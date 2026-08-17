# Plan de asignación — Valentina Trigo · QUIVO Control + app pasajero · ago–oct 2026

> Elaborado: 2026-08-13. Gemelo estructural de `plan-pasantia-adrian-ago-oct-2026.md` y `plan-anett-quivo-pay-ago-oct-2026.md`. Primer plan propio de Valentina: hasta hoy su único trabajo trackeado fue el sprint M6 de UI/UX móvil (10 issues, 40 pts, todas Done al 2026-08-11), sin plan escrito detrás.
> Base: `Perfiles Academicos Pasante/Perfil Académico Valentina.docx` (cargado 2026-08-13), backlog de Linear (workspace Quivo-Tech, team QUI), estado real de `Quivo-enterprise/Quivo-control` verificado vía `gh` el 2026-08-13, `guion-presentacion-area-tecnologia.md`.
> **Cambio de mentor (decisión del CTO, 2026-08-13):** Valentina pasa de reportar al CPO (sprint M6) a reportar al CTO. La revisión de sus PRs y la definición de sus tareas quedan del lado técnico.

## 1. El perfil, contrastado contra el stack real

| Lo que trae | Lo que piden los frentes habilitados | Brecha |
|---|---|---|
| React, Next.js, Node.js, TypeScript, Tailwind | `Quivo-control`: `apps/web` = Next.js, `apps/api` = NestJS, `apps/mobile` = Expo/RN, `packages/shared` = Zod. TS punta a punta | **Ninguna.** Coincidencia casi exacta |
| React (web) | `quivo-mobile-expo` (app pasajero): Expo SDK 57, RN 0.86, React 19, TS, Zod, TanStack Query | Menor: RN ≠ React DOM, pero ya la salvó sola en el sprint M6 |
| SQL (MySQL, SQL Server, Oracle) | Postgres + PostGIS + Prisma + RLS multi-tenant | Media: Postgres y RLS son nuevos; PostGIS es especializado |
| Git, GitHub, Docker | Flujo rama→PR→CI→review→merge, monorepo pnpm/Turborepo | Menor: el monorepo y Turborepo son nuevos |
| ESP32, AD8232, C++/Arduino (2º lugar TECHMAKERS 1-2024) | — | No aplica: el frente de hardware está vedado (§2) |
| — | `Quivo-dashboard`: **SvelteKit 2 + Svelte 5 (runes)** | **Alta.** Svelte no está en su perfil. Solo entra como estirable (§6) |
| — | Backend G0: **Go + Terraform/GCP** | **Total.** No declara ninguno de los dos. Vedado (§2) |

**Lectura:** es la pasante mejor alineada del grupo con el stack real de la empresa. De las tres, es la única cuyo perfil declara exactamente lo que corre en `Quivo-control` (React/Next/Node/TS). Ya lo demostró: entregó 10 pantallas del móvil del conductor (40 pts) sin plan formal y sin mentor técnico asignado. Sus dos proyectos académicos citados —el ECG con ESP32 y la plataforma web del SEDES Cochabamba con React/Next/Node/Tailwind— confirman que el segundo no es teoría de aula.

**Consecuencia de planificación:** no necesita rampa de aprendizaje de stack; necesita rampa de **proceso**. El problema que revela su sprint M6 no es técnico, es de flujo: sus 10 issues figuran Done en Linear pero **su código nunca pasó por un PR**. Este plan arranca cerrando esa brecha, no enseñándole React.

## 2. Lo que está vedado, y por qué no es negociable

| Bloque | Issues/áreas | Motivo |
|---|---|---|
| Validador — App Kotlin | Proyecto "QUIVO Pay — App del Validador (Kotlin)" completo (QUI-303, 304, 318–327, 333…) | Decisión del CTO 2026-08-13: frente exclusivo suyo + Adrian. No se reparte, aunque el perfil de Valentina tenga ESP32/C++ |
| Validador — Hardware H111 | Proyecto "QUIVO Pay — Validador H111" completo | Ídem. Además requiere la unidad física |
| QUIVO-ERP | Proyecto entero (hoy con 0 issues creadas) | Exclusión explícita del CTO |
| Backend Go de Pay | QUI-268/269/270/278/283/290/291/316 y afines | Go no está en su perfil, y el bloque de integridad temporal es el más urgente del proyecto: no es terreno para aprender un lenguaje nuevo |
| Infra GCP / Terraform | QUI-271/272/282/285/297, QUI-284, QUI-293 | Credenciales de producción + facturación. Nivel de acceso que ninguna pasante tiene |
| Seguridad y antifraude | QUI-292 (topes de gasto offline), QUI-300 | Superficie de fraude con tarjetas sin criptografía. Requiere revisión del CTO, no delegación |
| Decisiones de arquitectura y gates | QUI-216 (gate GPS GO/NO-GO), troceo del PR #1 | Son decisiones del CTO. Valentina puede aportar instrumentación y datos, no el veredicto |

