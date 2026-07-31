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

## Logo de marca

`src/components/brand-logo.tsx` (`<BrandLogo />`) resuelve isotipo/logotipo con variante
clara/oscura según `prefers-color-scheme` (misma media query que ya usa
`@quivo/design-system` para sus tokens de color, así que quedan sincronizados). Los
archivos en `public/brand/` y el favicon (`app/favicon.ico`, `app/icon.svg`) vienen del kit
de marca del proyecto de landing (`/home/jairomgr/Proyectos/Web/landing_pageQUIVO/quivo-landing/public/img/{LOGOTIPO,ISOTIPO}/`,
`MANUAL DE MARCA QUIVO V1.pdf`) — son una copia, no un symlink, porque son assets
estáticos (no código que deba seguir cambios del repo hermano). Si el manual de marca
cambia el isotipo/logotipo, hay que volver a copiar los archivos actualizados acá.

## Auth (QUI-227 + QUI-219) — estado actual

El backend real de auth (`POST /v1/auth/login`, `POST /v1/auth/refresh`) ya existe en
`apps/api` (Better-Auth + JWT, ver `apps/api/README.md` para cómo levantarlo local con
Postgres). `src/lib/auth/api-client.ts` llama a ambos endpoints con el contrato de
`@quivo/shared` (`LoginResponse`/`RefreshResponse`). Para loguearte de verdad necesitás la
API corriendo en `NEXT_PUBLIC_API_URL` (por defecto `http://localhost:3001`) con la base
migrada y sembrada — credenciales demo en `apps/api/README.md`.

Si no querés levantar Postgres/la API solo para navegar el panel, sigue disponible el
**bypass de desarrollo**:

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

### Módulos CRUD contra el API real

Todos los módulos administrativos ya pegan contra `apps/api` de verdad — no queda ningún
modo demo (`src/lib/demo-data.ts` se borró; el último módulo en migrar fue el dashboard
`/`, que hasta esta limpieza seguía mostrando KPIs de ejemplo aunque las 4 APIs que
necesita ya eran reales). Sindicatos/Socios/Vehículos/Conductores/Líneas/Reglas usan
`src/components/module-table-page.tsx` (`ModuleTablePage`) con su prop `dataSource:
{list, create, update}` — `PageHeader` + búsqueda + `DataTable` + alta/edición en
`Modal`+`FormGroup`, contra el API real (ver `src/lib/api/*.ts`, un cliente delgado por
entidad). **Sin borrado en ningún módulo**: ningún endpoint de M1/M4 expone `DELETE` (las
entidades se desactivan vía `estado`, nunca se borran de la DB).

Rutas (QUI-229), Rotaciones (QUI-233), Sanciones (dentro de `/reglas`, QUI-245) y
Auditoría (QUI-248) tienen páginas a medida (no `ModuleTablePage`) porque su interacción
no es un CRUD tabular simple: mapa interactivo, grilla vehículo×fecha con transiciones de
estado, flujo de transiciones con confirmación, y filtros de solo-lectura respectivamente.
`Reportes` es la única página que sigue sin datos reales — bloqueada por M3 (necesita
`gps_points`/sesiones que no existen todavía).

Para agregar un módulo CRUD simple nuevo al patrón `ModuleTablePage`: armar `columns:
DataColumn<T>[]` (con `render` para badges) y `fields: EntityFieldConfig[]` (para el
formulario del modal), un cliente en `src/lib/api/<entidad>.ts` que exponga
`{list, create, update}` contra `apps/api`, y pasarlos a `<ModuleTablePage<T> />` junto con
`entityLabel` (singular, minúscula), `dataSource`, y `createDefaults` (incluyendo
`sindicatoId: user?.sindicatoId ?? ''` si la entidad es multi-tenant). La página en sí debe
llevar `'use client'` — pasarle a `ModuleTablePage` (un client component) `columns` con
funciones `render`/`actions` desde un Server Component no es serializable y rompe el build
de producción.

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
