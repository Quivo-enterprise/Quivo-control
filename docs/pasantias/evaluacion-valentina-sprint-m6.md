# Informe evaluativo — Valentina Trigo · Sprint M6 (UI/UX móvil del conductor)

> Elaborado: 2026-08-13, a pedido del CTO en su rol de encargado de pasantía, para decidir si el
> sprint debía rehacerse. **Veredicto: no se rehace.**
> Base: repo `Quivo-enterprise/Quivo-control` clonado y verificado localmente; ramas
> `qui-227-web-nextjs-scaffold` (linaje A) y `feat/mobile-ui-valentina` (linaje B); `git blame`,
> `git log`, `git show --numstat` y lectura del código. Todo juicio va con `path:line`.
> Calibración: pasante de 8º semestre, primer trabajo real, **sin mentor técnico durante el sprint**
> (reportaba al CPO). Ver [`plan-pasantia-valentina-ago-oct-2026.md`](plan-pasantia-valentina-ago-oct-2026.md).

## 1. Qué entregó, y qué es suyo de verdad

El sprint M6 son 10 issues (QUI-254 a QUI-263), 40 puntos, todas marcadas Done entre julio y el
2026-08-11. Su huella real en la rama del PR #1 son **3 commits**: `95c5e7b` y `a01c9d8` (7-ago) y
`8d20f9a` (9-ago), como `TrigoValentina <tme0032929@est.univalle.edu>`.

`git blame` sobre esa rama:

| Archivo | Líneas suyas | Líneas del CTO |
|---|---|---|
| `splash-screen.tsx` | 183 | 3 |
| `control-feedback-toast.tsx` | 200 | 1 |
| `offline-banner.tsx` | 73 | 0 |
| `driver-login-screen.tsx` | 360 | 63 |
| `next-control-sheet.tsx` | 329 | 38 |
| `vehicle-login-screen.tsx` | 145 | 41 |
| `operation-screen.tsx` | 251 | 445 |
| `perfil-screen.tsx` (QUI-262) | **0** | 323 |
| `ajustes-operacion-screen.tsx` (QUI-263) | **0** | 251 |

Las dos últimas no son suyas **en esta rama**. Su versión vive en el linaje B (§4).

## 2. El hallazgo de proceso, con la cronología exacta

Es lo más importante del informe y **no es un problema de capacidad técnica**.

| Hora | Commit | Qué pasó |
|---|---|---|
| 09-ago | `fb815d3` | Se mergea `feat/mobile-ui-sprint-valentina` a la rama del PR. QUI-263 entra como **stub**: un diálogo "próximamente" |
| **11-ago 00:37** | `a7b0a72` (Valentina) | Implementa `ajustes-screen.tsx` **de verdad**, 248 líneas — en la rama `feat/mobile-ui-valentina`, que **nunca se abre a PR** |
| **11-ago 17:30** | `4952f1a` (CTO) | Audita la rama del PR, encuentra el stub, y **reimplementa QUI-263 desde cero** sin saber que ya existía |

Los dos implementaron la misma pantalla el mismo día, con 17 horas de diferencia. El mensaje de
`4952f1a` lo documenta: *"estaba marcada Done en Linear pero solo mostraba un diálogo 'próximamente'"*.

**Lectura correcta:** no es que declarara terminado algo vacío — lo había hecho. Es que **su trabajo
era invisible para el repo porque nunca abrió un PR**. La consecuencia medible es trabajo duplicado
del CTO. Falla de proceso a ambos lados, con el peso mayor en no abrir el PR.

El mismo `4952f1a` tuvo que conectar el botón "Registrar observación" (tenía `onPress` vacío pese a
que la lógica de outbox ya estaba construida), conectar la llamada de emergencia, renderizar
`errorSync` que se calculaba y nunca se mostraba, corregir placeholders `[CHANGEME]` y `"spike GPS"`
en los permisos de ubicación y en la notificación persistente que ve el conductor, y borrar 3
archivos muertos. Todo eso estaba dentro de issues marcadas Done.

## 3. Evaluación técnica del linaje A

