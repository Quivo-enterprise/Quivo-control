# Plan — cerrar los pendientes reales del PR #51

## Contexto

La sesión del 2026-09-06/07 se cortó por límite de uso a mitad de la verificación del PR #51
(integración del rediseño de Jairo). Dejó tres cosas rotas:

1. **El PR miente sobre su propio contenido.** Su CI verde corrió sobre `07c4a7c`. La rama local
   `integracion/redesign-jairo` está **3 commits adelante** (`7318196`, `56c753f`, `1349870`) y esos
   commits no están pusheados. Lo que hay en GitHub todavía trae el backend de pasajeros completo,
   que ya se extirpó localmente. El título del PR también quedó viejo.
2. **Se perdió trabajo sin commitear.** Los dos worktrees de esa sesión fueron borrados. Los fixes
   de texto invisible, del pipe Zod y del dashboard hay que rehacerlos desde cero.
3. **El handoff no se actualizó** pese a haberse reportado como hecho.

Auditado el commit `1349870` con tres subagentes en paralelo, **dos de los cuatro bloqueantes que
lista el PR ya están muertos** y dos siguen vivos. Además aparecieron dos defectos que el PR no
menciona, uno de ellos introducido por el propio PR.

Resultado buscado: `main` con el rediseño integrado, sin regresiones de seguridad ni de legibilidad,
con el PR reflejando lo que realmente se mergea, y con el bug sistémico de validación arreglado en
su propio PR y con una red de tests que impida que vuelva en silencio.

## Decisiones ya tomadas por el CTO

- **El fix del pipe Zod va en un PR aparte**, después de mergear #51. Es el cambio con mayor radio
  de daño del lote y no debe viajar escondido en un diff de 300 archivos.
- **Las migraciones fuera de orden se renombran** a timestamps posteriores.

## Estado verificado de los bloqueantes

| Bloqueante del PR | Estado real en `1349870` | Evidencia |
|---|---|---|
| `subtitle` de `ModuleTablePage` no renderiza | **Muerto** — lo arregló `4d5d414` | `module-table-page.tsx:119,607-615` |
| `secret-box.ts` cae a `JWT_SECRET` | **Muerto** — el archivo y el módulo `notificaciones` se fueron con la extirpación | sin referencias en `git grep` |
| Migraciones fuera de orden | **Vivo** | 4 carpetas con timestamp < `20260817150000` |
| Aviso de GPS al cerrar sesión | **Vivo, severidad alta** | `cerrar-sesion-dialog.tsx:26-28` |

**No listados en el PR, ambos vivos:**
- **~100 usos de `color:'#ffffff'` sobre superficies claras** en 15 archivos de `apps/web`. Incluye
  los 4 KPIs del dashboard (`page.tsx:321,370,418,466`) — de ahí el falso síntoma "el dashboard
  muestra ceros": los datos llegan bien (`page.tsx:88-101`), el número se pinta blanco sobre
  `--qv-surface-glass` y sólo queda visible el `/ total` gris al lado.
- **`demo-requests.controller.ts:11` sin `@Inject`** — único controller del repo que rompe la
  convención. Bajo cualquier runtime esbuild, `AppModule` no arranca. Lo introdujo este PR.

## Fase 0 — Que el PR refleje la realidad (chairman)

Antes de tocar nada: `git push` de los 3 commits locales a `origin/integracion/redesign-jairo` y
reescribir el título del PR (ya no integra "el backend de pasajeros"). Esperar CI real sobre el
árbol verdadero. **Hoy el PR muestra verde sobre un árbol que ya no es el que queremos mergear —
esa es la parte más peligrosa de la foto y se corrige primero.**

Limpiar los worktrees muertos: `git worktree prune`.

## Fase 1 — Fixes dentro del PR #51

Todo delegado a subagentes Sonnet, en paralelo salvo donde se indique. El chairman revisa cada diff.

### 1.a Colores invisibles en el panel — `apps/web` (subagente A)

