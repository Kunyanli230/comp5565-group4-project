import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Box, CheckCircle2, ChevronRight, CircleHelp,
  Clock3, Fingerprint, LayoutDashboard, LoaderCircle, Menu, PackagePlus, ShieldCheck,
  Wallet, Wrench, X, RefreshCw } from 'lucide-react';
import { useDapp } from './context/DappContext';
import { ROUTES, LOCAL_ACCOUNTS } from './shared';
import { Address, Notice } from './components/ui';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Register = lazy(() => import('./pages/Register'));
const Transfer = lazy(() => import('./pages/Transfer'));
const Verify = lazy(() => import('./pages/Verify'));
const Warranty = lazy(() => import('./pages/Warranty'));
const Service = lazy(() => import('./pages/Service'));
const Product = lazy(() => import('./pages/Product'));

const links = [
  { path: ROUTES.home, label: 'Overview', icon: LayoutDashboard },
  { path: ROUTES.verify, label: 'Verify a product', icon: Fingerprint },
  { path: ROUTES.register, label: 'Register product', icon: PackagePlus },
  { path: ROUTES.transfer, label: 'Transfer ownership', icon: ArrowUpRight },
  { path: ROUTES.warranty, label: 'Warranty claims', icon: ShieldCheck },
  { path: ROUTES.service, label: 'Service center', icon: Wrench },
];

