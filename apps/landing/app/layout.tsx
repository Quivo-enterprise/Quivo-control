import type { Metadata } from 'next';
import { Chakra_Petch } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const chakraPetch = Chakra_Petch({
  subsets: ['latin'],
  variable: '--font-chakra',
  display: 'swap',
  weight: ['300', '400', '500', '600', '700'],
});

const themeInitScript = `
  (function () {
    try {
      var storedTheme = window.localStorage.getItem('quivo-theme');
      var preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      var theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : preferredTheme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (error) {
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.colorScheme = 'dark';
    }
  })();
`;

export const metadata: Metadata = {
  title: 'QUIVO Control | Panel de transporte en vivo',
  description:
    'Controla tus trufis, recorridos y vehículos desde un solo panel.',
  keywords: [
    'transporte público',
    'trufis en vivo',
    'seguimiento GPS',
    'QUIVO Control',
    'Bolivia',
    'Latinoamérica',
  ],
  authors: [{ name: 'QUIVO Tech' }],
  openGraph: {
    title: 'QUIVO Control | Panel de transporte en vivo',
    description:
      'Mira tus vehículos y recorridos en tiempo real desde QUIVO Control.',
    type: 'website',
    locale: 'es_BO',
    siteName: 'QUIVO Control',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={chakraPetch.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
