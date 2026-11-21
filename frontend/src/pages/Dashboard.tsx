import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProductRecord } from '../../../shared/types';
import { useDapp } from '../context/DappContext';
import { createApi } from '../lib/api';
import { formatError, mapProduct } from '../lib/utils';
import { Address, Button, Notice, PageHeader } from '../components/ui';
import { productPath, type Product, validMetadata } from './data';
import { ROUTES } from '../shared';
import { ArrowRight, ArrowUpRight, Box, Check, Fingerprint, Layers3, ShieldCheck, Sparkles, Wallet } from 'lucide-react';

const PAGE_SIZE = 8n;
type ProductRow = { product: Product; metadata: ProductRecord | null; active: boolean };
export default function Dashboard() {
  const { config, registry, warranty, ready, revision, roles, account } = useDapp();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0n);
  const [claims, setClaims] = useState(0n);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [metadataMissing, setMetadataMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setRows([]); setError(''); setMetadataMissing(false);
    if (!registry || !warranty || !config) { setLoading(false); return; }
    setLoading(true);
    void (async () => {
      try {
        const [next, nextClaim] = await Promise.all([registry.nextProductId(), warranty.nextClaimId()]);
        const count = BigInt(next) - 1n;
        const start = count - BigInt(page) * PAGE_SIZE;
        const ids: bigint[] = [];
        for (let id = start; id > 0n && id > start - PAGE_SIZE; id--) ids.push(id);
        let missing = false;
        const products = await Promise.all(ids.map(async id => {
          const [raw, active] = await Promise.all([registry.getProduct(id), registry.isWarrantyActive(id)]);
          const product = mapProduct(raw);
          let metadata: ProductRecord | null = null;
          try {
            const record = await createApi(config.offchainBaseUrl).getProductMetadata(product.serialHash);
            if (!validMetadata(record, product)) throw new Error('Fingerprint mismatch');
            metadata = record;
          } catch { missing = true; }
          return { product, metadata, active: Boolean(active) };
        }));
        if (!cancelled) { setTotal(count); setClaims(BigInt(nextClaim) - 1n); setRows(products); setMetadataMissing(missing); }
      } catch (error) { if (!cancelled) setError(formatError(error)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [registry, warranty, config, revision, page]);
  const identity = !account ? 'Public viewer' : roles.manufacturer ? 'Manufacturer' : roles.serviceCenter ? 'Service center' : roles.retailer ? 'Retailer' : roles.admin ? 'Administrator' : 'Product owner';
  return <div className="stack">
    <PageHeader eyebrow="YOUR CONNECTED WORKSPACE" title="Workspace overview" description="The complete picture of your products, ownership, and care."><span className={`workspace-live ${ready ? 'is-live' : ''}`}><span className="status-dot" />{ready ? 'Connected to local chain' : 'Waiting for connection'}</span></PageHeader>
    <section className="dashboard-hero">
      <div className="hero-copy"><div className="hero-label"><span className="hero-label-dot" />THE DIGITAL PRODUCT PASSPORT</div><h2>Every product.<br /><span>A verifiable story.</span></h2><p>From the first registration to the next owner.<br className="desktop-break" /> Authenticity, ownership, and warranty — connected.</p><div className="hero-actions"><Link className="button hero-primary" to={ROUTES.verify}><Fingerprint size={17} />Verify a product<ArrowUpRight size={16} /></Link><Link className="hero-secondary" to={ROUTES.register}>Register product<ArrowRight size={16} /></Link></div><div className="hero-footnote"><ShieldCheck size={14} /><span>Recorded on-chain. Built to stay with the product.</span></div></div>
      <div className="passport-scene" aria-hidden="true"><div className="scene-grid" /><div className="scene-orbit orbit-one" /><div className="scene-orbit orbit-two" /><div className="scene-spark spark-one" /><div className="scene-spark spark-two" /><div className="passport-backplate" /><div className="digital-passport"><div className="digital-passport-top"><span className="digital-brand"><Box size={18} />origin</span><span className="digital-chip"><Layers3 size={18} /></span></div><div className="passport-emblem"><Fingerprint size={63} strokeWidth={.85} /></div><div className="digital-passport-title">PRODUCT<br /><strong>PASSPORT</strong></div><div className="digital-passport-bottom"><span>ORIGIN · OWNERSHIP · CARE</span><span className="passport-seal"><Check size={12} /></span></div><div className="passport-sheen" /></div><div className="scene-tag"><span><ShieldCheck size={14} /></span><div>Proof that stays.<small>Verifiable product history</small></div><span className="tag-status" /></div></div>
    </section>
    <div className="stat-grid dashboard-stats"><article className="stat-card"><span className="stat-icon"><Box size={19} /></span><div><span className="eyebrow">REGISTERED PRODUCTS</span><strong>{ready ? total.toString().padStart(2, '0') : '—'}</strong><p>Manufacturer-issued passports</p></div><span className="stat-decoration" aria-hidden="true">↗</span></article><article className="stat-card"><span className="stat-icon"><ShieldCheck size={19} /></span><div><span className="eyebrow">WARRANTY REQUESTS</span><strong>{ready ? claims.toString().padStart(2, '0') : '—'}</strong><p>Recorded on the product lifecycle</p></div><span className="stat-decoration" aria-hidden="true">↗</span></article><article className="stat-card"><span className="stat-icon"><Wallet size={19} /></span><div><span className="eyebrow">YOUR WORKSPACE</span><strong className="stat-label">{identity}</strong><p>{account ? 'Permissions verified on-chain' : 'Connect a wallet to take action'}</p></div></article></div>
    <section className="card stack directory-card"><div className="section-heading"><div><span className="eyebrow">PRODUCT DIRECTORY</span><h2>Your source of provenance <span className="directory-count">{ready ? total.toString() : '—'}</span></h2></div><Link className="directory-register" to={ROUTES.register}>Register a product <ArrowUpRight size={16} /></Link></div>
      {error && <Notice tone="error">{error}</Notice>}
      {metadataMissing && <Notice>Some product metadata is unavailable or could not be verified. Their on-chain records remain accessible.</Notice>}
      {loading && <p className="muted" role="status">Reading product passports…</p>}
      {!loading && rows.length === 0 && <div className="empty-state"><div className="empty-icon">◇</div><h3>{ready ? 'Your product story starts here' : 'Bring your local workspace online'}</h3><p>{ready ? 'Register a product, or run the seed script to explore the group demo.' : 'Start the local blockchain and metadata service, then deploy and seed the contracts. Connection details appear above.'}</p><Link className="button button-secondary" to={ROUTES.verify}>Explore verification →</Link></div>}
      {rows.length > 0 && <div className="table-wrap"><table className="table"><thead><tr><th>Product / passport</th><th>Current owner</th><th>Warranty status</th><th>Claims used</th><th><span className="sr-only">Open passport</span></th></tr></thead><tbody>{rows.map(({ product, metadata, active }, index) => <tr key={product.id.toString()}><td><div className="asset-cell"><span className={`asset-icon asset-tone-${index % 3}`}><Box size={21} strokeWidth={1.4} /></span><div><Link className="product-name" to={productPath(product.id)}>{metadata?.modelName ?? `Product #${product.id}`}</Link><div className="product-id">PASSPORT #{product.id.toString().padStart(4, '0')}</div></div></div></td><td data-label="Current owner"><Address value={product.owner} /></td><td data-label="Warranty"><span className={`badge ${active ? 'badge-success' : 'badge-neutral'}`}><span className="badge-dot" />{product.transferLocked ? 'Service pending' : active ? 'Active' : product.warrantyStart === 0n ? 'Not started' : 'Inactive'}</span></td><td data-label="Claims used"><span className="claim-count">{product.claimCount.toString()}<span> / {product.maxClaims.toString()}</span></span></td><td><Link className="table-view-link" to={productPath(product.id)} aria-label={`View product ${product.id}`}><ArrowUpRight size={17} /></Link></td></tr>)}</tbody></table></div>}
      {total > PAGE_SIZE && <div className="pagination"><Button className="button button-secondary" disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>← Newer</Button><span>Page {page + 1}</span><Button className="button button-secondary" disabled={BigInt(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage(p => p + 1)}>Older →</Button></div>}
    </section>
      <div className="quick-actions"><Link to={ROUTES.transfer} className="card action-card"><div className="action-icon"><ArrowUpRight size={21} /></div><span className="eyebrow">OWNERSHIP</span><h3>Pass it forward.</h3><p className="muted">A new owner. The same trusted history.</p><span className="action-link">Transfer ownership<ArrowRight size={15} /></span></Link><Link to={ROUTES.warranty} className="card action-card"><div className="action-icon"><ShieldCheck size={21} /></div><span className="eyebrow">CUSTOMER CARE</span><h3>Care beyond the sale.</h3><p className="muted">Request support under an active warranty.</p><span className="action-link">Request warranty<ArrowRight size={15} /></span></Link><Link to={ROUTES.service} className="card action-card"><div className="action-icon"><Sparkles size={21} /></div><span className="eyebrow">SERVICE CENTER</span><h3>Make every repair count.</h3><p className="muted">Review requests. Record the next chapter.</p><span className="action-link">Open service center<ArrowRight size={15} /></span></Link></div>
  </div>;
}
