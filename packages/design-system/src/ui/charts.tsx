'use client';

import { useState, type ReactNode } from 'react';
import { cx } from '../utils.js';

/* ---------------------------------------------------------------------------------------
 * DonutChart — Gráfico circular SVG interactivo para distribuciones por estado.
 * ------------------------------------------------------------------------------------- */

export interface DonutSegment {
  id: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  data: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerSublabel?: string;
  className?: string;
}

export function DonutChart({
  data,
  size = 180,
  strokeWidth = 24,
  centerLabel,
  centerSublabel,
  className,
}: DonutChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const total = data.reduce((acc, item) => acc + item.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercent = 0;

  const segments = data.map((item) => {
    const percent = total > 0 ? (item.value / total) * 100 : 0;
    const strokeDasharray = `${(percent * circumference) / 100} ${circumference}`;
    const strokeDashoffset = -((accumulatedPercent * circumference) / 100);
    accumulatedPercent += percent;

    return {
      ...item,
      percent: Math.round(percent),
      strokeDasharray,
      strokeDashoffset,
    };
  });

  const activeSegment = hoveredId ? data.find((d) => d.id === hoveredId) : null;
  const displayValue = activeSegment ? activeSegment.value : (centerLabel ?? total);
  const displaySublabel = activeSegment ? activeSegment.label : (centerSublabel ?? 'Total');

  return (
    <div className={cx('qv-donut-container', className)}>
      <div className="qv-donut-chart" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="qv-donut-svg">
          {/* Fondo del track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--qv-surface-sunken)"
            strokeWidth={strokeWidth}
          />
          {/* Segmentos de datos */}
          {total > 0 &&
            segments.map((seg) => {
              const isHovered = hoveredId === seg.id;
              return (
                <circle
                  key={seg.id}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={seg.strokeDasharray}
                  strokeDashoffset={seg.strokeDashoffset}
                  strokeLinecap="round"
                  className={cx('qv-donut-segment', isHovered && 'qv-donut-segment--active')}
                  onMouseEnter={() => setHoveredId(seg.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    transformOrigin: 'center',
                    transform: 'rotate(-90deg)',
                    transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              );
            })}
        </svg>

        <div className="qv-donut-center">
          <span className="qv-donut-center-value">{displayValue}</span>
          <span className="qv-donut-center-label">{displaySublabel}</span>
        </div>
      </div>

      {/* Leyenda interactiva */}
      <div className="qv-donut-legend">
        {data.map((item) => {
          const percent = total > 0 ? Math.round((item.value / total) * 100) : 0;
          const isHovered = hoveredId === item.id;
          return (
            <div
              key={item.id}
              className={cx('qv-donut-legend-item', isHovered && 'qv-donut-legend-item--active')}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <span className="qv-donut-legend-dot" style={{ backgroundColor: item.color }} />
              <span className="qv-donut-legend-label">{item.label}</span>
              <span className="qv-donut-legend-count">{item.value}</span>
              <span className="qv-donut-legend-percent">{percent}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * BarTrendChart — Gráfico de barras temporales (ej. 7 días) para actividad y eventos.
 * ------------------------------------------------------------------------------------- */

export interface TrendBarPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  tooltip?: string;
}

export interface BarTrendChartProps {
  data: TrendBarPoint[];
  height?: number;
  primaryColor?: string;
  secondaryColor?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  className?: string;
}

export function BarTrendChart({
  data,
  height = 140,
  primaryColor = 'var(--qv-color-primary)',
  secondaryColor = 'var(--qv-color-warning)',
  primaryLabel,
  secondaryLabel,
  className,
}: BarTrendChartProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const maxValue = Math.max(
    1,
    ...data.map((d) => Math.max(d.value, d.secondaryValue ?? 0)),
  );

  return (
    <div className={cx('qv-bar-trend-chart', className)}>
      {(primaryLabel || secondaryLabel) && (
        <div className="qv-bar-trend-legend">
          {primaryLabel && (
            <div className="qv-bar-trend-legend-item">
              <span className="qv-bar-trend-legend-color" style={{ backgroundColor: primaryColor }} />
              <span>{primaryLabel}</span>
            </div>
          )}
          {secondaryLabel && (
            <div className="qv-bar-trend-legend-item">
              <span className="qv-bar-trend-legend-color" style={{ backgroundColor: secondaryColor }} />
              <span>{secondaryLabel}</span>
            </div>
          )}
        </div>
      )}

      <div className="qv-bar-trend-plot" style={{ height }}>
        {data.map((d, idx) => {
          const pHeight = (d.value / maxValue) * 100;
          const sHeight = d.secondaryValue !== undefined ? (d.secondaryValue / maxValue) * 100 : 0;
          const isActive = activeIdx === idx;

          return (
            <div
              key={d.label}
              className={cx('qv-bar-trend-col', isActive && 'qv-bar-trend-col--active')}
              onMouseEnter={() => setActiveIdx(idx)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <div className="qv-bar-trend-bars">
                <div
                  className="qv-bar-trend-bar qv-bar-trend-bar--primary"
                  style={{
                    height: `${Math.max(4, pHeight)}%`,
                    backgroundColor: primaryColor,
                  }}
                  title={`${primaryLabel ?? 'Valor'}: ${d.value}`}
                />
                {d.secondaryValue !== undefined && (
                  <div
                    className="qv-bar-trend-bar qv-bar-trend-bar--secondary"
                    style={{
                      height: `${Math.max(4, sHeight)}%`,
                      backgroundColor: secondaryColor,
                    }}
                    title={`${secondaryLabel ?? 'Secundario'}: ${d.secondaryValue}`}
                  />
                )}
              </div>
              <span className="qv-bar-trend-label">{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------
 * MetricCard — Tarjeta de KPI elevada y enriquecida con icono e indicador de estado.
 * ------------------------------------------------------------------------------------- */

export interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: string;
  icon?: ReactNode;
  tone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  badge?: string;
  href?: string;
  className?: string;
}

export function MetricCard({
  label,
  value,
  delta,
  icon,
  tone = 'primary',
  badge,
  href,
  className,
}: MetricCardProps) {
  const content = (
    <div className={cx('qv-metric-card', `qv-metric-card--${tone}`, href && 'qv-metric-card--interactive', className)}>
      <div className="qv-metric-card__top">
        <span className="qv-metric-card__label">{label}</span>
        {icon && <div className="qv-metric-card__icon">{icon}</div>}
      </div>
      <div className="qv-metric-card__middle">
        <strong className="qv-metric-card__value">{value}</strong>
        {badge && <span className="qv-metric-card__badge">{badge}</span>}
      </div>
      {delta && <span className="qv-metric-card__delta">{delta}</span>}
    </div>
  );

  if (href) {
    return (
      <a href={href} className="qv-metric-card__link">
        {content}
      </a>
    );
  }

  return content;
}
