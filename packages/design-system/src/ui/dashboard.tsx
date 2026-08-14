'use client';

import type { ReactNode } from 'react';
import { cx } from '../utils.js';
import type { ProgressBarProps } from '../types.js';

/* ---------------------------------------------------------------------------------------
 * Grid
 * ------------------------------------------------------------------------------------- */

export interface GridProps {
  columns: number;
  gap?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Grid({ columns, gap = 'md', children }: GridProps) {
  return (
    <div
      className={cx('qv-grid', `qv-grid--gap-${gap}`)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * KpiCard
 * ------------------------------------------------------------------------------------- */

export interface KpiCardProps {
  label: string;
  value: string | number;
  delta?: string;
  tone?: 'primary' | 'accent' | 'success' | 'neutral';
}

export function KpiCard({ label, value, delta, tone = 'neutral' }: KpiCardProps) {
  return (
    <div className={cx('qv-kpi-card', `qv-kpi-card--${tone}`)}>
      <span className="qv-kpi-card__label">{label}</span>
      <strong className="qv-kpi-card__value">{value}</strong>
      {delta && <span className="qv-kpi-card__delta">{delta}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * ChartCard / DataPanel — envoltorios de sección con encabezado, misma familia visual que
 * `Card` pero con jerarquía tipográfica propia (título de sección, no de módulo).
 * ------------------------------------------------------------------------------------- */

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, children }: ChartCardProps) {
  return (
    <section className="qv-chart-card">
      <header className="qv-chart-card__header">
        <h3 className="qv-chart-card__title">{title}</h3>
        {subtitle && <span className="qv-chart-card__subtitle">{subtitle}</span>}
      </header>
      <div className="qv-chart-card__body">{children}</div>
    </section>
  );
}

export interface DataPanelProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function DataPanel({ title, description, children }: DataPanelProps) {
  return (
    <section className="qv-data-panel">
      <header className="qv-data-panel__header">
        <h3 className="qv-data-panel__title">{title}</h3>
        {description && <p className="qv-data-panel__description">{description}</p>}
      </header>
      <div className="qv-data-panel__body">{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------
 * ProgressBar
 * ------------------------------------------------------------------------------------- */

export function ProgressBar({ label, value, max, variant = 'primary', showValue }: ProgressBarProps) {
  // `value` puede llegar negativo (dato de origen inconsistente) — sin acotar abajo, el ancho
  // del relleno queda como `"-N%"` (inválido) y `aria-valuenow` cae por debajo de
  // `aria-valuemin={0}`, fuera del rango que el propio elemento declara.
  const safeValue = Math.max(0, value);
  const percentage = max > 0 ? Math.max(0, Math.min(100, Math.round((safeValue / max) * 100))) : 0;
  return (
    <div className="qv-progress-bar">
      {(label || showValue) && (
        <div className="qv-progress-bar__meta">
          {label && <span className="qv-progress-bar__label">{label}</span>}
          {showValue && <span className="qv-progress-bar__value">{percentage}%</span>}
        </div>
      )}
      <div
        className="qv-progress-bar__track"
        role="progressbar"
        aria-valuenow={safeValue}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={cx('qv-progress-bar__fill', `qv-progress-bar__fill--${variant}`)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * MetricStrip
 * ------------------------------------------------------------------------------------- */

export interface MetricStripItem {
  label: string;
  value: string;
  helper?: string;
}

export interface MetricStripProps {
  metrics: MetricStripItem[];
  className?: string;
}

export function MetricStrip({ metrics, className }: MetricStripProps) {
  return (
    <div className={cx('qv-metric-strip', className)}>
      {metrics.map((metric, index) => (
        <div className="qv-metric-strip__item" key={`${metric.label}-${index}`}>
          <span className="qv-metric-strip__label">{metric.label}</span>
          <strong className="qv-metric-strip__value">{metric.value}</strong>
          {metric.helper && <span className="qv-metric-strip__helper">{metric.helper}</span>}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * ActionButton — enlace de acción usado en las tarjetas de "Acciones prioritarias" del
 * dashboard (`/`).
 * ------------------------------------------------------------------------------------- */

export interface ActionButtonProps {
  href: string;
  label: string;
  size?: 'sm' | 'md';
}

export function ActionButton({ href, label, size = 'md' }: ActionButtonProps) {
  return (
    <a href={href} className={cx('qv-action-button', `qv-action-button--${size}`)}>
      {label}
      <span className="qv-action-button__arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}
