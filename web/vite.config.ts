import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import path from 'path'

const __dirname = import.meta.dirname;

/**
 * TOS 上传代理插件：将 /__tos-upload?url=<encoded_tos_url> 转发到真实 TOS 地址
 * 开发模式下避免浏览器 CORS 限制
 */
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

          // 收集请求体
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk as Buffer)
          }
          const bodyBuf = Buffer.concat(chunks)

          // 构建转发请求头
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

/**
 * TOS 下载代理插件：将 /__tos-fetch?url=<encoded_tos_url> 转发到真实 TOS 地址
 * 开发模式下避免浏览器 CORS 限制（组下载需 fetch blob 打包，无法用 window.open 兜底）
 */
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

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // 按当前 mode 加载 .env.[mode] 环境变量（dev/test → https://web.master.xfai.cloud，见 .env.development / .env.test）
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      // 仅真正的 Vite dev server 启用。Vitest 的 command 也是 serve，
      // code-inspector / TOS 代理会挂住连接，导致 `vitest run` 退不出、门禁被 close timeout 误杀。
      command === 'serve' && !process.env.VITEST && codeInspectorPlugin({ bundler: 'vite' }),
      react(),
      !process.env.VITEST && tosUploadProxy(),
      !process.env.VITEST && tosFetchProxy(),
    ],
    // spawnSync（验证门禁）把 stdout 接到管道时 Vite 退不干净；Vitest 2 无 CLI --forceExit。
    test: {
      forceExit: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@lib': path.resolve(__dirname, '../backend/libs'),
      },
    },
    build: {
      // Vite 8 默认 cssMinify=lightningcss。同一规则同时写 backdrop-filter
      // 与 -webkit-backdrop-filter 时，lightningcss 会丢掉标准属性
      // （vitejs/vite#22649），Chromium 生产环境毛玻璃失效。esbuild 会保留两条。
      cssMinify: 'esbuild',
    },
    server: {
      // 监听所有网卡：支持局域网 IP（如 http://192.168.x.x:3000）访问
      host: true,
      port: 3000,
      open: true,
      // 忽略编辑器/Agent 原子写入留下的 .tmpdir/.tmp 锁定文件，避免 vite 文件监听 EBUSY 崩溃
      watch: {
        ignored: [/[\\/]\.[^\\/]*\.tmpdir[\\/]/, /\.tmp$/],
      },
      // 接口代理：/api 与 /agent 前缀请求转发到当前环境接口域名
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
