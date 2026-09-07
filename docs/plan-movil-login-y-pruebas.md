# Plan — login móvil real, arnés de pruebas y salida al GCP nuevo

> **Estado:** aprobado por el CTO el 2026-09-07. Sin implementar.
> Reemplaza al plan de cierre del PR #51 ([`plan-cierre-pr51.md`](plan-cierre-pr51.md)), ya ejecutado.

## Contexto

Se pidió un plan para probar la app móvil (`apps/mobile`, Expo/Android, GPS en background con
Transistorsoft 5.4.0), contemplando estructura, seguridad y código, sabiendo que el backend se
muda a un proyecto GCP nuevo.

Al investigar antes de planificar aparecieron **cuatro bloqueantes que hacen que "probar la app"
hoy sea teatro**. Ninguno se arregla con más casos de prueba: son estructurales.

## Decisiones del CTO

- **Login:** se queda el login nuevo de un solo paso. Hay que hacerlo real en el backend.
- **Datos:** se migran los datos del piloto al GCP nuevo (no se arranca de cero).

## Objeción registrada (dicha una vez, decisión tomada)

El segundo paso del login existía para **probar la identidad del conductor**. El producto imputa
cumplimientos y sanciones a una persona: un login que prueba "este vehículo" y deduce el chofer de
la planilla no sostiene esa imputación.

Por eso el diseño usa **placa + PIN del conductor**, no del vehículo: una sola pantalla con dos
campos (cumple el Figma) sin perder la atribución.

**La degradación de seguridad es real y no la compensa nada del todo:** la placa está pintada en la
puerta, así que el PIN del conductor queda como **único secreto** frente a un identificador
público. Relativo al APK que hoy está desplegado no se pierde nada —ahí el CI y el PIN del chofer
ya son constantes del binario, así que el único secreto real ya era el PIN del vehículo—, pero
relativo al diseño original de dos pantallas **sí se pierde un factor**. Convivible en un piloto de
2 vehículos; **hay que revisarlo antes de escalar a un sindicato entero**.

---

# Bloqueante 1 — el login no funciona con datos reales

## 1.a Credenciales demo clavadas en el binario

`apps/mobile/src/features/auth/use-auth-movil.ts:226-263` completa el segundo paso con
`CI_CONDUCTOR_DEMO = '1000101 LP'` y `PIN_CONDUCTOR_DEMO = '135790'`, **sin gate de `__DEV__`**.
`apps/api/src/modules/auth-movil/auth-movil.service.ts:145-156` busca al conductor con
`sindicatoId` + `documentoIdentidad`: para cualquier sindicato real ese CI no existe → 401.

El conductor ve *"Las credenciales no son válidas"* señalando el PIN del vehículo, que escribió
bien. No es una falla silenciosa: es una falla con mensaje engañoso.

## 1.b Validación duplicada en la pantalla — una causa, tres síntomas

`vehicle-login-screen.tsx:13-22` **reimplementó a mano** validaciones que ya existen en
`@quivo/shared` (paquete del que `apps/mobile` ya depende, `package.json:23`, pero que esa pantalla
no importa):

| Síntoma | Pantalla | Fuente de verdad |
|---|---|---|
| Placa de 3 dígitos imposible de tipear | `/^\d{4}-[A-Za-z]{3}$/` + máscara rígida (`:14,20-22`) | `PATRON_PLACA_ACTUAL_BOLIVIA = /^\d{3,4}[A-Z]{3}$/` (`vehiculo.ts:40`) |
| PIN de 4-5 dígitos pasa el cliente y vuelve 400 | `z.string().min(4)` (`:15`) | `PinMovilSchema = /^\d{6,12}$/` (`auth/mobile.ts:7-9`) |
| Mensajes de error propios, distintos del backend | literales locales | `PlacaVehiculoSchema` ya distingue formato anterior al reemplaque |

**Las placas del piloto (`1111AAA`, `2222AAA`) son de 4 dígitos, así que hoy esto NO bloquea el
piloto** — pero bloquea cualquier placa de 3 dígitos, que es formato boliviano válido. Ya hubo un
incidente por formato de placa (`handoff.md:962`, `placa: 'PILOTO001'`).

