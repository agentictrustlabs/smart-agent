import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@smart-agent/types', '@smart-agent/sdk'],
}

export default nextConfig
