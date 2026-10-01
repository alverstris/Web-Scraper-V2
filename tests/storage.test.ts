import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileRepository } from '../server/storage.ts';

const storageUrl = new URL('../server/storage.ts', import.meta.url).href;

function childRepository(directory: string, body: string) {
  const source = `import { FileRepository } from ${JSON.stringify(storageUrl)};
    const repo = new FileRepository(process.argv[1]);
    ${body}`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source, directory], {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr!.on('data', data => { stderr += String(data); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve());
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Child exited before readiness (${code}): ${stderr}`)));
  });
  return { child, ready, exited, stderr: () => stderr };
}

test('FileRepository preserves updates from two simultaneous API/job processes', { timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'commute-storage-concurrency-'));
  const repo = new FileRepository(directory);
  const children: ReturnType<typeof childRepository>[] = [];
  try {
    await repo.transaction(async tx => { tx.put('counters', 'shared', { count: 0 }); });
    const body = `
      const start = new Promise(resolve => process.once('message', resolve));
      process.send('ready');
      await start;
      for (let index = 0; index < 35; index++) {
        await repo.transaction(async tx => {
          const counter = await tx.get('counters', 'shared');
          await new Promise(resolve => setTimeout(resolve, 3));
          tx.put('counters', 'shared', { count: counter.count + 1 });
        });
      }
      process.disconnect();`;
    children.push(childRepository(directory, body), childRepository(directory, body));
    await Promise.all(children.map(child => child.ready));
    children.forEach(({ child }) => child.send('start'));
    const outcomes = await Promise.all(children.map(child => child.exited));
    outcomes.forEach((outcome, index) => assert.equal(outcome.code, 0, children[index]!.stderr()));
    assert.deepEqual(await repo.get('counters', 'shared'), { count: 70 });
    assert.deepEqual(await new FileRepository(directory).query('counters'), [{ count: 70 }]);
  } finally {
    children.forEach(({ child }) => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    await Promise.all(children.map(child => child.exited));
    await rm(directory, { recursive: true, force: true });
  }
});

test('FileRepository safely recovers a killed process lock without committing its unfinished transaction', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'commute-storage-recovery-'));
  let holder: ReturnType<typeof childRepository> | undefined;
  try {
    const repo = new FileRepository(directory);
    await repo.transaction(async tx => { tx.put('counters', 'shared', { count: 1 }); });
    holder = childRepository(directory, `
      const keepAlive = setInterval(() => {}, 1000);
      await repo.transaction(async tx => {
        tx.put('counters', 'shared', { count: 999 });
        process.send('locked');
        await new Promise(() => {});
      });
      clearInterval(keepAlive);`);
    await holder.ready;
    const metadata = JSON.parse(await readFile(join(directory, 'repository.json.lock'), 'utf8')) as { pid: number };
    assert.equal(metadata.pid, holder.child.pid);
    holder.child.kill('SIGKILL');
    await holder.exited;
    assert.deepEqual(await repo.get('counters', 'shared'), { count: 1 });
    await repo.transaction(async tx => { tx.put('counters', 'shared', { count: 2 }); });
    assert.deepEqual(await repo.get('counters', 'shared'), { count: 2 });
  } finally {
    if (holder && holder.child.exitCode === null && holder.child.signalCode === null) holder.child.kill('SIGKILL');
    if (holder) await holder.exited;
    await rm(directory, { recursive: true, force: true });
  }
});

test('FileRepository bounds waiting on a live owner and reports how to recover', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'commute-storage-busy-'));
  const holder = childRepository(directory, `
    setInterval(() => {}, 1000);
    await repo.transaction(async () => {
      process.send('locked');
      await new Promise(() => {});
    });`);
  try {
    await holder.ready;
    await assert.rejects(new FileRepository(directory).get('counters', 'shared'), /Local repository is locked by process .*Wait for the running API\/job operation/);
    const metadata = JSON.parse(await readFile(join(directory, 'repository.json.lock'), 'utf8')) as { pid: number };
    assert.equal(metadata.pid, holder.child.pid, 'A waiting process must never reclaim a live owner lock.');
  } finally {
    holder.child.kill('SIGKILL');
    await holder.exited;
    await rm(directory, { recursive: true, force: true });
  }
});
