'use client';

import { RouteMap, type MapOverlayMarker, type MapPoint, type MapRoute, type MapZone } from '@quivo/design-system';
import { FlaskConical } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  colaDe,
  FlotaMockProvider,
  infraccionActivaDe,
  paradasDe,
  puntosControlActivosDe,
  useFlotaMock,
  type FaseTrufi,
  type LineaMockId,
} from '../../../../src/lib/mock-flota';
import { colorConResaltado, overlayAltaDemandaDe, rutasEscenarioDe, zonasPuntosControlDe } from './capas-mapa';
import { FranjaKpi } from './franja-kpi';
import { PanelSimulacion } from './panel-simulacion';
import { RailVistas, type VistaId } from './rail-vistas';
import { TrufiMarcador } from './trufi-marcador';
import { TrufiPanel } from './trufi-panel';
import { VistaAnalisis } from './vistas/vista-analisis';
import { VistaConfiguracion } from './vistas/vista-configuracion';
import { VistaNovedades } from './vistas/vista-novedades';
import { VistaSalidas } from './vistas/vista-salidas';
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

/** `true` cuando se graba el video (`docs/guion-grabacion-mock.md`): oculta el badge "Modo
 * simulación", arranca con el panel de simulación oculto (se muestra/oculta con `S`) y no
 * cambia nada más de la lógica — la demo sigue siendo 100% mock. */
const MODO_GRABACION = process.env.NEXT_PUBLIC_MOCK_GRABACION === 'true';

/** Ancho de corte para "no entran mapa + vista + ficha" (Decisión C2, guion E05 02:18: panel
 * responsive en celular) — mismo breakpoint que ya usa `.qv-trufi-panel`/`.qv-sim-panel` en
 * `simulado.css` para pasar a bottom sheet. */
const BREAKPOINT_ANGOSTO = 720;

