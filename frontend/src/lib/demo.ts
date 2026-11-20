import { serialHash } from '../shared';

export type SerialLookup = (hash: string) => Promise<bigint>;

/** Choose an unused serial using read-only chain queries; never changes shared demo data. */
export async function selectDemoSerial(
  base: string,
  lookup: SerialLookup,
  options: { maxCandidates?: number; uniqueSuffix?: () => string } = {},
): Promise<string> {
  const limit = options.maxCandidates ?? 24;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Serial search must check between 1 and 100 candidates.');
  const match = /^(.*?)(\d+)$/.exec(base);
  if (!match) throw new Error('The demo serial must end in a number.');
  const [, prefix, digits] = match;
  const initial = BigInt(digits);
  // Small sequential batches avoid an unbounded browser loop/RPC flood while
  // preserving the first available suffix, even if read responses finish out of order.
  const batchSize = 6;
  for (let start = 0; start < limit; start += batchSize) {
    const candidates = Array.from({length: Math.min(batchSize, limit - start)}, (_, index) =>
      `${prefix}${(initial + BigInt(start + index)).toString().padStart(digits.length, '0')}`,
    );
    const ids = await Promise.all(candidates.map(candidate => lookup(serialHash(candidate))));
    const available = ids.findIndex(id => id === 0n);
    if (available !== -1) return candidates[available];
  }
  const suffix = options.uniqueSuffix?.() ?? `${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const candidate = `${base}-${suffix}`;
  // Randomness reduces collisions, but only a real contract lookup establishes
  // availability. Any RPC error is propagated; it never becomes a fake success.
  if (await lookup(serialHash(candidate)) !== 0n) throw new Error('Could not find an unused demo serial. Try Use demo values again.');
  return candidate;
}