**El arreglo es importar los schemas de `@quivo/shared`, no ensanchar el regex.** Si se parchea el
regex, el mismo defecto vuelve en la próxima pantalla.

## 1.c Premisa corregida: el login de 2 pasos tampoco funciona sin asignación

`autenticarConductor` ya tira 404 si no hay asignación (`auth-movil.service.ts:177-182`), con
filtro `fecha = fechaActualBolivia`, `estado:'vigente'`, `venceAt > ahora`,
`rotacion.estado='publicada'` (`:452-466`). El login de un paso basado en `Asignacion` **no pierde
nada ahí**; sólo cambia *cuándo* se descubre la falta.

## 1.d Contrato del endpoint nuevo

```
POST /v1/mobile/auth/sesion
{ placa, pin: /^\d{6,12}$/, deviceId }
```

| Código | Cuándo |
|---|---|
| 200 `status:'autenticado'` | 1 conductor válido, 1 asignación |
| 200 `status:'seleccion_requerida'` + `seleccionToken` | 1 conductor válido, ≥2 asignaciones hoy |
| 401 `'Placa o PIN incorrectos'` | placa desconocida · ningún PIN coincide · >1 coincide |
| 409 `'<Nombre>, hoy no tenés una rotación publicada para <placa>'` | PIN válido, sin asignación vigente |
| 429 + `retryAfterSeconds` | lockout progresivo por vehículo |

`POST /v1/mobile/auth/sesion/asignacion` `{ seleccionToken, asignacionId, deviceId }` → 200
`autenticado`.

**El 409 es lo que arregla el bug de verdad**: hoy un chofer con PIN correcto y sin rotación
publicada ve "credenciales no válidas", lo que lo manda a probar PINs.

**`DesafioAuthMovil` se recicla como `seleccionToken`** (`schema.prisma:468-486`): misma tabla, cero
migración. Cambia la semántica — hoy se emite *antes* de probar identidad, ahora *después*, con
`conductorId` ya poblado, lo que lo vuelve inofensivo como oráculo.

## 1.e Candidatos y fallback

1. **Nivel 1 (autenticación):** conductores con `Asignacion` sobre ese vehículo hoy, vigente y
   publicada. **Cardinalidad máxima estructural 3**, garantizada por
   `@@unique([vehiculoId, fecha, horario])` (`schema.prisma:459`) — no es una estimación.
2. **Nivel 2 (sólo si el 1 no matcheó):** conductores con cualquier asignación sobre ese vehículo en
   `[hoy-30d, hoy+7d]`, **tope duro de 20**. Si matchea exactamente uno → **409 con nombre y motivo**.

**No** comparar contra todos los conductores activos del sindicato: scrypt es lento a propósito y
con 200-300 choferes son decenas de segundos de CPU en un endpoint no autenticado.

**Caso sin salida conocido:** chofer nuevo + vehículo nuevo + cero historial → 401 sin camino de
login. Es correcto (el arreglo es publicar la rotación), pero **va a pasar en la calle** y hoy no
hay UI que lo explique.

## 1.f Colisión de PIN — y el arreglo que cierra dos defectos

`>1 válido` → 401 genérico + `Sentry.captureMessage` de severidad alta. Con 3 candidatos y PIN de 6
dígitos, la probabilidad por vehículo-día es ~3×10⁻⁶. **No** pedir el CI como desempate: sería un
tercer campo permanente para un evento que no ocurre.

Pero eso sólo vale si los PINs son aleatorios, y hoy nada lo garantiza: `establecerPin`
(`auth-movil.service.ts:377-380`) acepta `123456` o `000000`. **Un solo cambio cierra la colisión y
el PIN débil:** un endpoint que **genera** el PIN server-side con CSPRNG, lo devuelve una vez al
admin y lo hashea.

## 1.g Compensaciones de seguridad — obligatorias, no opcionales