~100 ocurrencias en 15 archivos. Patrón único: `color: '#ffffff'` → `color: 'var(--qv-text-primary)'`.

**No es un `sed` global**: el mismo string es correcto en 108 ocurrencias de los mismos archivos
(botones sobre `--qv-color-primary`, simuladores de mapa con fondo `#0c121e`, definiciones de token,
`colorTexto` que es dato de negocio). Se corrige sólo la lista auditada.

`tokens.css:37,107` define `--qv-text-primary` para tema claro **y** oscuro: el hex hardcodeado no
sólo es invisible en claro, rompe el sistema de temas. El token arregla ambos.

Archivos representativos: `app/(dashboard)/page.tsx`, `reglas/page.tsx` (21 ocurrencias),
`rutas/page.tsx`, `rotaciones/page.tsx`, `usuarios/page.tsx`, `reportes/page.tsx`,
`sync-errores/page.tsx`, `lineas/line-form-panel.tsx`, y los cuatro `*-preview.tsx`
(conductor/socio/sindicato/regla), que repiten la misma estructura y conviene resolver de una pasada.

**Caso aparte, no mecánico:** `regla-preview.tsx:343,352` tiene el `color-mix` invertido —
`color-mix(in srgb, var(--qv-surface-card) 90%, black)` da gris casi blanco donde la simulación de
notificación móvil necesita fondo oscuro (lo delatan el `boxShadow` a `rgba(0,0,0,0.4)` y los chips
a `0.2`). Ahí hay que arreglar **el fondo**, y recién entonces el `#ffffff` del texto queda correcto.

Fuera de alcance, sólo anotar: `route-map-impl.tsx:720` usa `'text-color':'#ffffff'` fijo con
`circle-color` dinámico. Es contraste dentro del canvas del mapa, otro problema.

### 1.b Aviso de GPS al cerrar sesión — `apps/mobile` (subagente B)

`apps/mobile/src/shared/components/cerrar-sesion-dialog.tsx`. El rediseño reemplazó el mensaje por
`"Deberas volver a ingresar tus datos para iniciar sesión"` (genérico, y con el typo de la tilde).

Restaurar el texto de `main`: *"Se va a cortar el registro del recorrido hasta que vuelvas a entrar.
El GPS deja de guardar tu viaje mientras tanto."* — y con él el comentario que explica por qué
existe (Hallazgo 2, ALTO de la auditoría post-piloto: `onLogout` dispara el `stop()` nativo
irreversible, apaga `startOnBoot` y nunca encola `fin_recorrido`).

**No revertir el diseño de Figma.** Cambia el texto y el comentario, no el `Modal` ni el
glassmorphism. Los dos call sites (`operation-screen.tsx:562`, `perfil-screen.tsx:150`) no pasan
`message`, así que ambos heredan el arreglo sin tocarlos.

### 1.c Orden de migraciones — `packages/db` (subagente C)

Renombrar 4 carpetas a timestamps posteriores a `20260817150000` (última de `main`) y anteriores a
`20260818163000` (siguiente de la rama), preservando su orden relativo:

| Actual | Nuevo |
|---|---|
| `20260815120000_linea_branding` | `20260817160000_linea_branding` |
| `20260815143000_line_identity_markers` | `20260817161000_line_identity_markers` |
| `20260815160000_linea_cartel_editor` | `20260817162000_linea_cartel_editor` |
| `20260817120000_public_mobility_publication` | `20260817163000_public_mobility_publication` |

Esto resuelve de paso el prefijo duplicado: `20260815120000_linea_branding` compartía los 14 dígitos
con `20260815120000_gps_points_sindicato_rls`, ya aplicada en `main`.

**Trampa:** renombrar cambia el `migration_name` que queda en `_prisma_migrations`. Cualquier base
que ya las haya aplicado las va a ver como nuevas e intentar re-aplicarlas. Producción corre `main`
y nunca las tuvo; la de CI es efímera. **Las bases locales de desarrollo necesitan reset** — hay que
avisarlo en el PR. Verificar antes que la rama no se haya desplegado a ningún ambiente compartido.

