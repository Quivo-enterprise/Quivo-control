import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @quivo/design-system se consume como symlink local (link:) hacia el repo hermano
  // Design_System_QUIVO — Next debe transpilarlo como parte del build de la app.
  transpilePackages: ['@quivo/design-system'],
};

export default nextConfig;