1. **Lockout por `vehiculoId` en base de datos, no por IP.** El `@Throttle` del controller
   (`auth-movil.controller.ts:24,30`) usa `req.ip` con `trustProxy: true` (`main.ts:29`); los
   choferes salen por **CGNAT de Entel/Tigo y comparten IP**. Un límite por IP bloquea legítimos y
   no frena al atacante. El throttler queda como capa externa, **no como el control**.
2. **Retraso exponencial, no bloqueo duro.** Con la placa pública, un bloqueo duro es un botón de
   "dejá a este trufi sin GPS" que cualquiera aprieta. `retryAfterSeconds = min(2^(fallos-3), 60)`
   desde el 3er fallo, reset en el primer éxito. 10⁶ a 1 intento/minuto ≈ 2 años.
   Tabla nueva `IntentoAuthMovil(vehiculoId @unique, fallos, bloqueadoHasta, updatedAt)` —
   **única migración de todo el plan**.
3. **Normalizar el tiempo de respuesta a K=3 verificaciones scrypt.** `DUMMY_HASH_PROMISE`
   (`:24,157-159`) hoy cubre "cero candidatos", pero con un set de tamaño 0..3 **el tiempo filtra si
   ese vehículo tiene rotación hoy**. Medir el costo real de scrypt antes de fijar K.
4. **El `deviceId` no es un control de seguridad** — lo genera el cliente
   (`sesion-movil-store.ts:57-64`) y rotarlo es gratis. Sirve para correlación y para revocar
   sesiones huérfanas del mismo dispositivo. No venderlo como factor.

**Impacto de un compromiso, para dimensionar:** el login nuevo revoca las sesiones activas del mismo
vehículo (`auth-movil.service.ts:231-244`), así que un PIN adivinado no sólo suplanta — **deja al
chofer real sin sesión y sin GPS**.

## 1.h Compatibilidad: no versionar nada

Los 2 teléfonos en la calle **no dependen del contrato de login**: el refresh token dura 30 días
(`:214-217`) y la sesión se restaura desde SecureStore. Mientras `/refresh`, `/contexto-operativo`,
`/logout` y sync no cambien, romper `/vehiculo` + `/conductor` no los toca.

Endpoints viejos detrás de `MOBILE_LEGACY_AUTH_ENABLED` (default `true`) → build 8 a los 2
teléfonos → verificar → flag en `false` → borrar. **Sin `/v2/`, sin negociación de contrato**:
versionar una API para 2 dispositivos propios es ceremonia.

## 1.i Migración de PINs

`Conductor.credencialHash` ya es scrypt de Better Auth y el endpoint nuevo usa la misma
`verifyPassword`: **cero migración de datos**. Aun así **rotar los PINs del piloto**, porque cambió
el modelo de amenaza (de segundo factor a único secreto) y es la ocasión de emitirlos con el
generador CSPRNG.

**Trampa:** `establecerPin` revoca sesiones al rotar (`:395-402`) — hacerlo con el vehículo en el
depósito, no a mitad de recorrido.

---

# Bloqueante 2 — la suite no puede ver esta familia de bugs

116 tests, 10 archivos, **todos `.ts`, ninguno `.tsx`**. Sin `@testing-library/react-native`, sin
`vitest.config.*` en todo el repo, sin entorno DOM: **ningún hook ni componente se monta jamás**.
Lo testeado son funciones puras extraídas y está bien hecho. Los bugs viven en el **pegamento entre
efectos**.

Peor: el único test de auth mockea el módulo `auth-movil-api` **entero**, así que su "401" es un
`new Error('401')` y nunca ejercita el mapeo `Response{status:401}` → `AuthMovilApiError`.

## 2.a Runner: `jest-expo` en `apps/mobile`, vitest en el resto

La "homogeneidad del monorepo" que se rompería es una devDependency, no un contrato: turbo invoca
`pnpm test` por paquete y no le importa qué corre adentro.

Contra vitest+RNTL en este repo: `vehicle-login-screen.tsx:11` importa un `.png` (vitest sin
transformer de assets revienta **al importar justo la pantalla que más hay que testear**);
`babel.config.js` declara el plugin de Reanimated; RN 0.81.5 distribuye fuente con tipos Flow que
esbuild no parsea; y habría que mockear a mano ~11 nativos que `jest-expo` ya resuelve.

