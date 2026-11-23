import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDapp } from '../context/DappContext';
import { createApi } from '../lib/api';
import { formatError } from '../lib/utils';
import { DEMO_REASON, reasonHash } from '../shared';
import { Button, Field, Notice, PageHeader } from '../components/ui';
import { LoadState, parseId, ProductSummary, sameAddress, useProduct, WriteAccess } from './data';

export default function Warranty() {
  const [query] = useSearchParams();
  const [id, setId] = useState(query.get('productId') ?? '1');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [working, setWorking] = useState(false);
  const { config, ready, busy, account, chainId, transact, resetTransaction } = useDapp();
  const submitLock = useRef(false);
  const state = useProduct(id);
  const isOwner = !!state.product && sameAddress(account, state.product.owner);
  const allowed = ready && !!account && chainId === config?.chainId && isOwner && state.active && state.pending === 0n && !state.loading;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!allowed || !config || busy || submitLock.current || !resetTransaction()) return;
    submitLock.current = true; setError(''); setSuccess('');
    setWorking(true);
    try {
      const productId = parseId(id);
      const hash = reasonHash(reason);
      const record = await createApi(config.offchainBaseUrl).createReason({ productId: productId.toString(), reasonText: reason });
      if (record.reasonHash.toLowerCase() !== hash.toLowerCase() || record.productId !== productId.toString() || record.reasonText !== reason) throw new Error('The stored fault description does not match your input.');
      const receipt = await transact(`Request warranty for product #${productId}`, (_r, w) => w.requestWarranty(productId, hash));
      if (receipt) { setSuccess('Warranty request confirmed. Ownership transfers are locked until the service center resolves this claim.'); setReason(''); }
    } catch (error) { setError(formatError(error)); }
    finally { submitLock.current = false; setWorking(false); }
  }
  return <div className="stack">
    <PageHeader eyebrow="CUSTOMER CARE" title="Request warranty service" description="Describe the fault and open a verifiable service request for a product you own." />
    <WriteAccess />
    <div className="workspace-grid"><form className="card stack" onSubmit={submit}>
      <h2>Tell us what happened</h2>
      <Field label="Product ID" hint="Use the same numeric product ID as the sale, not the serial number."><input required pattern="[1-9][0-9]*" inputMode="numeric" value={id} onChange={e => { setId(e.target.value); setSuccess(''); setError(''); }} /></Field>
      <Field label="Fault description" hint="Your exact text, including spaces, is preserved in its fingerprint."><textarea required rows={5} value={reason} onChange={e => setReason(e.target.value)} placeholder="Describe the issue you are experiencing…" /></Field>
      <Button className="button button-secondary" type="button" onClick={() => setReason(DEMO_REASON)}>Use demo description</Button>
      <LoadState {...state} />
      {state.product && !!account && !isOwner && <Notice tone="error">Connect the current owner’s wallet to request service.</Notice>}
      {state.product && !state.active && <Notice>This product’s warranty is not active. It may not have started, may have expired, or may have no approved claims remaining.</Notice>}
      {state.pending > 0n && <Notice>Claim #{state.pending.toString()} is already pending for this product.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
      <Button type="submit" disabled={!allowed || busy || working}>{working ? 'Submitting…' : 'Submit warranty request →'}</Button>
    </form>{state.product ? <ProductSummary product={state.product} metadata={state.metadata} active={state.active} pending={state.pending} /> : <aside className="card stack"><span className="eyebrow">SERVICE WITH A RECORD</span><h2>Every claim is traceable.</h2><p className="muted">A pending claim temporarily prevents resale. Approved repairs consume one claim; rejected requests do not.</p></aside>}</div>
  </div>;
}
