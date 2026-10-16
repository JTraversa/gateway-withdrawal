import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { hashTypedData } from 'viem';
import { DOMAIN, TYPES, createIntent, validateIntent, feeCap, units, bytes32, confirmedPayment, recipientAddress, validateRecovery, validateAttestation } from '../src/protocol.js';
import { attestationFor } from './fixtures.mjs';
import { NETWORKS, networkFor } from '../src/networks.js';
import gateway from '../api/gateway.js';
import rpc from '../api/rpc.js';

// Synthetic test accounts. Never funded or used to submit a real transfer.
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const ctx = { networkKey: 'base', source: account.address, recipient: other.address };
const salt = `0x${'ab'.repeat(32)}`;
const intent = (overrides = {}) => createIntent({ ...ctx, amount: 1000000n, salt, maxFee: 13200n, maxBlockHeight: '53000000', ...overrides });
const typed = message => ({ domain: DOMAIN, types: TYPES, primaryType: 'BurnIntent', message });
const response = () => ({ statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('USDC arithmetic rejects ambiguous and overprecise amounts', () => {
  assert.equal(units('146.428'), 146428000n); assert.equal(units('0.000001'), 1n);
  for (const value of ['1.0000001', '-1', '1e6', 'NaN', '01', ' 1', '', '.1', '1.']) assert.throws(() => units(value));
});
test('recipient checks reject zero, Circle contracts and invalid checksums', () => {
  assert.equal(recipientAddress(other.address.toLowerCase()), other.address);
  for (const value of ['0x0000000000000000000000000000000000000000', '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE', '0x2222222d7164433c4C09B0b0D809a9b52C04C205', 'vitalik.eth', '0x1234', `${other.address.slice(0, -1)}Z`]) assert.throws(() => recipientAddress(value));
});
test('every enabled network uses its own native USDC and same source/destination domain', () => {
  for (const [key, network] of Object.entries(NETWORKS)) {
    const value = intent({ networkKey: key }); const result = validateIntent(value);
    assert.equal(result.networkKey, key); assert.equal(value.spec.sourceDomain, network.domain); assert.equal(value.spec.destinationDomain, network.domain);
    assert.equal(value.spec.sourceToken, bytes32(network.usdc)); assert.equal(value.spec.destinationToken, bytes32(network.usdc));
  }
  for (const key of ['__proto__', 'constructor', 'file:///etc/passwd', 'unknown']) assert.throws(() => networkFor(key));
});
test('fee caps bound exposure and Max reserves the authorized fee', () => {
  assert.equal(feeCap(11000n, 'base'), 13200n); assert.equal(146440000n - feeCap(11000n, 'base'), 146426800n);
  assert.equal(feeCap(1100000n, 'ethereum'), 1320000n);
  assert.throws(() => feeCap(100000n, 'base')); assert.throws(() => feeCap(-1n, 'base'));
});
test('intent validation binds reviewed recipient, source and network', () => {
  validateIntent(intent(), ctx);
  for (const changed of [{ ...ctx, source: other.address }, { ...ctx, recipient: account.address }, { ...ctx, networkKey: 'ethereum' }]) assert.throws(() => validateIntent(intent(), changed));
  validateIntent(intent({ recipient: account.address }));
});
test('intent validation blocks cross-network transfers, hooks, altered contracts, tokens and delegates', () => {
  for (const [key, value] of Object.entries({ sourceSigner: bytes32(other.address), destinationDomain: 0, sourceToken: bytes32(account.address), destinationToken: bytes32(account.address), sourceContract: bytes32(account.address), destinationContract: bytes32(account.address), destinationCaller: bytes32(account.address), version: 2, hookData: '0x1234', value: '0', salt: '0x00' })) {
    const changed = intent(); changed.spec[key] = value; assert.throws(() => validateIntent(changed), key);
  }
  for (const [key, value] of [['maxFee', '100001'], ['maxFee', '-1'], ['maxBlockHeight', '0'], ['maxBlockHeight', '9'.repeat(78)]]) {
    const changed = intent(); changed[key] = value; assert.throws(() => validateIntent(changed));
  }
  assert.throws(() => validateIntent({ ...intent(), unexpected: true }));
});
test('EIP-712 encoding matches explicit Circle domain fields', () => {
  const value = typed(intent());
  assert.equal(hashTypedData(value), hashTypedData({ ...value, types: { ...TYPES, EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }] } }));
});
test('recovery validates signatures and ignores unsigned recipient metadata', async () => {
  const value = intent(); const signature = await account.signTypedData(typed(value));
  const recovered = await validateRecovery({ intent: value, signature, createdAt: Date.now(), recipient: account.address, networkKey: 'ethereum' });
  assert.equal(recovered.recipient, other.address); assert.equal(recovered.networkKey, 'base');
  await assert.rejects(validateRecovery({ intent: value, signature: await other.signTypedData(typed(value)), createdAt: Date.now() }));
  await assert.rejects(validateRecovery({ ...recovered, intent: intent({ recipient: account.address }) }));
  await assert.rejects(validateRecovery({ ...recovered, hash: '0x1234' }));
  await assert.rejects(validateRecovery({ ...recovered, attestation: '0x1234' }));
});
test('receipt verification requires the exact token, recipient and amount', () => {
  const value = intent(); const transfer = { address: NETWORKS.base.usdc, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', bytes32(account.address), bytes32(other.address)], data: '0x0f4240' };
  assert.equal(confirmedPayment([transfer], value), true);
  assert.equal(confirmedPayment([{ ...transfer, address: NETWORKS.ethereum.usdc }], value), false);
  assert.equal(confirmedPayment([{ ...transfer, data: '0x0f4241' }], value), false);
  assert.equal(confirmedPayment([{ ...transfer, topics: [...transfer.topics.slice(0, 2), bytes32(account.address)] }], value), false);
});
test('attestation must contain the exact signed transfer, including recipient and salt', () => {
  const value = intent(); const payload = attestationFor(value);
  assert.equal(validateAttestation(payload, value), true);
  assert.equal(validateAttestation(`0x1e12db7100000001${payload.slice(2)}`, value), true);
  assert.throws(() => validateAttestation(payload, intent({ recipient: account.address })));
  assert.throws(() => validateAttestation(payload, intent({ amount: 2000000n })));
  assert.throws(() => validateAttestation(`0x1e12db7100000002${payload.slice(2)}`, value));
  assert.throws(() => validateAttestation('0x1234', value));
});
test('server blocks forged signatures and invalid operations before upstream access', async () => {
  for (const body of [{ operation: 'other' }, { operation: 'balances', source: account.address, networkKey: '__proto__' }, { operation: 'transfer', intent: intent(), signature: await other.signTypedData(typed(intent())) }]) {
    const res = response(); await gateway({ method: 'POST', body }, res); assert.equal(res.statusCode, 400);
  }
});
test('server forwards valid signatures from arbitrary source wallets to fixed Circle API', async () => {
  const value = intent(); const signature = await account.signTypedData(typed(value));
  const original = globalThis.fetch; let called = false;
  globalThis.fetch = async (url, options) => {
    called = true; assert.equal(url, 'https://gateway-api.circle.com/v1/transfer');
    assert.deepEqual(JSON.parse(options.body), [{ burnIntent: value, signature }]);
    return Response.json({ attestation: '0x1234', signature: '0xabcd' });
  };
  try { const res = response(); await gateway({ method: 'POST', body: { operation: 'transfer', intent: value, signature } }, res); assert.equal(res.statusCode, 200); assert.equal(called, true); }
  finally { globalThis.fetch = original; }
});
test('RPC rejects transaction broadcasts, batch requests and unknown networks', async () => {
  for (const body of [{ method: 'eth_sendRawTransaction', params: ['0x'] }, { method: 'eth_sendTransaction', params: [] }, [{ method: 'eth_call', params: [] }]]) { const res = response(); await rpc({ method: 'POST', body }, res); assert.equal(res.statusCode, 400); }
  const res = response(); await rpc({ method: 'POST', query: { network: 'unknown' }, body: { method: 'eth_chainId' } }, res); assert.equal(res.statusCode, 400);
});
