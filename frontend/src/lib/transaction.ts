import type { Eip1193Provider } from 'ethers';

export type TransactionStage = 'preflight' | 'wallet' | 'confirmation';
export type TransactionOutcome = 'reverted' | 'confirmation_unknown' | 'submission_unknown' | 'not_submitted';
export interface TransactionDiagnostic {
  stage: TransactionStage;
  code?: string | number;
  message?: string;
  account: string;
  chainId: number | null;
  hash?: string;
}
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {};
export function validTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
}
export function extractTransactionHash(error: unknown): string | undefined {
  const e = record(error);
  const info = record(e.info);
  const receipt = record(e.receipt);
  const rpcData = record(record(info.error).data);
  const rawData = record(e.data);
  const originalData = record(record(rawData.originalError).data);
  const wrappedOriginalData = record(record(rpcData.originalError).data);
  // Only documented transaction fields are inspected. A calldata value or an
  // arbitrary 32-byte hex value in the error message is not a transaction hash.
  return [info.sendTransactionHash, e.transactionHash, e.hash, receipt.hash,
    receipt.transactionHash, record(e.transaction).hash, rpcData.txHash,
    rawData.txHash, originalData.txHash, wrappedOriginalData.txHash]
    .find(validTransactionHash) as string | undefined;
}
function safeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Never copy full RPC payloads, signed transaction bytes or arbitrary objects
  // into the UI. Nonce/RPC messages and public account addresses remain useful.
  return value.split(/\b(?:payload|transaction|request|arguments)\s*=/i)[0]
    .replace(/0x[0-9a-f]{64,}/gi, '[hex data omitted]').trim().slice(0, 400) || undefined;
}
function errorSources(error: unknown): RecordValue[] {
  const e = record(error);
  const nested = record(record(e.info).error);
  // MetaMask commonly wraps the useful node error inside `data`, underneath
  // an otherwise generic "Internal JSON-RPC error" message.
  return [record(record(nested.data).originalError), record(nested.data),
    record(record(e.data).originalError), record(e.data), nested, e];
}
export function transactionDiagnostic(error: unknown, stage: TransactionStage, account: string, chainId: number | null, hash?: string): TransactionDiagnostic {
  const e = record(error);
  const sources = errorSources(error);
  const rawCode = sources.map(source => source.code).find(code => typeof code === 'string' || typeof code === 'number');
  const code = typeof rawCode === 'number' ? rawCode : typeof rawCode === 'string' ? rawCode.slice(0, 80) : undefined;
  return {
    stage, code,
    message: sources.slice(0, -1).map(source => safeMessage(source.message)).find(Boolean)
      ?? safeMessage(e.shortMessage) ?? safeMessage(e.reason) ?? safeMessage(e.message),
    account, chainId, ...(validTransactionHash(hash) ? {hash} : {}),
  };
}
export function failureOutcome(error: unknown, stage: TransactionStage, hash?: string): TransactionOutcome {
  if (validTransactionHash(hash)) return 'confirmation_unknown';
  const e = record(error);
  const codes = errorSources(error).map(source => source.code);
  if (stage === 'preflight' || codes.includes(4001) || codes.includes('ACTION_REJECTED') || e.action === 'estimateGas') return 'not_submitted';
  // An eth_sendTransaction error without a returned hash does not establish
  // that the node never accepted the transaction. Do not recommend resending.
  return 'submission_unknown';
}
export function isCancelledReplacement(error: unknown): boolean {
  const e = record(error);
  return e.code === 'TRANSACTION_REPLACED' && e.cancelled === true;
}
export function replacementReceipt<T extends {hash: string; status: number | null}>(error: unknown): T | null {
  const e = record(error);
  const receipt = record(e.receipt);
  if (e.code !== 'TRANSACTION_REPLACED' || e.cancelled !== false || (receipt.status !== 0 && receipt.status !== 1) || !validTransactionHash(receipt.hash)) return null;
  return e.receipt as T;
}
export function matchingReceipt<T extends {hash: string; status: number | null}>(receipt: T | null, hash: string): T | null {
  return receipt && validTransactionHash(hash) && receipt.hash.toLowerCase() === hash.toLowerCase()
    && (receipt.status === 0 || receipt.status === 1) ? receipt : null;
}
export async function findKnownReceipt<T extends {hash: string; status: number | null}>(
  getHash: () => string | undefined,
  lookup: (hash: string) => Promise<T | null>,
  stopped: () => boolean,
  {timeoutMs = 15000, intervalMs = 500}: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (!stopped() && Date.now() < deadline) {
    const hash = getHash();
    if (!validTransactionHash(hash)) return null;
    try {
      const receipt = matchingReceipt(await lookup(hash), hash);
      if (stopped()) return null;
      if (receipt) return receipt;
    } catch { /* An offline RPC does not establish failure or non-submission. */ }
    if (!stopped() && Date.now() < deadline) await new Promise(resolve => globalThis.setTimeout(resolve, intervalMs));
  }
  return null;
}
type ReadRpc = (method: string, params: unknown[]) => Promise<unknown>;
export async function assertSameChainBlock(readRpc: ReadRpc, wallet: Eip1193Provider): Promise<void> {
  // The chain ID and deterministic deployment addresses can remain identical
  // across local resets or across two nodes. Compare one exact block instead
  // of comparing each node's moving `latest` block or only its chain ID.
  const anchor = record(await readRpc('eth_getBlockByNumber', ['latest', false]));
  if (typeof anchor.number !== 'string' || !/^0x[0-9a-f]+$/i.test(anchor.number) || !validTransactionHash(anchor.hash)) {
    throw new Error('The local RPC could not provide a block to verify the wallet network. No transaction was sent.');
  }
  const walletBlock = record(await wallet.request({method: 'eth_getBlockByNumber', params: [anchor.number, false]}));
  if (typeof walletBlock.number !== 'string' || !/^0x[0-9a-f]+$/i.test(walletBlock.number)
    || BigInt(walletBlock.number) !== BigInt(anchor.number) || !validTransactionHash(walletBlock.hash)
    || walletBlock.hash.toLowerCase() !== anchor.hash.toLowerCase()) {
    throw new Error('The wallet RPC and this workspace are on different local chains. Set the wallet RPC to http://127.0.0.1:8545, then refresh. No transaction was sent.');
  }
}
