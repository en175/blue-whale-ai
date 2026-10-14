import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import fs from 'node:fs'
import path from 'path'

const __dirname = import.meta.dirname;

const SHARED_API_MODULES = new Set(['http', 'idempotencyKey', 'sessionToken', 'homepageHeroes']);

function apiCompatAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  const apiDir = path.resolve(__dirname, './src/api');
  for (const file of fs.readdirSync(apiDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const stem = file.slice(0, -3);
    const folder = SHARED_API_MODULES.has(stem) ? 'shared' : stem.startsWith('admin') ? 'admin' : 'app';
    const implementation = path.resolve(__dirname, `./src/${folder}/api/${file}`);
    aliases[`@/api/${stem}`] = implementation;
    aliases[path.resolve(apiDir, file)] = implementation;
  }
  return aliases;
}

function tosUploadProxy(): Plugin {
  const ROUTE = '/__tos-upload'
  return {
    name: 'tos-upload-proxy',
    configureServer(server) {
      console.log('[Vite] TOS 上传代理中间件已注册:', ROUTE)
      server.middlewares.use(ROUTE, async (req, res) => {
        try {
          const reqUrl = new URL(req.url ?? '/', 'http://localhost')
          const targetUrl = reqUrl.searchParams.get('url')
          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing url parameter' }))
            return
          }

          const target = new URL(targetUrl)
          console.log('[TOS Proxy]', req.method, '→', target.host + target.pathname + '?' + target.search.substring(0, 80) + '...')

          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk as Buffer)
          }
          const bodyBuf = Buffer.concat(chunks)

          const forwardHeaders: Record<string, string> = {}
          for (const [key, value] of Object.entries(req.headers)) {
            const lk = key.toLowerCase()
            if (
              ['host', 'connection', 'origin', 'referer', 'content-length', 'accept-encoding',
               'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-ch-ua',
               'sec-ch-ua-mobile', 'sec-ch-ua-platform'].includes(lk)
            ) {
              continue
            }
            if (value) {
              forwardHeaders[key] = Array.isArray(value) ? value[0] : value
            }
          }
          forwardHeaders['host'] = target.host
          if (bodyBuf.length > 0) {
            forwardHeaders['content-length'] = String(bodyBuf.length)
          }

          console.log('[TOS Proxy] 转发头:', Object.keys(forwardHeaders).join(', '))

          const forwardRes = await fetch(targetUrl, {
            method: req.method,
            headers: forwardHeaders,
            body: bodyBuf.length > 0 ? bodyBuf : undefined,
            redirect: 'manual',
          })

          const respText = await forwardRes.text()
          console.log('[TOS Proxy] TOS 响应:', forwardRes.status, respText.substring(0, 200))

          const respHeaders: Record<string, string> = {}
          forwardRes.headers.forEach((value, key) => {
            if (!['transfer-encoding', 'connection', 'accept-ranges'].includes(key.toLowerCase())) {
              respHeaders[key] = value
            }
          })
          res.writeHead(forwardRes.status, respHeaders)
          res.end(respText)
        } catch (err) {
          console.error('[TOS Proxy] middleware error:', err)
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'TOS proxy error', message: (err instanceof Error ? err.message : String(err)) }))
          }
        }
      })
    },
  }
}

function tosFetchProxy(): Plugin {
  const ROUTE = '/__tos-fetch'
  return {
    name: 'tos-fetch-proxy',
    configureServer(server) {
      console.log('[Vite] TOS 下载代理中间件已注册:', ROUTE)
      server.middlewares.use(ROUTE, async (req, res) => {
        try {
          const reqUrl = new URL(req.url ?? '/', 'http://localhost')
          const targetUrl = reqUrl.searchParams.get('url')
          if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing url parameter' }))
            return
          }

          const target = new URL(targetUrl)
          console.log('[TOS Fetch Proxy]', req.method, '→', target.host + target.pathname + '?' + target.search.substring(0, 80) + '...')

          const forwardHeaders: Record<string, string> = {}
          for (const [key, value] of Object.entries(req.headers)) {
            const lk = key.toLowerCase()
            if (
              ['host', 'connection', 'origin', 'referer', 'content-length', 'accept-encoding',
               'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-ch-ua',
               'sec-ch-ua-mobile', 'sec-ch-ua-platform'].includes(lk)
            ) {
              continue
            }
            if (value) {
              forwardHeaders[key] = Array.isArray(value) ? value[0] : value
            }
          }
          forwardHeaders['host'] = target.host

          const forwardRes = await fetch(targetUrl, {
            method: req.method,
            headers: forwardHeaders,
            redirect: 'manual',
          })

          const respBuf = Buffer.from(await forwardRes.arrayBuffer())
          console.log('[TOS Fetch Proxy] TOS 响应:', forwardRes.status, `${respBuf.length} bytes`)

          const respHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Accept-Ranges': 'bytes',
          }
          forwardRes.headers.forEach((value, key) => {
            if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
              respHeaders[key] = value
            }
          })
          res.writeHead(forwardRes.status, respHeaders)
          res.end(respBuf)
        } catch (err) {
          console.error('[TOS Fetch Proxy] middleware error:', err)
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'TOS fetch proxy error', message: (err instanceof Error ? err.message : String(err)) }))
          }
        }
      })
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      command === 'serve' && !process.env.VITEST && codeInspectorPlugin({ bundler: 'vite' }),
      react(),
      !process.env.VITEST && tosUploadProxy(),
      !process.env.VITEST && tosFetchProxy(),
    ],
    test: {
      forceExit: true,
    },
    resolve: {
      alias: {
        ...apiCompatAliases(),
        '@/pages': path.resolve(__dirname, './src/app/pages'),
        '@/components': path.resolve(__dirname, './src/app/components'),
        '@/layouts': path.resolve(__dirname, './src/app/layouts'),
        '@/styles': path.resolve(__dirname, './src/app/styles'),
        '@': path.resolve(__dirname, './src'),
        '@lib': path.resolve(__dirname, '../backend/libs'),
      },
    },
    build: {
      cssMinify: 'esbuild',
    },
    server: {
      host: true,
      port: 3000,
      open: true,
      watch: {
        ignored: [/[\\/]\.[^\\/]*\.tmpdir[\\/]/, /\.tmp$/],
      },
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL,
          changeOrigin: true,
        },
        '/agent': {
          target: env.VITE_API_BASE_URL,
          changeOrigin: true,
        },
      },
    },
  };
});
