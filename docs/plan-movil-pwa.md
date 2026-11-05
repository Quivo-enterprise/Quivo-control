# Plan: panel admin + En vivo usables en celular, instalable como PWA

## Context
El cliente necesita usar el panel admin (`apps/web`) y la pantalla En vivo desde el celular, e instalarlo como PWA. Hoy:
- Shell: sidebar fijo de 18rem (`packages/design-system/src/styles.css:1355,1364`). El único breakpoint (`:4915`, <960px) lo baja a 13.5rem, así que a 375px quedan unos 190px de contenido. `AdminLayout` (`packages/design-system/src/ui/layout.tsx:18`) no tiene topbar, hamburguesa ni drawer.
- Tablas: `DataTable` (`packages/design-system/src/ui/data.tsx:23`) solo hace scroll horizontal (`.qv-table-wrap`, `styles.css:1207`). Hay `<table>` crudas en reglas, usuarios, sync-errores, reportes, rotaciones y `AuditLog`.
- Modales: `--wide/--xl/--2xl` con 92–96vw y 90vh (`styles.css:996-1010`), sin variante móvil.
- En vivo (`apps/web/app/(dashboard)/en-vivo/`) ya tiene parte del trabajo: breakpoints en 1024 y 720, y un bottom sheet de vehículo. Falta la fase 2c (`docs/plan-en-vivo.md:86,107-110`, `docs/handoff.md:~311`).
- Todo usa `100vh`, sin `dvh` ni safe areas. No hay `export const viewport`, manifest, íconos PNG ni service worker.
- Deploy: Cloud Run `quivo-web` (Next 15.5 standalone). Auth en localStorage, guard del lado del cliente, sin middleware ni CSP.

Decisiones del CTO (5/11):
- Navegación con topbar + drawer.
- Todas las pantallas responsive; `/rutas` en celular es solo lectura.
- PWA instalable, sin modo offline.
- Sin bake-off: se adapta el design system actual.

Breakpoint móvil: **≤720px**, el mismo que ya usa En vivo. Entre 721 y 960px queda el sidebar angosto actual.

## PR A — Fundación: shell móvil + PWA + primitivas
1. **Viewport y metadata** (`apps/web/app/layout.tsx`):
   - `export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: <token de marca> }`.
   - `metadata.appleWebApp = { capable: true, title: 'Quivo Control', statusBarStyle: 'default' }`.
   - `metadata.icons.apple = '/icons/apple-touch-icon.png'`.
2. **Manifest** en `apps/web/app/manifest.ts` (`MetadataRoute.Manifest`):
   - `name`, `short_name` 'Quivo'.
   - `start_url: '/'`, `scope: '/'`, `display: 'standalone'`.
   - `background_color` y `theme_color` tomados de `tokens.css`.
   - Íconos 192, 512 y 512 maskable.
3. **Íconos** en `apps/web/public/icons/` (192, 512, 512 maskable con padding, apple-touch 180), generados una vez desde `apps/mobile/assets/images/icon.png` (1024px) con `sharp` o ImageMagick si ya están en la máquina. Se commitean los PNG, no un script nuevo.
4. **Service worker:** no se agrega. Chrome actual instala con solo el manifest; **no verificado**, se confirma en DevTools > Application > Manifest.
   - Si Chrome exige un SW, se agrega `public/sw.js` vacío, sin handler `fetch` ni cache, para no servir bundles viejos tras un deploy.
5. **Shell móvil** (`AdminLayout` + `apps/web/app/(dashboard)/layout.tsx`). A ≤720px:
   - Topbar sticky con botón hamburguesa (`aria-expanded`, `aria-controls`) y título de la página actual.
   - El `SidebarNav` actual, incluido el footer con el usuario y logout, se reusa como drawer izquierdo con backdrop.
   - El drawer se cierra al cambiar de ruta (`pathname`), con Esc, al tocar el backdrop y con el botón cerrar.
   - `inert` sobre el contenido mientras está abierto, y foco al primer item.
   - En escritorio no cambia nada.
6. **Alturas y safe areas** (`styles.css`, `globals.css`):
   - Cada `100vh` pasa a `height:100vh; height:100dvh` (fallback). Incluye `.qv-live-standalone-shell` (`styles.css:2911-2930`), `/rutas` (`globals.css:1044`, `styles.css:2932`) y el sidebar sticky.
   - `padding: env(safe-area-inset-*)` en la topbar, el drawer y el shell de En vivo.
7. **Modal en móvil:** a ≤720px, todas las variantes ocupan la pantalla completa (`100dvh`), con header sticky y footer con safe-area. Se toca solo CSS, en `overlay.tsx` y `styles.css`.
8. **Tablas apiladas:**
   - `DataTable` agrega `data-label={header}` a cada `<td>`.
   - La clase `.qv-table--stack` pasa, a ≤720px, a una tarjeta por fila con label y valor.
   - La columna de acciones queda al final y con objetivos de 44px.
   - Las `<table>` crudas listadas arriba reciben la misma clase y los `data-label` a mano.
   - **Excepción:** la matriz de rotaciones (`rotaciones/page.tsx:630`) mantiene el scroll horizontal dentro de su wrapper, con la primera columna sticky. Una matriz no se puede apilar.
9. **Enlace a En vivo:** el item del sidebar abre con `target=_blank` (`nav-items.ts`). En una PWA standalone eso sale al navegador, así que ahí navega en la misma ventana (`matchMedia('(display-mode: standalone)')` o ≤720px). En escritorio sigue el `_blank`.

