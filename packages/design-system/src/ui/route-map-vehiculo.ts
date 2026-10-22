// Lógica PURA del marcador de vehículo del motor Google (`route-map-google.tsx`): nivel y
// orden de las alertas por infracción, periodos de parpadeo, nombre accesible y íconos del
// badge. Sin DOM ni React, así se testea en `node`. Docs: docs/plan-en-vivo-alertas.md (PR E).

import type { MapPoint } from '../types.js';

export type NivelAlerta = NonNullable<MapPoint['alerta']>['nivel'];

/** Menor a mayor severidad. Es el orden de `GRAVEDAD_ORDEN` de `@quivo/shared` (este paquete
 * no depende de tipos de dominio). */
export const NIVELES_ALERTA: readonly NivelAlerta[] = ['leve', 'grave', 'gravisima'];

export const PESO_NIVEL_ALERTA: Record<NivelAlerta, number> = { leve: 1, grave: 2, gravisima: 3 };

/** Periodo (ms) de un ciclo completo anillo-de-línea -> color-de-severidad -> anillo-de-línea.
 * Todos por debajo de 3 Hz (WCAG 2.3.1): 600 ms = 1,67 Hz. Mismos valores que `styles.css`. */
export const PERIODO_PARPADEO_MS: Record<NivelAlerta, number> = { leve: 1600, grave: 1000, gravisima: 600 };

const ETIQUETA_NIVEL: Record<NivelAlerta, string> = { leve: 'leve', grave: 'grave', gravisima: 'gravísima' };

export function esNivelAlerta(valor: unknown): valor is NivelAlerta {
  return valor === 'leve' || valor === 'grave' || valor === 'gravisima';
}

/** La alerta es visible solo con un nivel conocido y al menos una infracción abierta o atendida. */
export function alertaVisible(alerta: MapPoint['alerta']): alerta is NonNullable<MapPoint['alerta']> {
  return (
    alerta !== undefined && esNivelAlerta(alerta.nivel) && (alerta.abiertas > 0 || (alerta.atendidas ?? 0) > 0)
  );
}

/** Texto de la alerta para el nombre accesible: "2 infracciones abiertas, gravísima" o, sin
 * abiertas, "1 infracción atendida, grave". */
export function etiquetaAlerta(alerta: MapPoint['alerta']): string {
  if (!alertaVisible(alerta)) return '';
  if (alerta.abiertas > 0) {
    const n = alerta.abiertas;
    return `${n} ${n === 1 ? 'infracción abierta' : 'infracciones abiertas'}, ${ETIQUETA_NIVEL[alerta.nivel]}`;
  }
  const n = alerta.atendidas ?? 0;
  return `${n} ${n === 1 ? 'infracción atendida' : 'infracciones atendidas'}, ${ETIQUETA_NIVEL[alerta.nivel]}`;
}

/** Texto del badge "M" para el nombre accesible. */
export const ETIQUETA_MOLINOS = 'vuelta vía Molinos';

/** `MapPoint.molinos`: `true` = designado a Molinos; número (>= 1) = además, su lugar en la cola. */
export function molinosActivo(molinos: MapPoint['molinos']): boolean {
  return molinos === true || (typeof molinos === 'number' && molinos >= 1);
}

/** Texto del badge: "M" o "M2" (orden en la cola). */
export function textoMolinos(molinos: MapPoint['molinos']): string {
  return typeof molinos === 'number' && molinos >= 1 ? `M${Math.floor(molinos)}` : 'M';
}

/** Nombre accesible: "vuelta vía Molinos" o "vuelta vía Molinos, 2.º en la cola". */
export function etiquetaMolinos(molinos: MapPoint['molinos']): string {
  if (!molinosActivo(molinos)) return '';
  return typeof molinos === 'number' ? `${ETIQUETA_MOLINOS}, ${Math.floor(molinos)}.º en la cola` : ETIQUETA_MOLINOS;
}

/** Orden de apilado del vehículo: seleccionado > gravísima > grave > leve > resto. */
export function zIndexVehiculo(punto: Pick<MapPoint, 'seleccionado' | 'alerta'>): number {
  if (punto.seleccionado) return 1400;
  if (alertaVisible(punto.alerta)) return 1000 + PESO_NIVEL_ALERTA[punto.alerta.nivel] * 100;
  return 1000;
}

