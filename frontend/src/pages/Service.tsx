import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDapp } from '../context/DappContext';
import { createApi } from '../lib/api';
import { dateTime, formatError, mapClaim, type Claim } from '../lib/utils';
import { DEMO_NOTE, noteHash, reasonHash } from '../shared';
import { Address, Button, Field, Notice, PageHeader } from '../components/ui';
import { productPath, sameAddress, WriteAccess } from './data';

type ClaimRow = { claim: Claim; reason: string; warning: string };
const PAGE_SIZE = 20n;

export default function Service() {
  const { config, warranty, account, chainId, roles, ready, busy, revision, transact } = useDapp();
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [total, setTotal] = useState(0n);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => {
    let cancelled = false;
    setRows([]); setError('');
    if (!warranty || !config) { setLoading(false); return; }
    setLoading(true);
    void (async () => {
      try {
        const count = BigInt(await warranty.nextClaimId()) - 1n;
        const start = count - BigInt(page) * PAGE_SIZE;
        const ids: bigint[] = [];
        for (let id = start; id > 0n && id > start - PAGE_SIZE; id--) ids.push(id);
        const records = await Promise.all(ids.map(async id => {
          const claim = mapClaim(await warranty.getClaim(id));
          let reason = ''; let warning = '';
          try {
            const metadata = await createApi(config.offchainBaseUrl).getReason(claim.reasonHash, claim.productId.toString());
            if (metadata.productId !== claim.productId.toString() || metadata.reasonHash.toLowerCase() !== claim.reasonHash.toLowerCase() || reasonHash(metadata.reasonText).toLowerCase() !== claim.reasonHash.toLowerCase()) throw new Error('Fault text does not match the on-chain fingerprint.');
            reason = metadata.reasonText;
          } catch (error) { warning = formatError(error); }
          return { claim, reason, warning };
        }));
        if (!cancelled) { setRows(records); setTotal(count); }
      } catch (error) { if (!cancelled) setError(formatError(error)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [warranty, config, revision, page]);
  const allowed = ready && !!account && chainId === config?.chainId && roles.serviceCenter;
  async function resolve(claim: Claim, approved: boolean) {
    if (!allowed || !config || !warranty || working || busy) return;
    setError(''); setSuccess(''); setWorking(true);
    try {
      const current = mapClaim(await warranty.getClaim(claim.id));
      if (current.status !== 1n) throw new Error('This claim has already been resolved. Refresh the queue.');
      if (sameAddress(current.requester, account)) throw new Error('A requester cannot resolve their own claim. Use a different authorised service-center wallet.');
      const note = notes[claim.id.toString()] ?? '';
      const hash = noteHash(note);
      if (note.length > 0) {
        const record = await createApi(config.offchainBaseUrl).createNote({ noteText: note });
        if (record.noteHash.toLowerCase() !== hash.toLowerCase() || record.noteText !== note) throw new Error('The stored service note does not match your input.');
      }
      const receipt = await transact(`${approved ? 'Approve' : 'Reject'} claim #${claim.id}`, (_r, w) => w.resolveClaim(claim.id, approved, hash));
      if (receipt) { setSuccess(`Claim #${claim.id} ${approved ? 'approved' : 'rejected'}. Product transfers are unlocked.`); setNotes(s => ({ ...s, [claim.id.toString()]: '' })); }
    } catch (error) { setError(formatError(error)); }
    finally { setWorking(false); }
  }
  const visible = rows.filter(row => !pendingOnly || row.claim.status === 1n);
  return <div className="stack">
    <PageHeader eyebrow="SERVICE CENTER" title="Warranty requests" description="Review the fault, record the outcome, and return the product to its owner’s care." />
    <WriteAccess role="serviceCenter" />
    <section className="card stack">
      <div className="section-heading"><div><h2>Service queue</h2><p className="muted">{total.toString()} total requests · up to 20 requests per page, newest first</p></div><label className="checkbox-label"><input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} /> Pending only</label></div>
      {loading && <p role="status" className="muted">Loading claims and fault descriptions…</p>}
      {error && <Notice tone="error">{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
      {!loading && visible.length === 0 && <div className="empty-state"><span className="empty-icon">✓</span><h3>{total === 0n ? 'No warranty requests yet' : 'No matching claims on this page'}</h3><p>{total === 0n ? 'Customer requests will appear here once confirmed on-chain.' : 'View all statuses or use the page controls to check older requests.'}</p></div>}
      {visible.map(({ claim, reason, warning }) => {
        const pending = claim.status === 1n;
        const status = pending ? 'Pending' : claim.status === 2n ? 'Approved' : 'Rejected';
        return <article className="claim-card stack" key={claim.id.toString()}>
          <div className="section-heading"><div className="inline-actions"><h3>Claim #{claim.id.toString()}</h3><Link className="text-link" to={productPath(claim.productId)}>Product #{claim.productId.toString()} ↗</Link></div><span className={`badge ${pending ? 'badge-warning' : claim.status === 2n ? 'badge-success' : ''}`}>{status}</span></div>
          <dl className="details-grid"><div><dt>Requested by</dt><dd><Address value={claim.requester} /></dd></div><div><dt>Requested at</dt><dd>{dateTime(claim.requestedAt)}</dd></div></dl>
          <div className="fault-description"><span className="eyebrow">FAULT DESCRIPTION</span><p className="preserve-whitespace">{reason || 'Fault text unavailable. The original fingerprint remains on-chain.'}</p></div>
          {warning && <p className="field-hint">Metadata: {warning}</p>}
          <details><summary>Fault fingerprint</summary><code className="hash">{claim.reasonHash}</code></details>
          {pending ? <><Field label={`Service note for claim #${claim.id}`} hint="Optional. Empty notes use a zero fingerprint and are not sent to the metadata service."><textarea value={notes[claim.id.toString()] ?? ''} rows={2} onChange={e => setNotes(s => ({ ...s, [claim.id.toString()]: e.target.value }))} placeholder="Work performed or reason for rejection" /></Field><div className="inline-actions"><Button type="button" className="button button-secondary" onClick={() => setNotes(s => ({ ...s, [claim.id.toString()]: DEMO_NOTE }))}>Use demo note</Button><Button type="button" className="button button-secondary" disabled={!allowed || busy || working || sameAddress(account, claim.requester)} onClick={() => void resolve(claim, false)}>Reject claim</Button><Button type="button" disabled={!allowed || busy || working || sameAddress(account, claim.requester)} onClick={() => void resolve(claim, true)}>Approve repair →</Button></div>{sameAddress(account, claim.requester) && <Notice>A requester cannot approve or reject their own claim.</Notice>}</> : <p className="muted">Resolved {dateTime(claim.resolvedAt)} by <Address value={claim.resolver} /></p>}
        </article>;
      })}
      <div className="pagination"><Button className="button button-secondary" disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>← Newer</Button><span className="muted">Page {page + 1}</span><Button className="button button-secondary" disabled={BigInt(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage(p => p + 1)}>Older →</Button></div>
    </section>
  </div>;
}
