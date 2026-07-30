import Image from 'next/image';

const BRAND_LOGOS = {
  logotipo: {
    light: '/brand/logotipo-principal.webp',
    dark: '/brand/logotipo-blanco.webp',
    ratio: 1000 / 300,
  },
  isotipo: {
    light: '/brand/isotipo-principal.webp',
    dark: '/brand/isotipo-blanco.webp',
    ratio: 300 / 199,
  },
} as const;

export interface BrandLogoProps {
  variant?: keyof typeof BRAND_LOGOS;
  height?: number;
  className?: string;
}

/**
 * Logo de QUIVO (assets del proyecto de landing, `MANUAL DE MARCA QUIVO V1.pdf`) con
 * variante clara/oscura según `prefers-color-scheme` — el design system ya cambia sus
 * propios tokens de color por el mismo media query, así que el logo debe seguirlo.
 */
export function BrandLogo({ variant = 'logotipo', height = 28, className }: BrandLogoProps) {
  const { light, dark, ratio } = BRAND_LOGOS[variant];
  const width = Math.round(height * ratio);

  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', height }}>
      <Image
        src={light}
        alt="QUIVO"
        height={height}
        width={width}
        style={{ height: '100%', width: 'auto' }}
        className="dark:hidden"
        priority
      />
      <Image
        src={dark}
        alt="QUIVO"
        height={height}
        width={width}
        style={{ height: '100%', width: 'auto' }}
        className="hidden dark:inline"
        priority
      />
    </span>
  );
}
