# Plan de saneamiento — documentación (SRS), seguridad, DRY y orden arquitectónico

> **Estado:** aprobado por el CTO el 2026-10-10. En ejecución: Fase 0.
> Origen: 3 auditorías de solo lectura (arquitectura, docs, salud de código) del 2026-10-10.

## Contexto

El CTO siente que el proyecto "avanza a ciegas". El diagnóstico (3 auditorías de solo lectura del 2026-10-10) corrige parte de esa premisa:

- **Documentación no falta; falta una fuente de verdad.** Hay unas 13k líneas en `docs/`:
  - `handoff.md` tiene 4256 líneas y mezcla estado con bitácora.
  - Hay unos 30 `plan-*.md`, la mitad completados pero con cabeceras "en curso".
  - Hay dos ADR numerados `0002`.
  - Hay contradicciones doc↔código: radios, frescura, distanceFilter, costos.
- **Los requisitos originales no existen en el repo.** `QUIVOcontrol.md` (RF-01..84 + RNF) y `QV-ESP-ESP-CTL-2026-001` solo se citan por número, y no están en `~/Downloads`. **Decisión del CTO: reconstruir el SRS desde el código + docs**, respetando la numeración RF/RNF ya citada.
- **El código es mejor de lo que parece en lo básico:**
  - 0 `any` y 0 `@ts-ignore`.
  - Zod global en el borde de la API.
  - RLS multi-tenant.
  - SQL siempre parametrizado.
  - CI con lint, typecheck, test, build y Playwright.
- **Los problemas reales** son:
  - Duplicación con divergencia: haversine en 5 copias con radios distintos; 3 criterios de jornada (offset fijo, IANA, navegador); radios dispersos, entre ellos un `radioToleranciaM: 30` hardcodeado.
  - Dependencias partidas: zod 3/4, React 18/19 en design-system.
  - God files de 1.3k a 1.9k líneas en el núcleo móvil y en los formularios web.
  - Huecos de seguridad puntuales.
  - Higiene del repo.

**Decisiones del CTO (2026-10-10):**
- Primero docs y auditoría, sin riesgo para prod. Después refactor incremental en PRs chicos con tests, intercalado con el roadmap, **sin congelar features**.
- SRS en `docs/`, en Markdown versionado, siguiendo ISO/IEC/IEEE 29148 liviano, con IDs trazables a código y tests.

**Restricción de calendario:**
- Las pruebas en calle S1/S2 y la licencia de Transistorsoft (antes del **2026-10-25**) tienen prioridad.
- Release 12 también tiene prioridad sobre este plan.
- **No se refactoriza el núcleo GPS/outbox/auth móvil antes de que release 12 esté validado en calle.**

## Paso previo (fuera de este plan, pendiente de la sesión)

