import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // QUI-213 — apps/web se despliega en Cloud Run (imagen propia, no Firebase App
  // Hosting). `output: 'standalone'` hace que `next build` emita un server.js
  // autocontenido con sólo los módulos de node_modules realmente usados (Next file
  // tracing) — es lo que copia apps/web/Dockerfile al stage `runner`.
  output: 'standalone',
  // @quivo/design-system se consume como paquete del propio workspace (workspace:*, ver
  // apps/web/package.json) — vendorizado en packages/design-system tras perderse el symlink
  // local (link:) que apuntaba al repo hermano Design_System_QUIVO. Next debe transpilarlo
  // igual que a cualquier paquete de workspace.
  transpilePackages: ['@quivo/design-system'],
};

export default nextConfig;
