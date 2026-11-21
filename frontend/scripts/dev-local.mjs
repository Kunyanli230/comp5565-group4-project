import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(frontend, '..');
const hardhat = resolve(repo, 'node_modules/hardhat/internal/cli/cli.js');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
async function rpc(method, params = []) {
  const r = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(1500) });
  const body = await r.json(); if (body.error) throw new Error(body.error.message); return body.result;
}
function occupied(port) { return new Promise(resolvePort => {
  const socket = createConnection({host: '127.0.0.1', port});
  socket.setTimeout(500);
  socket.once('connect', () => {socket.destroy(); resolvePort(true);});
  socket.once('error', () => resolvePort(false));
  socket.once('timeout', () => {socket.destroy(); resolvePort(false);});
}); }
function background(file, args = [], {cwd = repo, quiet = false} = {}) {
  const child = spawn(process.execPath, [file, ...args], {cwd, stdio: quiet ? 'ignore' : 'inherit'});
  children.push(child);
  child.once('error', err => {console.error(err.message); stop(1);});
  child.once('exit', (code, signal) => {if (!stopping) {console.error(`A demo service stopped (${code ?? signal}).`); stop(1);}});
  return child;
}
async function command(file, args = []) {
  await new Promise((ok, fail) => {
    const child = spawn(process.execPath, [file, ...args], {cwd: repo, stdio: 'inherit'});
    child.once('error', fail); child.once('exit', code => code === 0 ? ok() : fail(new Error(`Command failed (${code}).`)));
  });
}
async function waitUntil(check) {
  for (let i = 0; i < 45; i++) { try {if (await check()) return;} catch {} await new Promise(r => setTimeout(r, 500)); }
  throw new Error('A local service did not become ready. Check ports 8545 and 3001.');
}
try {
  if (!existsSync(hardhat) || !existsSync(resolve(frontend, 'node_modules/vite/bin/vite.js'))) throw new Error('Install dependencies at the repository root and frontend/: npm ci');
  if (await occupied(5173)) throw new Error('Port 5173 is already in use. Close the previous frontend, then retry.');
  let freshChain = false;
  if (await occupied(8545)) {
    if (BigInt(await rpc('eth_chainId')) !== 31337n) throw new Error('Port 8545 belongs to another network. It was left untouched.');
    console.log('Using the existing local chain (31337).');
  } else {
    background(hardhat, ['node', '--hostname', '127.0.0.1'], {quiet: true});
    await waitUntil(async () => BigInt(await rpc('eth_chainId')) === 31337n);
    freshChain = true;
    console.log('Started the local development chain.');
  }
  if (await occupied(3001)) {
    const health = await fetch('http://127.0.0.1:3001/health', {signal: AbortSignal.timeout(1500)}).then(r => r.json());
    if (health.ok !== true) throw new Error('Port 3001 is occupied by an unexpected service. It was left untouched.');
    console.log('Using the existing off-chain API.');
  } else {
    background(resolve(repo, 'offchain/server.js'));
    await waitUntil(async () => (await fetch('http://127.0.0.1:3001/health').then(r => r.json())).ok === true);
  }
  let deploy = freshChain;
  try {
    const config = JSON.parse(readFileSync(resolve(repo, 'deployments/local.json'), 'utf8'));
    for (const address of [config.productRegistry, config.warrantyManager]) if (await rpc('eth_getCode', [address, 'latest']) === '0x') deploy = true;
  } catch { deploy = true; }
  if (deploy) await command(hardhat, ['run', 'scripts/deploy.js', '--network', 'localhost']);
  await command(hardhat, ['run', 'scripts/seed.js', '--network', 'localhost']);
  await command(resolve(frontend, 'scripts/prepare.mjs'));
  background(resolve(frontend, 'node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1'], {cwd: frontend});
  console.log('\nOrigin is ready at http://127.0.0.1:5173\nKeep this terminal open. Ctrl+C stops only the services started by this launcher.\n');
} catch (err) { console.error(`\nCannot start demo: ${err.message}\n`); stop(1); }
