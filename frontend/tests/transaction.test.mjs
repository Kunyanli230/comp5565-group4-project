import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const hash = `0x${'a1'.repeat(32)}`;
const otherHash = `0x${'b2'.repeat(32)}`;
const account = `0x${'12'.repeat(20)}`;
const receipt = {hash, status: 1, blockNumber: 19};
let scratch;
let core;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'comp5565-transaction-'));
  const output = path.join(scratch, 'transaction.cjs');
  await build({entryPoints: [path.join(frontend, 'src/lib/transaction.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent'});
  core = require(output);
});
after(async () => {if (scratch) await rm(scratch, {recursive: true, force: true});});

describe('transaction evidence and diagnostics', () => {
  it('recovers the send hash when ethers has not returned its transaction response', () => {
    assert.equal(core.extractTransactionHash({code: 'NETWORK_ERROR', info: {sendTransactionHash: hash}}), hash);
    assert.equal(core.extractTransactionHash({receipt: {hash, status: 0}}), hash);
    assert.equal(core.extractTransactionHash({info: {error: {data: {txHash: hash}}}}), hash);
  });
  it('recovers explicit transaction hashes from raw EIP-1193 node errors', () => {
    assert.equal(core.extractTransactionHash({code: -32603, data: {txHash: hash}}), hash);
    assert.equal(core.extractTransactionHash({code: -32603, data: {originalError: {code: -32000, data: {txHash: hash}}}}), hash);
    assert.equal(core.extractTransactionHash({info: {error: {data: {originalError: {data: {txHash: hash}}}}}}), hash);
    assert.equal(core.extractTransactionHash({data: {originalError: {data: {txHash: '0x1234', transaction: hash}}}}), undefined);
  });
  it('retains the signing account and confirmed hash even when no wallet error occurred', () => {
    assert.deepEqual(core.transactionDiagnostic(undefined, 'confirmation', account, 31337, hash), {
      stage: 'confirmation', code: undefined, message: undefined, account, chainId: 31337, hash,
    });
  });
  it('never guesses a hash from calldata, error text or malformed transaction fields', () => {
    assert.equal(core.extractTransactionHash({message: `request failed ${hash}`, data: hash}), undefined);
    assert.equal(core.extractTransactionHash({hash: '0x1234', transactionHash: account}), undefined);
    assert.equal(core.validTransactionHash(hash), true);
    assert.equal(core.validTransactionHash(`${hash}aa`), false);
  });
  it('exposes the nested node nonce error instead of a generic MetaMask wrapper', () => {
    const error = {code: 'UNKNOWN_ERROR', shortMessage: 'could not coalesce error', info: {error: {
      code: -32603, message: 'Internal JSON-RPC error.', data: {code: -32000, message: 'Nonce too high. Expected nonce to be 2 but got 5.'},
    }}};
    assert.deepEqual(core.transactionDiagnostic(error, 'wallet', account, 31337), {
      stage: 'wallet', code: -32000, message: 'Nonce too high. Expected nonce to be 2 but got 5.', account, chainId: 31337,
    });
  });
  it('does not expose payloads, signed bytes or unrelated wallet object fields', () => {
    const error = {code: -32000, message: `nonce mismatch; payload=${JSON.stringify({privateKey: hash})}`,
      privateKey: otherHash, params: [{data: otherHash}], walletState: {secret: 'not for display'}};
    const diagnostic = core.transactionDiagnostic(error, 'wallet', account, 31337, hash);
    assert.equal(diagnostic.message, 'nonce mismatch;');
    assert.equal(diagnostic.hash, hash);
    assert.equal(JSON.stringify(diagnostic).includes(otherHash), false);
    assert.equal(JSON.stringify(diagnostic).includes('privateKey'), false);
    assert.equal(core.transactionDiagnostic({message: `signed bytes ${otherHash}`}, 'wallet', account, 31337).message, 'signed bytes [hex data omitted]');
  });
  it('distinguishes preflight and gas estimation failures from uncertain sends', () => {
    assert.equal(core.failureOutcome(new Error('RPC offline'), 'preflight'), 'not_submitted');
    assert.equal(core.failureOutcome({code: 'CALL_EXCEPTION', action: 'estimateGas'}, 'wallet'), 'not_submitted');
    assert.equal(core.failureOutcome({code: -32603}, 'wallet'), 'submission_unknown');
  });
  it('keeps a known broadcast hash uncertain even if a later wallet request is rejected', () => {
    assert.equal(core.failureOutcome({code: 4001}, 'wallet'), 'not_submitted');
    assert.equal(core.failureOutcome({code: 'ACTION_REJECTED'}, 'wallet'), 'not_submitted');
    assert.equal(core.failureOutcome({code: 4001}, 'confirmation', hash), 'confirmation_unknown');
  });
  it('accepts only a matching mined receipt, including genuine mined reverts', () => {
    assert.equal(core.matchingReceipt(receipt, hash.toUpperCase().replace('0X', '0x')), receipt);
    assert.equal(core.matchingReceipt({...receipt, hash: otherHash}, hash), null);
    assert.equal(core.matchingReceipt({...receipt, status: null}, hash), null);
    assert.equal(core.matchingReceipt(null, hash), null);
    const reverted = {...receipt, status: 0};
    assert.equal(core.matchingReceipt(reverted, hash), reverted);
  });
  it('never treats the successful receipt of a wallet cancellation as the business operation', () => {
    const cancelled = {code: 'TRANSACTION_REPLACED', cancelled: true, receipt: {...receipt, hash: otherHash}};
    assert.equal(core.isCancelledReplacement(cancelled), true);
    assert.equal(core.replacementReceipt(cancelled), null);
  });
  it('accepts successful speed-ups and preserves a reverted replacement as a revert', () => {
    for (const status of [0, 1]) {
      const replacement = {...receipt, hash: otherHash, status};
      assert.equal(core.replacementReceipt({code: 'TRANSACTION_REPLACED', cancelled: false, receipt: replacement}), replacement);
    }
    assert.equal(core.replacementReceipt({code: 'CALL_EXCEPTION', receipt}), null);
    assert.equal(core.replacementReceipt({code: 'TRANSACTION_REPLACED', receipt}), null);
  });
});

