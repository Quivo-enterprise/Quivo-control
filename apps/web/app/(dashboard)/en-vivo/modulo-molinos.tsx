'use client';

import { useMemo } from 'react';
import { Hourglass } from 'lucide-react';
import type { MolinosResumen, PosicionEnVivo } from '@quivo/shared';
import { colasVerificadas, colasVisibles } from '../../../src/lib/en-vivo/atencion';
import { useReloj } from '../../../src/lib/en-vivo/use-reloj';
import { ahoraServidor, textoHudMolinos } from '../../../src/lib/en-vivo/vuelta';

interface ModuloMolinosProps {
  resumen: MolinosResumen | undefined;
  /** Línea elegida en el filtro (`''` = todas). */
  lineaFilter: string;
  recibidoEn: number;
  /** Posiciones frescas: confirman quién sigue en espera (la misma regla que "Atención"). */
  posiciones: readonly Pick<PosicionEnVivo, 'id' | 'vuelta'>[];
}

/**
 * Molinos es salida libre: la cola es información (quién sigue), no una falla. Los lugares salen
 * de `resumen.colas` (la cola del chofer), verificada con la posición en vivo como en "Atención".
 */
export function ModuloMolinos({ resumen, lineaFilter, recibidoEn, posiciones }: ModuloMolinosProps) {
  const ahora = useReloj(10_000);
  const lineas = useMemo(
    () => (resumen?.lineas ?? []).filter((l) => !lineaFilter || l.lineaId === lineaFilter),
    [resumen, lineaFilter],
  );
  const colas = useMemo(
    () => colasVisibles(colasVerificadas(resumen?.colas, posiciones), lineaFilter),
    [resumen, posiciones, lineaFilter],
  );
  if (lineas.length === 0) return null;
  const reloj = ahoraServidor(resumen?.servidorTs, recibidoEn, ahora);
  return (
    <section className="qv-live-modulo" aria-label="Molinos">
      <h2 className="qv-live-modulo__titulo">
        <Hourglass size={14} aria-hidden="true" />
        Molinos
      </h2>
      <ul className="qv-live-modulo__lista">
        {lineas.map((l) => (
          <li key={l.lineaId}>
            {lineas.length > 1 && <strong>{l.lineaNombre} · </strong>}
            {textoHudMolinos(l, reloj)}
          </li>
        ))}
      </ul>
      {colas.length > 0 && (
        // shortcut: una sola lista; hoy solo la L16 hace cola en Molinos (la 120 nunca). Agrupar por cola si otra línea empieza a hacer cola.
        <ol className="qv-live-cola" aria-label="Cola de Molinos">
          {colas.flatMap((c) =>
            c.entradas.map((e) => (
              <li key={e.sesionId}>
                <span className="qv-live-cola__pos">{e.posicion}.º</span>
                <span translate="no">{e.placa}</span>
              </li>
            )),
          )}
        </ol>
      )}
    </section>
  );
}
