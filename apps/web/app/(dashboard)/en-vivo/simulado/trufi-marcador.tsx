'use client';

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CornerUpRight,
  RefreshCw,
  TrafficCone,
  TriangleAlert,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  SEVERIDAD_META,
  type EstadoTrufi,
  type FaseTrufi,
  type InfraccionMock,
  type LineaMock,
  type TrufiMock,
} from '../../../../src/lib/mock-flota';

/**
 * Marcador de un trufi sobre el mapa (Decisiones 6/7 del plan original + ampliación del guion
 * delegado, `docs/plan-mock-guion-delegado.md`): foto redonda con marco del color de línea,
 * que además cambia de aspecto según `EstadoTrufi.fase` — en_cola (más chico + pill), atascado
 * (anillo rojo + insignia), desviado (anillo naranja + insignia), sin_senal (foto en gris +
 * "Sin señal · hace m:ss"), sincronizando (spinner + "Sincronizando N puntos…"), finalizado
 * (gris + check). El parpadeo por infracción ACTIVA (Decisión 7 original) sigue funcionando
 * en cualquier fase, superpuesto — nunca con una ya sancionada.
 *
 * Vive dentro de un `overlayMarkers.content` de `RouteMap` — es un `<button>` real, no una
 * feature GeoJSON, así que el click no compite con `onMapClick`.
 */

interface TrufiMarcadorProps {
  trufi: TrufiMock;
  linea: LineaMock;
  estadoTrufi: EstadoTrufi | undefined;
  infraccionActiva: InfraccionMock | undefined;
  seleccionado: boolean;
  /** Total de trufis en la cola de la línea de este trufi — solo relevante con `fase ===
   * 'en_cola'` (ítem 1(a) del guion de fixes: este marcador es el CABEZA de cola, el resto se ve
   * en Salidas). `undefined` fuera de `en_cola`. */
  enColaTotal?: number;
  onClick: () => void;
}

const ICONO_SEVERIDAD = {
  leve: TriangleAlert,
  media: AlertTriangle,
  grave: AlertOctagon,
} as const;

const ETIQUETA_FASE: Record<FaseTrufi, string> = {
  en_cola: 'en cola',
  en_ruta: 'en ruta',
  atascado: 'atascado en tráfico',
  desviado: 'desviado de la ruta',
  sin_senal: 'sin señal',
  sincronizando: 'sincronizando',
  finalizado: 'recorrido finalizado',
};

/** Anillo distinto de `linea.color` solo para las fases donde el guion pide un color de alerta
 * propio (E07 04:32) — el resto (`en_cola`, `sin_senal`, `sincronizando`) se distingue por la
 * foto/pill, no por el anillo, para no perder de vista a qué línea pertenece el trufi. */
const ANILLO_POR_FASE: Partial<Record<FaseTrufi, string>> = {
  atascado: '#dc2626',
  desviado: '#f97316',
  finalizado: '#94a3b8',
};

/** `mm:ss` desde `desdeIso` hasta ahora — usado por el hint "Sin señal · hace m:ss". No usa un
 * `setInterval` propio: el componente ya se vuelve a renderizar cada tick (1 s, ver
 * `en-vivo-simulado.tsx`, cuyo `estado` cambia en cada tick) así que basta con recalcular en
 * cada render. */
