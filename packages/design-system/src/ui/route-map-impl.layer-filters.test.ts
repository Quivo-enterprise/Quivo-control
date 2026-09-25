import { describe, expect, it } from 'vitest';
import type { FilterSpecification } from 'maplibre-gl';
import {
  MARKER_POINTS_FILTER,
  MARKER_POPUP_ANCHOR_FILTER,
  MARKER_PULSE_FILTER,
  VEHICLE_BODY_FILTER,
  VEHICLE_LABELS_FILTER,
} from './route-map-impl.js';

// ENTREGA 16 — regresión del fix de code-review: la Entrega 14 le robó `pinType: 'pulse'` a
// sus consumidores no vehiculares (nodos del editor de trazado en `rutas/page.tsx`, demo de la
// landing en `FleetPanelPreview.tsx`) para dárselo en exclusiva a los vehículos de `/en-vivo`.
// Estos tests evalúan las expresiones REALES que MapLibre corre contra cada feature — un
// mini-intérprete de las pocas operaciones (`get`/`==`/`!=`/`all`/`any`) que usan los filtros
// de este archivo — sin levantar un `Map` (WebGL no está disponible en el entorno de test). Si
// alguien vuelve a fusionar `'pulse'` y `'vehicle'`, o rompe el fallback de un vehículo sin
// `estadoFrescura`, alguno de estos casos falla.
function evaluar(expr: unknown, props: Record<string, unknown>): unknown {
  if (!Array.isArray(expr)) return expr;
  const [op, ...args] = expr as [string, ...unknown[]];
  switch (op) {
    case 'get':
      return props[args[0] as string];
    case '==':
      return evaluar(args[0], props) === evaluar(args[1], props);
    case '!=':
      return evaluar(args[0], props) !== evaluar(args[1], props);
    case 'all':
      return args.every((a) => evaluar(a, props) === true);
    case 'any':
      return args.some((a) => evaluar(a, props) === true);
    default:
      throw new Error(`Operador no soportado en el evaluador de test: ${op}`);
  }
}

function matchea(filter: FilterSpecification, props: Record<string, unknown>): boolean {
  return evaluar(filter, props) === true;
}

const nodoPendiente = { pinType: 'pulse', estadoFrescura: '', placa: '', label: 'Punto marcado' };
const vehiculoReportando = { pinType: 'vehicle', estadoFrescura: 'reportando', placa: 'ABC-123', label: 'ABC-123' };
const vehiculoPerdido = { pinType: 'vehicle', estadoFrescura: 'perdido', placa: 'ABC-123', label: 'ABC-123' };
const vehiculoDetenido = { pinType: 'vehicle', estadoFrescura: 'detenido', placa: 'ABC-123', label: 'ABC-123' };
const vehiculoSinPlaca = { pinType: 'vehicle', estadoFrescura: 'reportando', placa: '', label: '' };
const puntoControl = { pinType: 'stop', estadoFrescura: '', placa: '', label: 'Parada #1' };
const nodo = { pinType: 'node', estadoFrescura: '', placa: '', label: 'Nodo 2' };

describe('MARKER_PULSE_FILTER — el halo animado', () => {
  it('pulsa un pinType "pulse" (nodo del editor/demo de landing) sin importar estadoFrescura', () => {
    expect(matchea(MARKER_PULSE_FILTER, nodoPendiente)).toBe(true);
  });

  it('pulsa un vehículo "reportando"', () => {
    expect(matchea(MARKER_PULSE_FILTER, vehiculoReportando)).toBe(true);
  });

  it('NO pulsa un vehículo "perdido" ni "detenido"', () => {
    expect(matchea(MARKER_PULSE_FILTER, vehiculoPerdido)).toBe(false);
    expect(matchea(MARKER_PULSE_FILTER, vehiculoDetenido)).toBe(false);
  });

  it('NO pulsa un punto de control ni un nodo sin seleccionar', () => {
    expect(matchea(MARKER_PULSE_FILTER, puntoControl)).toBe(false);
    expect(matchea(MARKER_PULSE_FILTER, nodo)).toBe(false);
  });
});

describe('MARKER_POINTS_FILTER — el círculo genérico', () => {
  it('dibuja un pinType "pulse" (nodo del editor/demo de landing) — regresión del bug que lo sacó de acá', () => {
    expect(matchea(MARKER_POINTS_FILTER, nodoPendiente)).toBe(true);
  });

  it('dibuja puntos de control y nodos', () => {
    expect(matchea(MARKER_POINTS_FILTER, puntoControl)).toBe(true);
    expect(matchea(MARKER_POINTS_FILTER, nodo)).toBe(true);
  });

  it('NO dibuja un vehículo — tiene sus propias capas (ícono/fallback)', () => {
    expect(matchea(MARKER_POINTS_FILTER, vehiculoReportando)).toBe(false);
  });
});

describe('VEHICLE_BODY_FILTER — ícono/fallback del vehículo', () => {
  it('dibuja cualquier pinType "vehicle" sin importar estadoFrescura', () => {
    expect(matchea(VEHICLE_BODY_FILTER, vehiculoReportando)).toBe(true);
    expect(matchea(VEHICLE_BODY_FILTER, vehiculoPerdido)).toBe(true);
  });

  it('NO dibuja un pinType "pulse" — regresión del bug que le pedía un sprite inexistente', () => {
    expect(matchea(VEHICLE_BODY_FILTER, nodoPendiente)).toBe(false);
  });

  it('NO dibuja puntos de control ni nodos', () => {
    expect(matchea(VEHICLE_BODY_FILTER, puntoControl)).toBe(false);
    expect(matchea(VEHICLE_BODY_FILTER, nodo)).toBe(false);
  });
});

describe('VEHICLE_LABELS_FILTER — la placa del vehículo', () => {
  it('dibuja la placa de un vehículo con placa', () => {
    expect(matchea(VEHICLE_LABELS_FILTER, vehiculoReportando)).toBe(true);
  });

  it('NO dibuja nada si el vehículo no trae placa', () => {
    expect(matchea(VEHICLE_LABELS_FILTER, vehiculoSinPlaca)).toBe(false);
  });

  it('NO dibuja la placa de un pinType "pulse" aunque tenga "placa" seteada', () => {
    expect(matchea(VEHICLE_LABELS_FILTER, { ...nodoPendiente, placa: 'no-debería-importar' })).toBe(false);
  });
});

describe('MARKER_POPUP_ANCHOR_FILTER — el label genérico (paradas/nodos/punto pendiente)', () => {
  it('dibuja el label de un pinType "pulse" con label — regresión del bug que lo sacó de acá', () => {
    expect(matchea(MARKER_POPUP_ANCHOR_FILTER, nodoPendiente)).toBe(true);
  });

  it('dibuja el label de una parada', () => {
    expect(matchea(MARKER_POPUP_ANCHOR_FILTER, puntoControl)).toBe(true);
  });

  it('NO dibuja el label de un vehículo — usa su propio label siempre visible (quivo-vehicle-labels)', () => {
    expect(matchea(MARKER_POPUP_ANCHOR_FILTER, vehiculoReportando)).toBe(false);
  });

  it('NO dibuja nada sin label, sea cual sea el pinType', () => {
    expect(matchea(MARKER_POPUP_ANCHOR_FILTER, { ...puntoControl, label: '' })).toBe(false);
  });
});
