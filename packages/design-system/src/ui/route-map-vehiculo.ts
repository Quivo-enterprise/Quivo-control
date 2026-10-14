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

export const ICONO_RELOJ = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';

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
