import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import { NETWORKS, networkFor } from '../../src/networks.js';
import { createIntent, DOMAIN, TYPES, bytes32 } from '../../src/protocol.js';
import { attestationFor } from '../fixtures.mjs';

// Synthetic accounts, signed only into mocked Circle requests.
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const hash = `0x${'aa'.repeat(32)}`;
const blockHash = `0x${'bb'.repeat(32)}`;
const STORAGE = 'gateway.withdrawal.v2';
type Options = { rejectSignature?: boolean; rejectMint?: boolean; zeroGas?: boolean; wrongSignature?: boolean; receiptTimeout?: boolean; sourceCode?: string };

async function setup(page: Page, context: BrowserContext, options: Options = {}) {
  const state = { transfers: 0, estimates: 0, source: account.address, recipient: account.address, amount: 1000000n, intent: undefined as any, signatures: 0, broadcasts: 0 };
  await page.exposeFunction('__sign', async (typed: any) => {
    state.signatures++;
    return (options.wrongSignature ? other : account).signTypedData(typed);
  });
  await page.exposeFunction('__broadcast', () => { state.broadcasts++; return hash; });
  await context.addInitScript(({ source, rejectSignature, rejectMint }) => {
    const events: Record<string, Function> = {};
    const w = window as any;
    w.__wallet = { account: source, chainId: '0x2105', rejectSignature, rejectMint };
    w.__changeAccount = (next: string) => { w.__wallet.account = next; events.accountsChanged?.([next]); };
    w.ethereum = {
      on: (name: string, cb: Function) => { events[name] = cb; }, removeListener: () => {},
      request: async ({ method, params }: any) => {
        const state = w.__wallet;
        if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [state.account];
        if (method === 'eth_chainId') return state.chainId;
        if (method === 'wallet_switchEthereumChain') { state.chainId = params[0].chainId; events.chainChanged?.(state.chainId); return null; }
        if (method === 'eth_signTypedData_v4') { if (state.rejectSignature) throw { code: 4001, message: 'User rejected signature' }; state.signed = JSON.parse(params[1]); return w.__sign(state.signed); }
        if (method === 'eth_sendTransaction') { if (state.rejectMint) throw { code: 4001, message: 'User rejected transaction' }; state.transaction = params[0]; return w.__broadcast(); }
        throw new Error(`Unexpected wallet call ${method}`);
      },
    };
  }, { source: account.address, rejectSignature: !!options.rejectSignature, rejectMint: !!options.rejectMint });
  await context.route('**/api/gateway', async route => {
    const body = route.request().postDataJSON(); let data;
    if (body.operation === 'balances') data = { token: 'USDC', balances: [{ domain: networkFor(body.networkKey).domain, depositor: body.source, balance: '146.440000', pendingBatch: '0.220000' }] };
    else if (body.operation === 'estimate') { state.estimates++; data = [{ burnIntent: { ...body.intent, maxFee: body.intent.spec.sourceDomain === 0 ? '1100000' : '11000', maxBlockHeight: '53036061' } }]; }
    else if (body.operation === 'transfer') {
      state.transfers++; state.intent = body.intent; state.source = `0x${body.intent.spec.sourceDepositor.slice(-40)}`; state.recipient = `0x${body.intent.spec.destinationRecipient.slice(-40)}`; state.amount = BigInt(body.intent.spec.value);
      data = { attestation: attestationFor(body.intent), signature: `0x${'22'.repeat(65)}` };
    } else throw new Error(`Unexpected API ${body.operation}`);
    await route.fulfill({ json: data });
  });
  await context.route('**/api/rpc?network=*', async route => {
    const key = new URL(route.request().url()).searchParams.get('network')!; const network = networkFor(key);
    const req = route.request().postDataJSON();
    const log = { address: network.usdc, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', bytes32('0x0000000000000000000000000000000000000000'), bytes32(state.recipient)], data: `0x${state.amount.toString(16).padStart(64, '0')}`, blockNumber: '0x3200000', transactionHash: hash, transactionIndex: '0x0', blockHash, logIndex: '0x0', removed: false };
    const receipt = { transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: '0x3200000', from: state.source, to: '0x2222222d7164433c4C09B0b0D809a9b52C04C205', cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', effectiveGasPrice: '0xf4240', contractAddress: null, logs: [log], logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', type: '0x2' };
    const results: Record<string, unknown> = { eth_chainId: `0x${network.chain.id.toString(16)}`, eth_getCode: options.sourceCode || '0x', eth_getBalance: options.zeroGas ? '0x0' : '0x38d7ea4c68000', eth_call: '0x', eth_estimateGas: '0x186a0', eth_gasPrice: '0xf4240', eth_blockNumber: '0x3200001', eth_getTransactionReceipt: options.receiptTimeout ? null : receipt };
    if (!(req.method in results)) throw new Error(`Unexpected RPC ${req.method}`);
    await route.fulfill({ json: { jsonrpc: '2.0', id: req.id, result: results[req.method] } });
  });
  await page.goto('./'); await expect(page.locator('#balance')).toHaveText('—');
  return state;
}
async function connect(page: Page) { await page.locator('#connect').click(); await expect(page.locator('#balance')).toHaveText('146.44'); }
async function review(page: Page) { await page.locator('#amount').fill('1'); await page.locator('#review').click(); await expect(page.locator('#quote')).toBeVisible(); }

test('default withdrawal uses connected wallet for both source and recipient', async ({ page, context }) => {
  const state = await setup(page, context); await connect(page);
  await expect(page.locator('#destination')).toHaveText(account.address);
  await page.locator('#max').click(); await expect(page.locator('#amount')).toHaveValue('146.4268');
  await page.locator('#execute').click(); await expect(page.locator('#status')).toContainText('Withdrawal complete');
  expect(state.signatures).toBe(1); expect(state.transfers).toBe(1); expect(state.broadcasts).toBe(1);
  expect(state.intent.spec.sourceDepositor).toBe(bytes32(account.address)); expect(state.intent.spec.destinationRecipient).toBe(bytes32(account.address));
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE)).toBeNull();
});
test('custom recipient is explicit, reviewed and bound to signature', async ({ page, context }) => {
  const state = await setup(page, context); await connect(page);
  await page.locator('#custom-recipient').check(); await page.locator('#recipient').fill(other.address); await review(page);
  await expect(page.locator('#review-recipient')).toHaveText(other.address);
  await page.locator('#execute').click(); await expect(page.locator('#status')).toContainText('Withdrawal complete');
  expect(state.intent.spec.destinationRecipient).toBe(bytes32(other.address));
});
test('changing recipient invalidates the reviewed quote', async ({ page, context }) => {
  const state = await setup(page, context); await connect(page); await review(page);
  await page.locator('#custom-recipient').check(); await page.locator('#recipient').fill(other.address);
  await expect(page.locator('#quote')).toBeHidden(); await expect(page.locator('#execute')).toBeHidden(); expect(state.signatures).toBe(0);
});
test('account change invalidates quote and updates the default destination', async ({ page, context }) => {
  const state = await setup(page, context); await connect(page); await review(page);
  await page.evaluate(next => (window as any).__changeAccount(next), other.address);
  await expect(page.locator('#quote')).toBeHidden(); await expect(page.locator('#destination')).toHaveText(other.address); expect(state.signatures).toBe(0);
});
for (const key of Object.keys(NETWORKS)) test(`network ${key} switches wallet and binds its native token/domain`, async ({ page, context }) => {
  const state = await setup(page, context); await connect(page); await page.locator('#network-select').selectOption(key); await review(page);
  await page.locator('#execute').click(); await expect(page.locator('#status')).toContainText('Withdrawal complete');
  expect(state.intent.spec.sourceDomain).toBe(networkFor(key).domain); expect(state.intent.spec.destinationDomain).toBe(networkFor(key).domain);
  expect(state.intent.spec.sourceToken).toBe(bytes32(networkFor(key).usdc));
});
test('rejected signature never reaches Circle', async ({ page, context }) => {
  const state = await setup(page, context, { rejectSignature: true }); await connect(page); await review(page);
  await page.locator('#execute').click(); await expect(page.locator('#status')).toContainText('You declined'); expect(state.transfers).toBe(0);
});
test('signature from wrong account is rejected before submission', async ({ page, context }) => {
  const state = await setup(page, context, { wrongSignature: true }); await connect(page); await review(page);
  await page.locator('#execute').click(); await expect(page.locator('#status')).toContainText('signature for a different account'); expect(state.transfers).toBe(0);
});
test('declined mint survives reload without a second Circle authorization', async ({ page, context }) => {
  const state = await setup(page, context, { rejectMint: true }); await connect(page); await review(page);
  await page.locator('#execute').click(); await expect(page.locator('#status')).toContainText('You declined');
  await page.reload(); await expect(page.locator('#recovery')).toBeVisible(); await connect(page);
  await page.evaluate(() => { (window as any).__wallet.rejectMint = false; }); await page.locator('#resume').click();
  await expect(page.locator('#status')).toContainText('Withdrawal complete'); expect(state.transfers).toBe(1); expect(state.signatures).toBe(1);
});
test('recovery import verifies the file and requires a separate Continue action', async ({ page, context }) => {
  const state = await setup(page, context); const intent = createIntent({ networkKey: 'base', source: account.address, recipient: other.address, amount: 1000000n, salt: `0x${'ab'.repeat(32)}`, maxFee: '13200', maxBlockHeight: '53000000' });
  const signature = await account.signTypedData({ domain: DOMAIN, types: TYPES, primaryType: 'BurnIntent', message: intent });
  await page.locator('.import summary').click();
  await page.locator('#import-file').setInputFiles({ name: 'recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ intent, signature, createdAt: Date.now() })) });
  await expect(page.locator('#recovery')).toBeVisible(); await expect(page.locator('#recovery-summary')).toContainText(other.address);
  expect(state.transfers).toBe(0); expect(state.broadcasts).toBe(0); await connect(page); await page.locator('#resume').click();
  await expect(page.locator('#status')).toContainText('Withdrawal complete'); expect(state.signatures).toBe(0); expect(state.transfers).toBe(1);
});
test('invalid recovery fails closed without a request to Circle', async ({ page, context }) => {
  const state = await setup(page, context); await page.locator('.import summary').click();
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.locator('#status')).toContainText('Missing withdrawal'); expect(state.transfers).toBe(0);
});
test('native gas and smart wallet checks block signing', async ({ page, context }) => {
  const state = await setup(page, context, { zeroGas: true }); await connect(page); await review(page);
  await page.locator('#execute').click(); await expect(page.locator('#status')).toContainText('Add some ETH'); expect(state.signatures).toBe(0);
});
test('wallets with deployed code require additional support', async ({ page, context }) => {
  const state = await setup(page, context, { sourceCode: '0x1234' }); await connect(page); await review(page);
  await page.locator('#execute').click(); await expect(page.locator('#status')).toContainText('externally owned wallets'); expect(state.signatures).toBe(0);
});
test('mobile layout has no horizontal overflow', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page, context); await connect(page); await review(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
