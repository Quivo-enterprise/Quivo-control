import type { Metadata, Viewport } from 'next';
import { Montserrat, Oxanium } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import { THEME_COLOR } from '../src/lib/theme-color';

const oxanium = Oxanium({
  subsets: ['latin'],
  variable: '--font-oxanium',
  display: 'swap',
});

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'QUIVO Control',
  description: 'Panel administrativo de QUIVO Control',
  appleWebApp: { capable: true, title: 'Quivo Control', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR },
    { media: '(prefers-color-scheme: dark)', color: '#111827' }, // --qv-surface-card (oscuro)
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${oxanium.variable} ${montserrat.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