Queda fuera, entonces, todo lo que es Kotlin, Go, Terraform o decisión estructural. Lo que queda dentro es TypeScript de punta a punta: `apps/mobile` y `apps/web` de Control, y la app pasajero de Pay.

## 3. Capacidad asumida

| Concepto | Valor |
|---|---|
| Horas nominales | 4 h/día × 5 días = **20 h/semana** |
| Factor de foco (Estándar §3) | 0,7 |
| Horas efectivas | 20 × 0,7 = **14 h/semana** |
| Presupuesto bruto de pasantía | 280 h sin fecha de cierre → 196 h efectivas ≈ **65 pts** totales |
| Sprint M6 (10 issues, 40 pts) | **No descuenta** — decisión del CTO 2026-08-13: fue un tramo aparte bajo el CPO |
| Disponible para este plan | **~65 pts** |
| Ritmo objetivo | **~4 pts/semana** desde el ciclo 16 (el 15 pesa menos: es deuda y proceso) |
| Total comprometido abajo | **34 pts en 8 ciclos**, con ~31 pts de margen para el banco de estirables (§6) |

Presupuesto resuelto: el plan corre completo hasta el ciclo 23 (19-oct) y queda holgura real para los estirables, sin recortar nada de lo comprometido.

## 4. El plan, ciclo por ciclo

Ciclos semanales lunes-a-lunes, 1:1 con los *cycles* de Linear. El ciclo 14 (10–17 ago) ya está corriendo y no se toca; Valentina arranca en el **15 (17–24 ago)**.

Todas cargadas en Linear el 2026-08-13, asignadas a Valentina. Linear promueve a *Todo* cualquier issue con ciclo asignado, así que ninguna quedó en Backlog literal.

