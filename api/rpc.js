import { networkFor } from '../src/networks.js';
const ALLOWED = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_estimateGas']);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const network = networkFor(req.query?.network ?? 'base');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || Array.isArray(body) || !ALLOWED.has(body.method) || JSON.stringify(body).length > 16000) return res.status(400).json({ error: 'Unsupported read-only RPC request.' });
    for (const url of network.rpc) {
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
        const data = await response.json();
        // Return JSON-RPC execution errors too: reverted simulations must fail visibly.
        if (response.ok && (data.result !== undefined || data.error?.code === 3 || data.error?.code === -32000)) return res.status(200).json(data);
      } catch { /* Try the next read-only Base provider. */ }
    }
    return res.status(502).json({ error: 'Network RPC is temporarily unavailable. Try again.' });
  } catch {
    return res.status(400).json({ error: 'Invalid RPC request.' });
  }
}
