import './style.css';
import { createPublicClient, createWalletClient, custom, http, getAddress, formatEther, verifyTypedData, type EIP1193Provider, type Address, type Hex } from 'viem';
import { GATEWAY_MINTER, DOMAIN, TYPES, MINTER_ABI, units, usdc, serialize, createIntent, validateIntent, feeCap, confirmedPayment, recipientAddress, validateRecovery, validateAttestation } from './protocol.js';
import { NETWORKS, networkFor } from './networks.js';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const amount = el<HTMLInputElement>('amount');
const recipientInput = el<HTMLInputElement>('recipient');
const customRecipient = el<HTMLInputElement>('custom-recipient');
const networkSelect = el<HTMLSelectElement>('network-select');
const connectButton = el<HTMLButtonElement>('connect');
const walletSelect = el<HTMLSelectElement>('wallet-select');
type Provider = EIP1193Provider & { providers?: Provider[]; on?: (event: string, cb: (...args: any[]) => void) => void; removeListener?: (event: string, cb: (...args: any[]) => void) => void };
type Wallet = { info: { uuid: string; name: string }; provider: Provider };
type Context = { networkKey: string; source: Address; recipient: Address };
type Intent = ReturnType<typeof createIntent>;
type Quote = Context & { intent: Intent; fee: string; createdAt: number };
type Pending = { intent: Intent; signature: Hex; createdAt: number; attestation?: Hex; attestationSignature?: Hex; hash?: Hex };
const STORAGE = 'gateway.withdrawal.v2';
const LEGACY_STORAGE = 'traversa.gateway.withdrawal.v1';
const wallets: Wallet[] = [];
let provider: Provider | undefined;
let account: Address | undefined;
let available: bigint | undefined;
let quote: Quote | undefined;
let pending: Pending | undefined;
let busy = false;
let blockedStorage = false;
let accountEpoch = 0;
let balanceRequest = 0;

