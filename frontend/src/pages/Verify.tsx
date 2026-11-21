import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ProductRecord } from '../../../shared/types';
import { useDapp } from '../context/DappContext';
import { createApi } from '../lib/api';
import { formatError, mapProduct } from '../lib/utils';
import { DEMO_PRODUCT, serialHash } from '../shared';
import { Address, Button, Field, Notice, PageHeader } from '../components/ui';
import { productPath, validMetadata } from './data';

export default function Verify() {
  const { config, registry, ready, revision } = useDapp();
  const [serial, setSerial] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ authentic: boolean; id: string; owner: string; active: boolean; hash: string; metadata: ProductRecord | null; warning: string } | null>(null);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setResult(null); setSearching(false); return () => { generation.current++; }; }, [registry, config, revision]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setResult(null);
    if (!ready || !registry || !config) { setError('The local blockchain is not available. Check the connection status above.'); return; }
    const request = ++generation.current;
    setSearching(true);
    try {
      const hash = serialHash(serial);
      const [authentic, productId, owner, active] = await registry.verify(hash);
      let metadata: ProductRecord | null = null;
      let warning = '';
      if (authentic) {
        try {
          const [record, product] = await Promise.all([createApi(config.offchainBaseUrl).getProductMetadata(hash), registry.getProduct(productId)]);
          if (!validMetadata(record, mapProduct(product))) throw new Error('Product metadata does not match the on-chain model fingerprint.');
          metadata = record;
        } catch (error) { warning = `The on-chain record is verified, but metadata could not be verified. ${formatError(error)}`; }
      }
      if (generation.current === request) setResult({ authentic: Boolean(authentic), id: productId.toString(), owner, active: Boolean(active), hash, metadata, warning });
    } catch (error) { if (generation.current === request) setError(formatError(error)); }
    finally { if (generation.current === request) setSearching(false); }
  }
  return <div className="stack">
    <PageHeader eyebrow="TRUST, VERIFIED" title="Know your product’s story." description="Check a serial number against its original blockchain record. No wallet connection required." />
    <section className="verify-hero card"><div className="verify-symbol" aria-hidden="true">✓</div><div><span className="eyebrow">PRODUCT AUTHENTICITY</span><h2>A passport you can verify.</h2><p className="muted">From its first registration to its latest owner, discover the record behind your product.</p></div></section>
    <form className="card stack" onSubmit={submit}>
      <Field label="Product serial number" hint="Use the exact case shown on your product. Surrounding spaces are ignored."><div className="search-row"><input required value={serial} onChange={e => { generation.current++; setSerial(e.target.value); setResult(null); setError(''); setSearching(false); }} placeholder="e.g. LW-2026-0001" /><Button type="submit" disabled={!ready || searching}>{searching ? 'Verifying…' : 'Verify product →'}</Button></div></Field>
      <button type="button" className="text-link" onClick={() => { generation.current++; setSerial(DEMO_PRODUCT.serial); setResult(null); setError(''); setSearching(false); }}>Try demo serial: {DEMO_PRODUCT.serial}</button>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
    {result && <section className={`card stack verification-result ${result.authentic ? 'is-authentic' : ''}`} aria-live="polite">
      <div className="inline-actions"><span className={`badge ${result.authentic ? 'badge-success' : 'badge-warning'}`}>{result.authentic ? '✓ On-chain record found' : 'No registered record'}</span>{result.authentic && <span className="badge">Product #{result.id}</span>}</div>
      <h2>{result.authentic ? result.metadata?.modelName ?? `Product #${result.id}` : 'This serial has not been registered.'}</h2>
      {result.authentic ? <><p className="muted">The serial matches a manufacturer-registered product. {result.metadata?.description}</p><dl className="details-grid"><div><dt>Current owner</dt><dd><Address value={result.owner} /></dd></div><div><dt>Warranty</dt><dd>{result.active ? 'Active' : 'Not active'}</dd></div></dl><Link className="button" to={productPath(result.id)}>View product passport →</Link></> : <p className="muted">Check the serial and its capitalization. An absent record does not by itself prove a physical product is counterfeit.</p>}
      {result.warning && <Notice>{result.warning}</Notice>}
      <details><summary>Serial fingerprint</summary><code className="hash">{result.hash}</code></details>
    </section>}
    <div className="stat-grid"><article className="card"><span className="step-number">01</span><h3>Registered at origin</h3><p className="muted">A manufacturer creates the original product record.</p></article><article className="card"><span className="step-number">02</span><h3>Ownership you can trace</h3><p className="muted">Transfers remain visible in the product’s event history.</p></article><article className="card"><span className="step-number">03</span><h3>Warranty that follows</h3><p className="muted">Service and resale share the same product passport.</p></article></div>
  </div>;
}