### Veredicto por pantalla

| # | Pantalla (issue) | Veredicto | Motivo |
|---|---|---|---|
| 1 | Splash (QUI-254) | **Rehacer** | `splash-screen.tsx:63-65` bloquea el arranque sin red en una app offline-first; `:48` recrea el componente animado en cada render |
| 2 | Login vehículo (QUI-255) | Retocar | `vehicle-login-screen.tsx:53` delay artificial de 2 s; `:55` normaliza la placa "para el seed" en la vista |
| 3 | Vehículo validado (QUI-256) | Retocar | Bien resuelta; `driver-login-screen.tsx:86-120` sin `accessibilityRole` en el salto a pantalla completa |
| 4 | Confirma identidad (QUI-257) | Retocar | `:79` delay de 2 s; `:29` acepta PIN de 4-6 pero `:199` solo marca válido con ≥6 |
| 5 | Listo para salir (QUI-258) | Retocar | Correcta; arrastra el bug del sheet |
| 6 | Recorrido en curso (QUI-259) | **Rehacer** | Stale closure en `next-control-sheet.tsx:37-67` |
| 7 | Toast de control (QUI-260) | Retocar | `:131` muestra 4 caracteres de un UUID al conductor; `:186` verde `#4CAF50` sin contraste AA |
| 8 | Banner offline (QUI-261) | Retocar | Falta el "minimizar" que pide la issue; `use-sync-status.ts:36` no detecta offline |
| 9 | Perfil (QUI-262) | No evaluable | 0 líneas suyas en este linaje |
| 10 | Ajustes (QUI-263) | No evaluable | 0 líneas suyas en este linaje |

### Los dos bugs que importan

**`use-sync-status.ts:36` — el más caro. Niega funcionalmente QUI-261, la issue de 5 puntos.**

```js
const isOffline = netInfo.isConnected === false && netInfo.isInternetReachable === false;
```

`isInternetReachable` es `null` mientras NetInfo no lo resuelve, lo habitual en Android de gama baja
— el target del proyecto. Con `&&`, `isOffline` queda `false` con el equipo sin red: el banner no
aparece, el badge no dice "(local)" y el intervalo de `:87` sigue intentando sincronizar. Debe ser
`||`. Además `:107` mete `isOffline` en las dependencias del efecto, así que cada cambio de
conectividad destruye y recrea el motor de sync entero.

**`next-control-sheet.tsx:37-67` — stale closure.**

`useRef(PanResponder.create({...}))` evalúa el inicializador una sola vez, así que los handlers
capturan `minimized === false` para siempre. Las ramas `else if (minimized …)` de `:44` y `:54` son
inalcanzables. Efecto real: el conductor minimiza el sheet y **no puede volver a subirlo con el
gesto**; y `:61` lo anima de vuelta a `0` mientras el estado de React dice `true`, dejando UI y
estado desincronizados.

Son la misma familia de error: una clausura de React congela lo que ve en el momento en que se crea.

### Por dimensión

| Dimensión | Nota | Evidencia |
|---|---|---|
| Corrección | **Débil** | Los dos bugs de arriba; `setTimeout(2000)` de demo en `driver-login:79` y `vehicle-login:53` (4 s muertos por jornada, con `isSimulating` como nombre de estado); PIN 4-6 vs feedback ≥6 |
| Estados degradados (pesa doble) | **Débil** | `splash-screen.tsx:63-65`. Acertó el aviso de 80 % de buffer (`operation-screen.tsx:209-213`, umbral 800/1000 bien derivado) |
| Patrones RN/Expo | **Débil** | `splash-screen.tsx:48` `createAnimatedComponent` en el cuerpo del render; `:54-56` y `:74-78` timers sin limpiar → `onReady()` puede dispararse desmontado; imports a mitad de archivo en `use-sync-status.ts:28-29`. Reanimated bien usado en `offline-banner.tsx` |
| Estado y data fetching | Aceptable | No inventó capa propia: usó `usePaqueteDia`, `useSyncStatus` y el outbox SQLite del repo, y extendió `use-sync-status.ts` en vez de duplicarlo. Zod + react-hook-form como el resto |
| Accesibilidad | **Débil** | 0 props propias en `splash-screen`, `vehicle-login-screen` y `offline-banner`; los `accessibilityLabel` de `driver-login:133-134` los agregó el CTO. Toques ≥44 px sí cumplidos. `#4CAF50` sobre blanco ≈2.8:1 falla AA con el token `quivoColors.success` (`#16805D`, ≈4.9:1) ya existente; 19 hex hardcodeados |
| Tests | **Ausente** | Los 17 tests de `apps/mobile` son 4 archivos, todos del CTO. Dejó `simularDeteccion` (`use-gps-operativo.ts:172-181`) con botón `__DEV__`: instinto correcto de verificabilidad, canal equivocado |
| Consistencia con el repo | Aceptable | kebab-case y `features/<dominio>/` respetados. Grieta en idioma: identificadores y comentarios en inglés (`minimized`, `isSimulating`) contra un repo en español, y **ningún commit suyo referencia un ID de Linear** |

