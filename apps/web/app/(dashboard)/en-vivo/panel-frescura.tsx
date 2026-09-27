import { useEffect, useState } from 'react';
import { Loader, Tag } from '@quivo/design-system';
import type { SesionEnVivoResumen } from '@quivo/shared';
import { antiguedadViva, formatearAntiguedad, presentacionFrescura, type TrazaAcumulada } from '../../../src/lib/en-vivo/traza';

/** Re-renderiza cada segundo para que las antigüedades corran solas entre polls. Vive dentro
 * de `PanelFrescura` (ver el comentario ahí) para no forzar un re-render de toda la página. */
function useReloj(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return ahora;
}

/**
 * Las **dos** antigüedades, siempre juntas: `antiguedadFixMs` dice cuándo se capturó la
 * última posición y `antiguedadIngestaMs` cuándo llegó al servidor. Separadas distinguen
 * "el vehículo está parado" (fix viejo, ingesta fresca) de "el teléfono no sincroniza"
 * (las dos viejas), que es justo lo que hace útil la pantalla. Ambas se miden contra el
 * reloj del servidor vía `servidorTs`.
 */
export function PanelFrescura({
  datos,
  sesion,
  recibidoEn,
  sesionesRecibidoEn,
}: {
  datos: TrazaAcumulada | undefined;
  sesion: SesionEnVivoResumen | undefined;
  recibidoEn: number;
  sesionesRecibidoEn: number;
}) {
  // El tick de 1 Hz vive ACÁ, no en `EnVivoPage`: si estuviera arriba, forzaría un re-render
  // de toda la página (mapa incluido) cada segundo — `RouteMap` recompondría marcadores,
  // reiniciando la animación `qv-pulse` del vehículo antes de que complete un ciclo.
  // Confinado a esta hoja, el tick solo repinta este panel de texto.
  const ahora = useReloj();
  const fuente = datos ?? sesion;
  if (!fuente) return <Loader label="Cargando estado…" />;

  // El listado se refresca cada 30 s y la traza cada 10 s: si los datos vienen del listado
  // (todavía no llegó la primera respuesta de `posiciones`, o la query de traza está en error
  // sin data), la referencia tiene que ser el `dataUpdatedAt` de ESA query — el reloj del
  // navegador en el momento real en que esa respuesta llegó —, no `servidorTs` parseado como
  // si fuera un `recibidoEnMs`: eso da un offset de EXACTAMENTE 0 en `offsetRelojServidorMs`
  // (`Date.parse(servidorTs) - Date.parse(servidorTs)`), así que `antiguedadViva` termina
  // comparando `Date.now()` contra `ts` sin corregir el reloj del navegador — el bug preciso
  // que existe para evitar. Con `sesionesRecibidoEn` la antigüedad queda congelada hasta el
  // próximo refresco del listado, pero nunca desincronizada del reloj del servidor.
  const referencia = datos ? recibidoEn : sesionesRecibidoEn;
  const presentacion = presentacionFrescura(fuente.estadoFrescura);
  const antiguedadFix = antiguedadViva(fuente.ultimoFixTs, fuente.servidorTs, referencia, ahora);
  const antiguedadIngesta = antiguedadViva(
    fuente.ultimoIngresoTs,
    fuente.servidorTs,
    referencia,
    ahora,
  );
  // Fase A (docs/plan-ubicacion-fluida.md) — "Finalizó hace X" con la MISMA lógica de reloj
  // de servidor que las otras dos antigüedades: `recorridoFinTs` es la hora del evento
  // `fin_recorrido` (`SesionOperativa.recorridoEstadoTs`), viaja como ISO string y solo es
  // no-null cuando `estadoFrescura === 'finalizado'` (contrato de `derivarFrescura`).
  const antiguedadFin =
    fuente.estadoFrescura === 'finalizado'
      ? antiguedadViva(fuente.recorridoFinTs, fuente.servidorTs, referencia, ahora)
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', minWidth: '18rem' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span
          aria-hidden
          style={{
            width: '0.625rem',
            height: '0.625rem',
            borderRadius: '50%',
            background: presentacion.color,
            display: 'inline-block',
          }}
        />
        {/* Solo la etiqueta va en `aria-live`: cambia por poll (cada 10 s), no cada segundo
            como las dos líneas de antigüedad de abajo — envolverlas también spamearía al
            lector de pantalla. */}
        <span aria-live="polite" aria-atomic="true">
          <strong>{presentacion.etiqueta}</strong>
        </span>
        {datos && (
          <Tag variant="neutral">
            {datos.puntos.length} punto{datos.puntos.length === 1 ? '' : 's'}
          </Tag>
        )}
      </span>
      <span style={{ fontSize: '0.8125rem', opacity: 0.8 }}>
        Última posición capturada hace{' '}
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatearAntiguedad(antiguedadFix)}
        </strong>
      </span>
      <span style={{ fontSize: '0.8125rem', opacity: 0.8 }}>
        Última sincronización al servidor hace{' '}
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatearAntiguedad(antiguedadIngesta)}
        </strong>
      </span>
      {antiguedadFin !== null && (
        <span style={{ fontSize: '0.8125rem', opacity: 0.8 }}>
          Finalizó hace{' '}
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatearAntiguedad(antiguedadFin)}
          </strong>
        </span>
      )}
    </div>
  );
}
