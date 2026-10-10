# Línea base de calidad — 2026-10-10

Medido sobre una copia limpia de `main@64125f7` (worktree aparte). Primero `pnpm install --frozen-lockfile` y `pnpm -r build`, después typecheck y test por paquete. Plan: [`../plan-saneamiento.md`](../plan-saneamiento.md), Fase 0.

## Resultado

| Paquete | Typecheck | Tests locales | Nota |
|---|---|---|---|
| `packages/shared` | 0 errores | 57/57 | |
| `packages/design-system` | 0 errores | 59/59 | 8 warnings de lint (`react-hooks/exhaustive-deps`) |
| `packages/db` | 0 errores | 5 archivos fallan | Necesitan Postgres; en CI corren con DB |
| `apps/api` | 0 errores | 58 pasan; 36 archivos fallan | Los que fallan necesitan Postgres/Redis; en CI corren con DB |
| `apps/web` | 0 errores | 87/87 | 49 warnings de lint (48 `no-unused-vars`) |
| `apps/mobile` | 0 errores | 618/618 | 18 warnings de lint |
| `apps/landing` | 0 errores | sin tests | |

CI (`.github/workflows/ci.yml`) corre lint, typecheck, migrate, seed, test, build, bundle móvil y Playwright, con Postgres y Redis. Estaba verde en los PRs #106 y #107 del 2026-10-10.

## Trampa: el `dist` viejo hace mentir a lo local

Sin build previo, la misma medición da **51 errores de typecheck y 52 tests rotos**. El motivo es que `packages/shared/dist` y `packages/design-system/dist` quedan viejos respecto de su `src`, y las apps consumen `dist`.

`turbo.json` ya declara `typecheck`/`test` con `dependsOn: ["^build"]`, así que **por turbo no pasa**. Pasa cuando se corre `tsc` o `vitest` dentro de un paquete suelto.

**Regla:**
- Para verificar, usar `pnpm turbo run typecheck test --filter=<paquete>...`, o `pnpm -r build` antes de comandos sueltos.
- Un resultado medido sin build previo no cuenta como evidencia.

## Huecos de pruebas conocidos

- **`apps/web`:** 6 archivos de test para unos 93 de código. Sin tests en los formularios grandes: `vehicle-form-panel.tsx` (1884 líneas), `line-form-panel.tsx` (1749), `reglas/page.tsx`, `rutas/page.tsx`.
- **`apps/landing`:** sin tests.
- **`scripts/`:** sin tests. Incluye `sembrar-piloto-produccion.ts` (1590 líneas), que escribe en producción.
- **API:**
  - sin tests de `tracking/ruteo.*`, del módulo `media` ni de las transiciones de publicación;
  - sin tests de throttles de login y refresh;
  - `roles-matrix.test.ts` no cubre `AuthController`, `MediaController`, `MobilityPublicationController` ni `EnVivoController`;
  - el test de RLS no cubre `audit_log`, `sesiones_operativas`, `cumplimientos_pc`, `eventos_operativos`, `sync_errors` ni `gps_sesion_resumen`, entre otras.
- **Móvil:** solo unitarios. Sin e2e. Los gates de campo (batería, huecos GPS, p95 de sync, tracking tras kill/reboot) no están medidos con la app propia.
- **Carga:** el k6 de `tests/load/k6` nunca corrió como gate.

El detalle por requisito está en la columna *Test* de cada dominio del [SRS](../srs/README.md).