function formatearHaceTiempo(desdeIso: string, ahoraMs: number): string {
  const segundos = Math.max(0, Math.floor((ahoraMs - Date.parse(desdeIso)) / 1000));
  const mm = Math.floor(segundos / 60);
  const ss = segundos % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function TrufiMarcador({ trufi, linea, estadoTrufi, infraccionActiva, seleccionado, enColaTotal, onClick }: TrufiMarcadorProps) {
  const severidad = infraccionActiva?.severidad;
  const meta = severidad ? SEVERIDAD_META[severidad] : undefined;
  const IconoSeveridad = severidad ? ICONO_SEVERIDAD[severidad] : undefined;
  const fase = estadoTrufi?.fase ?? 'en_ruta';

  const style: CSSProperties & Record<string, string> = {
    '--qv-marker-line-color': ANILLO_POR_FASE[fase] ?? linea.color,
  };
  if (meta) {
    style['--qv-marker-severity-color'] = meta.color;
    style['--qv-blink-duration'] = `${meta.periodoParpadeoMs}ms`;
  }

  // Ítem 1(a): con más de 1 trufi en la cola de esta línea, este marcador (el CABEZA) representa
  // a TODOS — el `aria-label` lo dice explícito (no solo el pill visual) para que un lector de
  // pantalla no crea que es el único en cola.
  const ocultosEnCola = fase === 'en_cola' && enColaTotal && enColaTotal > 1 ? enColaTotal - 1 : 0;
  const etiquetaCola = ocultosEnCola > 0 ? `, cabeza de cola, ${ocultosEnCola} más detrás (ver Salidas)` : '';
  const etiquetaInfraccion = meta ? `, infracción ${meta.etiqueta.toLowerCase()}` : '';
  // `linea.nombre` a veces ya viene con el prefijo "Línea " (ej. "Línea 120") y a veces no
  // (ej. "Z12") — antepone "Línea " solo cuando hace falta, para no leer "línea Línea 120".
  const nombreLinea = /^línea\s/i.test(linea.nombre) ? linea.nombre : `Línea ${linea.nombre}`;
  const ariaLabel = `Trufi ${trufi.placa}, ${nombreLinea}, ${ETIQUETA_FASE[fase]}${etiquetaCola}${etiquetaInfraccion}`;

  const pill = ocultosEnCola > 0 ? `+${ocultosEnCola} en cola` : renderPill(fase, estadoTrufi);
  const IconoFase = ICONO_FASE[fase];

  return (
    <div className="qv-trufi-marker-wrap">
      <button
        type="button"
        className={[
          'qv-trufi-marker',
          `qv-trufi-marker--fase-${fase}`,
          infraccionActiva ? 'qv-trufi-marker--blink' : '',
          seleccionado ? 'qv-trufi-marker--selected' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={style}
        onClick={(event) => {
          // El `el` que envuelve este botón (el `<div>` del `maplibregl.Marker`, ver
          // `route-map-impl.tsx`) hace `preventDefault()` en `mousedown` para no competir con
          // el paneo/drag del mapa — eso también suprime el foco automático del navegador al
          // hacer click en un botón. Se fuerza el foco a mano para que `TrufiPanel` pueda
          // capturarlo como "elemento a devolver el foco" al cerrarse (ver su `previousFocusRef`).
          event.currentTarget.focus();
          onClick();
        }}
        aria-label={ariaLabel}
        aria-pressed={seleccionado}
      >
        <span className="qv-trufi-marker__ring">
          <img
            className="qv-trufi-marker__photo"
            src={trufi.fotoUrl}
            alt=""
            width={48}
            height={48}
            draggable={false}
          />
          {fase === 'sincronizando' && (
            <span className="qv-trufi-marker__spinner" aria-hidden="true">
              <RefreshCw size={18} strokeWidth={2.5} />
            </span>
          )}
        </span>
        {meta && IconoSeveridad && (
          <span className="qv-trufi-marker__badge qv-trufi-marker__badge--severidad" aria-hidden="true">
            <IconoSeveridad size={12} strokeWidth={2.5} />
          </span>
        )}
        {IconoFase && (
          <span className="qv-trufi-marker__badge qv-trufi-marker__badge--fase" aria-hidden="true">
            <IconoFase size={11} strokeWidth={2.5} />
          </span>
        )}
      </button>
      {pill && (
        <span className={`qv-trufi-marker__pill qv-trufi-marker__pill--${fase}`} aria-hidden="true">
          {pill}
        </span>
      )}
    </div>
  );
}

const ICONO_FASE: Partial<Record<FaseTrufi, typeof TrafficCone>> = {
  atascado: TrafficCone,
  desviado: CornerUpRight,
  finalizado: CheckCircle2,
};

function renderPill(fase: FaseTrufi, estadoTrufi: EstadoTrufi | undefined): string | null {
  switch (fase) {
    case 'en_cola':
      return 'En cola';
    case 'sin_senal':
      return estadoTrufi ? `Sin señal · hace ${formatearHaceTiempo(estadoTrufi.ultimaSenalEn, Date.now())}` : 'Sin señal';
    case 'sincronizando':
      return `Sincronizando ${estadoTrufi?.puntosPendientes ?? 0} puntos…`;
    case 'atascado':
      return 'Atascado';
    default:
      return null;
  }
}
