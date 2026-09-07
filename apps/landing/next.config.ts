import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@quivo/design-system'],
  ...(process.env.LANDING_STATIC_EXPORT === '1'
    ? { output: 'export' as const, trailingSlash: true, images: { unoptimized: true } }
    : {}),
};

export default nextConfig;