| Ciclo | Fechas | Issues | Pts | Por qué esta issue y no otra |
|---|---|---|---|---|
| **15** | 17–24 ago | **QUI-336** Portar lo rescatable de `feat/mobile-ui-valentina` y archivar la rama · **QUI-337** Limpiar las ramas del sprint M6 y documentar el estado · **QUI-348** Corregir los 4 bugs del sprint M6 | 5 + 1 + 3 = **9** | Su propia deuda primero, y el ciclo creció con el informe evaluativo (§7). El linaje B se archiva sin merge: revierte cuatro commits de fixes ya verificados. Se portan a mano solo 4 piezas, entre ellas la única mejora arquitectónica del sprint (react-navigation real). QUI-348 la arregla quien escribió los bugs: el valor es formativo. No se le asigna feature nueva hasta que esto cierre con PR y revisión — es la Definición de Hecho del §4.3 del guion, que su sprint M6 nunca cumplió |
| **16** | 24–31 ago | **QUI-338** Estados de error y edge cases de la app del conductor | **5** | Es la contracara de las 10 pantallas que ella misma construyó: el sprint M6 cubrió el happy path y nada más. Nadie conoce ese código mejor que ella, y la app es offline-first — los estados degradados son la mitad del producto, no un pulido |
| **17** | 31 ago – 7 sep | **QUI-346** Indicadores de sincronización y cola offline visibles al conductor | **3** | Cierra el hilo de QUI-338 con la parte que el conductor sí ve. Cargada en Linear como *blocked by* QUI-338 |
| **18** | 7–14 sep | **QUI-339** Auditoría de accesibilidad y contraste de `apps/web` · **QUI-347** Aplicar los fixes que salgan de la auditoría | 2 + 3 = **5** | Cambia de superficie sin cambiar de stack. La auditoría es de riesgo cero (no toca lógica) y le da contexto de `apps/web`, donde todavía no trabajó. QUI-347 quedó *blocked by* QUI-339 |
| **19** | 14–21 sep | **QUI-340** Tests E2E con Playwright de los flujos críticos del admin | **5** | El repo ya tiene `playwright.config.ts` pero la cobertura real de `apps/web` está sin verificar. TS puro, alto valor de regresión, y la obliga a leer el admin entero |
| **20** | 21–28 sep | **QUI-341** Pase visual/motion de la app pasajero: contraste WCAG y conteo escalonado | **3** | ⚠️ **Alcance a redefinir.** Al cargarla se verificó que los commits `c414608` y `41a49b9` (28-jul, PRs #26/#27) **ya ejecutaron las etapas 1–2** del plan: `mutedOnLight` existe y se usa, `use-animated-centavos.ts` está cableado con test. El doc `plan-pase-visual-motion.md` quedó sin archivar y se leyó como pendiente. La issue queda creada con nota: o pasa a "verificar y regresionar", o se reemplaza por un estirable |
| **21** | 28 sep – 5 oct | **QUI-342** Estados vacíos, filtros y exportación del dashboard de cumplimiento | **5** | Primera tarea de producto real en `apps/web`: pantalla existente (QUI-246, ya Done), mejora incremental, sin riesgo estructural. A esta altura ya conoce el admin por QUI-339 y QUI-340 |
| **22** | 5–12 oct | **QUI-343** Onboarding de `apps/web` y `apps/mobile` verificado en máquina limpia | **2** | Control no tiene el equivalente de QUI-311/313 que sí existe en G0. Lo hace quien ya sufrió el setup, y sirve para la próxima persona que entre al repo |
| **23** | 12–19 oct | **QUI-345** Tests de regresión de contraste y accesibilidad de la app pasajero | **2** | `src/theme/__tests__/contrast.test.ts` ya existe y corre bloqueante en CI, pero solo cubre los pares de tokens conocidos. El alcance es **extender cobertura**, no crear desde cero — la descripción ya se ajustó a eso |

**Total comprometido: 39 puntos en 8 ciclos** (el 15 cuenta como ciclo de deuda/proceso, no de feature). Los ciclos 24–25 quedan deliberadamente vacíos como margen de desborde antes de tocar el banco de estirables.

### Reparto por naturaleza del trabajo

| Bloque | Puntos | % |
|---|---|---|
| App móvil conductor (Control, Expo/RN) | 8 | 21% |
| Admin web (Control, Next.js) | 15 | 38% |
| App pasajero (Pay, Expo/RN) | 5 | 13% |
| Proceso, deuda de git y corrección de su propio sprint | 11 | 28% |

Ninguna línea toca Go, Kotlin, Terraform ni el validador. El 28 % de proceso y deuda es alto a
propósito: el informe evaluativo (§7) concluyó que su brecha es de disciplina de flujo, no técnica.

## 5. Bloqueantes antes del lunes 17 de agosto

1. 🔴 **El PR #1 no se puede mergear: su CI está en rojo, y no por culpa de Valentina.** Verificado el 2026-08-13 con `gh` y reproducido en un clon limpio: `@quivo/web#typecheck` falla con `Cannot find module '@quivo/design-system'`. La causa es que `apps/web/package.json` declara `"@quivo/design-system": "link:../../../Design_System_QUIVO/packages/design-system"` — un symlink a un repo hermano que **no existe en CI ni en ninguna máquina que no sea la del autor**. El propio `handoff.md:673` ya lo admitía. Los "278 tests verdes, 7/7 paquetes" que declara el cuerpo del PR no salieron de ese CI. **Arreglo previo obligatorio**: publicar `Design_System_QUIVO` como paquete consumible (registry privado, submódulo o carpeta dentro del monorepo) y reemplazar el `link:`. Hasta entonces `main` no puede recibir el PR y ningún PR de Valentina puede ponerse en verde.
2. 🔴 **`turbo.json` está enmascarando la señal de seguridad de RLS.** `globalPassThroughEnv` declara solo `DATABASE_URL`, no `RUNTIME_DATABASE_URL`. Como turbo filtra el entorno de los subprocesos, `pnpm test` hace que Prisma caiga al rol superusuario de migraciones, que **ignora RLS por definición de Postgres**: 12 de 17 tests de `packages/db` "fallan" mostrando fugas cross-tenant que no existen. Corriendo `vitest` directo con el rol `quivo_app`, los 17 pasan. Las políticas RLS están bien; el harness las evade. Es un falso negativo hoy, pero el día que RLS se rompa de verdad **la suite no lo va a ver**. Arreglo de una línea, prioridad alta.
3. **Estado real de los tests, para el registro**: 293 pasando, no 278 (`api` 196 vs 181 declarados; `shared` 41, `web` 22, `mobile` 17, `db` 17). El conteo del PR está desactualizado, no inflado.
4. ✅ **Repo clonado** en `/home/shadowfreak/Documents/Quivo-App/Quivo-control` el 2026-08-13, con las 4 ramas fetcheadas y `docker-compose` (postgres+postgis, redis) levantado y migrado.
5. ✅ **Presupuesto resuelto** (CTO, 2026-08-13): el sprint M6 fue un tramo aparte bajo el CPO y no descuenta.
6. ✅ **Proyecto "QUIVO Pay — App pasajero" creado** en Linear (`c4a5e7e6-f222-4aed-96bb-f44dd7d669ad`) para trackear `quivo-mobile-expo`, que hasta ahora no tenía ninguno.
7. **Agregarla como *member* de los proyectos** "QUIVO Control — MVP" y "QUIVO Pay — App pasajero": `save_project` no expone el campo de miembros y Linear no los agrega solo por tener issues asignadas (mismo pendiente que se detectó con Adrian). Requiere hacerlo a mano en la UI.
8. **Permisos en Linear**: figura como `admin`. El guion (§Anexo A) pide `member`, pero el CTO decidió el 2026-08-09 que las pasantes quedan como admin. Vale la decisión del CTO; lo que hay que corregir es el guion, no el permiso.

## 6. Banco de estirables

| Estirable | Pts | Condición |
|---|---|---|
| Desbloquear `Quivo-dashboard`: comparación Manual de Marca V2 vs. diseños Stitch, como insumo de la decisión de paleta | 2 | Solo si el CTO quiere destrabar el repo. La decisión estética es suya; ella prepara la comparación, no elige |
| Primera pantalla real de `Quivo-dashboard` (SvelteKit) | 5 | Requiere la paleta decidida **y** aceptar que aprenda Svelte 5 runes (stack fuera de su perfil) |
| Instrumentación de telemetría para el spike GPS QUI-216 (batería, Doze) — sin el veredicto GO/NO-GO | 3 | Requiere hardware Android de gama baja disponible. El gate lo decide el CTO |
| Apoyo en pareja a QUI-298 (load test k6, JS) | 2 | Ya asignada a Anett — coordinar antes, no reasignar |
| Paginación y exportación de reportes operativos (sobre QUI-249, Done) | 3 | Solo si V9 muestra que el CSV streaming actual no aguanta volúmenes reales |

Ninguno de estos entra sin que un ciclo comprometido se libere primero. No se reestima hacia abajo lo ya comprometido para hacerles lugar.

## 7. Cómo se evalúa

| Criterio | Qué se mira |
|---|---|
| Definición de Hecho, esta vez completa | Los 5 puntos del §4.3 del guion, con foco en el que falló en M6: **PR con descripción + CI en verde + revisión aprobada** antes de mover la issue a Done. Que una pantalla "funcione en su máquina" dejó de contar |
| Estados degradados, no solo el happy path | V3, V4 y V11 existen porque el sprint M6 entregó las pantallas felices. Se mide si empieza a proponer los casos de error sin que se los pidan |
| Precisión de implementación contra spec escrita | V8 tiene el plan ya redactado línea por línea: se mide cuánto se desvía de una especificación exacta |
| Autonomía en superficie desconocida | V5, V7 y V9 la sacan del móvil hacia el admin web. Se mide cuánto pregunta y, sobre todo, si pregunta **en el canal** y no en privado (regla 4 del §6 del guion) |

Sumados a la rúbrica semanal general del Estándar de trabajo.

## 8. Informe evaluativo del sprint M6

Pedido por el CTO el 2026-08-13 para decidir si el sprint debía rehacerse. Documento completo:
[`evaluacion-valentina-sprint-m6.md`](evaluacion-valentina-sprint-m6.md). Resumen:

- **No se rehace.** De 8 pantallas evaluables (2 no son suyas en el linaje del PR), 6 son retoque y
  2 se arreglan en un día.
- **Patrón:** capa visual sólida, capa de estado asíncrono floja, disciplina de proceso ausente.
  El design system (`Button`/`Card`/`Input`) que usa todo el equipo es suyo, y es donde está la mejor
  accesibilidad del módulo.
- **Dos bugs de peso**, de la misma familia (clausura de React congelada): `use-sync-status.ts:36`
  usa `&&` sobre el tri-estado de NetInfo y niega funcionalmente QUI-261; `next-control-sheet.tsx:37-67`
  tiene un stale closure que impide restaurar el sheet minimizado.
- **Raíz de todo:** 40 puntos marcados Done y cero PRs. Su implementación real de QUI-263 existía en
  una rama invisible desde el 11-ago 00:37; el CTO la reimplementó desde cero 17 horas después.
  Falla de proceso a ambos lados — no tuvo mentor técnico en M6 — con el peso mayor en no abrir PR.

---

**Estado:** aplicado en Linear el 2026-08-13 — 11 issues (QUI-336 a QUI-347) creadas y asignadas, proyecto "QUIVO Pay — App pasajero" creado. Bloqueado para arrancar por los bloqueantes 1 y 2, que son deuda del repo, no de la pasante · **Decidió:** CTO · **Elaborado:** 2026-08-13
