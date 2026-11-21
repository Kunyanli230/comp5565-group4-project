import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(frontend);
let scratch;
let selectDemoSerial;
let serialHash;
const require = createRequire(import.meta.url);
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'origin-demo-serial-'));
  const output = path.join(scratch, 'demo.cjs');
  await build({
    stdin: {contents: 'export * from "./lib/demo.ts"; export { serialHash } from "./shared.ts";', resolveDir: path.join(frontend, 'src'), loader: 'ts'},
    outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    alias: {'@shared/hash': path.join(repo, 'shared/hash.js'), '@shared/constants': path.join(repo, 'shared/constants.js')},
  });
  ({selectDemoSerial, serialHash} = require(output));
});
after(async () => {if (scratch) await rm(scratch, {recursive: true, force: true});});

function chainWithSerials(serials) {
  const occupied = new Set(serials.map(serial => serialHash(serial)));
  return async hash => occupied.has(hash) ? 9007199254740993n : 0n;
}
describe('read-only demo serial selection', () => {
  it('skips the seeded product instead of filling its already-registered serial', async () => {
    assert.equal(await selectDemoSerial('LW-2026-0001', chainWithSerials(['LW-2026-0001'])), 'LW-2026-0002');
  });
  it('finds the next available serial after repeated live demonstrations', async () => {
    const serials = Array.from({length: 9}, (_, index) => `LW-2026-${String(index + 1).padStart(4, '0')}`);
    assert.equal(await selectDemoSerial('LW-2026-0001', chainWithSerials(serials)), 'LW-2026-0010');
  });
  it('can use the base serial only when the current chain has not registered it', async () => {
    assert.equal(await selectDemoSerial('LW-2026-0001', chainWithSerials([])), 'LW-2026-0001');
  });
  it('preserves suffix precision and width beyond Number.MAX_SAFE_INTEGER', async () => {
    assert.equal(await selectDemoSerial('DEMO-9007199254740993', chainWithSerials(['DEMO-9007199254740993'])), 'DEMO-9007199254740994');
  });
  it('uses a bounded fallback and verifies that candidate on-chain too', async () => {
    const hashes = [];
    const fallback = 'LW-2026-0001-unique-demo';
    const lookup = async hash => {hashes.push(hash);return hash === serialHash(fallback) ? 0n : 1n;};
    assert.equal(await selectDemoSerial('LW-2026-0001', lookup, {maxCandidates: 7, uniqueSuffix: () => 'unique-demo'}), fallback);
    assert.equal(hashes.length, 8);
    assert.equal(hashes.at(-1), serialHash(fallback));
  });
  it('does not claim availability when even its fallback is occupied', async () => {
    await assert.rejects(() => selectDemoSerial('LW-2026-0001', async () => 1n, {maxCandidates: 1, uniqueSuffix: () => 'occupied'}), /unused demo serial/);
  });
  it('propagates RPC failure rather than silently filling an unchecked serial', async () => {
    await assert.rejects(() => selectDemoSerial('LW-2026-0001', async () => {throw new Error('RPC unavailable');}), /RPC unavailable/);
  });
});
