'use client';

import { RouteMap, type MapOverlayMarker, type MapPoint, type MapRoute } from '@quivo/design-system';
import { FlaskConical } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  FlotaMockProvider,
  infraccionActivaDe,
  useFlotaMock,
  type LineaMockId,
} from '../../../../src/lib/mock-flota';
import { PanelSimulacion } from './panel-simulacion';
import { TrufiMarcador } from './trufi-marcador';
import { TrufiPanel } from './trufi-panel';
import './simulado.css';

/** Centro aproximado de Cochabamba, entre el recorrido de Z12 (norte-sur) y la 120
 * (centro), para que el encuadre inicial (antes de que `RouteMap` calcule bounds reales de
 * `routes`/`stops`) ya muestre ambas líneas. */
const CENTRO_COCHABAMBA: [number, number] = [-17.378, -66.176];
const ZOOM_INICIAL = 12;

/** 'todas' + cada `LineaMockId` — filtro de línea del HUD superior (Decisión CTO,
 * 2026-09-27). SIEMPRE arranca en 'todas': es solo `useState`, sin `localStorage` ni URL, así
 * que cada entrada a la vista (remount de `FlotaMockProvider`, ver `EnVivoSimulado` abajo)
 * vuelve a este default sin ningún trabajo extra. */
type FiltroLinea = 'todas' | LineaMockId;

/** Separación (px de pantalla, `MapRoute.offsetPx` — ver `packages/design-system/src/types.ts`)
 * entre Z12 y Línea 120 cuando ambas se dibujan a la vez ("Todas"). Root cause del bug de
 * visibilidad de la 120 (documentado en el handoff): la 120 recorre ~1.5km alrededor de Plaza
 * Colón/La Cancha, un tramo que Z12 también atraviesa — a zoom ciudad (12, el default) ese
 * lazo entero colapsa a un puñado de píxeles de pantalla, así que el offset automático de
 * `RouteMap` (±2px, pensado para trazos que NO comparten calle) no alcanza: el halo de 10px de
 * Z12 tapa por completo a la 120. Confirmado en vivo (inyectando features directo al source
 * `quivo-routes` con MapLibre, sin tocar código) que NI reordenar qué ruta va primero en el
 * array NI un offset de ±2 alcanzan — recién ±7 (14px totales, > los 10px de un halo) separa
 * los dos trazos de forma visible incluso a zoom 12. El array queda con el ORDEN ORIGINAL
 * (Z12 primero) — el reordenamiento no tenía efecto real, así que no hay motivo para tocarlo.
 *
 * SEGUNDA vuelta de este bug (code review, 2026-09-27): `line-offset` de MapLibre es relativo
 * al SENTIDO DE DIBUJO de cada trazo, no a un lado absoluto — un offset de signo fijo separa
 * dos trazos consistentemente SOLO si van en el mismo sentido en todo el tramo compartido. La
 * 120 es de ida y vuelta (recorre las mismas calles ida y vuelta para cerrar el loop —
 * `L120_POLILINEA` en `datos.ts`), así que dibujar la polilínea COMPLETA hacía que la vuelta
 * retrazara el tramo compartido con Z12 en sentido CONTRARIO al de la ida — ahí ±7 quedaba del
 * mismo lado que Z12 (se superponían) en vez del lado opuesto. Medido con un script de
 * bearings (segmentos de la 120 a ≤8m de un segmento de Z12, comparando dirección):
 *   ANTES (120 completa, ida+vuelta): 46 segmentos compartidos — 23 mismo sentido, 23 sentido
 *   opuesto (exactamente la mitad, como se esperaba de una vuelta que retraza la ida).
 *   DESPUÉS (120 solo ida, `linea.trazoRuta` — ver `geometria.ts#trazoVisibleDe`): 23
 *   segmentos compartidos, LOS 23 en el mismo sentido que Z12 → un signo fijo por línea
 *   alcanza, no hace falta partir el trazo en múltiples `MapRoute`. Fix: `routes` (abajo) usa
 *   `linea.trazoRuta` (solo ida en la 120, sin cambios en Z12) para DIBUJAR — el movimiento de
 *   los trufis (`posicionEnPolilinea`, en `estado.ts`) sigue usando `linea.polilinea` completa,
 *   sin tocar. */
const OFFSET_PX: Partial<Record<LineaMockId, number>> = { z12: -7, l120: 7 };

