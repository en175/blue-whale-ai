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
    // specific 规则在前，catch-all 在后（Next 按顺序匹配，先命中先转发）。
    // 注：原文件此处有两个 rewrites()，JS 对象重复键后者覆盖前者，导致 auth/templates
    // 等规则静默失效且 tsc 报 duplicate identifier——合并为单函数修复。
    return [
      // 全走网关（Nacos 服务发现）
      {
        source: "/api/:path*",
        destination: "http://localhost:8686/api/:path*",
      },
      // 静态资源（生成图片等）同源代理 → 后端
      {
        source: "/assets/:path*",
        destination: `${BACKEND_API_BASE_URL}/assets/:path*`,
      },
    ];
  },
};

export default nextConfig;
