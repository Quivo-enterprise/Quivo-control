'use client';

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { cx } from '../utils.js';
import type { StatusBadgeStatus } from '../types.js';

/* ---------------------------------------------------------------------------------------
 * Button
 * ------------------------------------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'qv-button',
        `qv-button--${variant}`,
        `qv-button--${size}`,
        fullWidth && 'qv-button--full',
        className,
      )}
      {...rest}
    />
  );
}

/* ---------------------------------------------------------------------------------------
 * Card
 * ------------------------------------------------------------------------------------- */

export interface CardProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Card({ header, footer, children, className }: CardProps) {
  return (
    <section className={cx('qv-card', className)}>
      {header !== undefined && <header className="qv-card__header">{header}</header>}
      <div className="qv-card__body">{children}</div>
      {footer !== undefined && <footer className="qv-card__footer">{footer}</footer>}
    </section>
  );
}

/* ---------------------------------------------------------------------------------------
 * Alert
 * ------------------------------------------------------------------------------------- */

export type AlertVariant = 'danger' | 'warning' | 'info' | 'success';

export interface AlertProps {
  variant: AlertVariant;
  title: string;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function Alert({ variant, title, children, style, className }: AlertProps) {
  return (
    <div className={cx('qv-alert', `qv-alert--${variant}`, className)} style={style} role="alert">
      <strong className="qv-alert__title">{title}</strong>
      {children !== undefined && <div className="qv-alert__body">{children}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * Badge / Tag
 * ------------------------------------------------------------------------------------- */

export interface BadgeProps {
  variant?: 'accent' | 'neutral';
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className }: BadgeProps) {
  return <span className={cx('qv-badge', `qv-badge--${variant}`, className)}>{children}</span>;
}

export interface TagProps {
  variant?: 'success' | 'neutral' | 'accent';
  children: ReactNode;
  className?: string;
}

export function Tag({ variant = 'neutral', children, className }: TagProps) {
  return <span className={cx('qv-tag', `qv-tag--${variant}`, className)}>{children}</span>;
}

/* ---------------------------------------------------------------------------------------
 * StatusBadge
 * ------------------------------------------------------------------------------------- */

const STATUS_LABEL: Record<StatusBadgeStatus, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  idle: 'Leve',
  warning: 'Advertencia',
  canceled: 'Cancelado',
  pending: 'Pendiente',
};

export interface StatusBadgeProps {
  status: StatusBadgeStatus;
  label?: string;
  className?: string;
  circle?: boolean;
}

export function StatusBadge({ status, label, className, circle }: StatusBadgeProps) {
  const displayLabel = label ?? STATUS_LABEL[status];
  if (circle) {
    return (
      <Tooltip content={displayLabel}>
        <span
          className={cx('qv-status-circle', `qv-status-circle--${status}`, className)}
          aria-label={displayLabel}
        >
          <span className="qv-status-circle__dot" aria-hidden="true" />
        </span>
      </Tooltip>
    );
  }
  return (
    <span className={cx('qv-status-badge', `qv-status-badge--${status}`, className)}>
      <span className="qv-status-badge__dot" aria-hidden="true" />
      {displayLabel}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------
 * PlateBadge — insignia de placa vehicular boliviana.
 * ------------------------------------------------------------------------------------- */

export interface PlateBadgeProps {
  plate: string;
  className?: string;
}

export function PlateBadge({ plate, className }: PlateBadgeProps) {
  return (
    <span className={cx('qv-plate', className)}>
      <span className="qv-plate__country">BOL</span>
      <strong className="qv-plate__value">{plate}</strong>
    </span>
  );
}

/* ---------------------------------------------------------------------------------------
 * Loader
 * ------------------------------------------------------------------------------------- */

export interface LoaderProps {
  label?: string;
}

export function Loader({ label }: LoaderProps) {
  return (
    <div className="qv-loader" role="status" aria-live="polite">
      <span className="qv-loader__spinner" aria-hidden="true" />
      {label && <span className="qv-loader__label">{label}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * Tooltip — envoltorio CSS-only (sin JS de posicionamiento): el disparador expone
 * `aria-label`/`title` para lectores de pantalla y `data-qv-tooltip` para el globo visual.
 * ------------------------------------------------------------------------------------- */

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const text = typeof content === 'string' ? content : undefined;
  return (
    <span className="qv-tooltip" data-qv-tooltip={text}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------
 * BanderitaIcon & BanderitaBadge — Señalética de banderas de transporte boliviano
 * ------------------------------------------------------------------------------------- */

export type TipoPatronBanderita =
  | 'solida'
  | 'mitad_horizontal'
  | 'franja_arriba_pequena'
  | 'franja_abajo_pequena'
  | 'mitad_vertical'
  | 'diagonal'
  | 'tricolor';

export interface BanderitaIconProps {
  patron?: TipoPatronBanderita;
  colorPrimario?: string;
  colorSecundario?: string;
  colorTerciario?: string;
  size?: number;
  className?: string;
}

export function BanderitaIcon({
  patron = 'solida',
  colorPrimario = '#ef4444',
  colorSecundario = '#ffffff',
  colorTerciario = '#10b981',
  size = 20,
  className,
}: BanderitaIconProps) {
  const width = size;
  const height = Math.round((size * 3) / 4);

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cx('qv-banderita-icon', className)}
      style={{
        borderRadius: '3px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.2)',
        flexShrink: 0,
      }}
    >
      {patron === 'solida' && <rect width="24" height="18" fill={colorPrimario} />}

      {patron === 'mitad_horizontal' && (
        <>
          <rect y="0" width="24" height="9" fill={colorPrimario} />
          <rect y="9" width="24" height="9" fill={colorSecundario} />
        </>
      )}

      {patron === 'franja_arriba_pequena' && (
        <>
          <rect y="0" width="24" height="5.5" fill={colorPrimario} />
          <rect y="5.5" width="24" height="12.5" fill={colorSecundario} />
        </>
      )}

      {patron === 'franja_abajo_pequena' && (
        <>
          <rect y="0" width="24" height="12.5" fill={colorPrimario} />
          <rect y="12.5" width="24" height="5.5" fill={colorSecundario} />
        </>
      )}

      {patron === 'mitad_vertical' && (
        <>
          <rect x="0" width="12" height="18" fill={colorPrimario} />
          <rect x="12" width="12" height="18" fill={colorSecundario} />
        </>
      )}

      {patron === 'diagonal' && (
        <>
          <polygon points="0,0 24,0 0,18" fill={colorPrimario} />
          <polygon points="24,0 24,18 0,18" fill={colorSecundario} />
        </>
      )}

      {patron === 'tricolor' && (
        <>
          <rect y="0" width="24" height="6" fill={colorPrimario} />
          <rect y="6" width="24" height="6" fill={colorSecundario} />
          <rect y="12" width="24" height="6" fill={colorTerciario} />
        </>
      )}

      <rect width="24" height="18" fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="0.75" />
    </svg>
  );
}

export function BanderitaBadge({
  texto,
  patron = 'solida',
  colorPrimario = '#ef4444',
  colorSecundario = '#ffffff',
  className,
}: {
  texto: string;
  patron?: TipoPatronBanderita;
  colorPrimario?: string;
  colorSecundario?: string;
  className?: string;
}) {
  return (
    <span
      className={cx('qv-banderita-badge', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: '0.2rem 0.55rem',
        borderRadius: 'var(--qv-radius-full)',
        backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 85%, transparent)',
        border: '1px solid var(--qv-border-glass)',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'var(--qv-text-primary)',
      }}
    >
      <BanderitaIcon
        patron={patron}
        colorPrimario={colorPrimario}
        colorSecundario={colorSecundario}
        size={18}
      />
      <span>{texto}</span>
    </span>
  );
}

const COLOR_PALETTE_MAP: Record<string, string> = {
  rojo: '#ef4444',
  roja: '#ef4444',
  azul: '#2563eb',
  verde: '#10b981',
  amarillo: '#f59e0b',
  amarilla: '#f59e0b',
  blanco: '#f8fafc',
  blanca: '#f8fafc',
  negro: '#0f172a',
  negra: '#0f172a',
  naranja: '#ea580c',
  celeste: '#06b6d4',
  morado: '#8b5cf6',
  morada: '#8b5cf6',
};

export function parsearDistintivoBanderita(texto?: string | null): {
  esBanderita: boolean;
  patron: TipoPatronBanderita;
  colorPrimario: string;
  colorSecundario: string;
  colorTerciario?: string;
  etiqueta: string;
} {
  if (!texto) {
    return {
      esBanderita: false,
      patron: 'solida',
      colorPrimario: '#ef4444',
      colorSecundario: '#ffffff',
      etiqueta: '',
    };
  }

  const normalizado = texto.toLowerCase();
  const esBanderita = normalizado.includes('bander') || normalizado.includes('franja') || normalizado.includes('bicolor');

  let patron: TipoPatronBanderita = 'solida';
  if (normalizado.includes('arriba') || normalizado.includes('superior') || normalizado.includes('techo')) {
    patron = 'franja_arriba_pequena';
  } else if (normalizado.includes('abajo') || normalizado.includes('inferior') || normalizado.includes('base')) {
    patron = 'franja_abajo_pequena';
  } else if (normalizado.includes('vertical')) {
    patron = 'mitad_vertical';
  } else if (normalizado.includes('diagonal')) {
    patron = 'diagonal';
  } else if (normalizado.includes('tri') || normalizado.includes('tres')) {
    patron = 'tricolor';
  } else if (normalizado.includes('/') || normalizado.includes('-') || normalizado.includes('mitad') || normalizado.includes('bicolor')) {
    patron = 'mitad_horizontal';
  }

  // Detectar colores
  const coloresEncontrados: string[] = [];
  for (const [nombre, hex] of Object.entries(COLOR_PALETTE_MAP)) {
    if (normalizado.includes(nombre)) {
      if (!coloresEncontrados.includes(hex)) {
        coloresEncontrados.push(hex);
      }
    }
  }

  const colorPrimario = coloresEncontrados[0] ?? '#ef4444';
  const colorSecundario = coloresEncontrados[1] ?? (patron === 'solida' ? colorPrimario : '#ffffff');
  const colorTerciario = coloresEncontrados[2] ?? '#10b981';

  return {
    esBanderita,
    patron,
    colorPrimario,
    colorSecundario,
    colorTerciario,
    etiqueta: texto,
  };
}

