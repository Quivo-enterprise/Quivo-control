# Plan: flota mockeada en `/en-vivo` (panel web), en la copia sandbox

## Contexto
El CTO quiere hacer una demo de funcionalidades nuevas en el mapa en vivo del panel web sin tocar el proyecto real. Por eso se trabaja en la copia `~/Downloads/Quivo-control`, rama `mock/sandbox`, que no tiene remote. Estas son las funcionalidades:
- 3 trufis mockeados. Cada uno se ve como una **foto en marco redondo** en lugar del ícono verde actual.
- El borde del marco lleva el color de la línea: **azul para "Z12"** (ese nombre exacto) y **blanco para "Línea 120"**.
- El marco **parpadea** según la infracción: amarillo = leve, naranja = media, rojo = grave.
- Al hacer click en un trufi se abre su ficha, con:
  - placa y conductor;
  - **asignar siguiente parada**;
  - **revisar la infracción**: acciones según el tipo de infracción; se elige una y se aplica ya o con plazo de hasta 1 mes;
  - **botón de WhatsApp**.
- **Panel de simulación** con botones que disparan infracciones en 1, 2 o 3 trufis.

Lo que existe hoy en el código, verificado por exploración:
- **Mapa:** MapLibre GL 5 (`packages/design-system/src/ui/route-map-impl.tsx`). El ícono verde es un **sprite SVG rasterizado** dentro de un symbol layer (`VEHICULO_ICONOS`, ~L364-458, `icon-image` L1011). Ahí no se puede meter una foto con borde que parpadee con CSS, así que hacen falta **marcadores DOM**.
- **Página:** `apps/web/app/(dashboard)/en-vivo/page.tsx` (765 líneas) hace polling con `usePosicionesEnVivo` (`src/lib/en-vivo/use-en-vivo.ts`) cada 5 s. El panel de detalle es bespoke, inline en la misma página.
- **Kit de UI:** `@quivo/design-system` propio, sin Tailwind, shadcn ni Radix. Trae `Modal`/`ConfirmDialog` (`overlay.tsx`) y `Select`/`DatePicker` (`form.tsx`). Íconos con `lucide-react`. No hay librería de toasts: los "toasts" son `div.qv-live-toast` dentro de `aria-live`.
- **Mocks:** el web no tiene ningún mecanismo. Lo único parecido es `NEXT_PUBLIC_DEV_BYPASS_AUTH` (`src/lib/auth/auth-context.tsx`), que solo simula el login.
- **Dominio real:**
  - `Linea.color` existe. En el seed, la 120 es `#0f766e`; el mock ignora ese valor y usa los colores que pidió el CTO.
  - El enum de gravedad real es `leve|grave|gravisima` (`packages/shared/src/enums/estados.ts:59`). El mock usa `leve|media|grave`, como pidió el CTO, y no toca el enum compartido.
  - `Sancion` no tiene fecha de plazo. `Conductor` no tiene teléfono. `Vehiculo` no tiene foto. No existe el concepto de "siguiente parada".
  - Todo eso queda **solo en el mock**: no se toca Prisma, la API ni `packages/shared`.

## Decisiones
1. **Flag `NEXT_PUBLIC_MOCK_FLOTA=true`**.
   - Con el flag prendido, `/en-vivo` renderiza `<EnVivoSimulado/>` en vez de la vista real.
   - La vista real no se modifica: el flag solo agrega un `if` al principio de `page.tsx`.
   - En modo mock no se pide nada a la API, así que la demo corre **sin backend** usando `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`.
2. **Marcadores DOM genéricos en el design-system**.
   - Nueva prop opcional `overlayMarkers?: { id; lat; lng; content: ReactNode; onClick? }[]` en `RouteMapProps`.
   - Cada marcador es un `maplibregl.Marker` con un `div` propio, y React renderiza dentro con `createPortal`.
   - Los marcadores se agregan, actualizan y eliminan por `id`, y se limpian en el unmount.
   - Es aditivo: nada de lo existente cambia de comportamiento.
3. **Estado del mock en el cliente**.
   - `useReducer` + Context en `src/lib/mock-flota/`, sin dependencias nuevas y en memoria. Recargar la página resetea todo, lo cual está bien para una demo.
   - Los trufis **se mueven** interpolando sobre la polilínea de su línea (tick de 1 s, con botón de pausa).
