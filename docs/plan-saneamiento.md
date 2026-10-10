# Plan de saneamiento — documentación (SRS), seguridad, DRY y orden arquitectónico

> **Estado:** aprobado por el CTO el 2026-10-10. Fase 0 hecha; Fase 1 en curso (SRS, modelo, arquitectura y glosario publicados; faltan ADRs, handoff, planes y contradicciones).
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

## Paso previo — HECHO (2026-10-10)

APK spike `beba67fa` verificado sobre el archivo:
- `EXPO_PUBLIC_SPIKE` aparece 0 veces;
- launcher `MainActivity`;
- SHA-1 `db6581…3420`;
- `geo.API_KEY` presente.

El handoff está actualizado (#106).

## Fase 0 — Línea base real e higiene — HECHA (2026-10-10)

1. **Línea base:** [`calidad/linea-base.md`](calidad/linea-base.md). Con build previo hay 0 errores de typecheck en los 7 paquetes. Los 51 errores y 52 tests rotos venían del `dist` viejo. `turbo.json` ya tenía `dependsOn: ["^build"]`, así que no hay cambio de config; queda la regla de verificar con turbo o con build previo.
2. **Higiene de raíz:** #107. `.gitignore` actualizado; `CREDENCIALES.md` fuera del índice y reemplazado por `docs/dev/credenciales-demo.md`; `archivo/mobile-mockup/` borrado; `reporte_implementacion.md` movido a `docs/archivo/`.
   - **Pendiente:** decidir sobre `scripts/experimentos/` (214 archivos, solo los referencian docs).
   - **Pendiente:** limpiar las menciones a `CREDENCIALES.md` en `packages/db/prisma/seed.ts` y `packages/db/src/auth.ts` (texto de error; revisar tests).
3. **`admin_quivo` demo en prod:** probablemente no existe. `plan-siembra-produccion.md` descartó correr el seed demo contra prod y el admin real es `admin@quivo.com`. **No verificado por SQL** (la DB solo tiene IP privada).
4. **OSRM en prod:** **no desplegado.** `quivo-api` no tiene `OSRM_URL` (verificado con `gcloud run services describe`). La ruta a un punto siempre se dibuja como línea recta. Decisión pendiente en la Fase 5.
5. **`radioToleranciaM: 30`:** **inocuo.** Solo lo usa `simularDeteccion`, que está detrás de `__DEV__`. Los comentarios desactualizados de `geofence.ts` (312-316, 443, 540-544) se corrigen en la Fase 3.2.

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

**Agregados por la reconstrucción del SRS (2026-10-10, [SRS §6](srs/README.md)). Prioridad: 9 > 10 > el resto.**

9. **Aislamiento de asignaciones (P0).**
   - `crearAsignacion`/`actualizarAsignacion` (`apps/api/src/modules/rotaciones/rotaciones.service.ts:219-258`) no validan el tenant de `vehiculoId`, `conductorId` y `rutaId`.
   - Primero un test cross-tenant que lo reproduzca, después el fix. `/codex-debug verify-fix`.
10. **RLS en `rutas`, `variantes`, `paradas`, `puntos_control`, `asignaciones`.** Necesita decisión P-RLS del CTO: policy con subquery o desnormalizar `sindicatoId`. Migración y test RLS.
11. **Auditoría:**
    - `REVOKE UPDATE, DELETE` sobre `audit_log` para `quivo_app` + trigger;
    - eventos de seguridad (login, fallos, lockout, revocación);
    - atomicidad. Depende de la decisión P-AUD.
12. **Sesión móvil:** revocarla al desactivar el vehículo o el conductor y al vencer la asignación. Depende de la decisión P-SESION.
13. **Integridad del sync** (después de la decisión P-ACK):
    - reintentos en BullMQ;
    - Redis en `noeviction`;
    - reproceso de `sync_errors`;
    - aislar la fila GPS mala en vez de mandar el lote entero;
    - cuarentena en la app para eventos que el servidor nunca acepta (400).
14. **Ampliar el test RLS y `roles-matrix.test.ts`** a las tablas y controllers que no cubren (ver `calidad/linea-base.md`).

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
