import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isAddress, ZeroAddress } from 'ethers';
import { useDapp } from '../context/DappContext';
import { formatError } from '../lib/utils';
import { Button, Field, Notice, PageHeader } from '../components/ui';
import { LoadState, parseId, ProductSummary, sameAddress, useProduct, WriteAccess } from './data';

export default function Transfer() {
  const [query] = useSearchParams();
  const [id, setId] = useState(query.get('productId') ?? '1');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { config, ready, busy, account, chainId, transact, resetTransaction } = useDapp();
  const submitLock = useRef(false);
  const state = useProduct(id);
  const isOwner = !!state.product && sameAddress(account, state.product.owner);
  const allowed = ready && !!account && chainId === config?.chainId && isOwner && !state.loading && !state.product?.transferLocked;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!allowed || !config || busy || submitLock.current || !resetTransaction()) return;
    submitLock.current = true; setError(''); setSuccess('');
    try {
      const productId = parseId(id);
      if (!isAddress(recipient) || sameAddress(recipient, ZeroAddress)) throw new Error('Enter a valid nonzero recipient address.');
      if ([account, config.productRegistry, config.warrantyManager].some(a => sameAddress(a, recipient))) throw new Error('Choose a different owner; the recipient cannot be the registry or warranty contract.');
      const receipt = await transact(`Transfer product #${productId}`, r => r.transferOwnership(productId, recipient));
      if (receipt) { setSuccess(`Ownership of product #${productId} was transferred successfully.`); setRecipient(''); }
    } catch (error) { setError(formatError(error)); }
    finally { submitLock.current = false; }
  }
  return <div className="stack">
    <PageHeader eyebrow="OWNERSHIP" title="Transfer a product" description="Pass ownership to the next wallet. A product’s provenance and existing warranty travel with it." />
    <WriteAccess />
    <div className="workspace-grid"><form className="card stack" onSubmit={submit}>
      <h2>Transfer details</h2>
      <Field label="Product ID" hint="Enter the numeric product ID shown after registration, such as 4. The serial number belongs on the Verify page."><input required pattern="[1-9][0-9]*" inputMode="numeric" value={id} onChange={e => { setId(e.target.value); setSuccess(''); setError(''); }} /></Field>
      <Field label="Recipient wallet"><input required value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="0x…" /></Field>
      <div className="inline-actions"><Button type="button" className="button button-secondary" onClick={() => setRecipient(config?.accounts.customer ?? '')}>Use demo customer</Button><Button type="button" className="button button-secondary" onClick={() => setRecipient(config?.accounts.resaleBuyer ?? '')}>Use demo resale buyer</Button></div>
      <LoadState {...state} />
      {state.product && !!account && !isOwner && <Notice tone="error">Only the current product owner can transfer this product. Switch to that wallet first.</Notice>}
      {state.product?.transferLocked && <Notice tone="error">An open warranty claim locks this product. The service center must resolve the claim before ownership can change.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
      <Button type="submit" disabled={!allowed || busy}>Transfer ownership →</Button>
    </form>{state.product ? <ProductSummary product={state.product} metadata={state.metadata} active={state.active} pending={state.pending} /> : <aside className="card stack"><span className="eyebrow">WARRANTY CONTINUITY</span><h2>One product. One history.</h2><p className="muted">The first transfer to a customer starts the warranty. Resale never resets that start date.</p></aside>}</div>
  </div>;
}
