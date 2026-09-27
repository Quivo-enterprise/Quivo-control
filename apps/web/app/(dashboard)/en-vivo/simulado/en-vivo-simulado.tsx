'use client';

import { RouteMap, type MapOverlayMarker, type MapPoint, type MapRoute } from '@quivo/design-system';
import { FlaskConical } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FlotaMockProvider, infraccionActivaDe, useFlotaMock } from '../../../../src/lib/mock-flota';
import { PanelSimulacion } from './panel-simulacion';
import { TrufiMarcador } from './trufi-marcador';
import { TrufiPanel } from './trufi-panel';
import './simulado.css';

/** Centro aproximado de Cochabamba, entre el recorrido de Z12 (norte-sur) y la 120
 * (centro), para que el encuadre inicial (antes de que `RouteMap` calcule bounds reales de
 * `routes`/`stops`) ya muestre ambas líneas. */
const CENTRO_COCHABAMBA: [number, number] = [-17.378, -66.176];
const ZOOM_INICIAL = 12;

function EnVivoSimuladoInterno() {
  const { estado, lineas, trufis } = useFlotaMock();
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);

  const routes = useMemo<MapRoute[]>(
    () =>
      Object.values(lineas).map((linea) => ({
        id: `ruta-${linea.id}`,
        label: linea.nombre,
        color: linea.color,
        points: linea.polilinea.map(([lat, lng]) => ({ lat, lng })),
      })),
    [lineas],
  );

  const stops = useMemo<MapPoint[]>(
    () =>
      Object.values(lineas).flatMap((linea) =>
        linea.paradas.map((parada) => ({
          id: `parada-${parada.id}`,
          lat: parada.lat,
          lng: parada.lng,
          label: parada.nombre,
          color: linea.color,
          pinType: 'stop' as const,
        })),
      ),
    [lineas],
  );

  const overlayMarkers = useMemo<MapOverlayMarker[]>(
    () =>
      trufis.map((trufi) => {
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
    [trufis, estado, lineas, seleccionadoId],
  );

  const trufiSeleccionado = seleccionadoId ? trufis.find((t) => t.id === seleccionadoId) : undefined;

  return (
    <div className="qv-live-map-wrapper">
      <RouteMap
        height="100%"
        routes={routes}
        stops={stops}
        overlayMarkers={overlayMarkers}
        defaultCenter={CENTRO_COCHABAMBA}
        defaultZoom={ZOOM_INICIAL}
        fitMode="auto"
      />

      <div className="qv-sim-badge">
        <FlaskConical size={13} aria-hidden="true" />
        Modo simulación
      </div>

      <PanelSimulacion />

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
