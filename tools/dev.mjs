import { createServer } from 'vite';
import gateway from '../api/gateway.js';
import rpc from '../api/rpc.js';

const server = await createServer({
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  plugins: [{ name: 'local-api', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      const handler = { '/api/gateway': gateway, '/api/rpc': rpc }[url.pathname];
      if (!handler) return next();
      let raw = '';
      try {
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 16000) { res.statusCode = 413; res.end('Request too large'); return; }
        }
        req.body = raw ? JSON.parse(raw) : undefined;
        req.query = Object.fromEntries(url.searchParams);
        res.status = code => { res.statusCode = code; return res; };
        res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return res; };
        await handler(req, res);
      } catch { res.statusCode = 400; res.end('Invalid request'); }
    });
  } }],
});
await server.listen(); server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
