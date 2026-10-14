'use client';

import { Hourglass } from 'lucide-react';
import type { MolinosLinea } from '@quivo/shared';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import { ahoraServidor, textoHudMolinos } from '../../../src/lib/en-vivo/vuelta';

interface HudMolinosProps {
  lineas: MolinosLinea[] | undefined;
  /** Línea elegida en el filtro (`''` = todas). */
  lineaFilter: string;
  servidorTs: string | undefined;
  recibidoEn: number;
}

export function HudMolinos({ lineas, lineaFilter, servidorTs, recibidoEn }: HudMolinosProps) {
  const ahora = useReloj(10_000);
  const visibles = (lineas ?? []).filter((l) => !lineaFilter || l.lineaId === lineaFilter);
  if (visibles.length === 0) return null;
  const reloj = ahoraServidor(servidorTs, recibidoEn, ahora);
  return (
    <div className="qv-live-hud-card qv-live-molinos" role="group" aria-label="Molinos por línea">
      <Hourglass size={14} aria-hidden="true" />
      <ul className="qv-live-molinos__lista">
        {visibles.map((l) => (
          <li key={l.lineaId}>
            {visibles.length > 1 && <strong>{l.lineaNombre} · </strong>}
            {textoHudMolinos(l, reloj)}
          </li>
        ))}
      </ul>
    </div>
  );
}
