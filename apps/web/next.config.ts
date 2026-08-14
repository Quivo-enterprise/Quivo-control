import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @quivo/design-system se consume como paquete del propio workspace (workspace:*, ver
  // apps/web/package.json) — vendorizado en packages/design-system tras perderse el symlink
  // local (link:) que apuntaba al repo hermano Design_System_QUIVO. Next debe transpilarlo
  // igual que a cualquier paquete de workspace.
  transpilePackages: ['@quivo/design-system'],
};

export default nextConfig;
