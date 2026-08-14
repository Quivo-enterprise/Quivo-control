# Plan — Retomar QUIVO Control desde `main` y reconstruir el roadmap de Valentina

> Fecha: 2026-08-13 · Estado: **aprobado por el CTO, en ejecución**
> Base: `main` = `98bae54` (merge del PR #1) · Rama de trabajo:
> `fix/vendorizar-design-system-ci-verde`

## Context

El CTO mergeó el PR #1 (`qui-227-web-nextjs-scaffold` → `main`, 2026-08-14 02:28 UTC), que
trae M1+M2+M3+M4+M5(parcial): backend NestJS completo, `apps/web` con 15 pantallas y
`apps/mobile` con las 10 pantallas del sprint M6. El CTO **asume la continuación del trabajo
que venía haciendo el equipo anterior** (el 91% de los commits son de `jg012119`, una máquina
`jairomgr` a la que ya no se tiene acceso).

Dos problemas fuerzan este plan:

1. **`main` está en rojo y nunca pasó CI** — 8 de 8 corridas fallidas en la historia del repo,
   incluida la del merge. El proyecto no es buildeable por nadie fuera de esa máquina.
2. **Las 12 issues abiertas de Valentina se escribieron contra un `main` viejo.** Verificadas
   contra el código real: 2 ya están hechas, 6 están parcialmente hechas o mal dimensionadas,
   y 5 están bloqueadas de hecho por el punto 1.

Resultado buscado: `main` verde y clonable por cualquiera, un diagnóstico honesto de qué falta
para el MVP, y un roadmap nuevo de Valentina escrito contra el estado real.

---

## Estado verificado (evidencia)

### Bloqueo #0 — `main` en rojo, una sola causa raíz

CI (`gh run list`): **0 corridas verdes en la historia del repo**. La del merge a `main`
(`31763822315`) falla en el paso *Typecheck* con **136 errores**, todos derivados de una raíz:

```
apps/web/package.json
"@quivo/design-system": "link:../../../Design_System_QUIVO/packages/design-system"
```

| Error | Cantidad | Naturaleza |
|---|---|---|
| `TS2307: Cannot find module '@quivo/design-system'` | 22 | **causa raíz** |
| `TS7006: Parameter implicitly has an 'any' type` | 110 | derivado — sin tipos del paquete, se pierde la inferencia en los callbacks |
| `TS7053: Element implicitly has an 'any' type` | 4 | derivado |

El paso *Typecheck* corta antes de *Test* y *Build*: **los 49 tests unitarios nunca corrieron en
CI**, y `apps/web` nunca se buildeó.

### El repo `Design_System_QUIVO` no es recuperable

Verificado exhaustivamente, incluida la carpeta `Quivo-control(base)` que indicó el CTO:

- No está en `Quivo-enterprise` (10 repos listados) ni en la cuenta personal del CTO.
- `Quivo-enterprise/Quivo-UI-UX` existe pero está **vacío** (sin contenido ni ramas).
- No está en este disco (`find /` completo, sin resultados). `~/Proyectos` no existe.
- Nunca estuvo en el historial de git de `Quivo-control` (`git log --all --diff-filter=A`).
- **Los 3 checkouts de `Quivo-control` en la máquina** — `Quivo-App/Quivo-control`,
  `Quivo-App/Quivo-control(base)` (checkout completo en `ac29323`, con `node_modules`) y la copia
  en la papelera — tienen el **mismo symlink colgado** `@quivo/design-system ->
  ../../../../../Design_System_QUIVO/packages/design-system`, todos con fecha 13-ago. Nunca
  resolvió en esta máquina.
- La caché de Turbo de `(base)` tiene artefactos de `api`, `db` y `shared`, pero **ningún
  `turbo-build` de `apps/web`** — no hay `.next` compilado del que extraer el CSS/JS del paquete.
- `apps/web/README.md` apunta a `/home/jairomgr/Proyectos/Web/Design_System_QUIVO`, y
  `docs/handoff.md` registra que ese repo **tenía 1 commit local sin pushear** (prop `zones` de
  `RouteMap`, QUI-229).

**Conclusión: el fuente se perdió con el acceso a la máquina `jairomgr`. Hay que reconstruirlo.**

**Superficie de consumo (lo que sí se recuperó, y alcanza para reconstruir):** 25 archivos de
`apps/web` importan ~21 símbolos:
`AdminLayout`, `AuthLayout`, `SidebarNav`, `DashboardHeader`, `PageHeader`, `LoginForm`,
`DataTable`, `Modal`/`FormGroup` (vía `ModuleTablePage`), `Button`, `Card`, `Alert`, `Badge`,
`StatusBadge`, `PlateBadge`, `Input`, `Select`, `FormField`, `DatePicker`, `SegmentedControl`,
`Loader`, `RouteMap`, más los tipos `MapPoint`, `MapRoute`, `SelectOption`, `ProgressBarProps`,
`StatusBadgeStatus`.

Convención conocida (documentada en `apps/web/README.md` + `apps/web/app/globals.css`): CSS
propio (`styles.css`/`tokens.css`), clases `qv-*`, variables `--qv-*`, **sin Tailwind interno**,
sin `@font-face` propio (las fuentes Oxanium/Montserrat las inyecta la app).
`next.config.ts` lo declara en `transpilePackages`, o sea que se consume como fuente TS, no como
build — un workspace del monorepo encaja sin fricción.

**Contrato recuperable:** 49 identificadores `qv-*` distintos aparecen citados desde `apps/web`
— tokens (`--qv-color-{primary,danger,success,warning,border,white,primary-soft,primary-subtle,
warning-soft}`, `--qv-space-{2xs,xs,sm,md,lg,xl}`, `--qv-radius-{sm,md,lg,full}`,
`--qv-shadow-{xs,sm,lg,focus}`, `--qv-font-{display,body,mono}`) y clases de componente
(`qv-button`, `qv-field`, `qv-select`, `qv-select-trigger`, `qv-modal`, `qv-table`,
`qv-table-wrap`, `qv-plate`, `qv-metric-strip`, `qv-surface-{card,soft,sunken}`,
`qv-border-{subtle,strong}`). Sumado a los 2041 líneas de `apps/web/app/globals.css` —que ya
extiende y sobreescribe buena parte de esas clases— y al manual de marca, el contrato a
reimplementar está prácticamente especificado.

### Otros hallazgos de infraestructura

- **Branch protection imposible hoy**: `gh api .../branches/main/protection` → `403 Upgrade to
  GitHub Pro`. El repo es privado en plan free. El criterio de aceptación de QUI-212 no se puede
  cumplir sin cambiar de plan (o hacer el repo público, descartado).
- **Playwright existe pero no corre**: `playwright.config.ts` + `tests/acceptance/admin-panel.spec.ts`
  (3 tests) están en el repo, pero `.github/workflows/ci.yml` no tiene job de Playwright.
- **3 ramas vivas post-merge**: `qui-227-web-nextjs-scaffold`, `feat/mobile-ui-valentina`,
  `feat/mobile-ui-sprint-valentina`. Las tres 100% mergeadas a `main` (verificado con
  `git merge-base --is-ancestor`), seguras de borrar.
- **`docs/handoff.md` desactualizado**: sigue diciendo "revisar y mergear el PR abierto".
- **Checkout local del CTO desactualizado**: `main` local está en `5e0f758` (solo docs). Hace
  falta `git pull` antes de tocar nada.

### Deuda técnica real en `apps/mobile`

- **Sistema de preferencias duplicado.** `use-operacion-settings.tsx` (AsyncStorage, clave
  `@quivo_operacion_settings`) es el que está montado en `operation-navigator.tsx` y el que leen
  `gps-provider.tsx` y `use-perfil-query.ts`. En paralelo, `preferencias-store.ts` (SecureStore)
  solo lo lee `ajustes-operacion-screen.tsx`, que **nadie importa** — código muerto. Es decir:
  AsyncStorage entró pese a estar excluido, y SecureStore quedó huérfano.
- **Los 3 ítems que QUI-336 excluía explícitamente entraron igual**: endpoint
  `GET /v1/mobile/perfil` (`auth-movil.controller.ts:56-63`), `use-perfil-query.ts:23` con
  `refetchInterval` de 60s/300s, y `react-native-shimmer-placeholder` (`package.json:50`, usado
  8× en `perfil-screen.tsx:241-265`).
- **Los 4 bugs de QUI-348 siguen los 4 vivos** (ver detalle en la tabla de tareas).
- `errorSync` se calcula en `use-sync-status.ts`, se destructura en `operation-screen.tsx:37`
  y **nunca se renderiza** — el conductor no ve nunca que la sync falló.
- `apps/mobile` está en **Expo SDK 52 / RN 0.76**, mientras `quivo-mobile-expo` (app pasajero)
  está en SDK 57 / RN 0.86. Divergencia a decidir, fuera del alcance de este plan.

---

## Fase 1 — Desbloquear `main` (subagente, ahora)

Objetivo: CI verde en `main`. Nada del roadmap avanza antes de esto.

### 1.a — Reconstruir `@quivo/design-system` como workspace del monorepo

El CTO eligió vendorizar; como el fuente no es recuperable, se **reconstruye** contra el
contrato ya conocido. No es diseño desde cero: la API, los nombres de token y las clases están
determinados por el código que ya los consume.

1. Crear `packages/design-system` con `styles.css` + `tokens.css` implementando los ~30 tokens
   `--qv-*` y las ~13 clases `qv-*` inventariadas arriba, sobre el manual de marca QUIVO
   (isotipo/logotipo ya están en `apps/web/public/brand/`).
2. Implementar los 21 componentes con la **firma exacta** que usan los 25 consumidores — se
   deriva leyendo cada sitio de uso, no inventando props. Los 2041 líneas de
   `apps/web/app/globals.css` sirven de referencia visual: ya extienden estas mismas clases.
3. `apps/web/package.json`: `"@quivo/design-system": "workspace:*"`. Registrar en `turbo.json` y
   regenerar `pnpm-lock.yaml`. `transpilePackages` de `next.config.ts` sigue sirviendo tal cual.
4. Verificar que `@import '@quivo/design-system/styles.css'` de `globals.css` resuelve.

Es trabajo de UI real (~13 pts), no mecánico: dispara la regla 7 (taste-skill) y el bake-off
dual de la 7.b para la dirección visual. **No es tarea de pasante.**

Se descartó migrar a shadcn/ui: obligaría a reescribir los 25 archivos consumidores además del
paquete, con más riesgo de regresión y sin resolver nada que la reconstrucción no resuelva.

**Atajo si aparece el fuente:** si el CTO recupera `Design_System_QUIVO` de la máquina
`jairomgr` en cualquier momento, esta fase colapsa a "copiar carpeta + `workspace:*`" (~2 pts).
Conviene agotar esa vía antes de arrancar la reconstrucción.

### 1.b — Cerrar el typecheck
Con el paquete resuelto, los 110 `TS7006` + 4 `TS7053` deberían evaporarse solos. Los que
queden se tipan a mano. Criterio: `pnpm typecheck` verde en los 5 workspaces.

### 1.c — Job de Playwright en CI
Agregar el job a `.github/workflows/ci.yml` reusando el `playwright.config.ts` y los servicios
Postgres+PostGIS/Redis que ya declara el workflow. Los 3 tests de `admin-panel.spec.ts` deben
correr.

### 1.d — Higiene
- Borrar las 3 ramas mergeadas en remoto.
- Actualizar `docs/handoff.md` al estado post-merge.
- Documentar en `docs/` qué rama del sprint M6 contuvo qué (absorbe QUI-337).

**Verificación de la Fase 1:** `gh run list --limit 1` devuelve `success` en `main` — la primera
corrida verde de la historia del repo. Además `pnpm install && pnpm build` funciona en un clon
limpio, sin dependencias fuera del repo.

---

## Fase 2 — Qué sigue en el MVP

Estado por milestone (Linear, 64 issues / 248 pts, 73% por puntos):

| Milestone | Target | Progreso | Qué falta |
|---|---|---|---|
| M0 Fundaciones + Spike GPS | 2026-08-10 ❌ **vencido** | 63,9% | QUI-216 (gate GPS, Urgent), QUI-212 (CI), QUI-213 (infra) |
| M1 Núcleo administrativo | 2026-08-30 | 100% | — |
| M2 Rotaciones | 2026-09-13 | 100% | — |
| M3 App móvil + sync | 2026-10-18 | 81,8% | QUI-237 (tracking GPS producción, Urgent, en Backlog sin ciclo) |
| M4 Dashboard/reglas/auditoría | 2026-11-08 | 100% | — |
| M5 Hardening + piloto | 2026-11-20 | 41,1% | QUI-250 (k6), QUI-252 (retención), QUI-253 (piloto) — los 3 In Progress |
| M6 Sprint UI/UX Mobile | 2026-08-10 ❌ vencido | 97,6% | resto en Valentina |

**Camino crítico real, en orden:**

1. **`main` verde** (Fase 1) — desbloquea a todo el mundo.
2. **QUI-216, gate GPS** — Urgent, vencido, bloquea el cierre productivo de M3 (QUI-237).
   Bloqueo de negocio: licencia Transistorsoft ~US$400 + Android de gama baja. El código de
   integración **ya está** (`react-native-background-geolocation ^4.17.3` en `package.json`,
   usado en `use-gps-operativo.ts`; arnés de medición completo en `apps/mobile/src/gps/`); lo que
   falta es la validación física de 8h del protocolo de `docs/spike-gps.md`.

   Estado verificado: la issue **nunca cambió de estado desde el 2026-07-19** — sigue en `Todo`,
   0 comentarios, tabla de resultados de `docs/spike-gps.md` vacía, sin veredicto GO/NO-GO. El
   campo `license` de `apps/mobile/app.json` está en `""` y no hay variable de entorno para la
   licencia en ningún `.env.example`. **No hay ningún rastro en Linear —issue, comentario o
   documento— de compra, presupuesto o aprobación** de la licencia ni del dispositivo.

   ⚠️ **El gate ya se está bypasseando de hecho:** QUI-216 declara bloquear a QUI-235 y QUI-237,
   pero QUI-235 está `Done` y toda la app móvil se construyó encima. La premisa "nada de M3
   arranca sin este GO" dejó de sostenerse hace tiempo. Decisión pendiente: comprar y correr el
   spike, o aceptar formalmente el riesgo y reescribir el gate.
3. **QUI-212 / QUI-213** — CI (parcialmente resuelto por la Fase 1; branch protection queda
   bloqueada por el plan de GitHub) e infra cloud (Railway vs Fly.io, ADR redactado sin decidir).
4. **M5** — las 3 issues del CTO en curso, más el deploy de `apps/web` en Vercel que sigue sin
   hacerse (criterio de aceptación pendiente de QUI-227).

**Riesgo de asignación:** desde el ciclo 15 en adelante, **el 100% de la carga futura del
proyecto está en Valentina**. No hay nada agendado para nadie más. Anett, Estrella y Adrian no
tienen ninguna issue en este proyecto (están en QUIVO Pay).

**Lo que aportó el CPO (respuesta a la consulta del CTO).** `cpo.matias` tiene **una sola issue
en todo el workspace**: QUI-264, el planning del sprint M6 — 1 pt, prioridad High, en el ciclo
actual, y **sigue en `Todo` desde el 2026-08-04**. Creó las 10 issues del sprint (QUI-254..263,
42 pts) con criterios de aceptación y 3 imágenes de referencia, y ahí termina su participación.
Dos consecuencias medibles:

- **El reparto planificado no se cumplió.** QUI-264 asigna 6 issues / 21 pts a Estrella y 4 / 21
  pts a Valentina. En Linear, **las 10 quedaron asignadas a Valentina** y Estrella no tiene
  ninguna issue en el proyecto. Valentina absorbió sola el sprint de dos personas — contexto
  directo de por qué la calidad del código de M6 dejó los 4 bugs de QUI-348.
- **Sobre el gate GPS, el CPO no aportó nada**: no creó ni tiene asignada QUI-216 ni QUI-237
  (ambas del CTO), y ninguna de sus issues menciona la licencia, su costo ni el spike. QUI-264
  solo lista "Transistorsoft GPS" dentro del stack técnico. Además QUI-258 especifica
  `react-native-geolocation-service`, un paquete **distinto** al Transistorsoft del spike.

Acción sugerida: cerrar QUI-264 (el sprint que planifica terminó hace un ciclo) y decidir si
Estrella se reincorpora con carga real o se la saca del proyecto.

---

## Fase 3 — Roadmap nuevo de Valentina

Decisión del CTO: **reescribir desde cero** contra el estado real de `main`.

### Veredicto sobre las 12 issues actuales

| Issue | Pts | Veredicto | Razón |
|---|---|---|---|
| QUI-343 Onboarding | 2 | ❌ **Cerrar — ya hecha** | README raíz + `apps/{web,api,mobile}/README.md` + `CREDENCIALES.md` con guía para pasantes ya existen |
| QUI-341 Pase visual app pasajero | 3 | ❌ **Cerrar — ya hecha** | `mutedOnLight`, `use-animated-centavos`, `use-reduced-motion` todos en `dev`; 237 tests / 30 suites verdes |
| QUI-345 Tests de contraste | 2 | ❌ **Cerrar — ya hecha** | `contrast.test.ts` cubre ambas familias de tokens + test de no-intercambiabilidad; CI bloqueante |
| QUI-336 Portar rama | 5 | 🔄 **Rescopear a 3 pts** | (a) navegación, (c) `expo-speech`, (d) `USE_MOCK` **ya están**. Queda solo resolver la duplicación de stores de preferencias |
| QUI-342 Dashboard | 5 | 🔄 **Rescopear a 2 pts** | Estados vacíos ✅ y export CSV ✅ ya existen. Falta: filtros en query params + export de la tabla de cumplimiento en sí |
| QUI-340 Playwright | 5 | 🔄 **Rescopear a 3 pts** | Login ✅ ya cubierto por `admin-panel.spec.ts`; el job de CI lo absorbe la Fase 1. Falta: altas de vehículo y conductor |
| QUI-338 Estados de error | 5 | 🔄 **Rescopear a 3 pts** | Offline ✅, sesión expirada ✅, GPS cortado ✅. Falta: renderizar `errorSync`, distinguir permiso denegado, flag de simulación |
| QUI-346 Cola offline | 3 | 🔄 **Rescopear a 2 pts** | Cuenta de pendientes ✅ + aviso al 80% ✅. Falta: timestamp de última sync + estado de fallo definitivo |
| QUI-348 Los 4 bugs | 3 | ✅ **Válida sin cambios** | Los 4 siguen vivos, verificados línea por línea |
| QUI-337 Limpiar ramas | 1 | ➡️ **Absorbida por Fase 1** | La higiene de ramas va con el fix de `main` |
| QUI-339 Auditoría a11y web | 2 | ⏸️ **Válida, pero bloqueada** | Requiere `main` verde. 129 hex hardcodeados en `apps/web`; 5 de 16 módulos usan formularios del design system |
| QUI-347 Fixes a11y web | 3 | ⏸️ **Válida, depende de 339** | — |

**Neto:** de 34 pts abiertos, ~7 ya están hechos y ~11 se reducen por rescope. Queda un roadmap
real de **~16-18 pts**, no 34.

### Roadmap propuesto (a escribir en Linear tras aprobación)

| Ciclo | Issue | Pts | Nota |
|---|---|---|---|
| C15 (17–24 ago) | Los 4 bugs del sprint M6 (QUI-348 tal cual) | 3 | Formativo: bugs 1 y 2 son la misma familia (closure de React congelada) |
| C15 | Unificar el sistema de preferencias del conductor | 3 | Elegir SecureStore o AsyncStorage, borrar el muerto, decidir sobre shimmer / `refetchInterval` / endpoint `/mobile/perfil` |
| C16 (24–31 ago) | Feedback de error de sync visible al conductor | 3 | Renderizar `errorSync`, distinguir permiso de ubicación denegado, flag de simulación de fallos para QA |
| C17 (31 ago–7 sep) | Última sync exitosa + estado de fallo definitivo | 2 | Completa el indicador de cola offline |
| C18 (7–14 sep) | Auditoría de accesibilidad de `apps/web` | 2 | Requiere `main` verde |
| C18 | Aplicar los fixes de severidad alta | 3 | Depende de la anterior |
| C19 (14–21 sep) | E2E de alta de vehículo y alta de conductor | 3 | Sobre el job de Playwright que deja la Fase 1 |
| C21 (28 sep–5 oct) | Filtros en URL + export de la tabla de cumplimiento | 2 | — |

**Cambios de proceso a aplicar en Linear:** poner prioridad a las issues (hoy las 12 están
"Sin prioridad") y asignarles milestone (hoy ninguna lo tiene). La secuenciación actual depende
solo del ciclo, lo que las hace invisibles en el progreso del proyecto.

**Ejecución en Linear** (decisión del CTO: escribir directo, sin borradores previos):
1. Cerrar QUI-343, QUI-341 y QUI-345 como `Done` con un comentario que cite la evidencia en
   código de por qué ya están hechas.
2. Cerrar QUI-337 como absorbida por el PR de la Fase 1.
3. Reescribir descripción, puntos, prioridad, milestone y ciclo de QUI-336, 338, 340, 342, 346.
4. Dejar QUI-348 como está y QUI-339/347 con nota de dependencia de `main` verde.
5. Abrir cada issue viva con un comentario de arranque — hoy **ninguna de las 12 tiene un solo
   comentario**, y esa es la causa directa de que Valentina no las entienda.

**Nota sobre el motivo original de la consulta:** Valentina no entiende sus tareas en parte
porque **ninguna de las 12 issues tiene un solo comentario** — todo el contexto vive en la
descripción y nunca hubo conversación. Las issues nuevas deberían abrirse con un comentario de
arranque.

---

## Archivos críticos

| Archivo | Rol |
|---|---|
| `apps/web/package.json` | El `link:` externo — origen del bloqueo #0 |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` | Registro del nuevo `packages/design-system` |
| `apps/web/app/globals.css` | `@import '@quivo/design-system/styles.css'` + overrides `--qv-*` |
| `.github/workflows/ci.yml` | Job único `ci`; falta el de Playwright |
| `tests/acceptance/admin-panel.spec.ts`, `playwright.config.ts` | Base E2E ya existente — reusar, no rehacer |
| `apps/mobile/src/features/operacion/use-sync-status.ts:36,107` | Bug 1 (`&&` → `\|\|`) + deps del efecto |
| `apps/mobile/src/features/operacion/next-control-sheet.tsx:37-68` | Bug 2 (stale closure de `PanResponder`) |
| `apps/mobile/src/features/auth/splash-screen.tsx:48,59,71` | Bug 3 (bloqueo sin red, componente en render, timers sin limpiar) |
| `apps/mobile/src/features/perfil/use-operacion-settings.tsx` vs `preferencias-store.ts` | Los dos stores duplicados |
| `docs/handoff.md` | Desactualizado; actualizar al cerrar (regla 5) |

## Verificación

1. `git pull` en el checkout local del CTO (hoy está 1 merge atrás).
2. **Clon limpio en directorio nuevo**: `pnpm install && pnpm typecheck && pnpm test && pnpm build`
   — debe pasar sin ninguna ruta fuera del repo. Es la prueba de que el vendoring funcionó.
3. `gh run list --limit 1` → primera corrida `success` de la historia del repo.
4. `pnpm test:acceptance` (Playwright) verde en local y en CI.
5. `git branch -a` → solo `main` en remoto.
6. `/code-review` antes del PR (regla 2). Sin `/security-review`: la Fase 1 no toca auth, RLS,
   secretos ni endpoints.
7. Cierre: commit → push → PR → CI verde → merge → borrar rama → actualizar `docs/handoff.md`.

## Fuera de alcance

- Migrar `apps/mobile` de Expo SDK 52 a 57 (divergencia con `quivo-mobile-expo`).
- Decidir Railway vs Fly.io (QUI-213) y el deploy de `apps/web` en Vercel.
- Comprar la licencia Transistorsoft / conseguir el Android de gama baja (QUI-216).
- Cambiar el plan de GitHub para habilitar branch protection.
- Reincorporar a Estrella o redistribuir carga entre pasantes (decisión del CTO).

## Decisiones tomadas por el CTO en esta sesión

| Tema | Decisión |
|---|---|
| Design system | Vendorizar en el monorepo. Como el fuente no aparece, se reconstruye |
| Roadmap de Valentina | Reescribir desde cero contra el estado real de `main` |
| Fix de `main` | Subagente en esta misma sesión, no tarea de pasante |
| Issues en Linear | Escribirlas directo, sin borradores previos |
