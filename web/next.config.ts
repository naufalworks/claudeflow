import type { NextConfig } from "next";

// Bundle analyzer configuration
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:20129';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${apiUrl}/health`,
      },
      {
        source: '/ready',
        destination: `${apiUrl}/ready`,
      },
    ];
  },
  // Add empty turbopack config to silence warning
  turbopack: {},
};

export default withBundleAnalyzer(nextConfig);
