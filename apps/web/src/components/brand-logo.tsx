import Image from 'next/image';

const BRAND_LOGOS = {
  logotipo: {
    light: '/brand/logotipo-principal.webp',
    dark: '/brand/logotipo-blanco.webp',
    ratio: 859.8 / 274.49,
  },
  isotipo: {
    light: '/brand/isotipo-principal.webp',
    dark: '/brand/isotipo-blanco.webp',
    ratio: 650 / 487.46,
  },
} as const;

export interface BrandLogoProps {
  variant?: keyof typeof BRAND_LOGOS;
  height?: number;
  className?: string;
}

/**
 * Logo de la submarca QUIVO Control (carpeta de assets entregada aparte del manual de
 * marca general de QUIVO) con variante clara/oscura según `prefers-color-scheme` — el
 * design system ya cambia sus propios tokens de color por el mismo media query, así que
 * el logo debe seguirlo. La variante oscura es el trazo invertido a blanco puro (los SVG
 * fuente no traen una versión "blanco" separada).
 */
export function BrandLogo({ variant = 'logotipo', height = 28, className }: BrandLogoProps) {
  const { light, dark, ratio } = BRAND_LOGOS[variant];
  const width = Math.round(height * ratio);

  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', height }}>
      <Image
        src={light}
        alt="QUIVO Control"
        height={height}
        width={width}
        style={{ height: '100%', width: 'auto' }}
        className="dark:hidden"
        priority
      />
      <Image
        src={dark}
        alt="QUIVO Control"
        height={height}
        width={width}
        style={{ height: '100%', width: 'auto' }}
        className="hidden dark:inline"
        priority
      />
    </span>
  );
}