**Fricción que hay que pagar, sin esconderla:** migración mecánica de los 10 tests
(`from 'vitest'` → globals de jest, `vi.` → `jest.`) y `transformIgnorePatterns` que incluya
`@quivo/shared` (ESM). Media jornada, no una semana. Es la pieza que más probablemente consuma más
tiempo del estimado.

## 2.b Mock a nivel `fetch` — verificado viable

Los dos clientes usan `fetch` global directo (`http-client.ts:47`, `auth-movil-api.ts:88`) y leen
`EXPO_PUBLIC_API_URL` en **module scope**, así que el setup debe definir esa env en `setupFiles`,
antes de importar. **MSW v2** para que los tests se escriban como "el servidor responde 401" y no
como "la promesa rechaza".

## 2.c Los cinco tests

| # | Qué prueba | Por qué falla hoy |
|---|---|---|
| T1 | El login manda **una** request y su body no contiene `'1000101 LP'` ni `'135790'`; el 401 llega como `AuthMovilApiError{status:401}` | Hoy manda **dos** requests y la segunda lleva las constantes |
| T2 | Con `/refresh` respondiendo siempre 401, en 10 min hay **≤6** requests | `use-sync-status.ts:8,179` llama `obtenerAccessToken` cada 15 s y `use-auth-movil.ts:311-329` no tiene backoff ni tope ⇒ ~41 requests |
| T3 | `fin_recorrido` cierra la sesión; `logout` registra cuando no cerró nada | Ninguna de las dos existe: el evento sólo va a bitácora y `updateMany` devuelve `count:0` que nadie mira |
| T4 | Una sesión que cruza el borde de jornada no reporta `sin_datos`; un zombi no se ordena arriba de una sesión fresca | El LATERAL acota a la jornada de hoy y el `ORDER BY ... NULLS LAST` invierte el orden al arreglarlo |
| T5 | `syncFalloDefinitivo` llega a la pantalla | Cero consumidores fuera de `use-sync-status.ts` |

**Raíces compartidas — un arreglo, no varios:**
- **T2:** el defecto es que `refrescar()` no recuerda los fallos definitivos. Un `Set` de refresh
  tokens muertos cierra **a la vez** la ruta de `refrescarConReintentos` y la de
  `obtenerAccessToken`. **No escribir dos backoffs separados.**
- **T3/T4:** las sesiones colgadas existen porque **nada** cierra una sesión. El
  `OR (so.fin IS NULL AND so.estado='activa')` de `en-vivo.service.ts:202` es un parche para
  convivir con ellas. Arreglar el ciclo de vida baja el volumen; el fix de la query sigue haciendo
  falta porque un teléfono perdido igual deja sesiones abiertas. El job repeatable a copiar es
  `rotaciones/vencimiento.processor.ts`.
- **T4, arreglo concreto:** ventana del LATERAL a cotas constantes `[ahora-36h, ahora+2h)` —sigue
  siendo constante, así que conserva la poda de particiones— y
  `ORDER BY greatest(fix."ultimoIngresoTs", so.inicio) DESC`, que resuelve la trampa en una sola
  expresión.

## 2.d CI

Al pasar `apps/mobile` a jest, **el paso `Test` existente ya corre los tests móviles**: cero YAML.
Un job `mobile` sin Postgres ni Redis (~2 min) sólo si el tiempo de CI molesta.

**No** meter builds de EAS en CI: 15-25 min y créditos, y con 2 dispositivos el build se dispara a
mano. `tsc --noEmit` por PR es la garantía que importa.

## 2.e E2E: no ahora

Detox queda descartado (build nativo por corrida, se rompe en cada bump de Expo). Maestro es
viable, pero **no ahora**: los defectos que golpean son de orquestación y de SQL, y los 5 tests los
agarran a una fracción del costo; los bugs de GPS en background que justificarían E2E **no se
reproducen en emulador**. Reconsiderarlo pasados ~10 dispositivos, con un solo flujo.