function useAnchoAngosto(): boolean {
  const [angosto, setAngosto] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${BREAKPOINT_ANGOSTO}px)`);
    setAngosto(mq.matches);
    const listener = (e: MediaQueryListEvent) => setAngosto(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);
  return angosto;
}

function EnVivoSimuladoInterno() {
  const { estado, lineas, trufis } = useFlotaMock();
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroLinea>('todas');
  const [vistaActiva, setVistaActiva] = useState<VistaId>('mapa');
  const [resaltarLineaId, setResaltarLineaId] = useState<LineaMockId | null>(null);
  const [panelSimulacionVisible, setPanelSimulacionVisible] = useState(!MODO_GRABACION);
  const angosto = useAnchoAngosto();

  const filtroLineaId: LineaMockId | null = filtro === 'todas' ? null : filtro;

  // Tecla `S` (sin modificadores, no mientras se escribe en un campo) alterna el panel de
  // simulación — en cualquier modo, no solo en grabación (contrato del brief de C2).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 's' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const activo = document.activeElement;
      const enCampo =
        activo instanceof HTMLElement &&
        (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA' || activo.tagName === 'SELECT' || activo.isContentEditable);
      if (enCampo) return;
      setPanelSimulacionVisible((v) => !v);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Configuración solo tiene sentido resaltar una línea mientras esa vista está abierta — al
  // salir de "Configuración" (cambiar de vista o volver a "Mapa"), se apaga el resaltado para
  // no dejar el mapa en un estado "a medias" cuando el delegado vuelve a la vista Mapa.
  useEffect(() => {
    if (vistaActiva !== 'configuracion') {
      setResaltarLineaId(null);
    }
  }, [vistaActiva]);

  function seleccionarTrufi(trufiId: string) {
    setSeleccionadoId(trufiId);
    // "Keep the view open if both fit; at ≤720px, close the view" (brief de C2) — en pantallas
    // angostas no entran la vista Y la ficha del trufi a la vez, así que abrir la ficha cierra
    // la vista que la disparó.
    if (angosto) {
      setVistaActiva('mapa');
    }
  }

  // -- "Tramo sincronizado" resaltado brevemente tras un resync (E08 05:53) -- declarado ACÁ
  // (antes del `useMemo` de `routes`, que lo lee) para que no quede en temporal-dead-zone: el
  // callback de `useMemo` se ejecuta de forma SÍNCRONA en el primer render, así que cualquier
  // `const`/`useState` que lea tiene que estar declarado antes en el orden del cuerpo de la
  // función, no solo antes en el árbol de hooks.
  const faseAnteriorRef = useRef<Record<string, FaseTrufi>>({});
  const [resaltadoBuffer, setResaltadoBuffer] = useState<{ trufiId: string; puntos: [number, number][]; expiresAt: number } | null>(
    null,
  );
  useEffect(() => {
    for (const trufi of trufis) {
      const actual = estado.trufis[trufi.id];
      const anterior = faseAnteriorRef.current[trufi.id];
      // Ítem 5 (fix, 2026-09-27): antes dibujaba los últimos 40 puntos de la traza acumulada
      // (una aproximación) — ahora usa `ultimoTramoSincronizado.puntos`, EXACTAMENTE los puntos
      // que volcó `recuperarSenal` desde el buffer (`estado/senal.ts`), sin adivinar.
      if (actual && anterior === 'sincronizando' && actual.fase === 'en_ruta' && actual.ultimoTramoSincronizado) {
        setResaltadoBuffer({
          trufiId: trufi.id,
          puntos: actual.ultimoTramoSincronizado.puntos,
          expiresAt: Date.now() + 4000,
        });
      }
      if (actual) faseAnteriorRef.current[trufi.id] = actual.fase;
    }
  }, [estado, trufis]);
  useEffect(() => {
    if (!resaltadoBuffer) return undefined;
    const restante = Math.max(0, resaltadoBuffer.expiresAt - Date.now());
    const id = setTimeout(() => setResaltadoBuffer(null), restante);
    return () => clearTimeout(id);
  }, [resaltadoBuffer]);

  const lineasVisibles = useMemo(
    () => Object.values(lineas).filter((linea) => filtro === 'todas' || linea.id === filtro),
    [lineas, filtro],
  );

  const routes = useMemo<MapRoute[]>(() => {
    const rutasLinea = lineasVisibles.map((linea) => ({
      id: `ruta-${linea.id}`,
      label: linea.nombre,
      color: colorConResaltado(linea.id, linea.color, resaltarLineaId),
      // `trazoRuta` (no `polilinea`): el trazo a DIBUJAR — solo la ida cuando la línea es de
      // ida y vuelta (la 120). El movimiento de los trufis sigue usando `polilinea` completa
      // en otro lado (`estado.ts`), sin tocar — ver comentario de `OFFSET_PX` arriba.
      points: linea.trazoRuta.map(([lat, lng]) => ({ lat, lng })),
      // Solo hace falta separar visualmente cuando las DOS líneas comparten mapa — con una
      // sola visible (filtro puesto) no hay nada de qué diferenciarla, así que no vale la
      // pena correr su trazo real de esa distancia fija.
      offsetPx: lineasVisibles.length > 1 ? OFFSET_PX[linea.id] : undefined,
    }));

    const trufisVisiblesParaRutas = filtro === 'todas' ? trufis : trufis.filter((t) => t.lineaId === filtro);
    const rutasEscenario = rutasEscenarioDe(trufisVisiblesParaRutas, estado.trufis, lineas, seleccionadoId);

    const rutaResync =
      resaltadoBuffer && Date.now() < resaltadoBuffer.expiresAt
        ? [
            {
              id: `buffer-resync-${resaltadoBuffer.trufiId}`,
              label: 'Tramo sincronizado',
              color: '#22d3ee',
              points: resaltadoBuffer.puntos.map(([lat, lng]) => ({ lat, lng })),
            },
          ]
        : [];

    return [...rutasLinea, ...rutasEscenario, ...rutaResync];
  }, [lineasVisibles, resaltarLineaId, filtro, trufis, estado.trufis, lineas, seleccionadoId, resaltadoBuffer]);

  const stops = useMemo<MapPoint[]>(
    () =>
      // `paradasDe` (no `linea.paradas`, ítem 4): incluye ediciones en vivo de Configuración
      // (nombre) — sin esto una parada renombrada en "Guardar cambios" seguía mostrando el
      // nombre viejo acá.
      lineasVisibles.flatMap((linea) =>
        paradasDe(estado, linea.id).map((parada) => ({
          id: `parada-${parada.id}`,
          lat: parada.lat,
          lng: parada.lng,
          label: parada.nombre,
          color: linea.color,
          pinType: 'stop' as const,
        })),
      ),
    [lineasVisibles, estado],
  );

  const zones = useMemo<MapZone[]>(() => {
    if (!resaltarLineaId) return [];
    const linea = lineas[resaltarLineaId];
    return zonasPuntosControlDe(linea, puntosControlActivosDe(estado, resaltarLineaId));
  }, [resaltarLineaId, lineas, estado]);

  const trufisVisibles = useMemo(
    () => (filtro === 'todas' ? trufis : trufis.filter((trufi) => trufi.lineaId === filtro)),
    [trufis, filtro],
  );

  const overlayMarkers = useMemo<MapOverlayMarker[]>(() => {
    // Ítem 1(a) del guion de fixes (2026-09-27): antes cada trufi `en_cola` tenía SU PROPIO
    // marcador — con 2-3 trufis apilados en la misma terminal (35 m entre sí, ver `flota.ts`) a
    // zoom ciudad se veían amontonados e ilegibles. Ahora solo el CABEZA de cola (`colaDe(...)[0]`,
    // el próximo en salir) tiene marcador, con un pill "+N en cola" — el resto se ve en Salidas.
    const cabezaDeColaPorLinea = new Map<string, string>();
    for (const linea of lineasVisibles) {
      const cola = colaDe(estado, linea.id);
      if (cola.length > 0) cabezaDeColaPorLinea.set(linea.id, cola[0]!);
    }

    const marcadoresTrufi = trufisVisibles
      .filter((trufi) => {
        const posicion = estado.trufis[trufi.id];
        if (posicion?.fase !== 'en_cola') return true;
        return cabezaDeColaPorLinea.get(trufi.lineaId) === trufi.id;
      })
      .map((trufi) => {
        const posicion = estado.trufis[trufi.id];
        const linea = lineas[trufi.lineaId];
        const infraccionActiva = infraccionActivaDe(estado, trufi.id);
        const seleccionado = seleccionadoId === trufi.id;
        const enColaTotal = posicion?.fase === 'en_cola' ? colaDe(estado, trufi.lineaId).length : undefined;
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
              estadoTrufi={posicion}
              infraccionActiva={infraccionActiva}
              seleccionado={seleccionado}
              enColaTotal={enColaTotal}
              onClick={() => setSeleccionadoId((current) => (current === trufi.id ? null : trufi.id))}
            />
          ),
        };
      });
    const marcadoresDemanda = overlayAltaDemandaDe(estado, lineasVisibles, new Date());
    return [...marcadoresTrufi, ...marcadoresDemanda];
  }, [trufisVisibles, estado, lineas, lineasVisibles, seleccionadoId]);

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

  const vistaProps = { lineaId: filtroLineaId, onSeleccionarTrufi: seleccionarTrufi, onCerrar: () => setVistaActiva('mapa') };

  // Ítem 9 del guion de fixes (2026-09-27): a ≤720px la ficha del trufi Y las vistas grandes
  // pasan a bottom sheet casi a todo ancho (`.qv-trufi-panel`/`.qv-vista-panel`, `max-width:
  // 720px` en `simulado.css`/`vistas.css`) — el panel de simulación (`.qv-sim-panel`, mismo
  // rincón inferior-izquierdo) quedaba SIEMPRE encima, tapando parte de la hoja. `S` sigue
  // siendo el toggle real (`panelSimulacionVisible`); esto solo lo oculta MIENTRAS hay algo
  // abierto en mobile — vuelve a aparecer solo si `panelSimulacionVisible` seguía en `true`.
  const otroPanelAbiertoEnMobile = angosto && (vistaActiva !== 'mapa' || !!trufiSeleccionado);
  const mostrarPanelSimulacion = panelSimulacionVisible && !otroPanelAbiertoEnMobile;

  return (
    <div className="qv-live-map-wrapper">
      <RouteMap
        height="100%"
        routes={routes}
        stops={stops}
        zones={zones}
        overlayMarkers={overlayMarkers}
        defaultCenter={CENTRO_COCHABAMBA}
        defaultZoom={ZOOM_INICIAL}
        fitMode="once"
        fitKey={filtro}
      />

      <div className="qv-top-hud">
        {!MODO_GRABACION && (
          <div className="qv-sim-badge">
            <FlaskConical size={13} aria-hidden="true" />
            Modo simulación
          </div>
        )}

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

        <RailVistas vistaActiva={vistaActiva} onCambiarVista={setVistaActiva} estado={estado} lineaId={filtroLineaId} />

        <FranjaKpi estado={estado} lineaId={filtroLineaId} />
      </div>

      {vistaActiva === 'salidas' && <VistaSalidas {...vistaProps} />}
      {vistaActiva === 'novedades' && <VistaNovedades {...vistaProps} />}
      {vistaActiva === 'analisis' && <VistaAnalisis {...vistaProps} />}
      {vistaActiva === 'configuracion' && <VistaConfiguracion {...vistaProps} onResaltarLinea={setResaltarLineaId} />}

      {mostrarPanelSimulacion && (
        <PanelSimulacion lineaId={filtro === 'todas' ? undefined : filtro} seleccionadoId={seleccionadoId} />
      )}

      {trufiSeleccionado && (
        <TrufiPanel
          trufi={trufiSeleccionado}
          linea={lineas[trufiSeleccionado.lineaId]}
          onClose={() => setSeleccionadoId(null)}
          onSeleccionarTrufi={seleccionarTrufi}
        />
      )}
    </div>
  );
}

/**
 * `/en-vivo` en modo mock (`NEXT_PUBLIC_MOCK_FLOTA=true`, ver `docs/plan-mock-flota-en-vivo.md`
 * y, para la ampliación del panel del delegado, `docs/plan-mock-guion-delegado.md`).
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