export default function App() {
  const dapp = useDapp();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 850px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 850px)');
    const update = () => { setIsMobile(media.matches); if (!media.matches) setMenuOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!menuOpen || !isMobile) return;
    sidebarRef.current?.querySelector<HTMLAnchorElement>('nav a.active')?.focus();
    function keyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus(); }
    }
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [menuOpen, isMobile]);
  const [guide, setGuide] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [hiddenTx, setHiddenTx] = useState('');
  const current = links.find(item => item.path === pathname)?.label ?? 'Product passport';
  const role = !dapp.account ? 'Read-only visitor' : dapp.rolesLoading ? 'Checking permissions…' : dapp.rolesError ? 'Permissions unavailable' : Object.entries(dapp.roles).filter(([, v]) => v).map(([key]) => key === 'serviceCenter' ? 'Service center' : key).join(' · ') || 'Product owner';
  const walletOnLocalChain = dapp.chainId === 31337;
  const networkLabel = !dapp.account ? 'Local RPC · 31337' : walletOnLocalChain ? 'Wallet · Hardhat 31337' : `Wallet · ${dapp.chainId ?? 'unknown'}`;
  async function connect() { try { setWalletError(''); await dapp.connect(); } catch (err) { setWalletError(err instanceof Error ? err.message : 'Could not connect wallet.'); } }
  async function switchChain() { try { setWalletError(''); await dapp.switchNetwork(); } catch (err) { setWalletError(err instanceof Error ? err.message : 'Could not switch network.'); } }
  const txKey = `${dapp.tx.phase}:${dapp.tx.hash ?? ''}:${dapp.tx.label}`;
  return <div className="app-shell">
    <a href="#main" className="skip-link">Skip to content</a>
    {menuOpen && <button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
    <aside ref={sidebarRef} inert={isMobile && !menuOpen} aria-hidden={isMobile && !menuOpen ? true : undefined} className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <Link to={ROUTES.home} className="brand" onClick={() => setMenuOpen(false)}><span className="brand-mark"><Box size={25} strokeWidth={1.7} /></span><div><strong>origin<span className="brand-period">.</span></strong><small>PRODUCT PASSPORT</small></div></Link>
      <div className="workspace-label"><span className="workspace-avatar">G4</span><span>Group 04 workspace<small>COMP5565 · Local network</small></span></div>
      <p className="nav-heading">WORKSPACE</p>
      <nav aria-label="Main navigation">{links.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={19} strokeWidth={1.7} />{label}<ChevronRight size={14} className="nav-chevron" /></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><ShieldCheck size={24} /><h3>A history you can trust.</h3><p>From the first owner to the next.<br />Every step, verifiable.</p><Link to={ROUTES.verify}>Explore a product <ArrowUpRight size={15} /></Link></div>
        <button className="help-button" onClick={() => setGuide(!guide)}><CircleHelp size={18} /> Local setup & demo <ArrowUpRight size={14} /></button>
        <div className="sidebar-footer"><span className={`status-dot ${dapp.ready ? 'online' : ''}`} />{dapp.ready ? 'Local chain connected' : 'Waiting for local chain'}<span>v1.0</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button ref={menuButtonRef} className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></button><span className="breadcrumb-home">Workspace</span><ChevronRight size={14} /><strong>{current}</strong></div><div className="topbar-actions"><span className="network-pill" title="Transactions require the connected wallet to use Hardhat Local (31337)."><span className={`status-dot ${dapp.ready && (!dapp.account || walletOnLocalChain) ? 'online' : ''}`} />{networkLabel}</span><button className="wallet-button" onClick={connect} disabled={dapp.busy}><Wallet size={16} />{dapp.account ? `${dapp.account.slice(0, 6)}…${dapp.account.slice(-4)}` : 'Connect wallet'}</button><span className="workspace-profile" aria-label="Group 4 workspace">G4</span></div></header>
      <main id="main" className="content" tabIndex={-1}>
        {!dapp.ready && <Notice tone={dapp.error ? 'error' : 'info'}><strong>{dapp.error ? 'Local environment needs attention' : 'Connecting to your workspace…'}</strong><p>{dapp.error || 'Loading deployment addresses and checking the local contracts.'}</p><div className="inline-actions"><button className="text-button" onClick={() => setGuide(true)}>Show setup steps</button><button className="text-button" onClick={() => void dapp.reload()}><RefreshCw size={13} />Retry connection</button></div></Notice>}
        {walletError && <Notice tone="error">{walletError}</Notice>}
        {dapp.ready && dapp.error && <Notice tone="error">{dapp.error}</Notice>}
        {dapp.account && dapp.chainId !== 31337 && <Notice tone="error">Your wallet is on another network. Reading is available; transactions require Hardhat (31337). <button className="text-button" onClick={switchChain}>Switch network</button></Notice>}
        {guide && <section className="card setup-guide"><div className="section-heading"><div><p className="eyebrow">GET STARTED</p><h2>Your local demo environment</h2></div><button className="icon-button" onClick={() => setGuide(false)} aria-label="Close setup"><X size={18} /></button></div><p>From the repository root, install with <code>npm ci</code>. Then in <code>frontend/</code>, run <code>npm ci</code> and <code>npm run demo</code>. Keep that terminal open.</p><p>Connect MetaMask to RPC <code>http://127.0.0.1:8545</code>, chain ID <code>31337</code>. Use your locally provided development accounts for each role. Public queries work without a wallet.</p><div className="account-grid">{Object.entries(LOCAL_ACCOUNTS).map(([name, address]) => <div key={name}><span>{name === 'serviceCenter' ? 'Service center' : name}</span><Address value={address} /></div>)}</div><p className="muted">Local development accounts are for this demo only. No wallet keys are stored in the frontend.</p></section>}
        <Suspense fallback={<p className="loading" role="status">Opening workspace…</p>}><Routes><Route path={ROUTES.home} element={<Dashboard />} /><Route path={ROUTES.register} element={<Register />} /><Route path={ROUTES.transfer} element={<Transfer />} /><Route path={ROUTES.verify} element={<Verify />} /><Route path={ROUTES.warranty} element={<Warranty />} /><Route path={ROUTES.service} element={<Service />} /><Route path={ROUTES.product} element={<Product />} /><Route path="*" element={<section className="empty-state"><h1>Page not found</h1><p>This page is not part of your workspace.</p><Link className="button" to="/">Back to overview</Link></section>} /></Routes></Suspense>
      </main>
      <footer className="app-footer"><span><Box size={14} /> Origin · Product provenance & warranty</span><span>{role}<span className="footer-separator">/</span>COMP5565 · Group 04</span></footer>
    </div>
    {dapp.tx.phase !== 'idle' && hiddenTx !== txKey && <section className={`transaction-toast tx-${dapp.tx.phase}`} role="status" aria-live="polite"><div className="transaction-icon">{dapp.tx.phase === 'success' ? <CheckCircle2 /> : dapp.tx.phase === 'error' ? <X /> : <LoaderCircle className="spin" />}</div><div><strong>{dapp.tx.label}</strong><p>{dapp.tx.message || ({ signing: 'Confirm this transaction in your wallet.', pending: 'Transaction sent. Waiting for confirmation…', success: 'Confirmed on the local chain.', error: 'The transaction did not complete.', idle: '' }[dapp.tx.phase])}</p>{dapp.tx.hash && <code className="transaction-hash" title={dapp.tx.hash}>{dapp.tx.hash}</code>}</div><button className="icon-button" onClick={() => setHiddenTx(txKey)} aria-label="Dismiss transaction status"><X size={15} /></button></section>}
  </div>;
}
