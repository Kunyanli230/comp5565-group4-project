import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EventLog } from 'ethers';
import { useDapp } from '../context/DappContext';
import { createApi } from '../lib/api';
import { dateTime, formatError } from '../lib/utils';
import { noteHash, reasonHash, ROUTES, ZERO_BYTES32 } from '../shared';
import { Address, Button, Notice, PageHeader } from '../components/ui';
import { LoadState, parseId, sameAddress, useProduct } from './data';

type HistoryEntry = {
  key: string; block: number; index: number; tx: string; title: string; timestamp: bigint;
  description: string; address?: string; hash?: string; kind: 'registered' | 'transfer' | 'request' | 'resolution';
};
const BLOCK_WINDOW = 5000;

export default function ProductPage() {
  const { productId = '' } = useParams();
  const { config, provider, registry, warranty, revision, account } = useDapp();
  const state = useProduct(productId);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [nextBlock, setNextBlock] = useState<number | null>(null);
  const [scannedFrom, setScannedFrom] = useState<number | null>(null);
  const historyVersion = useRef(0);

  async function readWindow(toBlock: number, version: number, replace: boolean) {
    if (!provider || !registry || !warranty || !config) return;
    const id = parseId(productId);
    const fromBlock = Math.max(0, toBlock - BLOCK_WINDOW + 1);
    setHistoryLoading(true); setHistoryError('');
    try {
      const [registered, transfers, requests, resolutions] = await Promise.all([
        registry.queryFilter(registry.filters.Registered(id), fromBlock, toBlock),
        registry.queryFilter(registry.filters.OwnershipTransferred(id), fromBlock, toBlock),
        warranty.queryFilter(warranty.filters.ClaimRequested(null, id), fromBlock, toBlock),
        warranty.queryFilter(warranty.filters.ClaimResolved(null, id), fromBlock, toBlock),
      ]);
      const events = [...registered, ...transfers, ...requests, ...resolutions].filter((event): event is EventLog => 'args' in event);
      const api = createApi(config.offchainBaseUrl);
      const entries = await Promise.all(events.map(async event => {
        const args = event.args;
        const common = { key: `${event.transactionHash}:${event.index}`, block: event.blockNumber, index: event.index, tx: event.transactionHash };
        if (event.eventName === 'Registered') return { ...common, title: 'Product registered', timestamp: BigInt(args.manufacturedAt), description: 'The manufacturer issued this passport and assigned it to the retailer.', address: String(args.manufacturer), kind: 'registered' as const };
        if (event.eventName === 'OwnershipTransferred') return { ...common, title: args.warrantyStarted ? 'First customer sale · warranty started' : 'Ownership transferred', timestamp: BigInt(args.timestamp), description: `From ${String(args.from)} to ${String(args.to)}. ${args.warrantyStarted ? 'The warranty clock started with this transfer.' : 'The original warranty start is preserved.'}`, address: String(args.to), kind: 'transfer' as const };
        if (event.eventName === 'ClaimRequested') {
          let description = `Claim #${args.claimId}. Original fault description unavailable.`;
          try {
            const reason = await api.getReason(String(args.reasonHash), id.toString());
            if (reason.productId !== id.toString() || reasonHash(reason.reasonText).toLowerCase() !== String(args.reasonHash).toLowerCase()) throw new Error('Fingerprint mismatch');
            description = `Claim #${args.claimId}: ${reason.reasonText}`;
          } catch { /* The event remains visible if the off-chain service is offline. */ }
          return { ...common, title: 'Warranty requested · transfer locked', timestamp: BigInt(args.requestedAt), description, address: String(args.requester), hash: String(args.reasonHash), kind: 'request' as const };
        }
        let description = `Claim #${args.claimId} ${args.approved ? 'approved' : 'rejected'}. Transfers unlocked. Approved claims used: ${args.claimCount}.`;
        const hash = String(args.noteHash);
        if (hash.toLowerCase() !== ZERO_BYTES32) {
          try {
            const note = await api.getNote(hash);
            if (noteHash(note.noteText).toLowerCase() !== hash.toLowerCase()) throw new Error('Fingerprint mismatch');
            description += ` Service note: ${note.noteText}`;
          } catch { description += ' Service note unavailable.'; }
        }
        return { ...common, title: args.approved ? 'Repair approved · claim recorded' : 'Claim rejected · transfer unlocked', timestamp: BigInt(args.resolvedAt), description, address: String(args.resolver), hash, kind: 'resolution' as const };
      }));
      if (historyVersion.current !== version) return;
      setHistory(previous => {
        const unique = new Map((replace ? entries : [...previous, ...entries]).map(entry => [entry.key, entry]));
        return [...unique.values()].sort((a, b) => b.block - a.block || b.index - a.index);
      });
      setScannedFrom(fromBlock); setNextBlock(fromBlock > 0 ? fromBlock - 1 : null);
    } catch (error) { if (historyVersion.current === version) setHistoryError(formatError(error)); }
    finally { if (historyVersion.current === version) setHistoryLoading(false); }
  }
  useEffect(() => {
    const version = ++historyVersion.current;
    setHistory([]); setHistoryError(''); setNextBlock(null); setScannedFrom(null);
    if (!provider || !registry || !warranty || !config) return;
    try { parseId(productId); } catch { return; }
    setHistoryLoading(true);
    void provider.getBlockNumber().then(block => {
      if (version === historyVersion.current) return readWindow(block, version, true);
    }).catch(error => {
      if (version === historyVersion.current) { setHistoryError(formatError(error)); setHistoryLoading(false); }
    });
    return () => { historyVersion.current++; };
    // Each deployment, ID, and confirmed transaction starts a fresh event scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, registry, warranty, config, revision, productId]);

  const product = state.product;
  const isOwner = !!product && sameAddress(product.owner, account);
  return <div className="stack">
    <PageHeader eyebrow="DIGITAL PRODUCT PASSPORT" title={state.metadata?.modelName ?? (product ? `Product #${product.id}` : 'Product passport')} description={state.metadata?.description ?? 'An independently verifiable record of origin, ownership, and care.'}>
      <Link className="button button-secondary" to={ROUTES.verify}>Verify another product ↗</Link>
    </PageHeader>
    <LoadState {...state} />
    {product && <>
      <section className="passport-hero card"><div className="passport-mark" aria-hidden="true">◇</div><div className="stack"><span className="eyebrow">PASSPORT #{product.id.toString()}</span><h2>{state.metadata?.modelName ?? 'Registered product'}</h2><div className="inline-actions"><span className="badge badge-success">✓ Authentic record</span><span className={`badge ${state.active ? 'badge-success' : ''}`}>{state.active ? 'Warranty active' : product.warrantyStart === 0n ? 'Warranty not started' : 'Warranty inactive'}</span>{product.transferLocked && <span className="badge badge-warning">Transfer locked</span>}</div></div></section>
      <div className="stat-grid"><article className="stat-card"><span className="eyebrow">CURRENT OWNER</span><strong className="stat-label"><Address value={product.owner} /></strong><p>{isOwner ? 'This product belongs to your connected wallet' : 'Ownership recorded on-chain'}</p></article><article className="stat-card"><span className="eyebrow">APPROVED CLAIMS</span><strong>{product.claimCount.toString()} <small>/ {product.maxClaims.toString()}</small></strong><p>{(product.maxClaims - product.claimCount).toString()} remaining</p></article><article className="stat-card"><span className="eyebrow">WARRANTY EXPIRES</span><strong className="stat-label">{product.warrantyStart === 0n ? 'Not activated' : dateTime(product.warrantyStart + product.warrantyDuration)}</strong><p>{product.warrantyStart === 0n ? 'Starts at the first sale to a customer' : 'Original start date preserved on resale'}</p></article></div>
      <section className="card stack"><div className="section-heading"><h2>Product details</h2><span className="badge">On-chain record</span></div><dl className="details-grid"><div><dt>Manufacturer</dt><dd><Address value={product.manufacturer} /></dd></div><div><dt>Original retailer</dt><dd><Address value={product.retailer} /></dd></div><div><dt>Manufactured at</dt><dd>{dateTime(product.manufacturedAt)}</dd></div><div><dt>Warranty started</dt><dd>{product.warrantyStart === 0n ? 'Not started' : dateTime(product.warrantyStart)}</dd></div><div><dt>Warranty duration</dt><dd>{product.warrantyDuration.toString()} seconds</dd></div><div><dt>Pending claim</dt><dd>{state.pending > 0n ? `#${state.pending}` : 'None'}</dd></div></dl><details><summary>Product fingerprints</summary><div className="stack"><div><span className="field-label">Serial hash</span><code className="hash">{product.serialHash}</code></div><div><span className="field-label">Model ID</span><code className="hash">{product.modelId.toString()}</code></div></div></details><div className="inline-actions"><Link className="button button-secondary" to={`${ROUTES.transfer}?productId=${product.id}`}>Transfer ownership →</Link><Link className="button" to={`${ROUTES.warranty}?productId=${product.id}`}>Request warranty →</Link></div></section>
      <section className="card stack"><div className="section-heading"><div><span className="eyebrow">PROVENANCE & CARE</span><h2>A history that stays with the product</h2></div><span className="badge">Blockchain events</span></div>
        {historyError && <Notice tone="error">{historyError}</Notice>}
        {history.length === 0 && !historyLoading && !historyError && <div className="empty-state"><p>No product events found in the scanned block range.</p></div>}
        <ol className="timeline">{history.map(entry => <li className={`timeline-item timeline-${entry.kind}`} key={entry.key}><span className="timeline-dot" aria-hidden="true">{entry.kind === 'registered' ? '◇' : entry.kind === 'transfer' ? '↗' : entry.kind === 'request' ? '＋' : '✓'}</span><div className="stack"><div className="section-heading"><h3>{entry.title}</h3><time className="muted">{dateTime(entry.timestamp)}</time></div><p className="preserve-whitespace">{entry.description}</p>{entry.address && <Address value={entry.address} />}<details><summary>Transaction · block {entry.block.toString()}</summary><code className="hash">{entry.tx}</code>{entry.hash && <><span className="field-label">Description fingerprint</span><code className="hash">{entry.hash}</code></>}</details></div></li>)}</ol>
        {historyLoading && <p className="muted" role="status">Reading blockchain event history…</p>}
        {scannedFrom !== null && <p className="field-hint">Events scanned from block {scannedFrom.toString()} to the latest block. History is read from contract logs and is never stored separately in this browser.</p>}
        {nextBlock !== null && <Button className="button button-secondary" disabled={historyLoading} onClick={() => void readWindow(nextBlock, historyVersion.current, false)}>Load older blocks →</Button>}
      </section>
    </>}
    {!product && !state.loading && !state.error && <Notice>Start the local workspace to read this product’s passport.</Notice>}
  </div>;
}
