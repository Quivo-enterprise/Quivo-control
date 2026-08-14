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
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span className={cx('qv-status-badge', `qv-status-badge--${status}`, className)}>
      <span className="qv-status-badge__dot" aria-hidden="true" />
      {label ?? STATUS_LABEL[status]}
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