## 4. Los dos linajes: A sobrevive, B se archiva

El linaje B (`feat/mobile-ui-valentina`, commit `a7b0a72`) no es un rebase pendiente: es un fork de
un commit que **duplica** lo que A ya hizo mejor y **revierte cuatro commits** de fixes verificados —
`4952f1a`, `a4174e6` (integridad `recorridosCompletados ≤ recorridosAsignados`), `174576a` y
`ac29323` (framework de aceptación Playwright). En B siguen vivos el `'QUIVO — spike GPS'` de la
notificación persistente y 11 `as any` que A ya había tipado.

**Se porta a mano** (no se mergea la rama):

1. `src/app/operation-navigator.tsx` + `gps-provider.tsx` — react-navigation real reemplaza los
   booleanos `showProfile`/`showAjustes`. **La única mejora arquitectónica del sprint.**
2. Cablear los ajustes al comportamiento. En A son teatro: `git grep preferencias-store` devuelve
   solo la propia pantalla, nadie los lee. En B sí están conectados (voz, ahorro de datos, texto
   grande, `trabajarOffline` bloqueando `canStart`). Portar la idea **sobre el `preferencias-store.ts`
   de SecureStore ya existente, sin sumar AsyncStorage**.
3. `expo-speech` para la navegación por voz (`gps-provider.tsx:36-43` de B).
4. El borrado del mock `USE_MOCK` de `paquete-dia-api.ts:8-88` (coordenadas fake de La Paz) que A
   todavía arrastra.

**No se porta:** el endpoint `GET /v1/mobile/perfil` (alias exacto de `contexto-operativo`, mismo
`obtenerContexto`, sin tests, con `@Controller('mobile')` como prefijo pelado); `use-perfil-query.ts`
con `refetchInterval: 60s` (poll permanente de un perfil que no cambia, en app offline-first sobre
datos móviles caros); el skeleton de `perfil-screen.tsx` y su dependencia
`react-native-shimmer-placeholder` — es **código inalcanzable**, porque `initialData` garantiza que
`isLoading` nunca sea true, y arrastra `react-native-linear-gradient`, un módulo nativo fuera del SDK
de Expo. La propia autora lo admite en el comentario B:26-27: *"Mantenemos la lógica de Skeletons
intacta para cumplir con el requerimiento"*.

## 5. Lo que hizo bien

- **Construyó el design system que usa el resto del equipo.** `95c5e7b` creó `Button.tsx`, `Card.tsx`
  e `Input.tsx` reemplazando tres componentes ad-hoc. `Input.tsx:57-58,70-71,88` lleva
  `accessibilityLabel`, `accessibilityHint` y `accessibilityLiveRegion` en el error: **la mejor
  accesibilidad del módulo es suya**, y está donde más se reusa — la consume hasta el modal de
  observaciones del CTO (`operation-screen.tsx:333`).
- **`MiniStepper`** (`next-control-sheet.tsx:317-348`): pagina de a 4 nodos, resuelve el caso borde
  de "bolita solitaria" fusionando la última página (`:330-332`) y convierte base-1 del backend a
  base-0 explícitamente (`:320-322`) — justo el desajuste que produce off-by-one. Comentarios que
  explican el porqué, no el qué.
