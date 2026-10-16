import { pad, zeroAddress, parseUnits, formatUnits, maxUint256, getAddress, isAddress, recoverTypedDataAddress, encodePacked } from 'viem';
import { networkFor, keyForDomain } from './networks.js';
export const GATEWAY_WALLET = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE';
export const GATEWAY_MINTER = '0x2222222d7164433c4C09B0b0D809a9b52C04C205';
export const DOMAIN = { name: 'GatewayWallet', version: '1' };
export const TYPES = {
  TransferSpec: [
    { name: 'version', type: 'uint32' }, { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' }, { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' }, { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' }, { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' }, { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' }, { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' }, { name: 'hookData', type: 'bytes' },
  ],
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' }, { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
};
export const MINTER_ABI = [{
  type: 'function', name: 'gatewayMint', stateMutability: 'nonpayable',
  inputs: [{ name: 'attestationPayload', type: 'bytes' }, { name: 'signature', type: 'bytes' }], outputs: [],
}];
export const bytes32 = address => pad(address.toLowerCase(), { size: 32 });
export const units = amount => {
  if (typeof amount !== 'string' || !/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/.test(amount)) throw new Error('Enter a USDC amount with up to six decimal places.');
  return parseUnits(amount, 6);
};
export const usdc = amount => formatUnits(BigInt(amount), 6);
export const serialize = value => JSON.stringify(value, (_, current) => typeof current === 'bigint' ? current.toString() : current);
export function recipientAddress(value) {
  if (typeof value !== 'string' || !isAddress(value, { strict: true })) throw new Error('Enter a valid EVM recipient address. Mixed-case addresses must have a valid checksum.');
  const address = getAddress(value);
  if ([zeroAddress, GATEWAY_WALLET, GATEWAY_MINTER].some(reserved => reserved.toLowerCase() === address.toLowerCase())) throw new Error('Choose a wallet address, not a zero or Gateway contract address.');
  return address;
}
export function addressFromBytes32(value) {
  if (typeof value !== 'string' || !/^0x0{24}[0-9a-f]{40}$/.test(value)) throw new Error('Invalid encoded EVM address.');
  return getAddress(`0x${value.slice(-40)}`);
}
/** @param {{networkKey:string, source:string, recipient:string, amount:bigint|string, salt:string, maxFee?:bigint|string|null, maxBlockHeight?:string}} params */
export function createIntent({ networkKey, source, recipient, amount, salt, maxFee = null, maxBlockHeight = maxUint256.toString() }) {
  const network = networkFor(networkKey);
  return {
    maxBlockHeight: maxBlockHeight.toString(), maxFee: (maxFee ?? network.feeLimit).toString(),
    spec: {
      version: 1, sourceDomain: network.domain, destinationDomain: network.domain,
      sourceContract: bytes32(GATEWAY_WALLET), destinationContract: bytes32(GATEWAY_MINTER),
      sourceToken: bytes32(network.usdc), destinationToken: bytes32(network.usdc),
      sourceDepositor: bytes32(recipientAddress(source)), destinationRecipient: bytes32(recipientAddress(recipient)),
      sourceSigner: bytes32(source), destinationCaller: bytes32(zeroAddress),
      value: amount.toString(), salt, hookData: '0x',
    },
  };
}
export function validateIntent(intent, context) {
  if (!intent || !intent.spec) throw new Error('Missing withdrawal authorization.');
  const spec = intent.spec;
  if (!/^[1-9]\d{0,18}$/.test(spec.value) || !/^0x[0-9a-fA-F]{64}$/.test(spec.salt)) throw new Error('Invalid withdrawal amount or identifier.');
  const networkKey = keyForDomain(spec.sourceDomain);
  const network = networkFor(networkKey);
  const source = recipientAddress(addressFromBytes32(spec.sourceDepositor));
  const recipient = recipientAddress(addressFromBytes32(spec.destinationRecipient));
  if (!/^\d{1,78}$/.test(intent.maxFee) || BigInt(intent.maxFee) > network.feeLimit) throw new Error(`Gateway fee exceeds the ${usdc(network.feeLimit)} USDC limit for this network.`);
  if (!/^[1-9]\d{0,77}$/.test(intent.maxBlockHeight) || BigInt(intent.maxBlockHeight) > maxUint256) throw new Error('Invalid authorization expiry.');
  const expected = createIntent({ networkKey, source, recipient, amount: spec.value, salt: spec.salt, maxFee: intent.maxFee, maxBlockHeight: intent.maxBlockHeight });
  if (Object.keys(spec).length !== Object.keys(expected.spec).length || Object.keys(intent).length !== 3) throw new Error('Unexpected authorization fields.');
  for (const [key, value] of Object.entries(expected.spec)) {
    if (spec[key] !== value) throw new Error(`Unexpected withdrawal field: ${key}.`);
  }
  if (context && (context.networkKey !== networkKey || context.source.toLowerCase() !== source.toLowerCase() || context.recipient.toLowerCase() !== recipient.toLowerCase())) throw new Error('Withdrawal no longer matches the reviewed wallet, network or recipient. Review it again.');
  return { networkKey, network, source, recipient };
}
export function feeCap(estimated, networkKey) {
  if (typeof estimated !== 'bigint' || estimated < 0n) throw new Error('Invalid fee estimate.');
  const slack = estimated / 5n > 1000n ? estimated / 5n : 1000n;
  const cap = estimated + slack;
  if (cap > networkFor(networkKey).feeLimit) throw new Error('Gateway fee exceeds this network’s safety limit. Review Circle fees before continuing.');
  return cap;
}
export function confirmedPayment(logs, intent) {
  const { network, recipient } = validateIntent(intent);
  const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  return logs.some(log => log.address.toLowerCase() === network.usdc.toLowerCase() && log.topics[0] === topic && log.topics[2]?.toLowerCase() === bytes32(recipient) && BigInt(log.data) === BigInt(intent.spec.value));
}

