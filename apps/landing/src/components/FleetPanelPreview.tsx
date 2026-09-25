'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { RouteMap, type MapPoint, type MapRoute } from '@quivo/design-system';
import {
  ArrowRight,
  BusFront,
  Clock3,
  MapPin,
  Radio,
  Route,
} from 'lucide-react';
import { LINEA_120_DEMO_POINTS } from '../data/linea-120-demo';

const VEHICULOS_EN_VIVO = [
  { id: '120-01', place: 'Tiquipaya', status: 'En movimiento', tone: 'lime', color: '#2a9e70', progress: 0.08 },
  { id: '120-04', place: 'Av. Ecológica', status: 'En movimiento', tone: 'blue', color: '#3e7de5', progress: 0.34 },
  { id: '120-07', place: 'Av. América', status: 'Próxima parada', tone: 'amber', color: '#c67c1d', progress: 0.62 },
  { id: '120-12', place: 'La Cancha', status: 'En movimiento', tone: 'purple', color: '#7356cf', progress: 0.9 },
];

// Se usa el mismo RouteMap del panel administrativo: MapLibre + estilo Bright de
// OpenFreeMap, con datos de OpenStreetMap y las capas visuales propias de QUIVO.
const DEMO_ROUTE_POINTS = LINEA_120_DEMO_POINTS.slice(0, 79);
const DEMO_ROUTE: MapRoute = {
  id: 'linea-120-demo',
  label: 'Línea 120 · recorrido de demostración',
  color: '#fd9e15',
  points: DEMO_ROUTE_POINTS,
};
const DEMO_START = DEMO_ROUTE_POINTS[0]!;
const DEMO_END = DEMO_ROUTE_POINTS[DEMO_ROUTE_POINTS.length - 1]!;
const DEMO_STOPS: MapPoint[] = [
  { id: 'demo-tiquipaya', ...DEMO_START, label: 'Tiquipaya', color: '#3226b4', pinType: 'stop' },
  { id: 'demo-la-cancha', ...DEMO_END, label: 'La Cancha', color: '#fd9e15', pinType: 'stop' },
];

function positionAlongRoute(points: MapPoint[], progress: number): { lat: number; lng: number } {
  const first = points[0];
  if (!first) return { lat: 0, lng: 0 };
  const safeProgress = ((progress % 1) + 1) % 1;
  const cursor = safeProgress * (points.length - 1);
  const fromIndex = Math.floor(cursor);
  const toIndex = Math.min(fromIndex + 1, points.length - 1);
  const from = points[fromIndex] ?? first;
  const to = points[toIndex] ?? from;
  const mix = cursor - fromIndex;
  return {
    lat: from.lat + (to.lat - from.lat) * mix,
    lng: from.lng + (to.lng - from.lng) * mix,
  };
}

function DemoLiveMap() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setStep((current) => current + 1), 1800);
    return () => window.clearInterval(timer);
  }, []);

  const markers = useMemo<MapPoint[]>(
    () =>
      VEHICULOS_EN_VIVO.map((vehicle, index) => ({
        id: `demo-${vehicle.id}`,
        ...positionAlongRoute(DEMO_ROUTE_POINTS, vehicle.progress + step * (0.003 + index * 0.00045)),
        label: vehicle.id,
        description: vehicle.place,
        color: vehicle.color,
        // ENTREGA 16 — 'vehicle' (con `estadoFrescura: 'reportando'`, todos "En movimiento" en
        // este demo estático): antes usaba 'pulse', que un fix de code-review le devolvió a su
        // significado original de "nodo pulsante del editor de trazado" — con eso, este demo
        // pedía el sprite `quivo-bus-` (estadoFrescura vacío) en vez de uno real y se quedaba
        // sin marker visible ni clickeable apenas cargaban los sprites de `/en-vivo`.
        pinType: 'vehicle',
        estadoFrescura: 'reportando',
        // FIX web-design-guidelines (hallazgo MEDIA) — `VEHICLE_LABELS_FILTER` exige
        // `placa !== ''`; sin esto la placa (acá, el id del vehículo demo) no se dibujaba.
        placa: vehicle.id,
      })),
    [step],
  );

  return (
    <RouteMap
      className="landing-live-route-map"
      height="100%"
      routes={[DEMO_ROUTE]}
      markers={markers}
      stops={DEMO_STOPS}
      fitMode="once"
      fitKey="linea-120-demo"
      defaultCenter={[-17.37, -66.18]}
      defaultZoom={12}
    />
  );
}

