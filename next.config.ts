import type { NextConfig } from 'next';

/**
 * Headers that do not depend on a per-request nonce live here. The Content-Security-Policy
 * is set in `src/middleware.ts` because it carries a per-request nonce.
 *
 * See SECURITY.md §"Browser hardening" for the rationale behind each of these.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Origin-Agent-Cluster', value: '?1' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    // The vault needs none of these. Camera/microphone are enabled per-origin only on the
    // media-capture route once the media pipeline (build-order step 5) exists.
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'usb=()',
      'xr-spatial-tracking=()',
      'publickey-credentials-get=(self)',
      'publickey-credentials-create=(self)',
    ].join(', '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  typedRoutes: false,
  experimental: {
    // Every response carries a per-request CSP nonce generated in middleware.
    // Next propagates it to the scripts it injects itself.
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
