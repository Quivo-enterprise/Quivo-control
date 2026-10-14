'use client';

import type { Vehiculo } from '@quivo/shared';
import { Bus } from 'lucide-react';
import { useState } from 'react';

/** Miniatura de 40 px para la tabla: foto de la unidad o ícono de reemplazo si falta/falla. */
export function FotoVehiculoMiniatura({ vehicle }: { vehicle: Vehiculo }) {
  const [rota, setRota] = useState<string | null>(null);
  const url = vehicle.fotoUrl?.trim() || null;
  const caja = {
    width: 40,
    height: 40,
    borderRadius: 'var(--qv-radius-md)',
    overflow: 'hidden',
    border: '1px solid var(--qv-border-glass)',
    background: 'var(--qv-surface-soft)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  } as const;
  if (url && rota !== url) {
    return (
      <span style={caja}>
        <img
          src={url}
          alt={`Foto del vehículo ${vehicle.placa}`}
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
          onError={() => setRota(url)}
        />
      </span>
    );
  }
  return (
    <span style={caja} role="img" aria-label={`Sin foto del vehículo ${vehicle.placa}`}>
      <Bus size={18} style={{ color: 'var(--qv-text-muted)' }} aria-hidden="true" />
    </span>
  );
}

// Siempre hora de Bolivia, no la del navegador del admin (mismo criterio que `jornadas.ts`).
const FORMATO_FECHA_FOTO = new Intl.DateTimeFormat('es-BO', {
  timeZone: 'America/La_Paz',
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatearFechaFoto(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '—' : FORMATO_FECHA_FOTO.format(ms);
}
