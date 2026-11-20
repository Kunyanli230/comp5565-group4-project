import { Interface, isAddress, ZeroAddress } from 'ethers';

export interface Product {
  id: bigint; serialHash: string; modelId: bigint; manufacturer: string; retailer: string; owner: string;
  manufacturedAt: bigint; warrantyStart: bigint; warrantyDuration: bigint; maxClaims: bigint;
  claimCount: bigint; transferLocked: boolean;
}
export interface Claim {
  id: bigint; productId: bigint; requester: string; resolver: string; reasonHash: string;
  noteHash: string; status: bigint; requestedAt: bigint; resolvedAt: bigint;
}
// Ethers Result is both an indexed tuple and a named record. Explicit conversion
// retains uint256 precision rather than round-tripping through JSON or Number.
type Tuple = Record<string, unknown> & readonly unknown[];
export function mapProduct(value: unknown): Product {
  const p = value as Tuple;
  return {
    id: BigInt(String(p.id ?? p[0])), serialHash: String(p.serialHash ?? p[1]), modelId: BigInt(String(p.modelId ?? p[2])),
    manufacturer: String(p.manufacturer ?? p[3]), retailer: String(p.retailer ?? p[4]), owner: String(p.owner ?? p[5]),
    manufacturedAt: BigInt(String(p.manufacturedAt ?? p[6])), warrantyStart: BigInt(String(p.warrantyStart ?? p[7])),
    warrantyDuration: BigInt(String(p.warrantyDuration ?? p[8])), maxClaims: BigInt(String(p.maxClaims ?? p[9])),
    claimCount: BigInt(String(p.claimCount ?? p[10])), transferLocked: Boolean(p.transferLocked ?? p[11]),
  };
}
export function mapClaim(value: unknown): Claim {
  const c = value as Tuple;
  return {
    id: BigInt(String(c.id ?? c[0])), productId: BigInt(String(c.productId ?? c[1])), requester: String(c.requester ?? c[2]),
    resolver: String(c.resolver ?? c[3]), reasonHash: String(c.reasonHash ?? c[4]), noteHash: String(c.noteHash ?? c[5]),
    status: BigInt(String(c.status ?? c[6])), requestedAt: BigInt(String(c.requestedAt ?? c[7])), resolvedAt: BigInt(String(c.resolvedAt ?? c[8])),
  };
}
export function positiveId(value: string, label = 'Product ID'): bigint {
  if (!/^[1-9][0-9]*$/.test(value.trim())) throw new Error(`${label} must be a positive whole number.`);
  const result = BigInt(value.trim());
  if (result >= 2n ** 256n) throw new Error(`${label} exceeds the uint256 limit.`);
  return result;
}
export function shortAddress(value: string, length = 6): string {
  return value.length > length * 2 + 3 ? `${value.slice(0, length)}…${value.slice(-4)}` : value;
}
export function dateTime(value: bigint | number | string): string {
  if (BigInt(value) === 0n) return 'Not started';
  const seconds = Number(value);
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}
export function validRecipient(value: string): boolean {
  return isAddress(value) && value.toLowerCase() !== ZeroAddress;
}
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
const contractErrors: Record<string, string> = {
  UnknownProduct: 'This product does not exist on the current chain.',
  SerialAlreadyRegistered: 'This serial number is already registered on-chain.',
  NotManufacturer: 'Connect the manufacturer account to register products.',
  NotRetailer: 'The recipient must have the retailer role.',
  NotProductOwner: 'Only the current product owner can perform this action.',
  InvalidRecipient: 'Choose a different, valid recipient address.',
  InvalidWarrantyTerms: 'Warranty duration and claim limit must each be at least one.',
  TransferLocked: 'This product has a pending warranty claim. Resolve it before transferring.',
  ClaimLimitReached: 'This product has used all of its warranty claims.',
  NotServiceCenter: 'Connect an authorised service-centre account.',
  WarrantyInactive: 'The warranty has not started, has expired, or has no claims remaining.',
  ClaimPending: 'This product already has a pending warranty claim.',
  UnknownClaim: 'This warranty claim does not exist.',
  ClaimNotPending: 'This claim has already been resolved.',
  SelfResolution: 'The requester cannot resolve their own claim. Use another authorised service centre.',
  RegistryNotLinked: 'The two contracts are not linked. Run the deployment script again.',
  EmptyHash: 'The supplied serial or description must not be empty.',
  ZeroAddress: 'The zero address cannot be used here.',
  AccessControlUnauthorizedAccount: 'This wallet does not have permission for this action.',
};
export function formatError(error: unknown, interfaces: Interface[] = []): string {
  const err = error as { code?: string | number; shortMessage?: string; message?: string; reason?: string; data?: unknown; info?: {error?: {data?: unknown; code?: number}}; revert?: {name?: string} };
  if (err?.code === 'ACTION_REJECTED' || err?.code === 4001 || err?.info?.error?.code === 4001) return 'The request was cancelled in your wallet. No new transaction was submitted.';
  if (err?.code === 'INSUFFICIENT_FUNDS') return 'This wallet has insufficient local test ETH to pay for gas.';
  let name = err?.revert?.name;
  const dataCandidates = [err?.data, err?.info?.error?.data];
  for (const item of dataCandidates) {
    const data = typeof item === 'string' ? item : (item as { data?: string } | undefined)?.data;
    if (!data) continue;
    for (const iface of interfaces) {
      try { const decoded = iface.parseError(data); if (decoded) name = decoded.name; } catch { /* Try the other ABI. */ }
    }
  }
  if (name && contractErrors[name]) return contractErrors[name];
  if (err?.code === 'NETWORK_ERROR') return 'The network changed or the local RPC is unavailable. Reconnect to Hardhat Local and refresh.';
  if (err?.code === 'CALL_EXCEPTION') return err.reason || (name ? `Contract rejected the operation: ${name}.` : 'The contract rejected this operation. Check ownership, role, and warranty status.');
  return err?.shortMessage || err?.message || 'The operation could not be completed. Please retry.';
}
