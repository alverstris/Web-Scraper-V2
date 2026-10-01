import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
if ((process.env.APP_MODE ?? 'demo') !== 'demo') {
  console.error('The local combined dev command only runs synthetic demo mode. Start separate reviewed services for live integration testing.');
  process.exit(1);
}
process.env.APP_MODE = 'demo';
process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '8787';
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
function launch(label, args) {
  const child = spawn(process.execPath, args, {cwd: root, env: process.env, stdio: 'inherit', windowsHide: true});
  children.push(child);
  child.on('error', error => { console.error(`${label}: ${error.message}`); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
launch('API', ['--import', 'tsx', 'server/main.ts']);
let ready = false;
for (let attempt = 0; attempt < 100 && !stopping; attempt++) {
  try {
    const response = await fetch(`http://${process.env.HOST}:${process.env.PORT}/health`, {signal: AbortSignal.timeout(500)});
    if (response.ok) { ready = true; break; }
  } catch { /* The API can still be starting. */ }
  await delay(200);
}
if (ready && !stopping) launch('Web', [resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1']);
else if (!stopping) { console.error('The local API did not become ready. Check its startup output.'); stop(1); }