export function FleetPanelPreview({ onOpenDemoModal }: { onOpenDemoModal: () => void }) {
  return (
    <section className="section panel-preview-section live-route-section" id="panel">
      <div className="container">
        <div className="section-header">
          <span className="badge badge-glow-primary"><Radio size={14} />Panel en vivo</span>
          <h2>Tu operación, <span className="gradient-text-accent">en movimiento.</span></h2>
          <p>Así se ve QUIVO Control cuando quieres saber qué vehículos están avanzando ahora mismo.</p>
        </div>

        <div className="live-panel-preview">
          <header className="live-panel-preview__header">
            <div className="live-panel-preview__brand">
              <Image src="/brand/control/logotipo-principal.png" alt="QUIVO Control" width={96} height={44} unoptimized />
              <div><strong>Panel de seguimiento</strong><span>Demostración en vivo</span></div>
            </div>
            <span className="live-panel-preview__signal"><i />EN VIVO <small>Actualizado hace unos segundos</small></span>
          </header>

          <div className="live-panel-preview__metrics" aria-label="Resumen del seguimiento">
            <div><span>UNIDADES ACTIVAS</span><strong>4</strong><small>en movimiento</small></div>
            <div><span>RECORRIDO</span><strong>En curso</strong><small>Tiquipaya ↔ Cochabamba</small></div>
            <div><span>ÚLTIMA SEÑAL</span><strong>Ahora</strong><small>sin retrasos</small></div>
          </div>

          <div className="live-panel-preview__body">
            <div className="live-panel-preview__map" aria-label="Mapa interactivo con trufis en movimiento">
              <div className="live-panel-preview__map-toolbar"><span><Route size={13} />RECORRIDO DE DEMOSTRACIÓN</span><small>4 unidades activas</small></div>
              <div className="live-panel-preview__map-fallback" aria-hidden="true">
                <Image src="/brand/vehicles/cochabamba/mapa-linea-120-route-wide.webp" alt="" width={760} height={460} unoptimized />
              </div>
              <DemoLiveMap />
              <div className="live-map-legend" aria-label="Leyenda del mapa"><span><i className="is-moving" />Vehículos activos</span><span><i className="is-next" />Próxima parada</span></div>
            </div>

            <aside className="live-panel-preview__feed" aria-label="Trufis de la Línea 120 en vivo">
              <div className="live-panel-preview__feed-heading"><div><span>AHORA EN RUTA</span><h3>Trufis en movimiento</h3></div><strong>4</strong></div>
              <div className="live-panel-preview__vehicle-list">
                {VEHICULOS_EN_VIVO.map((vehicle) => (
                  <article className="live-vehicle" key={vehicle.id}>
                    <span className={`live-vehicle__icon is-${vehicle.tone}`}><BusFront size={16} /></span>
                    <div><strong>{vehicle.id}</strong><span><MapPin size={12} />{vehicle.place}</span></div>
                    <small><i />{vehicle.status}</small>
                  </article>
                ))}
              </div>
              <div className="live-panel-preview__updated"><Clock3 size={14} />Los vehículos se actualizan en tiempo real</div>
            </aside>
          </div>

          <footer className="live-panel-preview__footer">
            <span>Vista de demostración · Caso Línea 120</span>
            <button className="btn btn-accent btn-sm" type="button" onClick={onOpenDemoModal}>Quiero verlo en vivo<ArrowRight size={15} /></button>
          </footer>
        </div>
      </div>
    </section>
  );
}