describe('independent local receipt observation', () => {
  it('confirms using only read calls even when wallet confirmation tracking is unavailable', async () => {
    const calls = [];
    const result = await core.findKnownReceipt(() => hash, async value => {calls.push(value); return receipt;}, () => false);
    assert.equal(result, receipt);
    assert.deepEqual(calls, [hash]);
  });
  it('recovers after a temporary offline read without sending a transaction', async () => {
    let reads = 0;
    const result = await core.findKnownReceipt(() => hash, async () => {
      if (++reads === 1) throw new Error('RPC offline');
      return receipt;
    }, () => false, {timeoutMs: 1000, intervalMs: 0});
    assert.equal(result, receipt);
    assert.equal(reads, 2);
  });
  it('returns unknown for an offline RPC instead of manufacturing a revert', async () => {
    let reads = 0;
    const result = await core.findKnownReceipt(() => hash, async () => {reads++; throw new Error('offline');}, () => false, {timeoutMs: 10, intervalMs: 0});
    assert.equal(result, null);
    assert.ok(reads > 0);
    assert.equal(core.failureOutcome({message: 'offline'}, 'confirmation', hash), 'confirmation_unknown');
  });
  it('follows the verified replacement hash without reading a different receipt as success', async () => {
    let current = hash;
    const calls = [];
    const result = await core.findKnownReceipt(() => current, async value => {
      calls.push(value);
      if (value === hash) {current = otherHash; return {...receipt, hash: otherHash};}
      return {...receipt, hash: otherHash};
    }, () => false, {timeoutMs: 1000, intervalMs: 0});
    assert.deepEqual(calls, [hash, otherHash]);
    assert.equal(result.hash, otherHash);
  });
  it('stops observers after completion and does not publish a late read', async () => {
    let stopped = false;
    const result = await core.findKnownReceipt(() => hash, async () => {stopped = true; return receipt;}, () => stopped);
    assert.equal(result, null);
    let reads = 0;
    assert.equal(await core.findKnownReceipt(() => undefined, async () => {reads++; return receipt;}, () => false), null);
    assert.equal(reads, 0);
  });
});

describe('wallet and public RPC block identity', () => {
  it('compares one exact block height, allowing the wallet latest height to have advanced', async () => {
    const calls = [];
    await core.assertSameChainBlock(async (method, params) => {
      calls.push(['public', method, params]); return {number: '0x13', hash};
    }, {request: async ({method, params}) => {calls.push(['wallet', method, params]); return {number: '0x013', hash};}});
    assert.deepEqual(calls, [
      ['public', 'eth_getBlockByNumber', ['latest', false]],
      ['wallet', 'eth_getBlockByNumber', ['0x13', false]],
    ]);
  });
  it('blocks different nodes even when both have the same chain ID and deployment addresses', async () => {
    await assert.rejects(core.assertSameChainBlock(async () => ({number: '0x13', hash}), {
      request: async () => ({number: '0x13', hash: otherHash}),
    }), /different local chains/);
  });
  it('blocks a stale wallet node that cannot supply the selected public block', async () => {
    await assert.rejects(core.assertSameChainBlock(async () => ({number: '0x13', hash}), {request: async () => null}), /different local chains/);
  });
  it('fails before signing when either block lookup is offline or malformed', async () => {
    let walletReads = 0;
    await assert.rejects(core.assertSameChainBlock(async () => null, {request: async () => {walletReads++;}}), /could not provide a block/);
    assert.equal(walletReads, 0);
    await assert.rejects(core.assertSameChainBlock(async () => {throw new Error('public RPC offline');}, {request: async () => ({})}), /public RPC offline/);
    await assert.rejects(core.assertSameChainBlock(async () => ({number: '0x13', hash}), {request: async () => {throw new Error('wallet RPC offline');}}), /wallet RPC offline/);
  });
});