## PR B — En vivo fase 2c (alcance de `docs/plan-en-vivo.md` 2c)
- **Barra compacta a ≤720px** (`barra-mando.tsx`):
  - Una fila con Panel, salud, filtro de línea y botón Flota. El título se oculta.
  - Los chips de nivel y "Siguiente alerta" pasan a una segunda fila con scroll horizontal (`overflow-x:auto`, sin wrap).
  - El `Select` de línea pierde el `min-width: 11rem`.
- **Hojas coordinadas:** Flota (drawer) y vehículo (`.qv-live-cajon`) son excluyentes en móvil. Abrir una cierra la otra.
  - Backdrop y tocar afuera para cerrar en el drawer de Flota.
  - El orden de z-index (12 y 26) se revisa.
- **Objetivos de 44px** también en `.qv-live-estado`, `.qv-live-segmento__op`, `.qv-live-pestana` y `.qv-live-fila`.
- **Colisión de elementos fijos:** los controles del mapa (Seguir, Reencuadrar, Refrescar) bajan a abajo-derecha por encima de la hoja plegada. Los toasts quedan arriba, debajo de la barra. Se verifica que no se pisen con la hoja abierta al 72vh, que pasa a `72dvh`.
- **Google Maps:** confirmar `gestureHandling: 'greedy'` en `packages/design-system/src/ui/route-map-google.tsx`. Si es `cooperative`, el mapa pide dos dedos.
- **Carga:** el poll de 2s ya se pausa con la pestaña oculta (`refetchIntervalInBackground:false`) y no se toca.

## PR C — Barrido de pantallas
Criterio por pantalla a 375px:
- Sin overflow horizontal del documento.
- Formularios en una columna.
- Botones de acción con objetivos de 44px.
- Charts al 100% del ancho.

Pantallas: `/` dashboard, `/salidas` (fila-en-vivo, frecuencias, grupos; diferido en `handoff.md:641`), `/lineas`, `/vehiculos`, `/conductores`, `/socios`, `/sindicatos` (vía `ModuleTablePage`), `/usuarios`, `/reglas`, `/rotaciones`, `/reportes` (+recorridos y detalle), `/auditoria`, `/sync-errores`, `/login`.

**`/rutas` en solo lectura a ≤720px:**
- Mapa y lista de rutas visibles.
- Se ocultan las herramientas de edición y trazado, con el aviso "La edición de trazado está disponible en escritorio".
- Solo se cambia la UI; la API no se toca.

## Ejecución (reglas del CTO)
- Chairman Opus: planifica, revisa los diffs y verifica.
- Toda escritura de código la hacen subagentes `general-purpose` con `model: "sonnet"`: uno por PR, en serie (A antes que B y C, porque B y C dependen del shell y del CSS base).
- Antes de codear: volcar este plan a `docs/plan-movil-pwa.md` con el puntero en `docs/handoff.md` (regla 8).
- Antes de cada commit:
  - `/code-review` y `/ponytail-review` como skills.
  - Gate de UI: `web-design-guidelines` y `impeccable audit`.
  - El hook de Codex corre solo. No hay superficie sensible, así que no lleva `/security-review`.
- Los hallazgos de las revisiones los arregla un Sonnet nuevo.
- Cierre de cada PR: commit, push, PR sin atribución de IA. Mergear solo con `ci` **y** `acceptance` en verde, después actualizar el handoff.

## Verificación
1. **Playwright móvil:**
   - Nuevo project `mobile` en `playwright.config.ts` con `devices['Pixel 7']`, solo Chromium para no sumar WebKit al CI.
   - Spec nuevo `tests/acceptance/mobile.spec.ts`: login, y en cada ruta del dashboard el assert `document.documentElement.scrollWidth <= innerWidth + 1`.
   - El drawer abre y cierra, y cerrarlo devuelve el foco.
   - El modal ocupa la pantalla.
   - En `/rutas` aparece el aviso de solo lectura.
   - Se adjunta una captura por ruta.
   - En vivo: solo layout (barra en una fila, Flota y vehículo excluyentes). Si CI no tiene la key de Maps, se acepta que el mapa no cargue.
2. **Desktop sin regresión:** `admin-panel.spec.ts` existente en verde, más capturas en 1440 y 1280 de shell, En vivo y una tabla.
3. **Unit:** `pnpm --filter @quivo/web test` y los tests del design-system en verde, y `tsc` limpio.
4. **Dispositivo real o emulador:**
   - Emulador Android vía MCP `mobile`, con Chrome apuntando a la web local (`10.0.2.2`).
   - Instalar la PWA, abrir en standalone, hacer login y verificar que se mantiene.
   - Probar el drawer, una tabla apilada, un modal y En vivo con gestos de un dedo.
   - iOS no se puede verificar acá: queda "no verificado". La instalación ahí es manual (Compartir > Agregar a inicio) y el login no pasa del Safari a la PWA.
5. **Lighthouse o DevTools** sobre el manifest: installability sin errores.

## Riesgos y trampas
- Muchos `!important` y `:has()` en `styles.css` y `globals.css`, sobre todo en `/rutas` y en `.qv-admin-layout__content` (`globals.css:1559-1570`). Las reglas móviles van dentro de `@media (max-width:720px)` al final del archivo, sin tocar las de escritorio.
- iOS guarda el localStorage de la PWA aparte del de Safari: hay que loguearse de nuevo tras instalar, e iOS puede borrarlo tras mucho tiempo sin uso. No hay fix sin pasar la sesión a cookies, que queda fuera de alcance.
- Si se cambia el dominio de la web, hay que actualizar `CORS_ORIGIN` y los referrers de la key de Maps.
