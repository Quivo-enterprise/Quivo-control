# Plan: Quivo Control móvil — escala + rediseño foco (fase 2 del plan móvil)

## Context
Las fases A, B y C (#295–#297, `docs/plan-movil-pwa.md`) hicieron el panel *responsive*: entra en el celular, pero se ve como una "mini versión" del escritorio. Texto de 13–14px, tablas densas, menú hamburguesa.

El CTO pide dos cosas:
1. Escala general ya.
2. Rediseño pensado para el celular de las tareas que el cliente hace desde el teléfono:
   - Monitorear En vivo.
   - Sanciones y alertas.
   - Salidas / fila.
   - Consultas rápidas.
   - Cambiar la **frecuencia base permanente** de la terminal.

Decisiones del CTO (5/11):
- Alcance "Escala + rediseño foco".
- Pestañas abajo: **Hoy · En vivo · Salidas · Alertas · Más**.
- La frecuencia que se edita es la base permanente (`PUT /salidas/:pc/base`), no la regla del día.

Hallazgos de la exploración:
- **No hay `html{font-size}`** y casi todo es rem: unos 452 `fontSize` inline en TSX y unos 106 literales CSS. Una sola regla escala todo.
- **Los inputs son de 14px**: iOS hace zoom al enfocarlos.
- **No existe una lista de "infracciones de hoy"** entre vehículos: solo se ven por sesión, en el cajón de En vivo. Hace falta un endpoint nuevo.
- **`/salidas` y `/reglas` nunca entraron al barrido móvil.** La fila tiene 3 botones por tarjeta.
- **El operador queda encerrado en `/en-vivo`:** sin AdminLayout, solo puede salir con "Salir", que cierra sesión.
- **`/conductores` muestra el teléfono como texto**: no es un link `tel:` ni de WhatsApp.
- **El dashboard no tiene nada "de hoy".** Solo muestra KPIs de padrón.

## PR D — Escala móvil (independiente; va primero)
- `packages/design-system/src/styles.css`, al final del bloque ≤720:
  - `html { font-size: 112.5% }` (18px base).
  - `.qv-input__control, .qv-select-trigger, .qv-textarea { font-size: max(16px, var(--qv-text-sm)) }`.
- Revisar después del bump:
  - Overflow: con la base más grande entran menos rem en 412px. `mobile.spec` ya lo valida por ruta.
  - El HUD de `/rutas`: `calc(100dvh - 3.5rem)` sigue siendo coherente porque todo es rem.
  - Íconos y puntos en px, que no escalan; mirar `lineas` y `reglas`.
- Sumar al barrido `/salidas` y `/reglas` en `mobile.spec`, que hoy los cubre solo el chequeo de overflow.
- Cierre: rebuild del design-system, acceptance y las revisiones de siempre.

## Bake-off de dirección (regla 7.b, caso "app móvil")
1. Lookup `ui-ux-pro-max` ("operations dashboard transit mobile"). Brief compartido:
   - Tokens actuales (`tokens.css`).
   - Fuentes Oxanium y Montserrat.
   - Morado de marca `--qv-color-primary`.
   - Uso en la calle, a una mano y con sol.
2. Dos propuestas en paralelo (2 subagentes Sonnet):
   - **A:** `redesign-existing-projects` + `high-end-visual-design`.
   - **B:** `impeccable shape` → `new-work`.
3. Cada una es un mock HTML en marco de teléfono con 5 pantallas:
   - Pestañas.
   - **Hoy:** resumen del día, búsqueda y llamar.
   - **En vivo:** mapa y hoja.
   - **Alertas:** infracciones de hoy y sancionar.
   - **Salidas:** fila con acciones grandes y frecuencia base.
4. Se publican como 2 Artifacts (skill `artifact-design`). El CTO elige A, B o un híbrido.
5. Se vuelcan los tokens ganadores en `docs/plan-movil-rediseno.md`.

## PR E — Shell: pestañas abajo (≤720)
- `packages/design-system/src/ui/layout.tsx` (`AdminLayout`):
  - Nueva prop `mobileTabs` (items con href, label, icono y activo).
  - A ≤720 se renderiza `nav.qv-tabbar`, fijo abajo con safe-area, y la hamburguesa se va.
  - "Más" abre el drawer actual. Se reusa todo: Escape, `inert` y foco.
- `apps/web/app/(dashboard)/layout.tsx`:
  - Pestañas filtradas por rol desde `src/lib/nav-items.ts`. El operador no tiene "Hoy" y empieza en En vivo.
  - Rutas nuevas: `/hoy` (o el dashboard con vista móvil, a decidir según el comp) y `/alertas`.
- `/en-vivo`: hoy salta el AdminLayout (`layout.tsx:81`). Hay que sumarle la tabbar sin romper el mapa a pantalla completa:
  - La barra de mando y la hoja suben sobre la tabbar con `--qv-tabbar-h`.
  - "Salir" pasa a "Más".
- El padding inferior del contenido pasa a usar `--qv-tabbar-h`.

## PR F — Salidas móvil
- `apps/web/app/(dashboard)/salidas/` (`fila-en-vivo.tsx`, `frecuencias-panel.tsx`, `page.tsx`), a ≤720:
  - Fila como lista de tarjetas grandes: posición, placa, cuenta regresiva.
  - Acción primaria **Despachar** a todo el ancho. "Al final" y "Retirar" van en un menú secundario.
  - La confirmación de salida temprana se mantiene.
- La frecuencia base sube arriba como control rápido: stepper − N min + y "Guardar" sobre `fijarBase`. Endpoint sin cambios: `PUT /salidas/:pc/base`.
- Grupos queda igual, al final.

## PR G — Alertas (infracciones y sanciones de hoy)
- **API, endpoint nuevo:**
  - `GET /reportes/en-vivo/infracciones?fecha=hoy` en `apps/api/src/modules/reportes/en-vivo.controller.ts`, mismo módulo que `GET /reportes/en-vivo/:id/infracciones`.
  - Infracciones abiertas y atendidas de las sesiones del día, con scope por sindicato igual que el resto de `/reportes/en-vivo`.
  - Schema en `packages/shared`.
  - Test e2e de scope: un admin de sindicato no ve otro sindicato.
  - `/security-review`, porque es un endpoint nuevo.
- **Web:** página `/alertas`:
  - Lista agrupada por nivel, con chips.
  - Por tarjeta: Ver en mapa (`/en-vivo?sesion=`), Atender, Descartar, Sancionar.
  - Reusa `modal-sancionar.tsx` (a pantalla completa en móvil) y el `PATCH /infracciones/:id` existente.
  - Sanciones pendientes enlazadas a `/reglas`.

## PR H — Hoy (consultas rápidas)
- Vista **Hoy** a ≤720:
  - KPIs del día: en servicio, inactivos, alertas abiertas, sanciones pendientes. Reusa `useJornadasHoy`, el resumen de posiciones y `GET /sanciones?estado=pendiente`.
  - Búsqueda unificada de placa o conductor sobre `vehiculosApi.listar` y `conductoresApi.listar`.
  - Resultado con estado y botones **Llamar** (`tel:`) y **WhatsApp**. Reusa `formatearTelefonoBolivia` y la lógica de contacto de `panel-vehiculo.tsx`.
- `/conductores`: el teléfono pasa a link `tel:`.

## Orden y ejecución
- **D** (ya, sin esperar el bake-off), luego **bake-off → elige el CTO**, luego **E**, luego **F / G / H**. F, G y H van en serie para no chocar con el CSS.
- Este plan se guarda en `docs/plan-movil-rediseno.md`, con el puntero en el handoff (regla 8).
- El chairman (Opus) diseña y revisa. Todo el código lo escribe Sonnet.
- Por PR:
  - `/code-review` y `/ponytail-review`.
  - `web-design-guidelines` e `impeccable audit`.
  - `/security-review` en G.
  - Merge con `ci` y `acceptance` en verde, y después handoff.

## Verificación
- `mobile.spec` (Pixel 7):
  - Overflow 0 en todas las rutas.
  - La tabbar aparece y "Más" abre el drawer.
  - Salidas: despachar con la fila sembrada.
  - Alertas: la lista carga; el estado vacío se ve en CI.
  - Hoy: la búsqueda devuelve una placa sembrada.
  - Los inputs miden 16px o más.
- Escritorio sin regresión: `admin-panel.spec`.
- Capturas a 412 y 1440 para el CTO.
- Unit: web, design-system y API (con un test del endpoint nuevo). `tsc` limpio.
- Emulador Android: Chrome con `adb reverse tcp:3000/3002` (localhost es un contexto seguro).
  - Instalar la PWA y abrir en standalone.
  - Recorrer las 5 pestañas a una mano.
- iOS: no verificable acá; queda "no verificado".

## Riesgos
- **Escala 112.5%:** pantallas densas (lineas, reglas) pueden volver a desbordar, y los px no escalan. Se mitiga con el chequeo de overflow por ruta.
- **Tabbar en `/en-vivo`:** compite con la hoja del vehículo y los controles del mapa. Hay que revisar los z-index (tabbar debajo de los modales, que están en 1000).
- **Endpoint nuevo:** riesgo de filtrar infracciones entre sindicatos. Por eso el test de scope y el security-review.
- **Base permanente editable desde el celular:** queda auditada (`fijar_frecuencia_base`). Pide confirmación porque afecta todos los días.

## Decisión del bake-off (2026-11-05)
Comps: [`docs/movil-comps/propuesta-a.html`](movil-comps/propuesta-a.html) ("Despacho de Alto Contraste", taste-skill) y [`propuesta-b.html`](movil-comps/propuesta-b.html) ("Señalética de garita", impeccable), con su `.png`.

**El CTO eligió un híbrido B + A.** La base es B:
- Placas dibujadas como placa: borde grueso, Oxanium.
- Estado con color **y** forma: círculo, rombo, cuadrado.
- En el mapa, cada trufi con su placa en una píldora del color de estado.
- Las acciones primarias siempre en morado (Sancionar incluido).
- Cuenta regresiva de Salidas de 44px, con Despachar a todo el ancho y el menú ⋮ para Al final/Retirar.
- Hoja de En vivo con cierre ✕.
- Base de texto ≥16px y bordes de 1,5–2,5px en lugar de sombras suaves.

De A se toma el **resumen del día arriba en Hoy**: cuadros de En servicio, Inactivos, Alertas abiertas (con graves) y Sanciones pendientes, antes del buscador.

Los tokens y medidas concretas se leen de `propuesta-b.html` al implementar el PR E.
