import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
delete require.cache[require.resolve('./electron/online.cjs')];
const { recognizeSong, timedLyrics } = require('./electron/online.cjs');
export default defineConfig({ plugins: [react(), { name: 'local-song-preparation', configureServer(server) {
  const onlinePath = require.resolve('./electron/online.cjs');
  server.watcher.add(onlinePath);
  server.watcher.on('change', file => { if (file === onlinePath) server.restart(); });
  server.middlewares.use('/api', async (request, response, next) => {
    const handler = request.url === '/recognize-song' ? recognizeSong : request.url === '/timed-lyrics' ? timedLyrics : undefined;
    if (!handler) return next();
    const origin = request.headers.origin;
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json' || (origin && origin !== 'http://127.0.0.1:5173' && origin !== 'http://localhost:5173')) { response.writeHead(403).end(); return; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 14 * 1024 * 1024) throw new Error('Recognition request is too large.'); chunks.push(chunk); }
      const result = await handler(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
    } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Online preparation failed.' })); }
  });
} }], base: './', build: { target: 'es2022' } });