// Lucide (ISC): circle-alert / triangle-alert / octagon-alert / clock. Una FORMA distinta por
// nivel: la severidad no depende solo del color.
export const ICONO_NIVEL: Record<NivelAlerta, string> = {
  leve: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  grave:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  gravisima:
    '<path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};

/** Insignia de estado del marcador: una FORMA por estado (viewBox 28, mismas de la Propuesta B de
 * `/en-vivo`). Los colores salen de clases CSS (`.qv-gmap-g-*`, `styles.css`) y no de `style=""`:
 * así no choca con una CSP sin `unsafe-inline`. f = relleno del estado, s = trazo del estado,
 * i = tinta sobre el relleno, p = fondo (superficie). Sin `sin_datos` en la tabla de íconos del
 * mapa (no tiene fix, no se dibuja), pero la forma existe para la leyenda y el panel. */
export type EstadoGlifo = 'reportando' | 'detenido' | 'perdido' | 'sin_datos' | 'finalizado' | 'en_pausa';

export const GLIFOS_ESTADO: Record<EstadoGlifo, string> = {
  reportando: '<circle cx="14" cy="14" r="12" class="qv-gmap-g-f"/><path d="M14 7l5 13-5-3-5 3z" class="qv-gmap-g-i"/>',
  detenido:
    '<rect x="2" y="2" width="24" height="24" rx="5" class="qv-gmap-g-f"/><rect x="9" y="9" width="10" height="10" rx="1.5" class="qv-gmap-g-i"/>',
  perdido:
    '<path d="M14 3 26.5 25h-25z" stroke-linejoin="round" stroke-width="2" class="qv-gmap-g-f qv-gmap-g-s"/><path d="M14 11v6" fill="none" stroke-width="2.6" stroke-linecap="round" class="qv-gmap-g-is"/><circle cx="14" cy="21" r="1.5" class="qv-gmap-g-i"/>',
  finalizado:
    '<circle cx="14" cy="14" r="11" stroke-width="2.6" class="qv-gmap-g-p qv-gmap-g-s"/><path d="M9 14.5l3.5 3.5 6.5-7" fill="none" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" class="qv-gmap-g-s"/>',
  en_pausa:
    '<path d="M8 3h12l7 11-7 11H8L1 14z" class="qv-gmap-g-f"/><rect x="10" y="9" width="3" height="10" rx="1" class="qv-gmap-g-i"/><rect x="15" y="9" width="3" height="10" rx="1" class="qv-gmap-g-i"/>',
  sin_datos:
    '<circle cx="14" cy="14" r="11" stroke-width="2.6" stroke-dasharray="3.4 3" class="qv-gmap-g-p qv-gmap-g-s"/><path d="M11 11.5a3 3 0 1 1 5.2 2c-1 1-2.2 1.5-2.2 3" fill="none" stroke-width="2.4" stroke-linecap="round" class="qv-gmap-g-s"/><circle cx="14" cy="20.5" r="1.4" class="qv-gmap-g-f"/>',
};

export function esEstadoGlifo(estado: unknown): estado is EstadoGlifo {
  return typeof estado === 'string' && Object.hasOwn(GLIFOS_ESTADO, estado);
}

/** SVG de la insignia de estado (sale de constantes del módulo: sin datos del usuario). */
export function svgGlifoEstado(estado: EstadoGlifo): string {
  return `<svg class="qv-gmap-veh__estado-svg" aria-hidden="true" focusable="false" viewBox="0 0 28 28">${GLIFOS_ESTADO[estado]}</svg>`;
}

/** SVG inline de un ícono lucide (sale de las constantes de arriba: sin datos del usuario). */
export function svgIcono(nodos: string, clase: string): string {
  return (
    `<svg class="${clase}" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${nodos}</svg>`
  );
}

/** URL de foto normalizada (sin espacios en los bordes); `null` si no hay. Es el ÚNICO valor que
 * se usa para decidir si hay foto, para marcarla como fallida y para `img.src`. */
export function normalizarFotoUrl(url: string | null | undefined): string | null {
  const limpia = url?.trim();
  return limpia ? limpia : null;
}

/** URLs de foto que ya fallaron (`onerror`): no se reintentan al recrear el contenido, así un
 * 404 no entra en un ciclo carga-falla en cada poll. */
const fotosFallidas = new Set<string>();
export function marcarFotoFallida(url: string): void {
  const limpia = normalizarFotoUrl(url);
  if (limpia) fotosFallidas.add(limpia);
}
export function fotoUsable(url: string | null | undefined): boolean {
  const limpia = normalizarFotoUrl(url);
  return limpia !== null && !fotosFallidas.has(limpia);
}
