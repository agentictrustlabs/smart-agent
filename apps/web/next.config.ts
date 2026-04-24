import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: [
    '@smart-agent/types',
    '@smart-agent/sdk',
    '@smart-agent/privacy-creds',
    '@smart-agent/credential-registry',
    '@smart-agent/discovery',
  ],
  async rewrites() {
    return [
      // Root-level routes → catalyst pages (no file moves needed)
      { source: '/oikos', destination: '/catalyst/circles' },
      { source: '/oikos/:path*', destination: '/catalyst/circles/:path*' },
      { source: '/circles', destination: '/catalyst/circles' },
      { source: '/circles/:path*', destination: '/catalyst/circles/:path*' },
      { source: '/nurture', destination: '/catalyst/nurture' },
      { source: '/nurture/prayer', destination: '/catalyst/prayer' },
      { source: '/nurture/grow', destination: '/catalyst/grow' },
      { source: '/nurture/coaching', destination: '/catalyst/coach' },
      { source: '/groups', destination: '/catalyst/groups' },
      { source: '/groups/:path*', destination: '/catalyst/groups/:path*' },
      { source: '/steward', destination: '/catalyst/steward' },
      { source: '/steward/treasury', destination: '/treasury' },
      { source: '/steward/reviews', destination: '/reviews' },
      { source: '/steward/governance', destination: '/catalyst/governance' },
      { source: '/steward/network', destination: '/network' },
      { source: '/activity', destination: '/catalyst/activities' },
      { source: '/activity/:path*', destination: '/catalyst/activities/:path*' },
      { source: '/me', destination: '/catalyst/me' },
      { source: '/me/:path*', destination: '/catalyst/me/:path*' },
    ]
  },
}

export default nextConfig
