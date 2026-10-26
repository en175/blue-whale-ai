import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createLab } from './server.ts';

const root = path.resolve(import.meta.dirname, '../..');
export default defineConfig({
  root,
  define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('') },
  plugins: [react(), {
    name: 'ikluvp-isolated-manual-regression',
    configureServer(server) {
      let preview: Buffer | null = null;
      let previewType = 'video/webm';
      const lab = createLab(async (file) => server.ssrLoadModule(path.resolve(root, '..', file)));
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:3016; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'");
        if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__ikluvp/')) return next();
        if (url.pathname === '/__ikluvp/reference' && req.method === 'GET') {
          res.writeHead(preview ? 200 : 404, { 'Content-Type': previewType, 'Cache-Control': 'no-store' });
          res.end(preview ?? '本地参考视频尚未准备');
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        if (url.pathname === '/__ikluvp/reference' && req.method === 'PUT') {
          preview = Buffer.concat(chunks);
          previewType = String(req.headers['content-type'] ?? 'video/webm');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 200, bytes: preview.length }));
          return;
        }
        try {
          const raw = Buffer.concat(chunks).toString();
          const result = await lab(req.method ?? 'GET', url.pathname, raw ? JSON.parse(raw) : undefined);
          res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(result.body));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 500, msg: String(error) }));
        }
      });
    },
  }],
  resolve: { alias: { '@': path.resolve(root, 'src'), '@lib': path.resolve(root, '../backend/libs') } },
  server: { host: '127.0.0.1', port: 3016, strictPort: true, open: false, fs: { allow: [path.resolve(root, '..')] } },
  build: { outDir: 'manual/ikluvp/dist', rollupOptions: { input: {
    guide: path.resolve(root, 'manual/ikluvp/index.html'), runtime: path.resolve(root, 'manual/ikluvp/runtime.html'),
  } } },
});
