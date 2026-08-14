import type { Metadata } from 'next';
import { Montserrat, Oxanium } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

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