4. **Datos mock**:
   - 3 trufis: **2 de Z12 y 1 de la Línea 120**, con placa, conductor, número interno y foto.
   - La geometría se aproxima: la de Z12 sale de los waypoints de `scripts/cargar-circuito-z12.ts` (Villa Armonía → Univalle → Salomón) y la de la 120 es una ruta aproximada. Para cada línea hay unas 6-8 paradas con nombre.
5. **Fotos**: se buscan en web fotos reales de trufis de la 120 y de Z12 (Cochabamba). Se descargan a `apps/web/public/mock/trufis/{z12-1,z12-2,l120-1}.jpg`, recortadas y comprimidas a unos 256 px. Si no aparece una foto específica de una línea, se usa una de un trufi cochabambino genérico y se avisa.
   - **Caveat:** son fotos de terceros sin licencia, así que sirven solo para una demo interna y temporal. Además, las placas que se vean en las fotos no van a coincidir con las mockeadas.
6. **Colores**:
   - Z12 azul `#2563eb`; 120 blanco `#ffffff`.
   - El blanco sobre las teselas claras de OpenFreeMap casi no se ve. Por eso todos los marcadores llevan un anillo exterior oscuro de 1 px + sombra, lo que no cambia el color de la línea.
   - Severidad: leve `#facc15`, media `#f97316`, grave `#dc2626`, alineados con `docs/categorizacion-colores-y-estados.md` si ahí hay tokens equivalentes.
7. **Parpadeo**:
   - Un keyframe CSS alterna el borde entre el color de la línea y el color de la severidad, con halo.
   - Velocidad según gravedad: leve lento (1.6 s), media (1.0 s), grave rápido (0.6 s).
   - Con `prefers-reduced-motion`: sin animación. El anillo queda fijo en el color de la severidad.
   - **Badge con ícono** de severidad, para que la información no dependa solo del color.
   - Al aplicar una acción, la infracción pasa a "sancionada" y **se deja de parpadear**.
8. **Catálogo de infracciones y acciones**. Es mock y los valores son inventados; el CTO los ajusta en un archivo:
   - leve: *Parada fuera de lugar*, *Retraso de frecuencia*. Acciones: llamada de atención verbal, amonestación escrita.
   - media: *Desvío de ruta*, *Exceso de pasajeros*. Acciones: multa Bs 100, suspensión 1 día.
   - grave: *Exceso de velocidad*, *Conducción temeraria*. Acciones: multa Bs 300, suspensión 3 días, retiro temporal de la línea.
   - Cada acción se aplica de una de dos formas:
     - **"Aplicar ahora"**;
     - **"Con plazo"**, con `DatePicker` limitado a hoy…hoy+30 días. La acción queda "pendiente hasta dd/mm".
9. **WhatsApp**:
   - Números **ficticios** `5917000000{1,2,3}`, por decisión del CTO. **Riesgo aceptado:** wa.me puede abrir el chat de una persona real.
   - El botón abre `https://wa.me/<n>?text=<mensaje con placa, línea e infracción>` en una pestaña nueva (`rel="noopener noreferrer"`).
   - Se reusa el patrón de `buildDemoRequestWhatsAppUrl` (`apps/api/src/modules/demo-requests/demo-requests.service.ts`), reescrito en el web.
10. **Panel de simulación**. Es flotante y colapsable, con estos controles:
    - botones **"Infracción en 1 / 2 / 3 trufis"**, que eligen trufis al azar entre los que no tienen infracción activa;
    - un selector de severidad: Aleatoria / Leve / Media / Grave;
    - **"Limpiar infracciones"** y **"Pausar/Reanudar movimiento"**;
    - un contador de infracciones activas.

## Archivos
**Design-system (1 cambio aditivo)**
- `packages/design-system/src/ui/route-map-impl.tsx`: prop `overlayMarkers` más un effect que sincroniza los `maplibregl.Marker`.
- Test nuevo `packages/design-system/src/ui/route-map-overlay-markers.test.ts(x)`: prueba el diff por id (agregar, mover, eliminar).

