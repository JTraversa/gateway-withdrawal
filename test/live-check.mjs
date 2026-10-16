// Read-only network verification. No signing, transfer requests or broadcasts.
import { createPublicClient, http, erc20Abi } from 'viem';
import { NETWORKS } from '../src/networks.js';
import { GATEWAY_MINTER, GATEWAY_WALLET, createIntent, recipientAddress } from '../src/protocol.js';
import { randomBytes } from 'node:crypto';
const source = recipientAddress(process.argv[2] || '0x1111111111111111111111111111111111111111');
let failed = false;
for (const [key, network] of Object.entries(NETWORKS)) {
  try {
    const client = createPublicClient({ chain: network.chain, transport: http(network.rpc[0], { timeout: 15000, retryCount: 0 }) });
    const intent = createIntent({ networkKey: key, source, recipient: source, amount: 1000000n, salt: `0x${randomBytes(32).toString('hex')}` });
    const [chainId, minter, wallet, decimals, estimate] = await Promise.all([
      client.getChainId(), client.getCode({ address: GATEWAY_MINTER }), client.getCode({ address: GATEWAY_WALLET }),
      client.readContract({ address: network.usdc, abi: erc20Abi, functionName: 'decimals' }),
      fetch('https://gateway-api.circle.com/v1/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ spec: intent.spec }]), signal: AbortSignal.timeout(20000) }).then(async r => ({ status: r.status, data: await r.json() })),
    ]);
    if (chainId !== network.chain.id || !minter || minter === '0x' || !wallet || wallet === '0x' || decimals !== 6 || estimate.status !== 200) throw new Error('Chain, contracts, token or estimate check failed.');
    console.log(JSON.stringify({ network: key, chainId, domain: network.domain, minterDeployed: true, walletDeployed: true, usdcDecimals: decimals, estimatedMaxFee: (estimate.data.body ?? estimate.data)[0].burnIntent.maxFee }));
  } catch (error) { failed = true; console.error(key, error.shortMessage || error.message); }
}
if (failed) process.exitCode = 1;
