import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserProvider, Contract, FetchRequest, JsonRpcProvider, ZeroAddress, isAddress, type ContractTransactionResponse, type Eip1193Provider, type TransactionReceipt } from 'ethers';
import type { DeploymentFile } from '../../../shared/types';
import registryArtifact from '../generated/ProductRegistry.json';
import warrantyArtifact from '../generated/WarrantyManager.json';
import { CHAIN_ID, ROLE_NAME, roleHash, ZERO_BYTES32 } from '../shared';
import { formatError, sameAddress } from '../lib/utils';
import { assertSameChainBlock, extractTransactionHash, failureOutcome, findKnownReceipt, isCancelledReplacement, matchingReceipt,
  replacementReceipt, transactionDiagnostic, validTransactionHash, type TransactionDiagnostic, type TransactionOutcome, type TransactionStage } from '../lib/transaction';

interface Wallet extends Eip1193Provider {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}
declare global { interface Window { ethereum?: Wallet } }
export interface WalletRoles { manufacturer: boolean; retailer: boolean; serviceCenter: boolean; admin: boolean }
export interface TransactionState {
  phase: 'idle' | 'signing' | 'pending' | 'success' | 'error'; label: string; hash?: string; message?: string;
  outcome?: TransactionOutcome; diagnostic?: TransactionDiagnostic;
}
interface DappContextValue {
  config: DeploymentFile | null; provider: JsonRpcProvider | null; registry: Contract | null; warranty: Contract | null;
  account: string; chainId: number | null; roles: WalletRoles; rolesLoading: boolean; rolesError: string; ready: boolean; error: string; busy: boolean;
  tx: TransactionState; revision: number;
  connect: () => Promise<void>; switchNetwork: () => Promise<void>; reload: () => Promise<void>;
  resetTransaction: () => boolean; recheckTransaction: () => Promise<void>;
  transact: (label: string, submit: (registry: Contract, warranty: Contract) => Promise<ContractTransactionResponse>) => Promise<TransactionReceipt | null>;
}
const emptyRoles: WalletRoles = { manufacturer: false, retailer: false, serviceCenter: false, admin: false };
const DappContext = createContext<DappContextValue | null>(null);
function validateConfig(input: unknown): DeploymentFile {
  const c = input as DeploymentFile;
  if (!c || Number(c.chainId) !== CHAIN_ID || !c.rpcUrl || !c.offchainBaseUrl || !c.accounts) throw new Error('Invalid deployment configuration. Run npm run deploy:local from the repository root.');
  for (const address of [c.productRegistry, c.warrantyManager]) {
    if (!isAddress(address) || sameAddress(address, ZeroAddress)) throw new Error('Contracts have not been deployed. Run npm run deploy:local first.');
  }
  for (const url of [c.rpcUrl, c.offchainBaseUrl]) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('The deployment contains an invalid service URL.');
  }
  return c;
}
export function DappProvider({children}: {children: ReactNode}) {
  const [config, setConfig] = useState<DeploymentFile | null>(null);
  const [provider, setProvider] = useState<JsonRpcProvider | null>(null);
  const [registry, setRegistry] = useState<Contract | null>(null);
  const [warranty, setWarranty] = useState<Contract | null>(null);
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [roles, setRoles] = useState<WalletRoles>(emptyRoles);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState('');
  const [ready, setReady] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [walletError, setWalletError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [tx, setTx] = useState<TransactionState>({phase: 'idle', label: ''});
  const [revision, setRevision] = useState(0);
  const [walletSyncVersion, setWalletSyncVersion] = useState(0);
  const mounted = useRef(false);
  const providerRef = useRef<JsonRpcProvider | null>(null);
  const setupRequest = useRef<AbortController | null>(null);
  const activeWrite = useRef(false);
  const transactionRef = useRef<TransactionState>({phase: 'idle', label: ''});
  const walletRevision = useRef(0);
  const configGeneration = useRef(0);
  const publishTransaction = useCallback((next: TransactionState) => {
    transactionRef.current = next;
    if (mounted.current) setTx(next);
  }, []);

  const syncWallet = useCallback(async () => {
    const epoch = ++walletRevision.current;
    const wallet = window.ethereum;
    if (!wallet) { if (mounted.current) { setAccount(''); setChainId(null); setRoles(emptyRoles); setRolesLoading(false); setRolesError(''); } return; }
    try {
      const [accounts, network] = await Promise.all([wallet.request({method: 'eth_accounts'}), wallet.request({method: 'eth_chainId'})]);
      if (!mounted.current || epoch !== walletRevision.current) return;
      const list = accounts as string[];
      setAccount(list?.[0] && isAddress(list[0]) ? list[0] : '');
      setChainId(Number(BigInt(String(network))));
      setWalletError('');
      // Wallets can emit another event with the same account and chain. Recheck
      // roles even when React would otherwise skip those unchanged values.
      setWalletSyncVersion(value => value + 1);
    } catch (err) {
      if (mounted.current && epoch === walletRevision.current) { setAccount(''); setChainId(null); setRoles(emptyRoles); setRolesLoading(false); setRolesError(''); setWalletError(formatError(err)); }
    }
  }, []);

  const reload = useCallback(async () => {
    setupRequest.current?.abort();
    const controller = new AbortController();
    setupRequest.current = controller;
    const generation = ++configGeneration.current;
    if (mounted.current) { setReady(false); setSetupError(''); }
    let nextProvider: JsonRpcProvider | null = null;
    try {
      const response = await fetch('/app-config.json', {cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw new Error('Deployment file is missing. Start the local chain and run npm run deploy:local, then refresh.');
      const nextConfig = validateConfig(await response.json());
      const rpcRequest = new FetchRequest(nextConfig.rpcUrl);
      rpcRequest.timeout = 5000;
      nextProvider = new JsonRpcProvider(rpcRequest, undefined, {pollingInterval: 1500});
      // Fail quickly when the local node has not been started; provider will be
      // destroyed on failure, so it cannot continue retrying after unmount.
      const network = await nextProvider.getNetwork();
      if (network.chainId !== BigInt(nextConfig.chainId)) throw new Error(`The RPC is on chain ${network.chainId}. Expected Hardhat Local (${nextConfig.chainId}).`);
      const code = await Promise.all([nextProvider.getCode(nextConfig.productRegistry), nextProvider.getCode(nextConfig.warrantyManager)]);
      if (code.some(value => value === '0x')) throw new Error('No contract exists at the configured address. The local chain may have restarted; deploy again, then refresh.');
      const nextRegistry = new Contract(nextConfig.productRegistry, registryArtifact.abi, nextProvider);
      const nextWarranty = new Contract(nextConfig.warrantyManager, warrantyArtifact.abi, nextProvider);
      const [linkedWarranty, linkedRegistry] = await Promise.all([nextRegistry.warrantyManager(), nextWarranty.registry()]);
      if (!sameAddress(String(linkedWarranty), nextConfig.warrantyManager) || !sameAddress(String(linkedRegistry), nextConfig.productRegistry)) throw new Error('Contract links do not match deployments/local.json. Run npm run deploy:local again.');
      if (!mounted.current || controller.signal.aborted || generation !== configGeneration.current) { nextProvider.destroy(); return; }
      const previousProvider = providerRef.current;
      providerRef.current = nextProvider;
      setConfig(nextConfig); setProvider(nextProvider); setRegistry(nextRegistry); setWarranty(nextWarranty); setReady(true); setRevision(value => value + 1);
      previousProvider?.destroy();
    } catch (err) {
      nextProvider?.destroy();
      if (mounted.current && !controller.signal.aborted && generation === configGeneration.current) {
        providerRef.current?.destroy(); providerRef.current = null;
        setConfig(null); setProvider(null); setRegistry(null); setWarranty(null); setRoles(emptyRoles); setSetupError(formatError(err));
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload(); void syncWallet();
    const wallet = window.ethereum;
    const onChange = () => { setRoles(emptyRoles); setRolesLoading(true); setRolesError(''); void syncWallet(); };
    const onDisconnect = () => { ++walletRevision.current; setAccount(''); setChainId(null); setRoles(emptyRoles); setRolesLoading(false); setRolesError(''); };
    wallet?.on?.('accountsChanged', onChange); wallet?.on?.('chainChanged', onChange); wallet?.on?.('disconnect', onDisconnect);
    return () => {
      mounted.current = false; ++walletRevision.current; ++configGeneration.current;
      setupRequest.current?.abort(); providerRef.current?.destroy(); providerRef.current = null;
      wallet?.removeListener?.('accountsChanged', onChange); wallet?.removeListener?.('chainChanged', onChange); wallet?.removeListener?.('disconnect', onDisconnect);
    };
  }, [reload, syncWallet]);

  useEffect(() => {
    let cancelled = false;
    const walletEpoch = walletRevision.current;
    const current = () => !cancelled && walletEpoch === walletRevision.current;
    setRoles(emptyRoles); setRolesError(''); setRolesLoading(false);
    if (!account || !registry || !ready || chainId !== config?.chainId) return;
    setRolesLoading(true);
    Promise.all([
      registry.hasRole(roleHash(ROLE_NAME.manufacturer), account),
      registry.hasRole(roleHash(ROLE_NAME.retailer), account),
      registry.hasRole(roleHash(ROLE_NAME.serviceCenter), account),
      registry.hasRole(ZERO_BYTES32, account),
    ]).then(([manufacturer, retailer, serviceCenter, admin]) => {
      if (current()) setRoles({manufacturer: Boolean(manufacturer), retailer: Boolean(retailer), serviceCenter: Boolean(serviceCenter), admin: Boolean(admin)});
    }).catch(err => {
      if (current()) { setRoles(emptyRoles); setRolesError(formatError(err)); }
    }).finally(() => { if (current()) setRolesLoading(false); });
    return () => { cancelled = true; };
  }, [account, chainId, config?.chainId, ready, registry, revision, walletSyncVersion]);

  const connect = useCallback(async () => {
    if (!window.ethereum) { setWalletError('Install MetaMask or another EIP-1193 wallet to sign transactions. Public lookups work without connecting.'); return; }
    setConnecting(true); setWalletError('');
    try { await window.ethereum.request({method: 'eth_requestAccounts'}); await syncWallet(); }
    catch (err) { if (mounted.current) setWalletError(formatError(err)); }
    finally { if (mounted.current) setConnecting(false); }
  }, [syncWallet]);

  const switchNetwork = useCallback(async () => {
    const wallet = window.ethereum;
    if (!wallet) { setWalletError('Install a browser wallet before switching networks.'); return; }
    setConnecting(true); setWalletError('');
    try {
      const expectedChain = `0x${CHAIN_ID.toString(16)}`;
      try { await wallet.request({method: 'wallet_switchEthereumChain', params: [{chainId: expectedChain}]}); }
      catch (err) {
        const code = (err as {code?: number; data?: {originalError?: {code?: number}}})?.code;
        if (code !== 4902) throw err;
        await wallet.request({method: 'wallet_addEthereumChain', params: [{chainId: expectedChain, chainName: 'Hardhat Local', rpcUrls: [config?.rpcUrl || 'http://127.0.0.1:8545'], nativeCurrency: {name: 'Local test Ether', symbol: 'ETH', decimals: 18}}]});
        await wallet.request({method: 'wallet_switchEthereumChain', params: [{chainId: expectedChain}]});
      }
      await syncWallet();
    } catch (err) { if (mounted.current) setWalletError(formatError(err)); }
    finally { if (mounted.current) setConnecting(false); }
  }, [config?.rpcUrl, syncWallet]);

  const resetTransaction = useCallback(() => {
    if (activeWrite.current) return false;
    publishTransaction({phase: 'idle', label: ''});
    return true;
  }, [publishTransaction]);

  const recheckTransaction = useCallback(async () => {
    const previous = transactionRef.current;
    const readProvider = providerRef.current;
    if (activeWrite.current || !readProvider || !validTransactionHash(previous.hash)) return;
    activeWrite.current = true;
    publishTransaction({...previous, phase: 'pending', message: 'Checking this hash on the local RPC. No transaction is being sent.'});
    try {
      const receipt = matchingReceipt(await readProvider.getTransactionReceipt(previous.hash), previous.hash);
      if (!receipt) {
        publishTransaction({...previous, phase: 'error', outcome: 'confirmation_unknown', message: 'The local RPC has no confirmed receipt for this hash yet. Check the product state before trying again.'});
      } else if (receipt.status === 1) {
        publishTransaction({...previous, phase: 'success', outcome: undefined, hash: receipt.hash, message: `Confirmed in block ${receipt.blockNumber}, verified on the local RPC.`});
        if (mounted.current) setRevision(value => value + 1);
      } else {
        publishTransaction({...previous, phase: 'error', outcome: 'reverted', hash: receipt.hash, message: `The transaction was mined in block ${receipt.blockNumber} but reverted. The on-chain operation did not succeed.`});
      }
    } catch (err) {
      publishTransaction({...previous, phase: 'error', outcome: 'confirmation_unknown', message: 'The local RPC could not verify this hash. Its status is unknown; do not submit it again until checked.', diagnostic: transactionDiagnostic(err, 'confirmation', previous.diagnostic?.account ?? account, config?.chainId ?? null, previous.hash)});
    } finally { activeWrite.current = false; }
  }, [account, config?.chainId, publishTransaction]);

  const transact = useCallback(async (label: string, submit: (registry: Contract, warranty: Contract) => Promise<ContractTransactionResponse>): Promise<TransactionReceipt | null> => {
    if (activeWrite.current) return null;
    activeWrite.current = true;
    publishTransaction({phase: 'signing', label, message: 'Checking the wallet and local chain before signing.'});
    let walletProvider: BrowserProvider | null = null;
    let stage: TransactionStage = 'preflight';
    let knownHash: string | undefined;
    let walletError: unknown;
    let trackingError: unknown;
    let finished = false;
    const walletEpoch = walletRevision.current;
    const deploymentEpoch = configGeneration.current;
    try {
      if (!ready || !config || !providerRef.current) throw new Error('The local contracts are not ready. Check deployment and refresh.');
      if (!window.ethereum || !account) throw new Error('Connect your wallet before submitting.');
      const wallet = window.ethereum;
      const readProvider = providerRef.current;
      const checkWallet = async () => {
        const [network, accounts] = await Promise.all([
          wallet.request({method: 'eth_chainId'}), wallet.request({method: 'eth_accounts'}) as Promise<string[]>,
        ]);
        if (BigInt(String(network)) !== BigInt(config.chainId)) throw new Error(`Switch your wallet to Hardhat Local (${config.chainId}) before submitting.`);
        if (!sameAddress(accounts[0], account) || walletRevision.current !== walletEpoch) {
          await syncWallet(); throw new Error('The wallet account or network changed. Check the selected account and submit again.');
        }
        if (configGeneration.current !== deploymentEpoch || providerRef.current !== readProvider) throw new Error('The local configuration changed. Refresh before submitting.');
      };
      await checkWallet();
      const codes = await Promise.all([readProvider.getCode(config.productRegistry), readProvider.getCode(config.warrantyManager)]);
      if (codes.some(code => code === '0x')) throw new Error('The local chain was reset. Redeploy the contracts and refresh before submitting.');
      await assertSameChainBlock((method, params) => readProvider.send(method, params), wallet);

      let reportBroadcast: () => void = () => {};
      const broadcast = new Promise<void>(resolve => { reportBroadcast = resolve; });
      const rememberHash = (hash: string) => {
        if (!validTransactionHash(hash) || finished) return;
        knownHash = hash;
        stage = 'confirmation';
        publishTransaction({phase: 'pending', label, hash, message: 'Submitted. Verifying confirmation on the local chain.'});
        reportBroadcast();
      };
      // Capture only the send result/error. No request parameters, signatures,
      // wallet state dumps or private data are retained in diagnostics.
      const signingWallet: Eip1193Provider = {request: async args => {
        if (args.method !== 'eth_sendTransaction') return wallet.request(args);
        // Account changes during metadata/RPC awaits must not silently change
        // which wallet signs. This runs immediately before the actual send.
        stage = 'preflight';
        await checkWallet();
        stage = 'wallet';
        try {
          const result = await wallet.request(args);
          if (validTransactionHash(result)) rememberHash(result);
          return result;
        } catch (err) { walletError = err; throw err; }
      }};
      walletProvider = new BrowserProvider(signingWallet);
      const signer = await walletProvider.getSigner(account);
      const writeRegistry = new Contract(config.productRegistry, registryArtifact.abi, signer);
      const writeWarranty = new Contract(config.warrantyManager, warrantyArtifact.abi, signer);
      stage = 'wallet';
      publishTransaction({phase: 'signing', label, message: 'Check the request in your wallet.'});

      const walletResult = (async () => {
        try {
          const response = await submit(writeRegistry, writeWarranty);
          rememberHash(response.hash);
          let receipt: TransactionReceipt | null;
          try { receipt = await response.wait(1, 20000); }
          catch (err) {
            const replacement = replacementReceipt<TransactionReceipt>(err);
            if (!replacement) throw err;
            rememberHash(replacement.hash);
            receipt = replacement;
          }
          return {kind: 'receipt' as const, source: 'wallet' as const, receipt};
        } catch (err) {
          trackingError = err;
          if (!isCancelledReplacement(err)) {
            const hash = extractTransactionHash(err);
            if (hash) rememberHash(hash);
          }
          return {kind: 'wallet-error' as const, error: err};
        }
      })();
      // This observer is independent of MetaMask's getTransaction/receipt
      // tracking, including the interval before ethers returns its response.
      // It only reads a known hash; it never retries a wallet send.
      const localResult = broadcast.then(async () => ({kind: 'receipt' as const, source: 'local' as const, receipt:
        await findKnownReceipt(() => knownHash, hash => readProvider.getTransactionReceipt(hash), () => finished),
      }));
      let result = await Promise.race([walletResult, localResult]);
      if (result.kind === 'wallet-error') {
        // A cancellation receipt belongs to a different operation and must
        // never turn this operation into a success.
        if (isCancelledReplacement(result.error) || !knownHash) throw result.error;
        const recovered = await localResult;
        if (!recovered.receipt) throw result.error;
        result = recovered;
      }
      const receipt = result.receipt;
      if (!receipt) throw new Error('The local RPC has not confirmed this transaction yet. Check its hash and product state before submitting again.');
      if (!knownHash || !matchingReceipt(receipt, knownHash)) throw new Error('The returned receipt could not be matched to this transaction. Verify the hash on the local RPC.');
      if (receipt.status === 0) {
        publishTransaction({phase: 'error', label, hash: receipt.hash, outcome: 'reverted', message: `The transaction was mined in block ${receipt.blockNumber} but reverted. The on-chain operation did not succeed.`, diagnostic: transactionDiagnostic(walletError, 'confirmation', account, config.chainId, receipt.hash)});
        return null;
      }
      publishTransaction({phase: 'success', label, hash: receipt.hash,
        message: `Confirmed in block ${receipt.blockNumber}${result.source === 'local' ? ', verified on the local RPC' : ''}.`,
        diagnostic: transactionDiagnostic(walletError ?? trackingError, 'confirmation', account, config.chainId, receipt.hash),
      });
      if (mounted.current) setRevision(value => value + 1);
      return receipt;
    } catch (err) {
      const outcome = failureOutcome(err, stage, knownHash);
      const detail = formatError(err, [new Contract(ZeroAddress, registryArtifact.abi).interface, new Contract(ZeroAddress, warrantyArtifact.abi).interface]);
      const message = isCancelledReplacement(err) ? 'This operation was replaced or cancelled in the wallet. A successful cancellation does not complete this operation.'
        : outcome === 'confirmation_unknown' ? 'The wallet returned a transaction hash, but confirmation could not be verified. Check this hash and the product state before submitting again.'
        : outcome === 'submission_unknown' ? 'The wallet or RPC reported an error while submitting. Submission status is unknown; check the product state before trying again.' : detail;
      publishTransaction({phase: 'error', label, hash: knownHash, outcome, message, diagnostic: transactionDiagnostic(walletError ?? err, stage, account, config?.chainId ?? null, knownHash)});
      return null;
    } finally { finished = true; activeWrite.current = false; walletProvider?.destroy(); }
  }, [account, config, ready, syncWallet, publishTransaction]);

  const busy = connecting || tx.phase === 'signing' || tx.phase === 'pending';
  return <DappContext.Provider value={{config, provider, registry, warranty, account, chainId, roles, rolesLoading, rolesError, ready, error: setupError || walletError, busy, tx, revision, connect, switchNetwork, reload, resetTransaction, recheckTransaction, transact}}>{children}</DappContext.Provider>;
}
export function useDapp(): DappContextValue {
  const context = useContext(DappContext);
  if (!context) throw new Error('useDapp must be used inside DappProvider.');
  return context;
}
