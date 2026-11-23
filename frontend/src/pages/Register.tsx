import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAddress, ZeroAddress } from 'ethers';
import { useDapp } from '../context/DappContext';
import { ApiError, createApi } from '../lib/api';
import { formatError } from '../lib/utils';
import { selectDemoSerial } from '../lib/demo';
import { DEMO_PRODUCT, modelIdFromName, serialHash, roleHash } from '../shared';
import { Button, Field, Notice, PageHeader } from '../components/ui';
import { productPath, WriteAccess } from './data';

export default function Register() {
  const { config, registry, account, chainId, roles, ready, busy, transact, resetTransaction } = useDapp();
  const [serial, setSerial] = useState('');
  const [modelName, setModelName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('31536000');
  const [maxClaims, setMaxClaims] = useState('2');
  const [retailer, setRetailer] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [created, setCreated] = useState('');
  const [confirmationNote, setConfirmationNote] = useState('');
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoInfo, setDemoInfo] = useState('');
  const demoRequest = useRef(0);
  const submitLock = useRef(false);
  const allowed = ready && !!account && chainId === config?.chainId && roles.manufacturer;
  useEffect(() => {
    demoRequest.current++;
    setDemoLoading(false);
    return () => { demoRequest.current++; };
  }, [registry, config]);
  function formEdited() {
    // Do not overwrite a manually edited form when an older RPC read finishes.
    demoRequest.current++; setDemoLoading(false); setDemoInfo(''); setCreated(''); setConfirmationNote(''); setError('');
  }
  async function demo() {
    if (!ready || !registry || !config || busy || working || demoLoading) return;
    const request = ++demoRequest.current;
    setDemoLoading(true); setError(''); setCreated(''); setConfirmationNote(''); setDemoInfo('');
    try {
      const demoRetailer = config.accounts.retailer;
      if (!isAddress(demoRetailer) || demoRetailer.toLowerCase() === ZeroAddress) throw new Error('The deployment has no valid demo retailer address. Refresh the local configuration.');
      const nextSerial = await selectDemoSerial(DEMO_PRODUCT.serial, async hash => BigInt(await registry.productIdBySerial(hash)));
      if (demoRequest.current !== request) return;
      setSerial(nextSerial); setModelName(DEMO_PRODUCT.modelName); setDescription(DEMO_PRODUCT.description);
      setDuration(String(DEMO_PRODUCT.warrantyDurationSeconds)); setMaxClaims(String(DEMO_PRODUCT.maxClaims));
      setRetailer(demoRetailer);
      setDemoInfo(`Demo form ready. ${nextSerial} is not registered on the current chain. The retailer is the first owner; keep the manufacturer selected in MetaMask to sign.`);
    } catch (error) {
      if (demoRequest.current === request) setError(`Could not prepare demo values. ${formatError(error)}`);
    } finally { if (demoRequest.current === request) setDemoLoading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!allowed || !config || !registry || demoLoading || busy || submitLock.current) return;
    if (!resetTransaction()) return;
    submitLock.current = true;
    setError(''); setCreated(''); setConfirmationNote('');
    setWorking(true);
    try {
      const hash = serialHash(serial);
      const modelId = modelIdFromName(modelName);
      if (!/^[1-9][0-9]*$/.test(duration) || BigInt(duration) >= 2n ** 64n) throw new Error('Warranty duration must be a positive uint64 number of seconds.');
      if (!/^[1-9][0-9]*$/.test(maxClaims) || BigInt(maxClaims) >= 2n ** 32n) throw new Error('Maximum claims must be a positive uint32 whole number.');
      if (!isAddress(retailer) || retailer.toLowerCase() === ZeroAddress) throw new Error('Enter a valid nonzero retailer wallet address.');
      if (!await registry.hasRole(roleHash('RETAILER_ROLE'), retailer)) throw new Error('This address does not have the retailer role.');
      const existing = BigInt(await registry.productIdBySerial(hash));
      if (existing !== 0n) throw new Error(`This serial is already registered on-chain as product #${existing}. Use a new serial.`);
      const api = createApi(config.offchainBaseUrl);
      let record;
      try { record = await api.createProduct({ serial, modelName, description }); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'serial_exists') throw error;
        // A cancelled wallet prompt can leave a plaintext record. Reuse only the identical data.
        record = await api.getProductMetadata(hash);
        if (record.serialHash.toLowerCase() !== hash.toLowerCase() || record.modelId !== modelId || record.modelName !== modelName.trim() || record.description !== description) {
          throw new Error('This serial has conflicting stored metadata. Use the original model and description or ask your team to investigate; existing data was not overwritten.');
        }
      }
      if (record.serialHash.toLowerCase() !== hash.toLowerCase() || record.modelId !== modelId || modelIdFromName(record.modelName) !== modelId) throw new Error('The metadata API returned a fingerprint that does not match your input.');
      const receipt = await transact(`Register ${serial.trim()}`, r => r.registerProduct(hash, BigInt(modelId), BigInt(duration), BigInt(maxClaims), retailer));
      if (receipt) {
        // The mined event is authoritative and does not depend on another RPC
        // read succeeding after the transaction has already been confirmed.
        let registeredId: bigint | null = null;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== config.productRegistry.toLowerCase()) continue;
          try {
            const event = registry.interface.parseLog(log);
            if (event?.name === 'Registered' && String(event.args.serialHash).toLowerCase() === hash.toLowerCase()) registeredId = BigInt(event.args.productId);
          } catch { /* Other logs are not registration events. */ }
        }
        if (registeredId === null) {
          try { const id = BigInt(await registry.productIdBySerial(hash)); if (id > 0n) registeredId = id; }
          catch { /* A display refresh failure does not reverse the receipt. */ }
        }
        if (registeredId !== null) setCreated(registeredId.toString());
        else setConfirmationNote(`Registration confirmed in block ${receipt.blockNumber}. The product ID could not be refreshed. Open Overview to find the product; do not submit this serial again.`);
      }
    } catch (error) { setError(formatError(error)); }
    finally { submitLock.current = false; setWorking(false); }
  }
  return <div className="stack">
    <PageHeader eyebrow="MANUFACTURER WORKSPACE" title="Register a product" description="Create a product passport and assign its first owner. The warranty begins when the retailer sells to a customer." />
    <WriteAccess role="manufacturer" />
    <div className="workspace-grid">
      <form className="card stack" onSubmit={submit} onChange={formEdited}>
        <div className="section-heading"><h2>Product information</h2><Button type="button" className="button button-secondary" disabled={!ready || !registry || !config || busy || working || demoLoading} onClick={() => void demo()}>{demoLoading ? 'Finding unused serial…' : 'Use demo values'}</Button></div>
        {demoInfo && <Notice>{demoInfo}</Notice>}
        <div className="form-grid">
          <Field label="Serial number" hint="Case sensitive; surrounding spaces are ignored."><input required value={serial} onChange={e => setSerial(e.target.value)} placeholder="LW-2026-0002" /></Field>
          <Field label="Model name"><input required value={modelName} onChange={e => setModelName(e.target.value)} placeholder="LuxeWatch X" /></Field>
        </div>
        <Field label="Description"><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="A short description of this product" rows={3} /></Field>
        <div className="form-grid">
          <Field label="Warranty duration (seconds)" hint="31536000 seconds = 365 days"><input required inputMode="numeric" value={duration} onChange={e => setDuration(e.target.value)} /></Field>
          <Field label="Maximum approved claims"><input required inputMode="numeric" value={maxClaims} onChange={e => setMaxClaims(e.target.value)} /></Field>
        </div>
        <Field label="Retailer wallet address" hint="This is the product’s first owner, not the signing wallet. Keep the manufacturer account selected in MetaMask."><input required value={retailer} onChange={e => setRetailer(e.target.value)} placeholder={config?.accounts.retailer ?? '0x…'} /></Field>
        {error && <Notice tone="error">{error}</Notice>}
        {created && <Notice tone="success">Product #{created} registered. <Link to={productPath(created)}>View its passport →</Link></Notice>}
        {confirmationNote && <Notice>{confirmationNote}</Notice>}
        <div className="form-footer"><span className="muted">No ETH payment is required. Network gas applies.</span><Button disabled={!allowed || busy || working || demoLoading} type="submit">{working ? 'Registering…' : 'Register product →'}</Button></div>
      </form>
      <aside className="card stack"><span className="eyebrow">HOW IT WORKS</span><h2>A verifiable beginning</h2><ol className="steps"><li>Save the product information to the metadata service.</li><li>Record its fingerprint and warranty terms on-chain.</li><li>Assign the product to a registered retailer.</li></ol><Notice>Use demo values checks the current chain for an unused serial. Filling the form does not register a product; confirm Register product in your manufacturer wallet to finish.</Notice></aside>
    </div>
  </div>;
}
