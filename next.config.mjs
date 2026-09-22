import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A standalone bundle keeps the Docker image small for the single-VPS deployment.
  // Only enabled for container builds, because `next start` does not support it.
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' } : {}),
  images: {
    formats: ['image/webp'],
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  experimental: {
    // argon2 is a native module; keep it server-side only.
    serverComponentsExternalPackages: ['argon2', '@prisma/client'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