for (const [key, { chain }] of Object.entries(NETWORKS)) {
  const option = document.createElement('option'); option.value = key; option.textContent = chain.name; networkSelect.appendChild(option);
}
function selectedNetwork() { return networkFor(networkSelect.value); }
function publicClient(key = networkSelect.value) { return createPublicClient({ chain: networkFor(key).chain, transport: http(`/api/rpc?network=${key}`, { retryCount: 1, timeout: 20000 }) }); }
function context(): Context {
  if (!account) throw new Error('Connect a wallet first.');
  return { source: account, recipient: customRecipient.checked ? recipientAddress(recipientInput.value.trim()) : account, networkKey: networkSelect.value };
}
function status(message: string, error = false) {
  const element = el('status'); element.textContent = message; element.hidden = !message; element.className = error ? 'error' : 'notice';
}
function failure(error: unknown) {
  const e = error as { shortMessage?: string; message?: string };
  const message = e.shortMessage || e.message || 'Something went wrong. Please try again.';
  status(/reject|denied/i.test(message) ? 'You declined the wallet request. Continue when you’re ready.' : message, true);
}
async function api(operation: string, data: object = {}) {
  const response = await fetch('/api/gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: serialize({ operation, ...data }), signal: AbortSignal.timeout(55000) });
  const result = await response.json();
  if (!response.ok || result.error || result.success === false) throw new Error(result.message || (typeof result.error === 'string' ? result.error : result.error?.message) || 'Circle could not complete this request.');
  return result;
}
function addressLink(id: string, address: string | undefined, key: string) {
  const link = el<HTMLAnchorElement>(id); link.textContent = address || 'Connect your wallet'; link.removeAttribute('href');
  if (address) { try { link.href = `${networkFor(key).chain.blockExplorers.default.url}/address/${recipientAddress(address)}`; } catch { /* Validate custom input on review. */ } }
}
function controls() {
  const saved = pending ? validateIntent(pending.intent) : undefined;
  const correct = !!account && (!saved || account.toLowerCase() === saved.source.toLowerCase());
  const locked = busy || !!pending || blockedStorage;
  el<HTMLButtonElement>('review').disabled = locked || available === undefined || !amount.value || !account;
  amount.disabled = locked; recipientInput.disabled = locked; customRecipient.disabled = locked; networkSelect.disabled = locked;
  el<HTMLButtonElement>('max').disabled = locked || !available;
  el<HTMLButtonElement>('refresh').disabled = busy || !account;
  connectButton.disabled = busy; connectButton.textContent = account ? 'Change wallet' : 'Connect wallet →';
  walletSelect.disabled = busy;
  el('connected').hidden = !account;
  el('connected').textContent = account ? `Connected: ${account}${saved && !correct ? ` · Switch to ${saved.source} to resume.` : ''}` : '';
  el('recipient-field').hidden = !customRecipient.checked;
  el<HTMLButtonElement>('execute').hidden = !quote || !!pending;
  el<HTMLButtonElement>('execute').disabled = busy || !correct || blockedStorage;
  el('recovery').hidden = !pending;
  el<HTMLButtonElement>('resume').disabled = busy || !correct || blockedStorage;
  el('withdraw-form').hidden = !!pending;
  el<HTMLInputElement>('import-file').disabled = busy || !!pending;
  addressLink('source', saved?.source ?? account, saved?.networkKey ?? networkSelect.value);
  addressLink('destination', saved?.recipient ?? (customRecipient.checked ? recipientInput.value.trim() : account), saved?.networkKey ?? networkSelect.value);
  el('network-name').textContent = `${selectedNetwork().chain.name} mainnet`;
  if (saved) el('recovery-summary').textContent = `${usdc(pending!.intent.spec.value)} USDC on ${saved.network.chain.name} → ${saved.recipient}`;
}
function resetQuote() { quote = undefined; el('quote').hidden = true; controls(); }
async function refresh() {
  const request = ++balanceRequest;
  if (!account) { available = undefined; el('balance').textContent = '—'; el('balance-note').textContent = 'Connect a wallet to see your Gateway balance.'; controls(); return; }
  const source = account; const key = networkSelect.value;
  el('balance-note').textContent = 'Fetching your live balance…';
  try {
    const result = await api('balances', { source, networkKey: key });
    if (request !== balanceRequest) return;
    const balance = result.balances?.find((b: any) => b.domain === networkFor(key).domain && b.depositor.toLowerCase() === source.toLowerCase());
    if (!balance) throw new Error('Circle returned no balance for this wallet and network.');
    available = units(balance.balance); el('balance').textContent = usdc(available);
    const extra = balance.pendingBatch && units(balance.pendingBatch) > 0n ? ` · ${usdc(units(balance.pendingBatch))} USDC pending settlement` : '';
    el('balance-note').textContent = `Live balance · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${extra}`;
  } catch (error) {
    if (request !== balanceRequest) return;
    available = undefined; el('balance').textContent = '—'; el('balance-note').textContent = 'Balance unavailable. Refresh to try again.'; failure(error);
  }
  controls();
}
function salt(): Hex { return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')}`; }
async function estimate(value: bigint, ctx: Context): Promise<Quote> {
  if (value <= 0n) throw new Error('Enter an amount greater than zero.');
  const requested = createIntent({ ...ctx, amount: value, salt: salt() });
  const result = await api('estimate', { intent: requested });
  const estimated = (result.body ?? result)?.[0]?.burnIntent;
  if (!estimated?.maxBlockHeight) throw new Error('Circle did not return an authorization expiry.');
  const fee = result.fees?.total !== undefined ? units(result.fees.total) : BigInt(estimated.maxFee);
  const intent = createIntent({ ...ctx, amount: value, salt: requested.spec.salt, maxFee: feeCap(fee, ctx.networkKey), maxBlockHeight: estimated.maxBlockHeight });
  validateIntent(intent, ctx);
  return { ...ctx, intent, fee: fee.toString(), createdAt: Date.now() };
}
function showQuote(next: Quote) {
  quote = next;
  el('receive-amount').textContent = `${usdc(next.intent.spec.value)} USDC`;
  el('estimated-fee').textContent = `${usdc(next.fee)} USDC`;
  el('max-fee').textContent = `${usdc(next.intent.maxFee)} USDC`;
  el('total').textContent = `${usdc(BigInt(next.intent.spec.value) + BigInt(next.intent.maxFee))} USDC`;
  el('review-recipient').textContent = next.recipient;
  el('gas-note').textContent = `Your connected wallet pays the final ${selectedNetwork().chain.nativeCurrency.symbol} network fee, shown by your wallet. The Gateway allowance is separate and may exceed the actual fee.`;
  el('quote').hidden = false; controls();
}
async function review(useMax = false) {
  if (busy || pending || blockedStorage) return;
  busy = true; resetQuote(); status('Fetching a live withdrawal estimate…');
  try {
    const ctx = context(); const epoch = accountEpoch;
    await refresh();
    if (available === undefined) throw new Error('Refresh your Gateway balance before continuing.');
    let value = useMax ? available : units(amount.value.trim()); let next = await estimate(value, ctx);
    if (useMax) {
      value = available - BigInt(next.intent.maxFee);
      if (value <= 0n) throw new Error('Your balance is too small to cover the Gateway fee.');
      next = await estimate(value, ctx); amount.value = usdc(value);
    }
    if (epoch !== accountEpoch) throw new Error('Your account changed. Review the withdrawal again.');
    validateIntent(next.intent, context());
    if (value + BigInt(next.intent.maxFee) > available) throw new Error('Leave enough USDC for the maximum Gateway fee, or choose Max.');
    showQuote(next); status('Review the full recipient address, network and fee allowance before signing.');
  } catch (error) { failure(error); }
  finally { busy = false; controls(); }
}
function addWallet(wallet: Wallet) {
  if (!wallet.provider || wallets.some(existing => existing.provider === wallet.provider)) return;
  wallets.push(wallet); const option = document.createElement('option'); option.value = wallet.info.uuid; option.textContent = wallet.info.name; walletSelect.appendChild(option);
  walletSelect.hidden = wallets.length < 2; el('wallet-label').hidden = wallets.length < 2;
}
window.addEventListener('eip6963:announceProvider', ((event: CustomEvent<Wallet>) => addWallet(event.detail)) as EventListener);
window.dispatchEvent(new Event('eip6963:requestProvider'));
const injected = (window as Window & { ethereum?: Provider }).ethereum;
if (injected) for (const [index, candidate] of (injected.providers || [injected]).entries()) addWallet({ info: { uuid: `injected-${index}`, name: index ? `Browser wallet ${index + 1}` : 'Browser wallet' }, provider: candidate });
function onAccountsChanged(accounts: string[]) {
  accountEpoch++; balanceRequest++; account = accounts[0] ? getAddress(accounts[0]) : undefined;
  available = undefined; resetQuote(); void refresh();
}
function onChainChanged() { accountEpoch++; resetQuote(); }
async function connect() {
  if (busy) return; busy = true; controls();
  try {
    const chosen = wallets.find(wallet => wallet.info.uuid === walletSelect.value) || wallets[0];
    if (!chosen) throw new Error('Open this page with a browser wallet extension, or inside your wallet’s browser.');
    provider?.removeListener?.('accountsChanged', onAccountsChanged); provider?.removeListener?.('chainChanged', onChainChanged);
    provider = chosen.provider; provider.on?.('accountsChanged', onAccountsChanged); provider.on?.('chainChanged', onChainChanged);
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts[0]) throw new Error('Your wallet did not provide an account.'); onAccountsChanged(accounts);
    if (pending) { const saved = validateIntent(pending.intent); if (account?.toLowerCase() !== saved.source.toLowerCase()) throw new Error(`Connect ${saved.source} to resume this saved withdrawal.`); }
    status('Wallet connected. Select the network holding your Gateway balance.');
  } catch (error) { failure(error); }
  finally { busy = false; controls(); }
}
async function assertWallet(ctx: Context) {
  if (!provider) throw new Error('Connect your wallet first.');
  const checkAccount = async () => { const accounts = await provider!.request({ method: 'eth_accounts' }); if (accounts[0]?.toLowerCase() !== ctx.source.toLowerCase()) throw new Error(`Connect the source wallet ${ctx.source} before continuing.`); };
  await checkAccount(); const chain = networkFor(ctx.networkKey).chain; const chainId = `0x${chain.id.toString(16)}` as Hex;
  if (await provider.request({ method: 'eth_chainId' }) !== chainId) {
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch (error: any) {
      if (error.code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [...chain.rpcUrls.default.http], blockExplorerUrls: [chain.blockExplorers.default.url] }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    }
  }
  if (await provider.request({ method: 'eth_chainId' }) !== chainId) throw new Error(`Select ${chain.name} in your wallet.`);
  await checkAccount();
}
function savePending(next: Pending) { localStorage.setItem(STORAGE, serialize(next)); pending = next; controls(); }
function showHash(hash: Hex, key: string) { const link = el<HTMLAnchorElement>('transaction'); link.href = `${networkFor(key).chain.blockExplorers.default.url}/tx/${hash}`; link.hidden = false; }
async function complete(next: Pending) {
  const ctx = validateIntent(next.intent); const chain = ctx.network.chain; const client = publicClient(ctx.networkKey);
  if (!next.attestation || !next.attestationSignature) {
    status('Submitting your saved authorization to Circle…');
    const result = await api('transfer', { intent: next.intent, signature: next.signature });
    if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(result.attestation) || !/^0x(?:[a-fA-F0-9]{2})+$/.test(result.signature)) throw new Error('Circle returned an invalid attestation. Keep your saved authorization for recovery.');
    next = { ...next, attestation: result.attestation, attestationSignature: result.signature }; savePending(next);
  }
  validateAttestation(next.attestation, next.intent);
  if (!next.hash) {
    await assertWallet(ctx); status(`Checking the ${chain.name} transaction before asking your wallet…`);
    const args = [next.attestation, next.attestationSignature] as [Hex, Hex];
    await client.simulateContract({ account: ctx.source, address: GATEWAY_MINTER, abi: MINTER_ABI, functionName: 'gatewayMint', args });
    const gas = await client.estimateContractGas({ account: ctx.source, address: GATEWAY_MINTER, abi: MINTER_ABI, functionName: 'gatewayMint', args });
    const [gasPrice, native] = await Promise.all([client.getGasPrice(), client.getBalance({ address: ctx.source })]);
    if (native < gas * gasPrice * 2n + 100000000000n) throw new Error(`Your source wallet needs ${chain.nativeCurrency.symbol} on ${chain.name} for gas. Balance: ${formatEther(native)}. Fund it, then continue the saved withdrawal.`);
    await assertWallet(ctx); status(`Approve the ${chain.name} transaction. USDC will arrive at ${ctx.recipient}.`);
    const wallet = createWalletClient({ chain, transport: custom(provider!) });
    const hash = await wallet.writeContract({ account: ctx.source, chain, address: GATEWAY_MINTER, abi: MINTER_ABI, functionName: 'gatewayMint', args });
    next = { ...next, hash }; savePending(next); showHash(hash, ctx.networkKey);
  }
  showHash(next.hash!, ctx.networkKey); status('Transaction submitted. Waiting for confirmation…');
  const receipt = await client.waitForTransactionReceipt({ hash: next.hash!, confirmations: 1, timeout: 120000, pollingInterval: 2500 });
  if (receipt.status !== 'success') { const retry = { ...next }; delete retry.hash; savePending(retry); throw new Error('The mint transaction reverted. Your attestation is saved; continue to retry minting.'); }
  if (!confirmedPayment(receipt.logs, next.intent)) throw new Error('Transaction confirmed, but the expected USDC transfer was not found. Keep the recovery file and check the transaction before continuing.');
  localStorage.removeItem(STORAGE); localStorage.removeItem(LEGACY_STORAGE);
  pending = undefined; quote = undefined; el('quote').hidden = true; amount.value = '';
  await refresh(); status(`Withdrawal complete. ${usdc(next.intent.spec.value)} USDC arrived at ${ctx.recipient} on ${chain.name}.`);
}
async function runWithdrawal(resume = false) {
  if (busy || blockedStorage) return; busy = true; controls();
  try {
    if (!navigator.locks) throw new Error('Use a current browser with Web Locks support to prevent overlapping withdrawals.');
    await navigator.locks.request(STORAGE, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('A withdrawal is already running in another tab. Continue there.');
      const stored = localStorage.getItem(STORAGE);
      if (stored) { pending = await validateRecovery(JSON.parse(stored)); if (!resume) throw new Error('A saved withdrawal exists. Continue it before starting another.'); }
      else if (resume) throw new Error('This withdrawal was completed in another tab. Refresh the page.');
      if (pending) { const ctx = validateIntent(pending.intent); await assertWallet(ctx); return complete(pending); }
      if (!quote) throw new Error('Review your withdrawal first.'); const reviewed = quote;
      validateIntent(reviewed.intent, context());
      if (Date.now() - reviewed.createdAt > 120000) { resetQuote(); throw new Error('Your fee estimate expired. Review the withdrawal again.'); }
      await assertWallet(reviewed); validateIntent(reviewed.intent, context());
      const latest = await api('balances', { source: reviewed.source, networkKey: reviewed.networkKey });
      const current = latest.balances?.find((b: any) => b.domain === networkFor(reviewed.networkKey).domain && b.depositor.toLowerCase() === reviewed.source.toLowerCase());
      if (!current || units(current.balance) < BigInt(reviewed.intent.spec.value) + BigInt(reviewed.intent.maxFee)) throw new Error('Your balance changed. Refresh and review again.');
      const client = publicClient(reviewed.networkKey); const code = await client.getCode({ address: reviewed.source });
      if (code && code !== '0x') throw new Error('This version supports externally owned wallets only. Smart-contract and delegated-code wallets require additional review.');
      if (await client.getBalance({ address: reviewed.source }) < 100000000000n) throw new Error(`Add some ${networkFor(reviewed.networkKey).chain.nativeCurrency.symbol} on ${networkFor(reviewed.networkKey).chain.name} for the final transaction, then try again.`);
      localStorage.setItem(`${STORAGE}.check`, '1'); localStorage.removeItem(`${STORAGE}.check`);
      await assertWallet(reviewed); validateIntent(reviewed.intent, context()); const epoch = accountEpoch;
      status('Sign the Gateway withdrawal authorization in your wallet.');
      const wallet = createWalletClient({ chain: networkFor(reviewed.networkKey).chain, transport: custom(provider!) });
      const signature = await wallet.signTypedData({ account: reviewed.source, domain: DOMAIN, types: TYPES, primaryType: 'BurnIntent', message: reviewed.intent });
      if (!await verifyTypedData({ address: reviewed.source, domain: DOMAIN, types: TYPES, primaryType: 'BurnIntent', message: reviewed.intent, signature })) throw new Error('Your wallet returned a signature for a different account.');
      const next = { intent: reviewed.intent, signature, createdAt: Date.now() }; savePending(next);
      if (accountEpoch !== epoch) throw new Error('Your wallet changed. Reconnect the source wallet and continue the saved withdrawal.');
      await complete(next);
    });
  } catch (error) { failure(error); }
  finally { busy = false; controls(); }
}
el('withdraw-form').addEventListener('submit', event => { event.preventDefault(); void review(); });
amount.addEventListener('input', resetQuote); recipientInput.addEventListener('input', resetQuote); customRecipient.addEventListener('change', resetQuote);
networkSelect.addEventListener('change', () => { accountEpoch++; available = undefined; el('transaction').hidden = true; resetQuote(); void refresh(); });
el('max').addEventListener('click', () => void review(true));
el('refresh').addEventListener('click', () => { resetQuote(); void refresh(); });
connectButton.addEventListener('click', () => void connect());
el('execute').addEventListener('click', () => void runWithdrawal()); el('resume').addEventListener('click', () => void runWithdrawal(true));
el('download').addEventListener('click', () => {
  if (!pending) return; const blob = new Blob([serialize({ format: 'gateway-withdrawal-v2', ...pending })], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `gateway-withdrawal-${pending.createdAt}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
});
el<HTMLInputElement>('import-file').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || busy || pending) return;
  busy = true; controls();
  try {
    if (file.size > 100000) throw new Error('Recovery file is too large.'); const recovered = await validateRecovery(JSON.parse(await file.text()));
    if (localStorage.getItem(STORAGE)) throw new Error('A saved withdrawal already exists. Continue it first.');
    // Import does not sign, contact Circle, or broadcast. Continue is a separate user action.
    savePending(recovered); networkSelect.value = recovered.networkKey; resetQuote();
    if (recovered.hash) showHash(recovered.hash, recovered.networkKey);
    status(`Recovery loaded for ${recovered.source}. Check the recipient and connect that wallet to continue.`);
  } catch (error) { failure(error); }
  finally { busy = false; input.value = ''; controls(); }
});
window.addEventListener('storage', event => { if ([STORAGE, LEGACY_STORAGE].includes(event.key ?? '') && !busy) window.location.reload(); });
window.addEventListener('beforeunload', event => { if (busy) event.preventDefault(); });
async function init() {
  try {
    const stored = localStorage.getItem(STORAGE) || localStorage.getItem(LEGACY_STORAGE);
    if (stored) { const recovered = await validateRecovery(JSON.parse(stored)); savePending(recovered); networkSelect.value = recovered.networkKey; if (recovered.hash) showHash(recovered.hash, recovered.networkKey); status('A saved withdrawal is ready to continue. Connect its source wallet.'); }
  } catch { blockedStorage = true; status('Recovery storage is unavailable or contains an invalid record. Export or reconcile it before starting another withdrawal. Do not clear an unresolved authorization.', true); }
  controls(); await refresh();
}
void init();
