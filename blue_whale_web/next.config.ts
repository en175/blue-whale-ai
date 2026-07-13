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
const USER = "http://localhost:8081";

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
      // agent 8082
      { source: "/api/generation/:path*", destination: `${AGENT}/api/generation/:path*` },
      { source: "/api/jobs/:path*", destination: `${AGENT}/api/jobs/:path*` },
      { source: "/api/webhooks/:path*", destination: `${AGENT}/api/webhooks/:path*` },
      { source: "/api/projects/:path*", destination: `${AGENT}/api/projects/:path*` },
      { source: "/api/canvases/:path*", destination: `${AGENT}/api/canvases/:path*` },
      { source: "/api/agent/templates/:path*", destination: `${AGENT}/templates/:path*` },
      { source: "/assets/:path*", destination: `${AGENT}/assets/:path*` },
      // user-service 8081
      { source: "/api/auth/:path*", destination: `${USER}/api/auth/:path*` },
      { source: "/api/me", destination: `${USER}/api/me` },
      { source: "/api/user/:path*", destination: `${USER}/api/user/:path*` },
    ];
  },
};

export default nextConfig;
