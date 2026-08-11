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
  // @volcengine/openapi 的 TLS Producer 用 protobufjs.load(__dirname + "/tls.proto")
  // 运行时读文件；若被 Next 打包，__dirname 指向打包根、.proto 不进 bundle → ENOENT
  // 上报静默失败（IK75CR）。标记为 server 外部包，运行时从真实 node_modules 加载。
  serverExternalPackages: ["@volcengine/openapi"],
  // IK7TED：仅 serverExternalPackages 不够——standalone 的 NFT trace 只追踪静态
  // require 的 JS 文件，protobuf.load(path.join(__dirname, …)) 是运行期动态路径，
  // tls.proto 不被追踪 → 运行时加载 SDK 副本缺 proto，首次 SendLog 即 ENOENT
  // （本地 standalone 复现证实，见 IK7TED）。强制把 SDK 包目录全部文件（含 .proto）
  // 纳入 trace。路径相对本目录（blue_whale_web），pnpm 实体在仓库根 node_modules/.pnpm。
  outputFileTracingIncludes: {
    "/*": ["../node_modules/.pnpm/@volcengine+openapi@*/node_modules/@volcengine/openapi/**"],
  },
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