- **La cola del toast** (`control-feedback-toast.tsx:19-48`) anticipa dos puntos de control casi
  simultáneos sin que nadie se lo señalara: encola y drena de a uno en vez de pisar, con guard
  anti doble-dismiss (`:80`) y limpieza de ambos timers al desmontar (`:72-75`).
- **Diagnosticó un bug en hardware real.** El JSDoc de `use-sync-status.ts:18-26` documenta que en un
  Moto E13 el sync se registraba antes de que resolviera el token y nunca reintentaba. Probar en gama
  baja y dejar el hallazgo escrito para el siguiente es criterio de ingeniería, no de pasante.
- Cumplió requisitos finos que era fácil saltarse: vibración con patrón al reconectar
  (`use-sync-status.ts:40-48`, pedido literal de QUI-261) y el warning de 80 % de capacidad.
- Higiene limpia en lo que suele fallar: **sin secretos, sin TODO/FIXME, sin URLs hardcodeadas**. El
  `pnpm-lock.yaml` de su commit es **+287/−0**, un `pnpm install` incremental normal y bien resuelto.

## 6. Qué corregir, separando lo que se enseña de lo que se exige

**Falta de experiencia — normal en 8º semestre, se enseña y no se repite:**

1. **Clausuras de React.** El stale closure del `PanResponder`, el `&&` de tri-estado de NetInfo y
   los timers sin limpiar son el mismo malentendido. Una sesión de pairing lo cierra.
2. **Estados degradados.** Entregó el happy path completo. En una app offline-first, los estados
   degradados son la mitad del producto.
3. **Commits monolíticos y sin trazabilidad.** `a7b0a72` mezcla API + navegación + 2 pantallas +
   dependencias. Ningún commit suyo referencia un ID de Linear, lo que hace imposible auditar qué
   ticket cerró qué.
4. **Dependencias nativas sin evaluar el costo** en un proyecto Expo managed.

**Falta de disciplina — esto es lo que no se negocia:**

5. **40 puntos marcados Done y cero PRs.** No es que el PR se haya trabado: no existe. De ahí sale
   todo lo demás — el trabajo duplicado del 11-ago, el andamio de demo que llegó a la rama, los
   `onPress` vacíos. **Definición de Hecho = PR mergeado**, no issue arrastrada en Linear.

**Mitigante honesto que corresponde registrar:** no tuvo mentor técnico durante M6, y `4952f1a`
muestra que el equipo tampoco le avisó que estaba reescribiendo su código en paralelo. El diagnóstico
justo es falla de proceso a ambos lados.

## 7. Decisión

**No se rehace el sprint.** De 8 pantallas evaluables, 6 son retoque y 2 se arreglan en un día. El
patrón es consistente: **capa visual sólida, capa de estado asíncrono floja, disciplina de proceso
ausente**. Lo primero se aprovecha, lo segundo se enseña, lo tercero se exige.

Cargado en Linear, ciclo 15 (17–24 ago), **9 puntos de deuda propia antes de cualquier feature nueva**:

| Issue | Pts | Qué |
|---|---|---|
| [QUI-336](https://linear.app/quivo-tech/issue/QUI-336) | 5 | Portar las 4 piezas rescatables del linaje B y archivar la rama |
| [QUI-337](https://linear.app/quivo-tech/issue/QUI-337) | 1 | Limpiar las ramas del sprint M6 y documentar el estado |
| [QUI-348](https://linear.app/quivo-tech/issue/QUI-348) | 3 | Corregir los 4 bugs del sprint M6, en orden de prioridad |

Los arregla quien los escribió: el valor de QUI-348 es formativo. Y QUI-338 (estados de error) y
QUI-346 (indicadores de sync), ya en su backlog, atacan exactamente sus dos dimensiones débiles.

---

**Estado:** entregado al CTO · **Evaluó:** revisión técnica sobre el repo, 2026-08-13 · **Decidió:** CTO
