import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProductRecord } from '../../../shared/types';
import { useDapp } from '../context/DappContext';
import { createApi } from '../lib/api';
import { dateTime, formatError, mapProduct } from '../lib/utils';
import { modelIdFromName } from '../shared';
import { Address, Notice } from '../components/ui';

export type Product = ReturnType<typeof mapProduct>;
export const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
export const productPath = (id: bigint | string) => `/product/${id}`;
export function parseId(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value) || value.length > 78) throw new Error('Enter a positive whole-number product ID.');
  const id = BigInt(value);
  if (id >= 2n ** 256n) throw new Error('Product ID is outside the supported range.');
  return id;
}
export function validMetadata(record: ProductRecord, product: Product) {
  return record.serialHash.toLowerCase() === product.serialHash.toLowerCase()
    && record.modelId === product.modelId.toString()
    && modelIdFromName(record.modelName) === product.modelId.toString();
}

export function useProduct(value: string) {
  const { registry, warranty, config, revision } = useDapp();
  const [state, setState] = useState<{ product: Product | null; metadata: ProductRecord | null; active: boolean; pending: bigint; loading: boolean; error: string; warning: string }>({ product: null, metadata: null, active: false, pending: 0n, loading: false, error: '', warning: '' });
  useEffect(() => {
    let cancelled = false;
    setState({ product: null, metadata: null, active: false, pending: 0n, loading: !!registry, error: '', warning: '' });
    if (!registry || !warranty || !config) return;
    let id: bigint;
    try { id = parseId(value); } catch (error) {
      setState(s => ({ ...s, loading: false, error: value ? formatError(error) : '' }));
      return;
    }
    void (async () => {
      try {
        const [raw, active, pending] = await Promise.all([registry.getProduct(id), registry.isWarrantyActive(id), warranty.pendingClaimOf(id)]);
        const product = mapProduct(raw);
        if (cancelled) return;
        setState({ product, metadata: null, active: Boolean(active), pending: BigInt(pending), loading: false, error: '', warning: '' });
        try {
          const metadata = await createApi(config.offchainBaseUrl).getProductMetadata(product.serialHash);
          if (!validMetadata(metadata, product)) throw new Error('The product metadata does not match its on-chain fingerprint.');
          if (!cancelled) setState(s => ({ ...s, metadata }));
        } catch (error) {
          if (!cancelled) setState(s => ({ ...s, warning: `Product metadata unavailable. On-chain data remains visible. ${formatError(error)}` }));
        }
      } catch (error) {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: formatError(error) }));
      }
    })();
    return () => { cancelled = true; };
  }, [value, registry, warranty, config, revision]);
  // Never expose a previous ID's record while the effect for a new input is
  // starting. Ownership controls must always describe the ID being submitted.
  if (state.product && state.product.id.toString() !== value) {
    return { ...state, product: null, metadata: null, active: false, pending: 0n, loading: true };
  }
  return state;
}

export function WriteAccess({ role }: { role?: 'manufacturer' | 'serviceCenter' }) {
  const { ready, account, chainId, config, roles, rolesLoading, rolesError, connect, switchNetwork, busy } = useDapp();
  if (!ready) return <Notice>Start the local chain and deploy the contracts to use this action. See the connection status above.</Notice>;
  if (!account) return <Notice>Connect your wallet to continue. Public product information can be read without connecting. <button type="button" className="text-button" disabled={busy} onClick={() => void connect()}>Connect wallet</button></Notice>;
  if (chainId !== config?.chainId) return <Notice tone="error">Switch your wallet to the local Hardhat network (31337) before submitting. <button type="button" className="text-button" disabled={busy} onClick={() => void switchNetwork()}>Switch network</button></Notice>;
  if (role && rolesLoading) return <Notice>Checking account permissions on-chain…</Notice>;
  if (role && rolesError) return <Notice tone="error">Could not check account permissions: {rolesError} <button type="button" className="text-button" disabled={busy} onClick={() => void connect()}>Refresh wallet</button></Notice>;
  if (role && !roles[role]) return <Notice tone="error">
    <strong>This action requires the {role === 'manufacturer' ? 'manufacturer' : 'service center'} account.</strong>
    <div className="inline-actions">Connected account: <Address value={account} /></div>
    {config && <div className="inline-actions">Local demo {role === 'manufacturer' ? 'manufacturer' : 'service center'}: <Address value={config.accounts[role]} /></div>}
    <p>Select and connect this account to this site in MetaMask, then refresh the wallet below. The address entered in the form does not change your connected account.</p>
    <button type="button" className="text-button" disabled={busy} onClick={() => void connect()}>Refresh wallet</button>
  </Notice>;
  return null;
}

export function ProductSummary({ product, metadata, active, pending = 0n }: { product: Product; metadata?: ProductRecord | null; active: boolean; pending?: bigint }) {
  return <section className="card stack product-summary">
    <div className="inline-actions"><span className="eyebrow">PRODUCT #{product.id.toString()}</span><span className={`badge ${product.transferLocked ? 'badge-warning' : active ? 'badge-success' : ''}`}>{product.transferLocked ? 'Transfer locked' : active ? 'Warranty active' : product.warrantyStart === 0n ? 'Not activated' : 'Warranty inactive'}</span></div>
    <h2>{metadata?.modelName ?? `Product #${product.id}`}</h2>
    {metadata?.description && <p className="muted">{metadata.description}</p>}
    <dl className="details-grid">
      <div><dt>Current owner</dt><dd><Address value={product.owner} /></dd></div>
      <div><dt>Claims used</dt><dd>{product.claimCount.toString()} / {product.maxClaims.toString()}</dd></div>
      <div><dt>Warranty started</dt><dd>{product.warrantyStart === 0n ? 'Starts with first customer sale' : dateTime(product.warrantyStart)}</dd></div>
      <div><dt>Warranty expires</dt><dd>{product.warrantyStart === 0n ? 'Not started' : dateTime(product.warrantyStart + product.warrantyDuration)}</dd></div>
      {pending > 0n && <div><dt>Pending claim</dt><dd>#{pending.toString()}</dd></div>}
    </dl>
    <Link className="text-link" to={productPath(product.id)}>Open product passport →</Link>
  </section>;
}

export function LoadState({ loading, error, warning }: { loading: boolean; error: string; warning?: string }) {
  return <>{loading && <p className="muted" role="status">Reading the blockchain…</p>}{error && <Notice tone="error">{error}</Notice>}{warning && <Notice>{warning}</Notice>}</>;
}