## 2.f Cómo se evita que vuelva la salvaguarda huérfana

Tres instancias del mismo patrón: `syncFalloDefinitivo` sin consumidores; un
`use-sync-status.test.ts` que un comentario afirma que existe y **no existe**; y el veredicto
GO/NO-GO del gate de GPS.

- `knip` como script `pnpm deadcode` en el job de lint: detecta exportado-sin-importadores.
- Para las banderas que son *propiedades del retorno de un hook* (que knip no ve), la convención:
  **toda bandera que exista para que el conductor la vea nace con su test de pantalla en el mismo
  PR**. T5 es la instancia. El gate ya existe (revisión antes de cerrar).

---

# Bloqueante 3 — el veredicto del gate de GPS se calcula y se tira

`docs/deuda-abierta.md:131-138` y `docs/spike-gps.md:10`: los **4 criterios GO siguen sin medirse
con nuestra app** — las trazas del piloto salieron de Geo Tracker.

El veredicto ya se calcula solo: `use-gps-operativo.ts:664` llama `evaluarCriteriosGo` al detener y
arma el informe completo (duración, puntos, pendientes en outbox, fallos de escritura, batería
medida y estimada a 8 h, huecos >2 min, nivel de log y el GO/NO-GO) en `setResultado` (`:672-690`).
El hook lo expone (`:745`). **Ningún `.tsx` lo lee.** El paso 4 del protocolo (`spike-gps.md:87`)
dice "la pantalla muestra el veredicto": **ese protocolo hoy no se puede ejecutar**.

**Decisión:** el spike terminó y la pantalla que lo mostraba no existe. Antes de conectar 30 líneas
de cálculo a una UI nueva, **decidir si el gate se cierra con esta instrumentación o se borra**.
Si se cierra: renderizarlo es lo más barato del plan entero. Si no: borrarlo, no dejarlo muerto.

Detalle bien resuelto que hay que respetar: `logVerboseHabilitado`
(`background-geolocation.config.ts:23`) permite subir el log sin tocar código, y el veredicto
**registra con qué nivel se midió**, para que nadie reclame un GO de batería sobre una corrida
contaminada.

---

# Prueba de campo

Reusar lo existente, no escribir protocolos nuevos: `docs/spike-gps.md:60-95` (8 h, incluye matar
la app y reiniciar el teléfono), `docs/piloto/checklist-aceptacion-e2e.md` +
`planilla-acompanante.md` (el acompañante con planilla sigue siendo la única verdad de campo
independiente, porque en headless el conductor no recibe feedback), y
`docs/runbooks/alta-de-conductor-android.md`.

**Crítico del runbook: nunca desinstalar el APK**, siempre instalar encima, o se destruyen las
bases SQLite locales con el outbox pendiente. Y el permiso "Permitir todo el tiempo" va a mano en
Ajustes; Android nunca lo ofrece en el diálogo.

**Herramientas hoy:** `adb` y `eas-cli` instalados; **sin emulador (falta el paquete `emulator` del
SDK), sin AVDs, sin dispositivo conectado**. Para GPS hace falta un Android real de gama baja igual
(Doze y battery killers no se emulan).

---

# Migración al GCP nuevo

**Decisión del CTO: se migran los datos del piloto.**

`apps/mobile/eas.json:30` es **el único lugar del móvil que apunta a GCP** (URL de Cloud Run en
texto plano, commiteada). La app resuelve la URL sólo de `EXPO_PUBLIC_API_URL` y **falla ruidoso**
si falta (`http-client.ts:38-43`) — bien hecho, sin default silencioso.
`app.config.ts:37` tiene `usesCleartextTraffic: false`: el endpoint nuevo debe ser HTTPS. Sentry y
el `projectId` de EAS no dependen de GCP.

**El corte importa, porque no hay OTA** (`expo-updates` no está instalado): cuando el backend se
mude, los teléfonos con el APK viejo siguen apuntando al viejo. Con 2 teléfonos: **mantener el
backend viejo vivo hasta confirmar que ambos corren el APK nuevo, y recién entonces apagarlo.**

