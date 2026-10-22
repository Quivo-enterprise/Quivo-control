/**
 * @quivo/design-system — sistema de diseño del panel administrativo (`apps/web`).
 *
 * Reconstruido en el monorepo (QUI-vendorizar-design-system): vivía en un repo hermano
 * (`Design_System_QUIVO`) enlazado por `link:` que se perdió — ver `docs/handoff.md` y
 * `docs/ramas-sprint-m6.md` para el contexto completo. La API pública (nombres, props,
 * clases `qv-*`) se derivó por fidelidad de cada sitio de uso en `apps/web`, no rediseñada.
 *
 * CSS propio, sin Tailwind (`./styles.css`) — la app lo importa con
 * `@import '@quivo/design-system/styles.css'` y conecta `--qv-font-display`/`--qv-font-body`
 * a sus propias fuentes (`next/font/google`). Este paquete no trae `@font-face`.
 */

export * from './types.js';

export * from './ui/primitives.js';
export * from './ui/form.js';
export * from './ui/overlay.js';
export * from './ui/data.js';
export * from './ui/layout.js';
export * from './ui/dashboard.js';
export * from './ui/charts.js';
export * from './ui/RouteMap.js';
export { colorTextoContraste } from './ui/route-map-shared.js';
export { GLIFOS_ESTADO, type EstadoGlifo } from './ui/route-map-vehiculo.js';
