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
const GATEWAY = process.env.GATEWAY_URL || "http://localhost:8686";

const nextConfig: NextConfig = {
  output: "standalone",
  // SSE 必须实时流式到达：Next 默认对 rewrite 代理的响应按浏览器 Accept-Encoding 做 gzip，
  // 压缩器会缓冲 text/event-stream 的小事件块，导致 Project SSE（/api/projects/:id/events）
  // 在浏览器端永远收不到增量事件（curl 不带 Accept-Encoding 所以掩盖了问题）。
  // 本地 MVP 直接关压缩；未来有 ingress/CDN 时在边缘层重新启用。
  compress: false,
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
    // 只代理尚未迁移到 Node 的 Java 路径前缀。
    // Node 已实现的路径（/api/auth/*, /api/projects/*, /api/canvases/*, /api/me）
    // 不在此列——Next.js 文件路由自然优先，不会走代理。
    const javaOnlyPrefixes = [
      "/api/agent/runs/:path*",
      "/api/generation-inbox/:path*",
      "/api/webhooks/:path*",
      "/api/user/:path*",
      // /api/assets 列表已迁 Node（Java AssetController 仅此一个端点），不再代理；
      // /api/projects/{id}/assets/*（copy/access/content）仍是 Java，见下方代理。
      // /api/jobs/{id}/stream SSE 仍由 Java JobStreamBus 推送；
      // /api/jobs 列表与 /api/jobs/{id} 状态已迁 Node，不再代理。
      "/api/jobs/:path*/stream",
      // /api/generation/models 已迁 Node（Java GenerationController 仅此一个端点），不再代理。
      // /api/projects/* 下未迁移的 Java 子资源（agent 对话/SSE）。
      "/api/projects/:path*/conversation/:path*",
      "/api/projects/:path*/input-requests/:path*",
      "/api/projects/:path*/events",
    ];
    return [
      ...javaOnlyPrefixes.map((source) => ({
        source,
        destination: `${GATEWAY}${source}`,
      })),
      { source: "/assets/:path*", destination: `${GATEWAY}/assets/:path*` },
    ];
  },
};

export default nextConfig;
