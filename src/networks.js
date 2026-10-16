import { base, arbitrum, optimism, polygon, avalanche, mainnet } from 'viem/chains';

// Mainnet deployments verified against Circle's Gateway and USDC address references.
// Only same-network EVM withdrawals are enabled. Do not accept user-supplied RPC URLs.
export const NETWORKS = {
  base: { chain: base, domain: 6, usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', feeLimit: 100000n, rpc: ['https://base.gateway.tenderly.co', 'https://base-rpc.publicnode.com'] },
  arbitrum: { chain: arbitrum, domain: 3, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', feeLimit: 100000n, rpc: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'] },
  optimism: { chain: optimism, domain: 2, usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', feeLimit: 100000n, rpc: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'] },
  polygon: { chain: polygon, domain: 7, usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', feeLimit: 100000n, rpc: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.gateway.tenderly.co'] },
  avalanche: { chain: avalanche, domain: 1, usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', feeLimit: 100000n, rpc: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://api.avax.network/ext/bc/C/rpc'] },
  ethereum: { chain: mainnet, domain: 0, usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', feeLimit: 2000000n, rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'] },
};
export function networkFor(key) {
  if (typeof key !== 'string' || !Object.hasOwn(NETWORKS, key)) throw new Error('Choose a supported network.');
  return NETWORKS[key];
}
export function keyForDomain(domain) {
  const key = Object.keys(NETWORKS).find(key => NETWORKS[key].domain === domain);
  if (!key) throw new Error('This Gateway domain is not supported.');
  return key;
}
