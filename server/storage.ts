import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Firestore } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';

export type EntityRecord = { id: string; [key: string]: unknown };

export interface StoreTx {
  get<T>(collection: string, id: string): Promise<T | undefined>;
  query<T>(collection: string): Promise<T[]>;
  put(collection: string, id: string, value: unknown): void;
  delete(collection: string, id: string): void;
}

export interface Repository {
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  get<T>(collection: string, id: string): Promise<T | undefined>;
  query<T>(collection: string): Promise<T[]>;
}

export interface BlobStore {
  put(key: string, value: unknown): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

// Every adapter uses JSON values, including the same omission of undefined fields.
function json<T>(value: T): T {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Stored values must be JSON serializable.');
  return JSON.parse(encoded) as T;
}

function segment(value: string): void {
  if (!value || /[\\/\u0000]/u.test(value) || value === '.' || value === '..') {
    throw new TypeError('Collection and document IDs must be nonempty path segments.');
  }
}

function blobKey(key: string, prefix = false): void {
  if (prefix && key === '') return;
  const checked = prefix && key.endsWith('/') ? key.slice(0, -1) : key;
  if (!checked || /[\\\u0000]/u.test(checked) || checked.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('Blob keys must be relative paths without traversal segments.');
  }
}

function missing(error: unknown): boolean {
  const code = (error as { code?: string | number } | null)?.code;
  return code === 'ENOENT' || code === 404 || code === '404';
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolveNext => { release = resolveNext; });
    await previous;
    try { return await fn(); } finally { release(); }
  }
}

// Shared across local adapter instances in this process. Production uses Firestore.
const localMutexes = new Map<string, Mutex>();
function localMutex(path: string): Mutex {
  const canonical = process.platform === 'win32' ? path.toLowerCase() : path;
  let mutex = localMutexes.get(canonical);
  if (!mutex) { mutex = new Mutex(); localMutexes.set(canonical, mutex); }
  return mutex;
}

type State = Map<string, Map<string, unknown>>;
function copyState(state: State): State {
  return new Map([...state].map(([collection, entries]) => [collection, new Map([...entries].map(([id, value]) => [id, json(value)]))]));
}

function memoryTransaction(state: State) {
  let active = true;
  let dirty = false;
  const check = () => { if (!active) throw new Error('Transaction is already closed.'); };
  const tx: StoreTx = {
    async get<T>(collection: string, id: string) {
      check(); segment(collection); segment(id);
      const value = state.get(collection)?.get(id);
      return value === undefined ? undefined : json(value) as T;
    },
    async query<T>(collection: string) {
      check(); segment(collection);
      return [...(state.get(collection)?.values() ?? [])].map(value => json(value) as T);
    },
    put(collection, id, value) {
      check(); segment(collection); segment(id);
      const clean = json(value);
      let entries = state.get(collection);
      if (!entries) { entries = new Map(); state.set(collection, entries); }
      entries.set(id, clean);
      dirty = true;
    },
    delete(collection, id) {
      check(); segment(collection); segment(id);
      if (state.get(collection)?.delete(id)) dirty = true;
    },
  };
  return { tx, close: () => { active = false; }, isDirty: () => dirty };
}

export class MemoryRepository implements Repository {
  private state: State = new Map();
  private readonly mutex = new Mutex();