**Deuda que se arrastra al migrar:** sesiones colgadas con `estado:'activa'` que nada cierra; la
sesión de QA `9c63dda6` con **un cumplimiento válido que nadie hizo** (hay que excluirla o
limpiarla); y la migración `20260829180000` con `DELETE FROM gps_points WHERE "sindicatoId" IS NULL`
— el SQL dice que debería afectar cero filas, **no verificado contra producción**: contar antes.

**No existe runbook de despliegue de GCP.** La migración es el momento de escribirlo.

---

# Orden de ejecución

| # | Trabajo | Prioridad | Bloqueado por |
|---|---|---|---|
| 0 | Reusar `PlacaVehiculoSchema` y `PinMovilSchema` de `@quivo/shared` en la pantalla de login (1.b) | P0 | — |
| 1 | Login de un paso: schemas, `autenticarSesion`, lockout, migración `IntentoAuthMovil` (1.d-1.g) | P0 | — |
| 2 | App: borrar `use-auth-movil.ts:226-263`, una sola llamada (1.a) | P0 | 1 |
| 3 | Rotar PINs del piloto con generador CSPRNG, con el móvil parado (1.f, 1.i) | P0 | 1 |
| 4 | `/en-vivo`: cotas constantes + `ORDER BY greatest(...)` + T4 | P1 | — |
| 5 | Ciclo de vida de sesión: `fin_recorrido` cierra, `logout` verifica `count`, job de colgadas + T3 | P1 | — |
| 6 | Refresh: `Set` de tokens muertos (arreglo único de las dos rutas) | P1 | — |
| 7 | Arnés: `jest-expo` + MSW + migración mecánica de los 10 tests | P2 | — |
| 8 | T1, T2, T5 | P2 | 2, 6, 7 |
| 9 | Decidir el veredicto GO/NO-GO: renderizar o borrar (bloqueante 3) | P2 | — |
| 10 | `knip` en el lint de CI (2.f) | P2 | 7 |
| 11 | Migración de GCP + runbook de despliegue | P1 | 2 |

Los ítems 4, 5 y 6 son paralelizables con 1 y no dependen del arnés.

# Verificación de que el plan se cumplió

- Un conductor real entra con placa + su PIN, y `grep -rn "CONDUCTOR_DEMO" apps/mobile/src` no
  devuelve nada.
- `vehicle-login-screen.tsx` importa sus schemas de `@quivo/shared`; una placa de 3 dígitos entra.
- Los 5 tests pasan, y se demuestra que **fallan** al revertir cada fix.
- Corrida de 8 h en un Android real, con los números copiados a `docs/spike-gps.md` y los 4
  criterios marcados GO o NO-GO con evidencia — o el veredicto borrado, si esa fue la decisión.
- La app apunta al GCP nuevo y el backend viejo se apagó **después** de confirmar los 2 teléfonos.

# Riesgos que quedan abiertos

1. **La degradación de seguridad del login de un paso es real** (ver objeción arriba). Revisar antes
   de escalar más allá del piloto.
2. **El lockout por vehículo es un vector de degradación**: con la placa pública, un atacante fuerza
   al chofer legítimo a esperar hasta 60 s entre intentos. Es el precio de un identificador público.
3. **El caso sin salida del fallback** (chofer nuevo + vehículo nuevo) va a pasar en la calle y no
   hay UI que lo explique.
4. **T2 depende de fake timers** sobre código con `AbortController` + `setTimeout(12_000)`. Un test
   *flaky* en CI se termina desactivando, que es exactamente cómo vuelve el bug. Presupuestar tiempo
   para estabilizarlo, o escribirlo con `REFRESCO_MS` inyectable.
5. **Divergencia zod 3 (`packages/shared`) / zod 4 (`apps/mobile`)**: hoy funciona, pero un schema
   nuevo escrito con API de zod 4 en `packages/shared` rompe la API. Merece revisión aparte.
6. **`jest-expo` + `@quivo/shared` ESM** es la pieza del arnés que más puede excederse en tiempo.
7. **Los tiempos de scrypt son estimación, no medición.** Medirlos antes de fijar K en el padding.
