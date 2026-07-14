import type { NextConfig } from "next";

/**
 * 后端为微服务架构，前端经 Next rewrite 同源代理到网关，规避浏览器 CORS。
 *
 * 全部流量走网关 gateway(8686)（用户指示：业务端口 8081/8082 不对外，
 * agent/user 由 gateway 经 Nacos 发现并路由）：
 *   - /api/*    → gateway /api/*
 *   - /assets/* → gateway /assets/*（网关再路由到 agent；需 gateway 配 /assets 转发，否则 404）
 *
 * rewrite 在 standalone Node server 端执行，目标用 env 注入：
 *   - GATEWAY_URL：容器内用服务名 http://blue-whale-gateway:8686；dev 不设则默认 localhost:8686。
 *
 * output: 'standalone' 供 Dockerfile 产出最小运行包（.next/standalone/server.js），不影响 dev。
 */
const GATEWAY = process.env.GATEWAY_URL || "http://115.190.244.91:8686";

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
    // 全走网关（Nacos 服务发现）。specific 规则在前，catch-all 在后（先命中先转发）。
    return [
      {
        source: "/api/:path*",
        destination: `${GATEWAY}/api/:path*`,
      },
      {
        source: "/assets/:path*",
        destination: `${GATEWAY}/assets/:path*`,
      },
    ];
  },
};

export default nextConfig;