  async transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      const next = copyState(this.state);
      const transaction = memoryTransaction(next);
      try {
        const result = await fn(transaction.tx);
        this.state = next;
        return result;
      } finally { transaction.close(); }
    });
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    return this.transaction(tx => tx.get<T>(collection, id));
  }
  async query<T>(collection: string): Promise<T[]> {
    return this.transaction(tx => tx.query<T>(collection));
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

type LockOwner = { pid: number; host: string; token: string };
const FILE_LOCK_TIMEOUT_MS = 5_000;

async function readLockOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object') return undefined;
    const owner = value as Partial<LockOwner>;
    if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0 || typeof owner.host !== 'string' || typeof owner.token !== 'string') return undefined;
    return owner as LockOwner;
  } catch (error) {
    // A competing owner may still be writing its initial metadata.
    if (missing(error) || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function ownerIsDead(owner: LockOwner): boolean {
  if (owner.host !== hostname()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}

async function recoverDeadLock(path: string): Promise<void> {
  const candidate = await readLockOwner(path);
  if (!candidate || !ownerIsDead(candidate)) return;

  // Only one reclaimer may inspect/delete a stale lock. Without this guard, two
  // reclaimers could delete a new live owner's lock between their checks.
  const recoveryPath = `${path}.recovery`;
  let recovery;
  try { recovery = await open(recoveryPath, 'wx', 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return; throw error; }
  try {
    const current = await readLockOwner(path);
    if (current && ownerIsDead(current)) {
      try { await unlink(path); } catch (error) { if (!missing(error)) throw error; }
    }
  } finally {
    await recovery.close();
    await unlink(recoveryPath);
  }
}

async function acquireFileLock(path: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + FILE_LOCK_TIMEOUT_MS;
  const owner: LockOwner = { pid: process.pid, host: hostname(), token: randomUUID() };
  while (true) {
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await recoverDeadLock(path);
      if (Date.now() >= deadline) {
        const held = await readLockOwner(path);
        const detail = held ? ` by process ${held.pid} on ${held.host}` : '';
        throw new Error(`Local repository is locked${detail}. Wait for the running API/job operation to finish and retry. If a lock remains after all local app processes have stopped, remove "${path}" and "${path}.recovery" before restarting. Use Firestore for shared or multi-host deployments.`);
      }
      await delay(20 + Math.floor(Math.random() * 30));
      continue;
    }
    try { await handle.writeFile(JSON.stringify(owner), 'utf8'); await handle.sync(); }
    catch (error) {
      await handle.close();
      await unlink(path).catch(() => undefined);
      throw error;
    }
    return async () => {
      await handle.close();
      const current = await readLockOwner(path);
      if (current?.token !== owner.token) throw new Error('Local repository lock ownership changed unexpectedly; stop all local app processes before retrying.');
      await unlink(path);
    };
  }
}

// Local API and CLI processes serialize transactions on the same machine.
// Firestore remains the adapter for containers and shared/multi-host deployments.
export class FileRepository implements Repository {
  private readonly directory: string;
  private readonly path: string;
  private readonly mutex: Mutex;

  constructor(directory: string) {
    this.directory = resolve(directory);
    this.path = join(this.directory, 'repository.json');
    this.mutex = localMutex(this.path);
  }

  private async read(): Promise<State> {
    try {
      const stored: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(stored)) throw new Error('Invalid repository file.');
      const state: State = new Map();
      for (const row of stored) {
        if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !Array.isArray(row[1])) throw new Error('Invalid repository collection.');
        segment(row[0]);
        const entries = new Map<string, unknown>();
        for (const entry of row[1]) {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') throw new Error('Invalid repository record.');
          segment(entry[0]);
          entries.set(entry[0], entry[1]);
        }
        state.set(row[0], entries);
      }
      return state;
    } catch (error) { if (missing(error)) return new Map(); throw error; }
  }

  async transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      await mkdir(this.directory, { recursive: true });
      const release = await acquireFileLock(`${this.path}.lock`);
      try {
        // Load after acquiring the process lock so another process's latest
        // commit is included in every read and every read-modify-write cycle.
        const next = await this.read();
        const transaction = memoryTransaction(next);
        try {
          const result = await fn(transaction.tx);
          if (transaction.isDirty()) {
            await atomicJson(this.path, [...next].map(([collection, entries]) => [collection, [...entries]]));
          }
          return result;
        } finally { transaction.close(); }
      } finally { await release(); }
    });
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    return this.transaction(tx => tx.get<T>(collection, id));
  }
  async query<T>(collection: string): Promise<T[]> {
    return this.transaction(tx => tx.query<T>(collection));
  }
}

type Pending = { deleted: true } | { deleted: false; value: unknown };

export class FirestoreRepository implements Repository {
  private readonly db: Firestore;
  constructor(dbOrProject?: Firestore | string) {
      this.db = typeof dbOrProject === 'string' ? new Firestore({ projectId: dbOrProject, databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)' }) : dbOrProject ?? new Firestore({ databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)' });
  }

  async transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async native => {
      const pending = new Map<string, Map<string, Pending>>();
      let active = true;
      const check = () => { if (!active) throw new Error('Transaction is already closed.'); };
      const record = (collection: string, id: string, value: Pending) => {
        check(); segment(collection); segment(id);
        let writes = pending.get(collection);
        if (!writes) { writes = new Map(); pending.set(collection, writes); }
        writes.set(id, value);
      };
      const tx: StoreTx = {
        get: async <V>(collection: string, id: string): Promise<V | undefined> => {
          check(); segment(collection); segment(id);
          const staged = pending.get(collection)?.get(id);
          if (staged) return staged.deleted ? undefined : json(staged.value) as V;
          const snapshot = await native.get(this.db.collection(collection).doc(id));
          return snapshot.exists ? json(snapshot.data()!.value) as V : undefined;
        },
        query: async <V>(collection: string): Promise<V[]> => {
          check(); segment(collection);
          const snapshot = await native.get(this.db.collection(collection));
          const values = new Map<string, unknown>(snapshot.docs.map(doc => [doc.id, doc.data().value]));
          for (const [id, value] of pending.get(collection) ?? []) {
            if (value.deleted) values.delete(id); else values.set(id, value.value);
          }
          return [...values.values()].map(value => json(value) as V);
        },
        put: (collection, id, value) => record(collection, id, { deleted: false, value: json(value) }),
        delete: (collection, id) => record(collection, id, { deleted: true }),
      };
      try {
        const result = await fn(tx);
        // Firestore disallows reads after writes. Flush buffered per-entity writes last.
        for (const [collection, entries] of pending) {
          for (const [id, value] of entries) {
            const ref = this.db.collection(collection).doc(id);
            if (value.deleted) native.delete(ref); else native.set(ref, { value: value.value });
          }
        }
        return result;
      } finally { active = false; }
    });
  }

  async get<T>(collection: string, id: string): Promise<T | undefined> {
    segment(collection); segment(id);
    const snapshot = await this.db.collection(collection).doc(id).get();
    return snapshot.exists ? json(snapshot.data()!.value) as T : undefined;
  }
  async query<T>(collection: string): Promise<T[]> {
    segment(collection);
    const snapshot = await this.db.collection(collection).get();
    return snapshot.docs.map(doc => json(doc.data().value) as T);
  }
}

