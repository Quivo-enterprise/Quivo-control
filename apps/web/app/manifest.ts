import type { MetadataRoute } from 'next';
import { THEME_COLOR } from '../src/lib/theme-color';

// Hex fijos: el manifest no lee CSS vars. theme_color = fondo de la barra superior.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QUIVO Control',
    short_name: 'Quivo',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: THEME_COLOR,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
