'use client';

import { AlertTriangle, Bell, CheckCircle2, CircleDot, Clock, WifiOff } from 'lucide-react';
import { kpis, type EstadoFlotaMock, type LineaMockId } from '../../../../src/lib/mock-flota';
import { useScrollFadeRight } from './use-scroll-fade';

interface FranjaKpiProps {
  estado: EstadoFlotaMock;
  lineaId: LineaMockId | null;
}

/**
 * Franja KPI del HUD (E07 03:48 del guion: "cuántos trabajan, dónde"). Equivalente propio en
 * vez de `MetricStrip`/`MetricStripItem` de `@quivo/design-system` (Decisión — probado
 * primero): `MetricStrip` está pensado para tarjetas de dashboard sobre fondo sólido
 * (`.qv-metric-strip` en `packages/design-system/src/styles.css` no lleva `backdrop-filter` ni
 * los tokens `--qv-surface-glass`/`--qv-border-glass`) y flotando sobre el mapa se veía como un
 * bloque opaco fuera de lugar frente al resto del HUD "vidrio flotante" (`.qv-sim-badge`,
 * `.qv-linea-filtro`). Mismo criterio de "no tocar el design-system": se construye acá, no se
 * edita `MetricStrip`.
 */
const ITEMS = [
  { key: 'enRuta', label: 'En ruta', icon: CircleDot },
  { key: 'enCola', label: 'En cola', icon: Clock },
  { key: 'finalizados', label: 'Finalizados', icon: CheckCircle2 },
  { key: 'sinSenal', label: 'Sin señal', icon: WifiOff },
  { key: 'atascados', label: 'Atascados', icon: AlertTriangle },
  { key: 'novedadesAbiertas', label: 'Novedades', icon: Bell },
] as const;

export function FranjaKpi({ estado, lineaId }: FranjaKpiProps) {
  const valores = kpis(estado, lineaId ?? undefined);
  // Ítem 10: a 390px la franja de 6 indicadores no entra — `overflow-x: auto` ya scrollea, esto
  // solo agrega la pista visual (fade) de que hay más a la derecha, cuando de verdad desborda.
  const { ref, desbordaDerecha } = useScrollFadeRight<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`qv-kpi-strip ${desbordaDerecha ? 'qv-scroll-fade-right' : ''}`}
      role="group"
      aria-label="Indicadores de la flota"
    >
      {ITEMS.map(({ key, label, icon: Icon }) => (
        <div className="qv-kpi-strip__item" key={key}>
          <Icon size={13} aria-hidden="true" className="qv-kpi-strip__icon" />
          <strong className="qv-kpi-strip__value">{valores[key]}</strong>
          <span className="qv-kpi-strip__label">{label}</span>
        </div>
      ))}
    </div>
  );
}