Sólo se renombran carpetas: **no se toca una línea de SQL**.

### 1.d `@Inject` faltante — `apps/api` (subagente C, mismo lote)

`demo-requests.controller.ts:11`: `constructor(private readonly demoRequests: DemoRequestsService)`
→ `constructor(@Inject(DemoRequestsService) private readonly demoRequests: DemoRequestsService)`.
Una línea, la convención que ya siguen los otros ~25 controllers.

### 1.e Docs (chairman)

Commitear `docs/plan-cola-terminales.md` y `docs/costos-gcp-por-escala.{md,html}`, que están sueltos.
Los tres PNG de `/en-vivo` no se commitean.

## Fase 2 — Verificación real, no CI

CI ya pasó en verde **con todos estos defectos presentes**: lint, typecheck, build y una suite de
aceptación con Playwright no ven texto blanco sobre blanco. La verificación tiene que ser visual.

- **Panel web**: levantar con `scripts/dev-all.sh`, recorrer con el MCP `playwright` las pantallas
  tocadas (dashboard, reglas, rutas, rotaciones, usuarios, reportes, sync-errores, líneas y los
  cuatro preview) y capturar con `puppeteer` **en tema claro y en tema oscuro**. El dashboard tiene
  que mostrar sus números.
- **App móvil**: el rediseño **nunca se revisó en vivo** — el mismo hueco de evidencia que ya
  destapó el CTO con el panel. Levantar con el MCP `mobile`/Expo Go y confirmar el diálogo de cerrar
  sesión con el texto restaurado.
- **Migraciones**: `prisma migrate deploy` contra una base limpia + `migrate diff` para confirmar que
  el historial dejó de estar desordenado.
- **Gate de UI** (regla 12): skill `web-design-guidelines` sobre los archivos tocados.

## Fase 3 — Cierre del PR #51

`/code-review` sobre la rama, `/security-review` por el aviso de GPS y el endpoint público. Los
hallazgos los aplica un subagente Sonnet nuevo, no el chairman. Después: push → CI → merge → borrar
rama → sincronizar `main` → **actualizar `docs/handoff.md` de verdad** (la vez pasada quedó en un
scratchpad que ya no existe).

Queda registrado en el handoff, sin bloquear el merge:
- `20260829180000` corre `DELETE FROM gps_points WHERE "sindicatoId" IS NULL`. El comentario del SQL
  dice que debería afectar cero filas; **no está verificado contra producción**. Contar antes de
  desplegar.
- `20260819100000` asigna `cityId='cochabamba'` por default a todas las líneas.
- El rol `'pasajero'` sigue en `RolSchema` (`packages/shared/src/enums/roles.ts:5,15`), inerte.

## Fase 4 — PR aparte: el pipe Zod

**El bug.** `ZodValidationPipe` (`zod-validation.pipe.ts:14-15`) decide si validar leyendo
`metadata.metatype`, que Nest resuelve con `design:paramtypes` — metadata que sólo emite `tsc`.
Si no está, hace `return value`: no-op silencioso. Todo el repo usa `@Inject` explícito justamente
porque esbuild no la emite, así que la DI sobrevive y el pipe no.

**Alcance real, más chico de lo que parecía.** Dev ya está bien: `scripts/dev-all.sh:102,272` corre
`tsc --watch` + `node --watch dist/main.js`, con el comentario *"Nest necesita el JavaScript emitido
por tsc para conservar la metadata de decoradores"*. El `"dev": "tsx watch"` de `apps/api/package.json`
es residuo vestigial que nadie invoca — y una trampa. Producción compila con `tsc`, y el job
`acceptance` levanta con `build && start` (`playwright.config.ts:38`), o sea que **ahí el bug no
existe**. El único runtime realmente roto es **vitest**, y es justo donde tiene que vivir la red.

**Los pasos, en este orden:**

1. Alinear (o borrar) `dev`/`dev:worker` de `apps/api/package.json` con lo que ya hace `dev-all.sh`.
   Cero dependencias nuevas: es copiar un comando que el repo corre todos los días.