**Web: módulo mock nuevo `apps/web/src/lib/mock-flota/`**
- `datos.ts`: trufis, líneas (color, nombre, polilínea, paradas) y números de WhatsApp.
- `catalogo-infracciones.ts`: tipos por severidad, acciones por tipo y colores.
- `estado.ts`: tipos, reducer y acciones (`tick`, `simularInfracciones(n, severidad)`, `limpiar`, `asignarParada`, `aplicarAccion(ahora|plazo)`, `togglePausa`), más un Context/Provider.
- `geometria.ts`: interpolación sobre la polilínea (posición según avance).
- `whatsapp.ts`: construye la URL de `wa.me`.
- Tests con Vitest de `estado.ts`, `geometria.ts` y `whatsapp.ts`.

**Web: UI nueva `apps/web/app/(dashboard)/en-vivo/simulado/`**
- `en-vivo-simulado.tsx`: `RouteMap` con `routes` (las 2 líneas en su color), `stops` y `overlayMarkers`.
- `trufi-marcador.tsx`: foto redonda, borde de línea, clase de parpadeo, badge y `button` accesible con `aria-label`.
- `trufi-panel.tsx`:
  - panel lateral con foto, placa, línea, conductor y siguiente parada (`Select` de las paradas de la línea más "Asignar");
  - sección de infracción: tipo, severidad y hora; acciones como radio; "Ahora / Con plazo" + `DatePicker`; confirmar;
  - historial de acciones aplicadas;
  - botón de WhatsApp.
- `panel-simulacion.tsx`
- `simulado.css`: keyframes, `prefers-reduced-motion` y tokens del design-system.
- `apps/web/app/(dashboard)/en-vivo/page.tsx`: solo el `if (process.env.NEXT_PUBLIC_MOCK_FLOTA === 'true') return <EnVivoSimulado/>` al principio. Las reglas de hooks se respetan poniendo el branch en un wrapper, no a mitad del componente.
- `apps/web/public/mock/trufis/*.jpg`
- `apps/web/.env.local` (copia): agregar `NEXT_PUBLIC_MOCK_FLOTA=true` y `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`.

## Ejecución (el chairman orquesta; todo el código lo escribe Sonnet)
1. Salir de plan mode y guardar este plan en `docs/plan-mock-flota-en-vivo.md` + agregar el puntero en `docs/handoff.md` de la copia.
2. En paralelo:
   - **Sonnet A**: `overlayMarkers` + su test.
   - **Sonnet B**: módulo `mock-flota` + tests. Buscar y descargar las fotos (WebSearch/WebFetch) y comprimirlas.
3. **Sonnet C**: la UI (marcador, panel, simulación y CSS) + el cableado en `page.tsx`. Usa las interfaces de A y B. Por la regla 7, es un camino único con `impeccable` (`shape`) y tokens del design-system.
4. Verificación del chairman (ver abajo), después `/code-review` + `web-design-guidelines`. Los hallazgos los corrige un Sonnet nuevo.
5. Commit en `mock/sandbox`. **Sin push ni PR**: la copia no tiene remote a propósito, así que las reglas 3 y 4 no aplican.

## Verificación
- `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test`, más `pnpm --filter @quivo/design-system test`.
- Levantar `next dev --port 3110` en la copia, que no choca con el 3000/3100 del original. Solo necesita `NEXT_PUBLIC_MOCK_FLOTA=true` y `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`; no hace falta backend.
- Playwright MCP sobre `/en-vivo`. Chequear:
  - 3 fotos redondas: 2 con borde azul y 1 blanco con contorno oscuro visible;
  - que se mueven;
  - "Infracción en 2" deja 2 parpadeando con el color correcto y el badge;
  - click en un trufi: se ve el panel con la placa;
  - asignar parada;
  - aplicar una acción "Con plazo": el `DatePicker` no deja pasar de hoy+30 y el parpadeo se detiene;
  - WhatsApp: el `href` es `wa.me/5917000000X?text=…`;
  - "Limpiar" resetea;
  - con reduced motion emulado (`browser_emulate_media`) no hay animación.
- Screenshots con puppeteer para el CTO.
- Chequeo del flag apagado: `/en-vivo` real renderiza igual que antes (estado de error sin backend, sin crash).