function EnVivoSimuladoInterno() {
  const { estado, lineas, trufis } = useFlotaMock();
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroLinea>('todas');

  const lineasVisibles = useMemo(
    () => Object.values(lineas).filter((linea) => filtro === 'todas' || linea.id === filtro),
    [lineas, filtro],
  );

  const routes = useMemo<MapRoute[]>(
    () =>
      lineasVisibles.map((linea) => ({
        id: `ruta-${linea.id}`,
        label: linea.nombre,
        color: linea.color,
        // `trazoRuta` (no `polilinea`): el trazo a DIBUJAR — solo la ida cuando la línea es de
        // ida y vuelta (la 120). El movimiento de los trufis sigue usando `polilinea` completa
        // en otro lado (`estado.ts`), sin tocar — ver comentario de `OFFSET_PX` arriba.
        points: linea.trazoRuta.map(([lat, lng]) => ({ lat, lng })),
        // Solo hace falta separar visualmente cuando las DOS líneas comparten mapa — con una
        // sola visible (filtro puesto) no hay nada de qué diferenciarla, así que no vale la
        // pena correr su trazo real de esa distancia fija.
        offsetPx: lineasVisibles.length > 1 ? OFFSET_PX[linea.id] : undefined,
      })),
    [lineasVisibles],
  );

  const stops = useMemo<MapPoint[]>(
    () =>
      lineasVisibles.flatMap((linea) =>
        linea.paradas.map((parada) => ({
          id: `parada-${parada.id}`,
          lat: parada.lat,
          lng: parada.lng,
          label: parada.nombre,
          color: linea.color,
          pinType: 'stop' as const,
        })),
      ),
    [lineasVisibles],
  );

  const trufisVisibles = useMemo(
    () => (filtro === 'todas' ? trufis : trufis.filter((trufi) => trufi.lineaId === filtro)),
    [trufis, filtro],
  );

  const overlayMarkers = useMemo<MapOverlayMarker[]>(
    () =>
      trufisVisibles.map((trufi) => {
        const posicion = estado.trufis[trufi.id];
        const linea = lineas[trufi.lineaId];
        const infraccionActiva = infraccionActivaDe(estado, trufi.id);
        const seleccionado = seleccionadoId === trufi.id;
        return {
          id: trufi.id,
          lat: posicion?.lat ?? linea.polilinea[0]?.[0] ?? 0,
          lng: posicion?.lng ?? linea.polilinea[0]?.[1] ?? 0,
          anchor: 'center' as const,
          zIndex: seleccionado ? 100 : infraccionActiva ? 50 : 10,
          content: (
            <TrufiMarcador
              trufi={trufi}
              linea={linea}
              infraccionActiva={infraccionActiva}
              seleccionado={seleccionado}
              onClick={() => setSeleccionadoId((current) => (current === trufi.id ? null : trufi.id))}
            />
          ),
        };
      }),
    [trufisVisibles, estado, lineas, seleccionadoId],
  );

  const trufiSeleccionado = seleccionadoId ? trufis.find((t) => t.id === seleccionadoId) : undefined;

  // Si el trufi con la ficha abierta queda fuera del filtro recién elegido (p. ej. la ficha de
  // un trufi de la 120 sigue abierta y el usuario cambia el filtro a "Z12"), cierra la ficha —
  // dejarla abierta mostraría el panel de un vehículo que ya no está ni en el mapa ni en los
  // marcadores visibles.
  useEffect(() => {
    if (!trufiSeleccionado) return;
    if (filtro !== 'todas' && trufiSeleccionado.lineaId !== filtro) {
      setSeleccionadoId(null);
    }
  }, [filtro, trufiSeleccionado]);

  return (
    <div className="qv-live-map-wrapper">
      <RouteMap
        height="100%"
        routes={routes}
        stops={stops}
        overlayMarkers={overlayMarkers}
        defaultCenter={CENTRO_COCHABAMBA}
        defaultZoom={ZOOM_INICIAL}
        fitMode="once"
        fitKey={filtro}
      />

      <div className="qv-top-hud">
        <div className="qv-sim-badge">
          <FlaskConical size={13} aria-hidden="true" />
          Modo simulación
        </div>

        <div className="qv-linea-filtro" role="group" aria-label="Filtrar por línea">
          <button
            type="button"
            className={`qv-linea-filtro__btn ${filtro === 'todas' ? 'qv-linea-filtro__btn--active' : ''}`}
            aria-pressed={filtro === 'todas'}
            onClick={() => setFiltro('todas')}
          >
            <span className="qv-linea-filtro__dot qv-linea-filtro__dot--todas" aria-hidden="true" />
            Todas
          </button>
          {Object.values(lineas).map((linea) => (
            <button
              key={linea.id}
              type="button"
              className={`qv-linea-filtro__btn ${filtro === linea.id ? 'qv-linea-filtro__btn--active' : ''}`}
              aria-pressed={filtro === linea.id}
              onClick={() => setFiltro(linea.id)}
            >
              <span
                className={`qv-linea-filtro__dot ${linea.color === '#ffffff' ? 'qv-linea-filtro__dot--ring' : ''}`}
                style={{ background: linea.color }}
                aria-hidden="true"
              />
              {linea.nombre}
            </button>
          ))}
        </div>
      </div>

      <PanelSimulacion lineaId={filtro === 'todas' ? undefined : filtro} />

      {trufiSeleccionado && (
        <TrufiPanel
          trufi={trufiSeleccionado}
          linea={lineas[trufiSeleccionado.lineaId]}
          onClose={() => setSeleccionadoId(null)}
        />
      )}
    </div>
  );
}

/**
 * `/en-vivo` en modo mock (`NEXT_PUBLIC_MOCK_FLOTA=true`, ver `docs/plan-mock-flota-en-vivo.md`).
 * `FlotaMockProvider` vive acá arriba (no en `page.tsx`) para que el estado se resetee cada
 * vez que se entra a esta vista, sin filtrarse a la vista real.
 */
export function EnVivoSimulado() {
  return (
    <FlotaMockProvider>
      <EnVivoSimuladoInterno />
    </FlotaMockProvider>
  );
}
