import type { NextConfig } from "next";

/**
 * 后端 API 基址：服务端 env 注入（不暴露前端 bundle）。
 * dev 默认 http://localhost:8000（blue_whale_server application.yml server.port=8000）。
 * 通过 rewrite 代理 /api/* → 后端，浏览器侧同源请求，规避 CORS。
 */
const BACKEND_API_BASE_URL =
  process.env.BACKEND_API_BASE_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  // 关 StrictMode：dev 下 effect 双跑（mount→cleanup→mount）致首屏分页请求两次。
  // prod 本就单次；关掉换 dev 干净。代价：失 React 调试期副作用重复检测。
  reactStrictMode: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "dj5nb01yl89hl.cloudfront.net",
        pathname: "/**",
      },
    ],
  },
  async rewrites() {
    // specific 规则在前，catch-all 在后（Next 按顺序匹配，先命中先转发）。
    // 注：原文件此处有两个 rewrites()，JS 对象重复键后者覆盖前者，导致 auth/templates
    // 等规则静默失效且 tsc 报 duplicate identifier——合并为单函数修复。
    return [
      {
        // /api/agent/* 统一走 gateway:8686（原样转发 lb://blue-whale-agent）。
        // controller 已带 /api/agent 前缀 + gateway 去 StripPrefix，gateway 不动路径直转。
        // 覆盖 templates + skills + 未来所有 agent 接口，单一入口。
        source: "/api/agent/:path*",
        destination: "http://localhost:8082/api/agent/:path*",
      },
      {
        source: "/api/auth/:path*",
        destination: "http://localhost:8081/api/auth/:path*",
      },
      {
        source: "/api/me",
        destination: "http://localhost:8081/api/me",
      },
      {
        source: "/api/user/:path*",
        destination: "http://localhost:8081/api/user/:path*",
      },
      {
        source: "/api/:path*",
        destination: `${BACKEND_API_BASE_URL}/api/:path*`,
      },
      {
        // 静态资源（生成图片等）同源代理 → 后端。
        // 后端 assets.url 存的是 /assets/<file>，由后端 :8000 的 /assets/** handler 提供服务。
        // 不代理则前端 <img src="/assets/..."> 落到 Next 源 404，图片显示黑块。
        source: "/assets/:path*",
        destination: `${BACKEND_API_BASE_URL}/assets/:path*`,
      },
    ];
  },
};

export default nextConfig;
