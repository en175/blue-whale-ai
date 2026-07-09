import type { NextConfig } from "next";

/**
 * 后端 API 基址：服务端 env 注入（不暴露前端 bundle）。
 * dev 默认 http://localhost:8000（blue_whale_server application.yml server.port=8000）。
 * 通过 rewrite 代理 /api/* → 后端，浏览器侧同源请求，规避 CORS。
 */
const BACKEND_API_BASE_URL =
  process.env.BACKEND_API_BASE_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
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
    return [
      {
        source: "/api/agent/templates/:path*",
        destination: "http://localhost:8686/api/agent/templates/:path*",
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
    ];
  },
  async rewrites() {
    return [
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
