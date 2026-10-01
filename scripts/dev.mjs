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
process.env.HOST ||= '127.0.0.1';
process.env.PORT ||= '8787';
if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST)) {
  console.error('The local demo HOST must be 127.0.0.1, localhost or ::1.');
  process.exit(1);
}
const port = Number(process.env.PORT);
const startupTimeout = Number(process.env.DEV_STARTUP_TIMEOUT_MS ?? 90_000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer from 1 to 65535.');
  process.exit(1);
}
if (!Number.isInteger(startupTimeout) || startupTimeout < 1000 || startupTimeout > 300_000) {
  console.error('DEV_STARTUP_TIMEOUT_MS must be an integer from 1000 to 300000.');
  process.exit(1);
}
const healthHost = process.env.HOST === '::1' ? '[::1]' : process.env.HOST;
const healthUrl = `http://${healthHost}:${port}/health`;
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
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${label} stopped unexpectedly (${signal ?? 'exit code ' + code}).`);
      stop(code || 1);
    }
  });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
launch('API', ['--import', 'tsx', 'server/main.ts']);
console.log('Starting the Keywise API and preparing saved EPFL data. The first startup can take longer.');
let ready = false;
const startedAt = Date.now();
let nextProgress = startedAt + 10_000;
let lastFailure = 'No response received.';
while (Date.now() - startedAt < startupTimeout && !stopping) {
  try {
    const response = await fetch(healthUrl, {signal: AbortSignal.timeout(1000)});
    if (response.ok) {
      const health = await response.json();
      if (health?.ok === true && health.mode === 'demo') { ready = true; break; }
      lastFailure = 'The health endpoint did not report a ready Keywise demo API.';
    } else lastFailure = `The health endpoint returned HTTP ${response.status}.`;
  } catch (error) {
    lastFailure = error.cause?.code ?? error.code ?? error.message;
  }
  if (Date.now() >= nextProgress && !stopping) {
    console.log(`Still waiting for the API (${Math.round((Date.now() - startedAt) / 1000)} seconds)…`);
    nextProgress = Date.now() + 10_000;
  }
  await delay(200);
}
if (ready && !stopping) launch('Web', [resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1']);
else if (!stopping) {
  console.error(`The local API did not become ready within ${startupTimeout / 1000} seconds at ${healthUrl}. Last check: ${lastFailure}`);
  console.error('To inspect API startup directly, run: node --import tsx server/main.ts');
  console.error('If that API is running, leave it open and start the website in a second terminal with: npm.cmd run dev:web');
  stop(1);
}
