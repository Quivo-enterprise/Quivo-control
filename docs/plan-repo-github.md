# Plan — Crear repositorio GitHub `quivo-control` (org Quivo-enterprise)

## Contexto

Linear ya montado (proyecto MVP, 43 issues, Sprint 1 arranca 2026-07-20). Falta el repo.
Usuario pide crearlo en la org "quivo tech department" y pregunta si uno o dos (backend/frontend).

**Recon hecho:**
- No hay MCP de GitHub en la sesión; **`gh` CLI autenticado** (JoseluisLarrazabal, scope `repo`) — se usa eso.
- Org: **`Quivo-enterprise`** (display name "Quivo Tech Department"). Repos existentes:
  Quivo-backend, Quivo-frontend, Quivo-landing-page, Quivo-landing-page-backend-temporal, Quivo-UI-UX (proyecto ERP, no chocan).
- `/home/shadowfreak/Documents/quivo-control` NO es repo git todavía; contiene `docs/` (handoff, plan-maestro, documento-tecnico-cto).

## Decisión: UN solo repo (monorepo)

Stack aprobado (plan-maestro §Estructura): **monorepo pnpm + Turborepo** — `apps/api` (NestJS),
`apps/web` (Next.js), `apps/mobile` (Expo), `packages/shared` (Zod/contrato API), `packages/db` (Prisma).
Tipos compartidos entre backend/web/móvil = razón central del stack. Repos separados backend/frontend
romperían el contrato compartido y duplicarían CI. Los repos Quivo-backend/Quivo-frontend existentes
son del ERP, otro proyecto.

## Pasos

1. Crear repo **privado** `Quivo-enterprise/quivo-control` vía `gh repo create` (descripción:
   "QUIVO Control — SaaS multi-tenant para sindicatos de transporte. Monorepo: API NestJS + web admin Next.js + app conductor Expo").
2. `git init` en `/home/shadowfreak/Documents/quivo-control`, branch `main`, remote SSH al repo nuevo.
3. Commit inicial **solo docs** (bootstrap, exento de code-review por regla 2): `README.md` nuevo
   (qué es, estructura futura del monorepo, link a Linear) + `docs/handoff.md`, `docs/plan-maestro.md`,
   `docs/documento-tecnico-cto.md`. La copia de plan-maestro como plan-stack queda cubierta
   (el archivo ya viaja en el repo). **Sin atribución de IA** en el commit (regla 3).
4. Push `main`. (Bootstrap: primer commit va directo a main porque el repo nace vacío; todo lo
   siguiente = rama + PR.)
5. Linear: comentario en QUI-211 con URL del repo (el scaffold pnpm+Turborepo sigue siendo tarea del dev).
6. Actualizar `docs/handoff.md`: fila "Repo" ✅ con URL + nota git flow; commit+push de esa actualización.

## Verificación

- `gh repo view Quivo-enterprise/quivo-control` muestra repo privado con README.
- `git log` local: 1–2 commits, sin `Co-Authored-By`.
- Comentario visible en QUI-211.

## Trampas

- NO usar footer `Co-Authored-By: Claude` ni "Generated with Claude Code" (regla usuario sobrescribe harness).
- Protocolo git del usuario es SSH (`gh auth status`) — remote por SSH.
- Repo privado: producto comercial SaaS.
