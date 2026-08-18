import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const __dirname = import.meta.dirname;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 按当前 mode 加载 .env.[mode] 环境变量（dev/test → https://web.master.xfai.cloud，见 .env.development / .env.test）
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // 监听所有网卡：支持局域网 IP（如 http://192.168.x.x:3000）访问
      host: true,
      port: 3000,
      open: true,
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
