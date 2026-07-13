import type { NextConfig } from "next";

/**
 * 后端为微服务架构，前端经 Next rewrite 同源代理到各服务，规避浏览器 CORS。
 *   - agent(8082)：文生图/视频 /api/generation、任务轮询/SSE /api/jobs、ark 回调 /api/webhooks、
 *     project/canvas 持久化 /api/projects /api/canvases（ADR-0011）、
 *     模板（前端以 /api/agent/templates 访问，rewrite 去掉 /api/agent 前缀 → 后端 /templates）、
 *     静态资源 /assets（生成图片/视频落 ./data/assets，WebAppConfig 暴露）。
 *   - user-service(8081)：鉴权 /api/auth、当前用户 /api/me、用户资料 /api/user。
 * 注意：微服务拆分后不再有单一后端入口，故废弃旧的 BACKEND_API_BASE_URL(=8000 单体) 写法。
 */
const AGENT = "http://localhost:8082";

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
      // 静态资源（生成图片等）同源代理 → agent（assets 由 agent 8082 的 /assets handler 提供）
      {
        source: "/assets/:path*",
        destination: `${AGENT}/assets/:path*`,
      },
    ];
  },
};

export default nextConfig;