export class MemoryBlobStore implements BlobStore {
  private readonly values = new Map<string, unknown>();
  async put(key: string, value: unknown): Promise<void> { blobKey(key); this.values.set(key, json(value)); }
  async get<T>(key: string): Promise<T | undefined> {
    blobKey(key);
    const value = this.values.get(key);
    return value === undefined ? undefined : json(value) as T;
  }
  async delete(key: string): Promise<void> { blobKey(key); this.values.delete(key); }
  async list(prefix: string): Promise<string[]> { blobKey(prefix, true); return [...this.values.keys()].filter(key => key.startsWith(prefix)).sort(); }
}

export class FileBlobStore implements BlobStore {
  private readonly directory: string;
  private readonly mutex: Mutex;
  constructor(directory: string) {
    this.directory = resolve(directory);
    this.mutex = localMutex(`${this.directory}:blobs`);
  }
  private path(key: string): string {
    blobKey(key);
    // Hashing prevents platform filename restrictions and traversal through object keys.
    return join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  }
  async put(key: string, value: unknown): Promise<void> {
    const path = this.path(key);
    const clean = json(value);
    await this.mutex.run(async () => {
      await mkdir(this.directory, { recursive: true });
      await atomicJson(path, { key, value: clean });
    });
  }
  async get<T>(key: string): Promise<T | undefined> {
    const path = this.path(key);
    return this.mutex.run(async () => {
      try {
        const envelope = JSON.parse(await readFile(path, 'utf8')) as { key: string; value: T };
        if (envelope.key !== key) throw new Error('Blob key does not match stored object.');
        return envelope.value;
      } catch (error) { if (missing(error)) return undefined; throw error; }
    });
  }
  async delete(key: string): Promise<void> {
    const path = this.path(key);
    await this.mutex.run(async () => { try { await unlink(path); } catch (error) { if (!missing(error)) throw error; } });
  }
  async list(prefix: string): Promise<string[]> {
    blobKey(prefix, true);
    return this.mutex.run(async () => {
      let files: string[];
      try { files = await readdir(this.directory); } catch (error) { if (missing(error)) return []; throw error; }
      const keys: string[] = [];
      for (const file of files) {
        if (!/^[a-f0-9]{64}\.json$/u.test(file)) continue;
        try {
          const envelope = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as { key: string };
          if (typeof envelope.key !== 'string') throw new Error('Invalid blob metadata.');
          if (envelope.key.startsWith(prefix)) keys.push(envelope.key);
        } catch (error) { if (!missing(error)) throw error; }
      }
      return keys.sort();
    });
  }
}

export class GcsBlobStore implements BlobStore {
  private readonly bucket;
  constructor(bucketName: string, storage = new Storage()) {
    if (!bucketName) throw new TypeError('A Cloud Storage bucket is required.');
    this.bucket = storage.bucket(bucketName);
  }
  async put(key: string, value: unknown): Promise<void> {
    blobKey(key);
    await this.bucket.file(key).save(JSON.stringify(json(value)), { resumable: false, contentType: 'application/json', metadata: { cacheControl: 'private, no-store' } });
  }
  async get<T>(key: string): Promise<T | undefined> {
    blobKey(key);
    try { const [contents] = await this.bucket.file(key).download(); return JSON.parse(contents.toString('utf8')) as T; }
    catch (error) { if (missing(error)) return undefined; throw error; }
  }
  async delete(key: string): Promise<void> {
    blobKey(key);
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
  async list(prefix: string): Promise<string[]> {
    blobKey(prefix, true);
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map(file => file.name).sort();
  }
}