APK spike `beba67fa` terminado (https://expo.dev/artifacts/eas/UUy5GfzmFr_UBGT17nQgvH7WVJC2eVNN8Ufu13lBwdY.apk).
- **Sin verificar todavía.** Antes de dárselo al CTO: descargarlo y comprobar sobre el bundle Hermes:
  - que `EXPO_PUBLIC_SPIKE` no aparezca como string;
  - que el launcher sea `MainActivity`;
  - que el SHA-1 sea `db6581…3420`;
  - que `geo.API_KEY` esté presente.
- Actualizar el handoff con #102 (`409abd8`, `ff32688`) y el build.

## Fase 0 — Línea base real e higiene (1–2 PRs, bajo riesgo)

1. **Medir de verdad.** Los locales actuales dan 51 errores de tipos y 52 tests rotos, probablemente por `packages/shared/dist` viejo (del 23-sep, anterior a `src`). Correr `pnpm -r build` y repetir typecheck y test por paquete. Guardar los números en `docs/calidad/linea-base.md`.
   - Si se confirma que es el `dist`: en `turbo.json`, `typecheck` y `test` tienen que depender de `^build`, o hay que consumir `shared` desde `src`. Así lo local nunca vuelve a mentir.
2. **Higiene de raíz:**
   - Agregar a `.gitignore`: `web-mapa/`, `.playwright-mcp/`, `.worktrees/`, `/*.png`, `*.keystore`, `CREDENCIALES.md`.
   - `git rm --cached CREDENCIALES.md` y mover su contenido útil a un `docs/dev/credenciales-demo.example.md` sin PINs.
   - Archivar o eliminar `archivo/mobile-mockup/` (código muerto, 2k líneas) y `reporte_implementacion.md`.
   - Decidir sobre `scripts/experimentos/` (214 archivos): moverlo a `scripts/_experimentos` documentado, o borrarlo.
3. **Verificar en prod con SQL de solo lectura** que el usuario demo `admin_quivo`, de password conocido según `CREDENCIALES.md:57-59`, **no exista o esté desactivado.**
4. **Verificar OSRM en prod.** `tracking/ruteo.service.ts:31` cae a `localhost:5001`, y `deploy-gcp.sh` no despliega OSRM. Confirmar si `/v1/mobile/ruta-a-punto` funciona en prod o si es un bug latente.
5. **Verificar `radioToleranciaM: 30`** en `apps/mobile/src/features/operacion/use-gps-operativo.ts:1686`, contra la decisión de 150/40 m. Si es un bug, es un `fix:` aparte con `/codex-debug verify-fix`.

## Fase 1 — Documentación: fuente de verdad única (PRs solo-docs)

**Estructura objetivo de `docs/`:**
```
docs/README.md                 índice: qué leer, qué es vigente (reemplaza el índice del README raíz)
docs/srs/SRS.md                ISO 29148 liviano
docs/glosario.md
docs/arquitectura/
  vision-general.md            C4 contexto + contenedores (mermaid)
  modulos.md                   mapa api/web/mobile/packages, dependencias, convenciones
  secuencias.md                login móvil, outbox→sync→ingesta→cumplimiento, en-vivo, publicación pública
  maquinas-de-estado.md        detección de PC (150/40, histéresis, pasada), outbox, frescura, recorrido
docs/datos/modelo.md           ERD mermaid + diccionario (29 modelos), RLS, particiones GPS, retención
docs/api/README.md             cómo se genera OpenAPI + referencia (openapi.json commiteado + chequeo de drift en CI)
docs/adr/README.md + 0001..00NN  renumerar e indexar; plantilla; backfill
docs/operacion/                release API (deploy-gcp, orden --solo web, rollback por digest), APK (perfiles EAS, firma, versionCode), incidentes; mover runbooks/
docs/calidad/                  estrategia de pruebas, línea base, matriz de trazabilidad
docs/handoff.md                SOLO estado actual (≤200 líneas) + próximos pasos
docs/bitacora/2026-MM.md       bitácora cronológica movida desde handoff (contenido íntegro)
docs/planes/                   planes vigentes; los completados van a docs/archivo/ con estado en cabecera
```

**SRS (`docs/srs/SRS.md`):**
- Contenido: propósito, alcance, stakeholders y personas (admin Quivo, admin sindicato, operador, supervisor, socio, conductor, pasajero), restricciones (solo Android, sideload, GCP `southamerica-west1`, Transistorsoft) y supuestos.
- RF por módulo, conservando la numeración RF-01..84 del mapa de `documento-tecnico-cto.md` §3.
- RNF: escala, retención 6 meses, latencia del panel ≤30 s, sync p95, batería, seguridad, costos, umbrales y aborto del piloto.
- Cada requisito lleva: `ID | enunciado | fuente | estado (implementado/parcial/pendiente/descartado/inferido-validar) | código | test`.
- Sección **"A validar por el CTO"**: requisitos inferidos del código sin fuente escrita, y contradicciones resueltas a favor del código.

**ADRs:**
- Renumerar: `0001-railway-vs-flyio` (desde `docs/archivo/`), `0002-gcp`, `0003-public-mobility-read-model`.
- Backfill de decisiones que hoy viven solo en el handoff:
  - multi-tenant con RLS;
  - outbox UUIDv7 + sync idempotente;
  - auth móvil con token opaco y PIN;
  - radios 150/40;
  - Transistorsoft;
  - motor de mapa (pendiente S2);
  - jornada boliviana.

**Corregir contradicciones** listadas por la auditoría de docs:
- costos en `documento-tecnico-cto.md` §13;
- distanceFilter 15;
- frescura de 15 min y poll de 30 s;
- `apps/movil`;
- README raíz;
- cabeceras de plan obsoletas;
- `deuda-abierta.md` E1;
- `issues-pendientes-gps.md`;
- `.html` duplicado de costos.

**Ejecución:**
- Subagentes Sonnet en paralelo, uno por dominio, extraen requisitos y comportamiento del código a borradores en el scratchpad. Dominios:
  - auth y tenant;
  - catálogo (sindicatos/socios/vehículos/conductores/líneas/rutas/PC);
  - rotaciones y asignaciones;
  - operación móvil y GPS;
  - sync e ingesta;
  - reportes y en-vivo;
  - reglas y sanciones;
  - public-mobility.
- El chairman consolida, escribe y revisa `docs/*.md`.
- La reestructura del handoff mueve contenido; no se reescribe historia.

## Fase 2 — Seguridad y sanitización (PRs chicos, `/code-review` + `/security-review`)

1. Guard global (`JwtAuthGuard`/`AuthMovilGuard` según prefijo) con decorador `@Public()` explícito. Hoy los guards son opt-in por controlador.
2. `apps/api/src/modules/tracking/ruteo.controller.ts`: DTO Zod con rangos de lat/lng. Hoy `Number('')` da 0 y pasa.
3. Retirar `POST /v1/_internal/validate-demo` (`common/ping/ping.controller.ts:19`).
4. `@fastify/helmet` en `apps/api/src/main.ts` (deuda S4).
5. Tope de descompresión del gunzip de sync (`main.ts:90-97`): mitiga una zip-bomb.
6. Inyección de fórmulas en los CSV de `reportes/exportes` (deuda S5).
7. `pnpm audit` en CI (deuda S6) y Sentry en web (deuda S8).
8. Sesión web en `localStorage` (`apps/web/src/lib/auth/auth-context.tsx`): primero un ADR (cookie httpOnly vs CSP estricta). Es un cambio mayor y no entra a ciegas.

## Fase 3 — DRY: una sola fuente por regla de negocio (PRs con tests)

1. **Tiempo y jornada:**
   - Helper único en `packages/shared` con IANA `America/La_Paz`, partiendo de `apps/api/src/common/tiempo/jornada.ts`, más constantes de duración (`MS_POR_DIA`, etc.).
   - Reemplazar el `format-hora.ts` de mobile y los `toLocaleDateString` sin zona de web.
2. **Geo:**
   - `haversineMetros` de `packages/shared/src/geo.ts` como única implementación. Eliminar la copia de `apps/web/app/(dashboard)/rutas/route-utils.ts:82` (R distinto) y las de `scripts/`.
   - Radios y tolerancias centralizados en `shared` (`RADIO_AVISO_M`, `RADIO_CONFIRMACION_M`, `RUTA_PROXIMIDAD_TOLERANCIA_METROS`), usados también por el seed y los scripts.
   - `calcHeading` del HTML del WebView queda documentado como excepción.
3. **Contrato de error y cliente HTTP:** tipo de error de API compartido en `shared` (forma de `issues`/`message`); `ApiError` único que reemplaza a `apps/web/src/lib/api/client.ts:3` y a `apps/mobile/src/shared/api/http-client.ts:9`.
4. **Schemas:** `demo-request` a `shared` y la landing lo consume; schemas inline de `public-mobility`, `mobility-publication` y `media` a `shared`.
5. **Tokens de diseño:** `packages/design-system/src/tokens.css` como fuente. El theme de mobile se genera desde ahí con un script. Los hex sueltos se migran gradualmente.
6. **Dependencias:**
   - Unificar zod en v4. Implica migrar `shared` y `api`, con ADR, y apoyarse en `scripts/assert-bundle-singletons.mjs`.
   - Peer de React de design-system a `^18 || ^19`.
   - Alinear `react-query`, `pg`, `tsx` y `better-auth` con el catálogo de pnpm.

## Fase 4 — Arquitectura y mantenibilidad (después de validar release 12 en calle)

1. **Partir god files, siempre con tests de caracterización antes:**
   - Mobile: `use-gps-operativo.ts` (1716), `use-auth-movil.ts` (1545), `db/outbox.ts` (1468), `gps/headless-task.ts` (1384).
   - Web: `vehicle-form-panel.tsx` (1884), `line-form-panel.tsx` (1749), `reglas/page.tsx`, `rutas/page.tsx`.
2. **Fronteras de módulos de la API:**
   - Hacer cumplir "solo vía `index.ts`" con `no-restricted-imports` o `eslint-plugin-boundaries`.
   - Arreglar los deep-imports actuales (`tracking`/`sync`/`ingesta-worker` → `auth-movil`/`sync`).
   - **No** introducir una capa repository: `apps/api/src/modules/README.md` se actualiza a la realidad (controller + service + Prisma), porque agregar la capa es costo sin beneficio hoy.
3. **CSS:** deduplicar `apps/web/app/globals.css` (3.8k) y `apps/landing/app/globals.css` (3.3k) contra `design-system/styles.css`.
4. **Limpieza:** eliminar el flag `MOBILE_LEGACY_AUTH_ENABLED` y los endpoints legacy (hoy devuelven 410 en prod); llevar los `console.*` de mobile a `shared/observability`.
5. **Huecos de tests:** formularios del panel web (6 tests en ~93 archivos), `ruteo` de la API y un smoke e2e del panel por cada flujo crítico del SRS.

## Fase 5 — Escalabilidad (verificación, no reescritura)

- Formalizar en el SRS los RNF de escala (2000–3000 vehículos, ~300 pts/s pico) con un **criterio medible** y su prueba: el k6 de `tests/load/k6` como gate, más el experimento de carga ya hecho (`plan-experimento-puntos-gps.md`).
- Decidir con ADR la deuda de infra ya identificada: Redis `volatile-lru`→`noeviction`, y OSRM en prod (según el resultado de 0.4).

## Reglas de ejecución

- Persistir este plan en `docs/plan-saneamiento.md` y poner el puntero en el handoff antes de ejecutar (regla 8).
- Un PR por ítem o grupo coherente. Sonnet implementa; el chairman revisa el diff y verifica.
- Gates:
  - `/code-review` siempre;
  - `/security-review` en la Fase 2;
  - `/codex-debug verify-fix` en cada `fix:`.
- CI verde, merge, handoff actualizado.
- Refactors sin cambio de comportamiento: tests de caracterización antes y suite completa después.
- Orden sugerido intercalado con el roadmap: Fase 0, Fase 1 y Fase 2 ahora. Fase 3 entre tareas de release 12. Fase 4 después de validar release 12 en calle.

## Verificación

- **Fase 0:** `docs/calidad/linea-base.md` con los números reales por paquete tras `pnpm -r build`. `git ls-files` sin `CREDENCIALES.md`. Resultado SQL de `admin_quivo`. Resultado de OSRM en prod.
- **Fase 1:**
  - Cada RF/RNF del SRS con estado y referencia de código.
  - Link-check de Markdown sin rotos.
  - `docs/README.md` indexa todo lo vigente.
  - `handoff.md` ≤200 líneas.
  - La bitácora conserva el contenido completo: diff de líneas movidas.
  - El CTO revisa la sección "A validar".
- **Fases 2–4:** tests nuevos por ítem, suite completa verde local y en CI, `/code-review` sin hallazgos abiertos, `/security-review` en la Fase 2.
- **Mobile:** verificación en dispositivo (MCP `mobile`) para lo que toque UI o GPS.