export function validateAttestation(payload, intent) {
  validateIntent(intent);
  if (typeof payload !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(payload)) throw new Error('Invalid Circle attestation encoding.');
  let body = payload.toLowerCase();
  // Circle's packed EVM Attestation or a single-element AttestationSet.
  // Layout: circlefin/evm-gateway-contracts/src/lib/{Attestations,TransferSpec}.sol
  if (body.startsWith('0x1e12db71')) {
    if (body.slice(10, 18) !== '00000001') throw new Error('Expected exactly one withdrawal attestation.');
    body = `0x${body.slice(18)}`;
  }
  if (!body.startsWith('0xff6fb334') || body.length !== 2 + (40 + 340) * 2 || body.slice(74, 82) !== '00000154') throw new Error('Unsupported Circle attestation layout. Keep the recovery file for manual reconciliation.');
  const s = intent.spec;
  const expected = encodePacked(
    ['bytes4', 'uint32', 'uint32', 'uint32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'uint32'],
    ['0xca85def7', s.version, s.sourceDomain, s.destinationDomain, s.sourceContract, s.destinationContract, s.sourceToken, s.destinationToken, s.sourceDepositor, s.destinationRecipient, s.sourceSigner, s.destinationCaller, BigInt(s.value), s.salt, 0],
  );
  if (`0x${body.slice(82)}` !== expected.toLowerCase()) throw new Error('Circle attestation does not match the signed wallet, recipient, amount or network.');
  return true;
}

export async function validateRecovery(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid recovery file.');
  const { networkKey, source, recipient } = validateIntent(value.intent);
  if (typeof value.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value.signature)) throw new Error('Invalid recovery signature.');
  const signer = await recoverTypedDataAddress({ domain: DOMAIN, types: TYPES, primaryType: 'BurnIntent', message: value.intent, signature: value.signature });
  if (signer.toLowerCase() !== source.toLowerCase()) throw new Error('Recovery signature does not match its source wallet.');
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) throw new Error('Invalid recovery timestamp.');
  if (!!value.attestation !== !!value.attestationSignature) throw new Error('Incomplete recovery attestation.');
  for (const key of ['attestation', 'attestationSignature']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !/^0x(?:[a-fA-F0-9]{2})+$/.test(value[key]) || value[key].length > 20000)) throw new Error('Invalid recovery attestation.');
  }
  if (value.hash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(value.hash)) throw new Error('Invalid transaction hash.');
  if (value.hash && !value.attestation) throw new Error('Transaction recovery is missing its attestation.');
  if (value.attestation) validateAttestation(value.attestation, value.intent);
  // Imported metadata cannot override the signed wallet, recipient or network.
  return { intent: value.intent, signature: value.signature, createdAt: value.createdAt,
    ...(value.attestation ? { attestation: value.attestation, attestationSignature: value.attestationSignature } : {}),
    ...(value.hash ? { hash: value.hash } : {}), networkKey, source, recipient };
}
