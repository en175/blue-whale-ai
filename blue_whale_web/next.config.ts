import type { NextConfig } from "next";

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
};

export default nextConfig;
