import { verifyTypedData } from 'viem';
import { DOMAIN, TYPES, validateIntent, recipientAddress } from '../src/protocol.js';
import { networkFor } from '../src/networks.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (JSON.stringify(body).length > 12000) return res.status(413).json({ error: 'Request too large.' });
    const { operation, intent, signature, source, networkKey } = body;
    let path, payload;
    if (operation === 'balances') {
      path = 'balances';
      payload = { token: 'USDC', sources: [{ depositor: recipientAddress(source), domain: networkFor(networkKey).domain }] };
    } else if (operation === 'estimate' || operation === 'transfer') {
      const context = validateIntent(intent);
      path = operation;
      // Let Circle calculate both fee and expiry, instead of echoing a supplied cap.
      payload = [{ spec: intent.spec }];
      if (operation === 'transfer') {
        if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Invalid wallet signature.');
        const valid = await verifyTypedData({ address: context.source, domain: DOMAIN, types: TYPES, primaryType: 'BurnIntent', message: intent, signature });
        if (!valid) throw new Error('Authorization must be signed by the source wallet.');
        payload = [{ burnIntent: intent, signature }];
      }
    } else {
      throw new Error('Unsupported operation.');
    }
    const upstream = await fetch(`https://gateway-api.circle.com/v1/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (error) {
    // Do not log signed authorizations or request bodies.
    return res.status(error.name === 'TimeoutError' ? 504 : 400).json({ error: error.name === 'TimeoutError' ? 'Circle timed out. Continue the saved withdrawal to retry the same authorization.' : error.message || 'Gateway request failed.' });
  }
}