2. `APP_PIPE` de `useClass` a **`useValue: new ZodValidationPipe()`** en `app.module.ts:70`, con un
   comentario que documente el crash histórico. Con `useClass`, Nest instancia el pipe y lee la
   metadata de su constructor; cuando el pipe gane un constructor eso hace que intente inyectar
   `Function` como token y la app no levante — ya pasó una vez. Con `useValue` le das la instancia
   hecha y Nest nunca inspecciona el constructor: el crash no se evita, se vuelve inalcanzable.
   Es mejor que el `@Optional()` que se usó antes, que sólo tapa el síntoma de un parámetro.
3. `apps/api/vitest.config.ts` nuevo con `unplugin-swc` (+ devDeps `@swc/core`, `unplugin-swc`,
   `@nestjs/testing`, ninguna instalada hoy) para que el runner emita la metadata. **No existe
   ninguna config de vitest en el repo**: hay que crearla. Verificar contra el baseline de 44
   archivos de test antes de seguir.
4. **La red de seguridad**, en vitest, sin infra: `Test.createTestingModule` + `FastifyAdapter`,
   requests con `app.getHttpAdapter().getInstance().inject(...)`. Asertar que
   `GET /v1/public/mobility/lines?limit=50` llega al service con `limit` **número**, y que
   `POST /v1/_internal/validate-demo` con `{}` responde **400** con `issues`. Hoy los dos fallan:
   el service recibe `'50'` string y el POST responde 201. Cubrir `@Query()` y no sólo `@Body()`
   es la diferencia entre "el pipe corre" y "el pipe transforma".
5. Smoke de arranque de `AppModule` (`.compile()`, sin `init()`). Habría atrapado las dos trampas
   históricas: el crash de DI y el `@Inject` faltante. Si queda flaky por BullMQ/ioredis, degradarlo
   a un test que lea la metadata de `providers` y afirme que `APP_PIPE` usa `useValue`.
6. Guardia en `bootstrap()` de `main.ts`, junto a `validateRuntimeConfig()`: verificar que
   `design:paramtypes` existe sobre un método conocido y, si no, morir con un error que nombre
   `emitDecoratorMetadata`. Convierte el no-op silencioso en un crash ruidoso en **cualquier**
   runtime, incluidos los que todavía no existen.

**Riesgo a revisar antes de mergear:** cuando el pipe empiece a validar de verdad en tests van a
aparecer 400 que antes no existían. Es el efecto buscado, pero hay que recorrer los 52 schemas
buscando campos requeridos que los clientes hoy no mandan, y `@Query()` con `.strict()` que
rechazaría params extra. Esa es la revisión que da valor; el tooling es lo fácil.

## Fase 5 — Registrada, fuera de alcance ahora

Migrar los **52 call sites en 27 controllers** a decoradores explícitos `@ZodQuery(XDto)` /
`@ZodBody(XDto)`, para que la validación deje de depender de la reflexión. Se puede hacer
incremental **siempre que el `APP_PIPE` global siga registrado durante toda la migración** (validar
dos veces contra el mismo schema es idempotente); quitarlo debe ser el último commit. El decorador
tiene que recibir la **clase DTO**, no el schema suelto: el compilador no puede verificar la
correspondencia, pero con el identificador repetido en la línea un mismatch es visible y greppable.

## Verificación de que el plan se cumplió

- `git log origin/main` incluye el merge de #51; la rama borrada; `main` local sincronizado.
- `git grep -c "'#ffffff'" apps/web` sólo devuelve las 108 ocurrencias legítimas.
- Capturas del dashboard y de las 8 pantallas en tema claro y oscuro, con los números visibles.
- Captura del diálogo de cerrar sesión de la app móvil con el aviso de GPS.
- `prisma migrate diff` sin reporte de historial desordenado.
- En el PR del pipe: el test HTTP en verde, y demostrado que falla si se revierte el paso 3.
- `docs/handoff.md` actualizado en el repo, no en un scratchpad.
