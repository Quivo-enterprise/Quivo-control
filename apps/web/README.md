# @quivo/web

Next.js (App Router) — panel administrativo. Consume `@quivo/design-system`, un paquete
de un repo hermano (`/home/jairomgr/Proyectos/Web/Design_System_QUIVO`), enlazado vía
`link:` en `package.json` (symlink real, no copia).

## Requisito de entorno

Este `link:` asume que `Design_System_QUIVO` existe en `../../../../Web/Design_System_QUIVO`
relativo a esta carpeta (es decir, como hermano de `QUIVO-Control/` en `~/Proyectos/Web/`).
Si el repo del design system no está en esa ruta en otra máquina, hay que ajustar la ruta
en `package.json` o migrar a un paquete publicado/tarball.

## Estilos: Tailwind + `@quivo/design-system`

- `@quivo/design-system` trae su propio CSS (`styles.css`/`tokens.css`, clases `qv-*`,
  variables `--qv-*`) — **no usa Tailwind internamente**.
- Tailwind (v4) está disponible en esta app para composición de página (grillas, spacing,
  responsive) donde el design system no tiene un primitivo — pero para cualquier cosa
  visual/de marca (botones, cards, inputs, layouts) usar los componentes del design system,
  no reconstruirlos con clases de Tailwind.
- `app/globals.css` importa Tailwind primero y el design system después (para que sus
  clases `qv-*` no queden pisadas por el `preflight` de Tailwind).
- Las fuentes (`Oxanium`/`Montserrat`) las carga esta app con `next/font/google`
  (`app/layout.tsx`) y sobreescribe `--qv-font-display`/`--qv-font-body` en `globals.css` —
  el paquete del design system no trae `@font-face` propio.

## Auth (QUI-227) — estado actual

El backend real de auth (`POST /v1/auth/login`, `POST /v1/auth/refresh`, QUI-219)
**todavía no existe** (solo hay un `AuthModule` vacío en `apps/api`). `src/lib/auth/api-client.ts`
ya llama a ambos endpoints con el contrato correcto, pero fallarán hasta que QUI-219 esté
implementado (probado en Chrome real: `Failed to fetch` al intentar login, manejado sin
romper la UI).

Para poder navegar el dashboard mientras tanto, hay un **bypass de desarrollo**:

```bash
cp .env.example .env.local   # trae NEXT_PUBLIC_DEV_BYPASS_AUTH=true
```

`auth-context.tsx` solo lo respeta si `NODE_ENV !== "production"` — no tiene efecto en
un build de producción aunque la env var quede seteada por error.

### Manejo de sesión/refresh

`auth-context.tsx` guarda `accessToken` + `refreshToken` (en `localStorage`, clave
`quivo.session`) y programa un refresh automático leyendo el `exp` del JWT
(`src/lib/auth/jwt.ts`, decodificación sin verificar firma — solo para UX, la API
verifica la firma real). El refresh se dispara 30s antes de expirar
(`REFRESH_MARGIN_MS`); si `POST /v1/auth/refresh` falla, la sesión se cierra. El token
de bypass de desarrollo es opaco (no es un JWT), así que no programa refresh.

### Guard por rol en rutas

`RequireAuth` (`src/components/require-auth.tsx`) hace dos chequeos: sesión activa
(igual que antes) y, si hay sesión, que el rol del usuario tenga acceso a la ruta actual
según `NAV_ITEMS` (`src/lib/nav-items.ts` → `isRouteAllowedForRole`). Si no tiene acceso
(ej. `admin_sindicato` navegando directo a `/sindicatos` por URL, no por el menú) se
redirige a `/`. Rutas que todavía no existen como página (todo excepto `/` y `/login`,
hasta M1) no se bloquean acá — no hay ítem de navegación que matchee.

### Demo navegable de los módulos (Sindicatos, Socios, Vehículos, etc.)

Los 8 módulos con CRUD real futuro (Sindicatos QUI-220, Socios QUI-221, Vehículos
QUI-222, Conductores QUI-223, Líneas QUI-224, Rutas QUI-229, Rotaciones QUI-233, Reglas
en M4) tienen una página de demo bajo `app/(dashboard)/<módulo>/`, todas montadas sobre
`src/components/module-table-page.tsx` (`ModuleTablePage`): `PageHeader` + búsqueda +
`DataTable` + alta/edición en `Modal`+`FormGroup` + borrado con `ConfirmDialog`, todo con
componentes de `@quivo/design-system`. Los datos de partida están en
`src/lib/demo-data.ts` (arrays en memoria, sin backend).

**Importante — es un demo sin persistencia:** los cambios (alta/edición/borrado) viven en
`useState` de `ModuleTablePage`, no pegan contra ninguna API ni base de datos. Se pierden
al recargar la página. El CRUD real llega módulo por módulo con las issues de M1
referenciadas arriba, contra `packages/db` (Prisma, QUI-217) y `apps/api`.

`Auditoría` y `Reportes` quedan de solo lectura (no tiene sentido un alta manual de logs
de auditoría o de reportes agregados) — usan `AuditLog` y `DataTable` directo, sin
`ModuleTablePage`.

Para agregar un módulo nuevo al mismo patrón: definir el tipo de fila en
`demo-data.ts`, armar `columns: DataColumn<T>[]` (con `render` para badges) y
`fields: EntityFieldConfig[]` (para el formulario del modal), y pasarlos a
`<ModuleTablePage<T> />` junto con `entityLabel` (singular, minúscula) y
`createDefaults`. La página en sí debe llevar `'use client'` — pasarle a `ModuleTablePage`
(un client component) `columns` con funciones `render`/`actions` desde un Server
Component no es serializable y rompe el build de producción.

## Agregar componentes faltantes al design system

Si una página necesita un componente o una variante que no existe en
`@quivo/design-system`, se agrega directo en
`Design_System_QUIVO/packages/design-system/src/ui/`, se exporta desde `src/index.ts`, y
se corre `pnpm --filter @quivo/design-system build` **en ese repo** (regenera `dist/`).
Como es un symlink, no hace falta reinstalar nada en `quivo-control`.

## Comandos

```bash
pnpm --filter @quivo/web dev          # next dev
pnpm --filter @quivo/web build        # next build
pnpm --filter @quivo/web lint         # eslint app src
pnpm --filter @quivo/web typecheck    # tsc --noEmit
```
