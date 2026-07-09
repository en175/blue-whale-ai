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
    ];
  },
};

export default nextConfig;
