import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The dashboard is a purely server-rendered app: every page reads from the
  // internal API on each request, so nothing here should be statically cached.
  reactStrictMode: true,
  poweredByHeader: false,
  // The replay iframe is built by rrweb inside the page; the page itself never
  // needs to be framed, so deny that outright.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
