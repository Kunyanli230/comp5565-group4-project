import { after, before, beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const repository = path.resolve(frontend, '..');
const require = createRequire(import.meta.url);
let scratch;
let core;
let api;
let originalFetch;
const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const body = {serial: '  SERIAL-precision  ', modelName: ' LuxeWatch X ', description: 'Description with exact spacing  '};
let record;

before(async () => {
  // Bundle the real browser sources and frozen CJS shared modules, rather than
  // recreating the hashing/API implementation in test fixtures.
  scratch = await mkdtemp(path.join(tmpdir(), 'comp5565-frontend-core-'));
  const output = path.join(scratch, 'core.cjs');
  await build({
    stdin: {contents: 'export * from "./lib/api.ts"; export * from "./lib/utils.ts"; export * from "./shared.ts";', resolveDir: path.join(frontend, 'src'), loader: 'ts'},
    outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    alias: {'@shared/hash': path.join(repository, 'shared/hash.js'), '@shared/constants': path.join(repository, 'shared/constants.js')},
  });
  core = require(output);
  record = {serialHash: core.serialHash(body.serial), modelId: core.modelIdFromName(body.modelName), modelName: body.modelName.trim(), description: body.description, createdAt: '2026-11-16T00:00:00.000Z'};
});
after(async () => { if (scratch) await rm(scratch, {recursive: true, force: true}); });
beforeEach(() => { originalFetch = globalThis.fetch; api = core.createApi('http://127.0.0.1:3001/'); });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('product registration retries', () => {
  it('reuses matching plaintext after a cancelled wallet request without changing the record', async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({url, method: options.method, body: options.body});
      return options.method === 'POST' ? response({error: 'serial_exists', serialHash: record.serialHash, modelId: record.modelId}, 409) : response(record);
    };
    assert.deepEqual(await api.createProduct(body), record);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].url, `http://127.0.0.1:3001/products/${record.serialHash}`);
  });
  for (const field of ['modelId', 'modelName', 'description', 'serialHash']) {
    it(`rejects a conflicting existing ${field} instead of registering altered product details`, async () => {
      globalThis.fetch = async (_url, options) => options.method === 'POST'
        ? response({error: 'serial_exists'}, 409)
        : response({...record, [field]: field === 'modelId' ? '123' : 'different'});
      await assert.rejects(() => api.createProduct(body), /different product details/);
    });
  }
  it('rejects a successful-looking response with a different on-chain model fingerprint', async () => {
    globalThis.fetch = async () => response({...record, modelId: '9007199254740993'});
    await assert.rejects(() => api.createProduct(body), /do not match/);
  });
});

describe('frozen hash and integer rules', () => {
  it('keeps model IDs and product IDs above Number.MAX_SAFE_INTEGER exact', () => {
    const large = 9007199254740993n;
    const mapped = core.mapProduct([large, record.serialHash, BigInt(record.modelId), 'manufacturer', 'retailer', 'owner', 1n, 0n, 31536000n, 2n, 0n, false]);
    assert.equal(core.positiveId(large.toString()), large);
    assert.equal(mapped.id, large);
    assert.equal(mapped.modelId.toString(), record.modelId);
    assert.equal(mapped.transferLocked, false);
    const claim = core.mapClaim([large, large + 1n, 'requester', 'resolver', 'reason', 'note', 1n, 123n, 0n]);
    assert.equal(claim.productId, large + 1n);
  });
  it('rejects fractional, zero and uint256-overflow IDs', () => {
    for (const invalid of ['1.2', '0', '-1', '1e9', (2n ** 256n).toString()]) assert.throws(() => core.positiveId(invalid));
  });
  it('trims only serial/model edges, preserves case, and preserves fault/repair text whitespace', () => {
    assert.equal(core.serialHash(' LW-1 '), core.serialHash('LW-1'));
    assert.notEqual(core.serialHash('LW-1'), core.serialHash('lw-1'));
    assert.notEqual(core.reasonHash(' fault '), core.reasonHash('fault'));
    assert.notEqual(core.noteHash(' note '), core.noteHash('note'));
  });
  it('uses zero bytes32 for empty service notes', () => {
    assert.equal(core.noteHash(''), core.ZERO_BYTES32);
    assert.notEqual(core.noteHash(' '), core.ZERO_BYTES32);
  });
  it('rejects an API that trims fault text before hashing', async () => {
    const reasonText = '  Screen flicker  ';
    globalThis.fetch = async () => response({productId: '2', reasonText: reasonText.trim(), reasonHash: core.reasonHash(reasonText.trim())});
    await assert.rejects(() => api.createReason({productId: '2', reasonText}), /does not match/);
  });
  it('rejects service-note hash or raw-text mismatch', async () => {
    globalThis.fetch = async () => response({noteText: 'wrong note', noteHash: core.noteHash('wrong note')});
    await assert.rejects(() => api.createNote({noteText: ' intended note '}), /does not match/);
  });
  it('always includes productId when retrieving a shared reason hash', async () => {
    let url;
    const hash = core.reasonHash('Screen flicker');
    globalThis.fetch = async value => {url = value; return response({productId: '9007199254740993', reasonHash: hash, reasonText: 'Screen flicker'});};
    await api.getReason(hash, '9007199254740993');
    assert.equal(url, `http://127.0.0.1:3001/claims/${hash}?productId=9007199254740993`);
  });
});

describe('errors and cancellation', () => {
  it('branches on the API error code instead of the mutable human message', async () => {
    globalThis.fetch = async () => response({error: 'not_found', message: 'A completely unrelated service message'}, 404);
    await assert.rejects(() => api.getProductMetadata(record.serialHash), error => {
      assert.ok(error instanceof core.ApiError);
      assert.equal(error.code, 'not_found');
      assert.equal(error.status, 404);
      assert.doesNotMatch(error.message, /unrelated/);
      return true;
    });
  });
  it('maps unavailable API and invalid JSON to usable errors', async () => {
    globalThis.fetch = async () => {throw new TypeError('Failed to fetch');};
    await assert.rejects(() => api.health(), error => error instanceof core.ApiError && error.code === 'unavailable');
    globalThis.fetch = async () => new Response('<html>not JSON</html>');
    await assert.rejects(() => api.health(), error => error instanceof core.ApiError && error.code === 'invalid_response');
  });
  it('preserves caller abort cancellation instead of masking it as service failure', async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async (_url, options) => {assert.equal(options.signal.aborted, true); throw new DOMException('Cancelled', 'AbortError');};
    await assert.rejects(() => api.health(controller.signal), error => error.name === 'AbortError');
  });
  it('maps wallet user rejection by numeric and ethers error codes', () => {
    for (const error of [{code: 4001}, {code: 'ACTION_REJECTED'}, {info: {error: {code: 4001}}}]) {
      assert.match(core.formatError(error), /cancelled in your wallet/);
    }
  });
});
