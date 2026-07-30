import type { NextConfig } from "next";

/**
 * 后端为 Next.js Route Handlers + TypeScript workers + new-api（Go）。
 * IK50GB 断链后不再有 Java 网关：浏览器同源请求 /api/* 由 Next.js 文件路由直接处理，
 * 无 rewrite 代理、无 GATEWAY_URL。资产文件经 presign 直连对象存储，不经网关。
 *
 * output: 'standalone' 供 Dockerfile 产出最小运行包（.next/standalone/server.js），不影响 dev。
 */
const nextConfig: NextConfig = {
  output: "standalone",
  // SSE 必须实时流式到达：Next 默认对浏览器 Accept-Encoding 做 gzip，
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
};

export default nextConfig;
