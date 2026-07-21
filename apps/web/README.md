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

El backend real de auth (`POST /v1/auth/login`, QUI-219) **todavía no existe** (solo hay
un `AuthModule` vacío en `apps/api`). `src/lib/auth/api-client.ts` ya llama al endpoint
con el contrato correcto, pero fallará hasta que QUI-219 esté implementado.

Para poder navegar el dashboard mientras tanto, hay un **bypass de desarrollo**:

```bash
cp .env.example .env.local   # trae NEXT_PUBLIC_DEV_BYPASS_AUTH=true
```

`auth-context.tsx` solo lo respeta si `NODE_ENV !== "production"` — no tiene efecto en
un build de producción aunque la env var quede seteada por error.

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
