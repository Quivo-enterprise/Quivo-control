# Handoff — QUIVO Control

> **Documento de estado.** Arriba, el estado real de hoy; abajo, el registro cronológico de
> cómo se llegó hasta acá, PR por PR. Se actualiza al cierre de cada iteración/PR.
>
> **Este documento registra la ejecución. La intención vive en
> [`plan-piloto-lunes-17-agosto.md`](plan-piloto-lunes-17-agosto.md)** — alcance, fases,
> asignación y fechas hasta el piloto. Si los dos se contradicen, el plan manda sobre qué hay que
> hacer y este handoff sobre qué se hizo.
>
> ⚠️ **[`plan-finalizacion-piloto.md`](plan-finalizacion-piloto.md) quedó obsoleto el
> 2026-08-15.** Apunta el piloto al 5–19 de octubre y trata el spike GPS (QUI-216) como gate
> previo; el CTO confirmó ese día que **el piloto arranca el lunes 17 de agosto con un auto**.
> Se conserva como registro histórico de las decisiones de escala y de los recortes a M7.

## Estado — 2026-08-16 (domingo, víspera del piloto)

**Repo:** [Quivo-enterprise/quivo-control](https://github.com/Quivo-enterprise/quivo-control)
(privado) · `main` = `9a0e472` · **CI verde** (`ci` + `acceptance`) · 3 ramas vivas (las tres de
Valentina, congeladas).

**En producción:** API `api:v3` (revisión `quivo-api-00005-x72`) y panel web
`quivo-web-00001-4jd`, ambos en Cloud Run `southamerica-west1`.

**Dónde estamos:** el backend **está desplegado y verificado en GCP Cloud Run**
(`southamerica-west1`). El piloto real arranca **mañana lunes 17 de agosto con un auto y un
conductor**. Lo que queda hoy no es código de producto: es cerrar el build del APK y probarlo en
un teléfono en la calle.

### Qué se cerró el sábado 15 — PR #15 (`3876384`, mergeado a `main`)

Todo el bloque "Sábado" del plan, en un solo PR: QUI-354 (Dockerfiles de `apps/api` y `apps/web`,
`enableShutdownHooks()`, liveness/readiness separados) · QUI-356 (guardarraíl de arranque de
`JWT_SECRET` + purga del default publicado + `JWT_REFRESH_TTL` a 7 d) · QUI-358 (`sindicatoId` +
RLS en `gps_points`) · QUI-357 (`usesCleartextTraffic: false`) · QUI-359 (rotación del refresh
token en el panel web) · QUI-366 (seed del sindicato piloto: 1 línea, 1 ruta, puntos de control,
1 vehículo, 1 conductor, más el segundo tenant de aislamiento) · QUI-365 (Sentry en
`apps/mobile`) · QUI-348 / QUI-338 / QUI-346 (los bugs de M6 que toca el conductor).

Verificado: lint, typecheck y 350 tests en verde; migraciones, seed y suite de RLS corridas
**contra la instancia real de Cloud SQL**.

**QUI-213 (GCP) quedó desplegado pero fuera del control de versiones.** No hay ningún `.tf` ni
carpeta `infra/` en el repo: Cloud Run, Cloud SQL, Memorystore y Secret Manager se levantaron por
consola/CLI. Verificado en vivo: liveness 200, readiness con `db` y `redis` arriba, login real
contra Cloud SQL y aislamiento cross-tenant confirmado a mano. **Deuda registrada: el entorno del
piloto no es reproducible desde el repo.** Terraform queda pendiente post-piloto.

### Qué está abierto hoy — PR #16 (`feat/config-movil-piloto`)

Apunta la app móvil al backend real (`EXPO_PUBLIC_API_URL` a Cloud Run), carga el DSN de Sentry
(antes era un no-op silencioso), agrega el plugin de Sentry y fija el `projectId` de EAS.

El code review del 2026-08-16 encontró que **el build de release iba a fallar** y que la
instrumentación no cumplía su objetivo. Los cuatro hallazgos que importan:

1. **`disableAutoUpload` no existe en `@sentry/react-native` 7.2.0.** El `PluginProps` de esa
   versión solo admite `organization`, `project`, `authToken`, `url` y `experimental_android`; la
   clave se pasaba y se ignoraba. La tarea de subida de source maps se registra igual en
   `sentry.gradle` (su gate real es el env var `SENTRY_DISABLE_AUTO_UPLOAD`, no el prop del
   plugin), corre dentro de `assembleRelease` y, sin org ni token, `sentry-cli` sale con exit
   code 1 dentro de un `exec {}` sin `ignoreExitValue`. **Rompía el build entero, no era un
   warning.** Comprobado ejecutando a mano el binario de `sentry-cli` que trae el repo.
2. **Faltaba `metro.config.js` con `getSentryExpoConfig`.** Sin el serializer de Sentry el bundle
   no lleva Debug ID, así que los source maps subidos no matchean: los stack traces seguirían
   ilegibles aunque el token estuviera bien cargado.
3. **Sentry inicializaba tarde.** En `index.js` la llamada a `initSentry()` estaba escrita antes
   de los imports, pero los imports ESM se hoistean: Sentry arrancaba después de evaluar
   `react-native-background-geolocation` y el headless task de GPS — justo el escenario que
   QUI-365 existe para cubrir.
4. **El perfil `development` de `eas.json` apuntaba al Cloud Run de producción.** Cualquier build
   de development manejando en la calle habría escrito GPS y jornadas de prueba en la misma base
   que guarda la evidencia del piloto. Además ese perfil es `developmentClient: true`: no embebe
   bundle, así que ni siquiera servía para la prueba de campo.

Decisión del CTO: **se va con source maps funcionando**, no con el atajo de desactivar la subida.
`SENTRY_AUTH_TOKEN` va como secret de EAS; `SENTRY_ORG` y `SENTRY_PROJECT` como env del perfil.
El token nunca se commitea.

### QUI-364 cerrado — el APK del piloto existe

**Artefacto:** `versionCode` 6, package `com.quivotech.conductor`, firmado con el keystore remoto de
EAS (`Build Credentials 9zSZpTExKl`), apuntando a Cloud Run.
Build `22e5d3f0-5239-474a-b076-c57f60c48bf5`.

Salió al **quinto intento**. Los cuatro anteriores murieron, cada uno más adelante que el
anterior, y ninguno por la misma causa. Los cuatro están arreglados y mergeados:

| # | Fase donde murió | Causa | Fix |
|---|---|---|---|
| 1 | `INSTALL_DEPENDENCIES` | Worker con Node 20; el repo declara pnpm 11.3.0, que usa `node:sqlite` | PR #17 — `base.node = "22.23.1"` |
| 2 | `INSTALL_DEPENDENCIES` | El `postinstall` de `packages/db` corre `prisma generate`, que explota sin `DATABASE_URL` | PR #19 — placeholder en `base.env` |
| 3 | `EAGER_BUNDLE` | `packages/shared/dist` está gitignoreado; el worker clona limpio y Metro no resolvía `@quivo/shared` | PR #20 — `eas-build-post-install` que compila las deps de workspace |
| 4 | `RUN_GRADLEW` (585/585 tareas) | Un comentario XML con la secuencia `--` adentro; AAPT2 lo rechaza con error fatal | PR #21 — reescribir el comentario |

**El fix de Sentry quedó validado por el build 4**, que lo ejercitó completo antes de morir por el
XML: `sentry-cli` resolvió bajo pnpm, recibió org, project y token, y terminó con `Uploaded files
to Sentry` / `File upload complete`. Los source maps del release están subidos y con Debug ID, así
que los stack traces del piloto llegan legibles.

**Verificado sobre el artefacto, no sobre la config** (lo que exige el gate previo del
checklist): el bundle contiene la URL de Cloud Run por HTTPS una sola vez y **ninguna** referencia
a `10.0.2.2`, `192.168.*` ni `172.16-31.*`. Los dos `localhost` que aparecen son inertes y no son
la base del API: un path de desarrollo de Expo Google Fonts y el endpoint del overlay Spotlight
del SDK de Sentry, que requiere `spotlight: true` para activarse. Firma verificada (RSA 2048,
esquema v2), `android:debuggable` **ausente** —así que el bloque `debug-overrides` del network
security config queda inerte y el cleartext sigue bloqueado—, y `ACCESS_FINE_LOCATION` +
`ACCESS_BACKGROUND_LOCATION` declarados. SHA256 del APK:
`b23582f48403255cefdc81f81fe41c795240f5c505caefcd8c69e040acc7dc1b`.

La licencia de Transistorsoft viaja embebida en el manifest y su JWT confirma **trial, expira
2026-09-15**. El dato del checklist es correcto: hay que decidir la compra antes de esa fecha o el
próximo build sale sin licencia.

### El panel web quedó desplegado — 2026-08-16 (noche)

**URL:** https://quivo-web-424426714260.southamerica-west1.run.app
Servicio `quivo-web`, revisión `quivo-web-00001-4jd`, imagen
`southamerica-west1-docker.pkg.dev/quivo-piloto/quivo/web:v1`.

El servicio es mucho más simple que el del API: `apps/web` es un SPA con cáscara Next (todo
`'use client'`, sin `better-auth`/`@quivo/db`/`@prisma/client`), así que **no lleva conector de
Cloud SQL, ni VPC connector, ni secretos de base**. Solo sirve el bundle; el navegador pega
directo contra el API.

**`CORS_ORIGIN` ahora acopla los dos servicios.** `apps/api/src/main.ts:51-54` usa un string
único, no un array ni una regex, y estaba sin setear. Se agregó al servicio `quivo-api` con la
URL exacta del panel, lo que creó la revisión `quivo-api-00004-4n4`; el readiness se verificó
sano inmediatamente después. **Si el panel cambia de URL, el API deja de aceptarlo** y hay que
actualizar la variable. Está documentado en `scripts/deploy-web.sh`, que automatiza todo el
procedimiento.

**Trampa del build, para quien lo repita:** `NEXT_PUBLIC_API_URL` se hornea en build time y va
**sin** `/v1` (el código concatena el prefijo en cada llamada, `client.ts:36`). Si falta al
buildear, Next inlinea el fallback `http://localhost:3000` y el panel sale roto sin ningún error
visible. Por eso el script verifica los chunks de `.next/static` dentro del contenedor antes de
desplegar — mirar el HTML servido no sirve: `/` redirige a `/login` y las `NEXT_PUBLIC_*` viven
en el JavaScript compilado, no en el HTML.

### Lo que el panel destapó: el seed del piloto estaba a medias

Con el panel arriba, `GET /v1/vehiculos` devolvía **500** y lo dejaba vacío. La causa no era
RLS —`withTenantContext` ya hace coalesce de `null` a string vacío, y todos los demás listados
respondían 200 para la cuenta global— sino **los datos placeholder del seed**:

- `placa: 'PILOTO001'` no matchea el regex de placa boliviana (3-4 números + 3 letras).
- `color: 'PLACEHOLDER'` no está en `ColorVehiculoSchema`.
- Y el vehículo **no tenía socio propietario**: el seed crea socio solo para el sindicato demo
  (`seed.ts:155`), nunca para el piloto, así que la activación lo rechazaba.

Se corrigió **vía el API REST del propio panel**, no con SQL directo, para que pasara por
validación y quedara en auditoría. Estado actual de los datos del piloto, **todos placeholder
pendientes de reemplazo por el CTO**:

| Campo | Valor cargado |
|---|---|
| Placa | `1111AAA` |
| Marca / modelo | `PLACEHOLDER` |
| Color | `blanco` |
| Socio propietario | `SOCIO PILOTO POR DEFINIR` (creado esta noche, no existía) |
| Conductor | `PLACEHOLDER — conductor piloto`, CI `PILOTO-CI-001` |

⚠️ **El login móvil es placa + PIN.** La placa pasó de `PILOTO001` a `1111AAA`, así que el
conductor entra con **`1111AAA`** y el PIN original (que no se tocó). `auth-movil.service.ts`
compara contra `placaNormalizada`. **Cuando se cargue la placa real, la credencial cambia otra
vez** y hay que avisarle al conductor.

Se barrieron los 16 listados del panel: ningún otro 500. El conductor no fallaba por una
asimetría del código — `ConductorSchema` usa `z.string()` simple para lectura, mientras
`VehiculoSchema` aplica los schemas estrictos también al leer. Es la única entidad así.

**Fix de fondo aplicado:** `listar()` ahora tolera filas corruptas (las omite y las loguea con
id y campos fallidos) y un `ZodExceptionFilter` global devuelve 422 en vez del 500 opaco. El
patrón vulnerable existe en 14 servicios, pero solo Vehículo tiene hoy una fila que lo dispare;
el helper `mapearTolerante` queda listo para migrar el resto.

### La cadena de login móvil, verificada de punta a punta

Preguntar por el PIN destapó tres bloqueantes más, todos del mismo origen: **el seed del piloto
quedó a medias**. Ninguno se habría visto hasta que el conductor intentara entrar en la calle.

1. **Los PINs eran irrecuperables.** Se hashean con `better-auth/crypto`, de un solo sentido, y
   solo se imprimen una vez en el stdout del seed. Se fijaron nuevos vía
   `PUT /v1/mobile/credenciales/{vehiculos,conductores}/:id`.
2. **El CI del conductor no pasaba el login.** `PILOTO-CI-001` no matchea el regex de CI
   boliviano que usa el endpoint de autenticación. La fila sí pasaba la lectura, porque
   `ConductorSchema` usa `z.string()` simple — la validación estricta solo vive en los schemas de
   creación. Corregido a `00000000 LP`.
3. **No existía ninguna rotación.** El seed nunca creó una para el piloto, y sin asignación
   publicada vigente el login del conductor devuelve 404. Se creó la rotación `2026-08-piloto`
   (`86d20fcf-931d-40cb-8062-bf605f161709`), publicada, con **15 asignaciones del 17 al 31 de
   agosto**, una por día.

**Credenciales operativas del piloto** (las anteriores ya no sirven):

| Qué | Valor |
|---|---|
| Placa del vehículo | `1111AAA` |
| PIN del vehículo | `76179397` |
| CI del conductor | `00000000 LP` |
| PIN del conductor | `18218968` |

**Cómo funciona el login, por si algo falla en campo:** son dos pasos —
`POST /v1/mobile/auth/vehiculo` con placa+PIN devuelve un `challengeToken`, y
`POST /v1/mobile/auth/conductor` con ese token + CI + PIN devuelve la sesión. `deviceId` es
obligatorio en **ambos**. La búsqueda de asignación filtra por **fecha calendario exacta** de
Bolivia, no por rango, y **no filtra por turno**: el turno solo importa porque más de una
asignación en el mismo día hace que el login devuelva `seleccion_requerida` en vez de tokens. El
`venceAt` cubre hasta las 23:59:59 hora Bolivia, así que el horario real de trabajo no afecta.

Verificado en vivo con una rotación de prueba solo para hoy (después anulada): la cadena completa
devuelve tokens, y `GET /v1/mobile/asignacion-del-dia` responde 200 con la geometría de la ruta y
los 2 puntos de control.

### El alcance real del piloto, según el CTO (2026-08-16)

El sindicato tiene muchas líneas y rotaciones. Se arranca con el **grupo de antiguos**, que
**alterna días entre la línea Z12 y la 120** (la troncal, la más demandada). **Mañana lunes 17
toca Z12, con un solo vehículo**; el resto del grupo se absorbe durante la semana.

### Z12 cargada — la ruta real ya está en producción (2026-08-16, noche)

El sindicato mandó los recorridos como mapas de **Google My Maps**. Se extraen por URL sin
credenciales: `https://www.google.com/maps/d/kml?mid=<MID>&forcekml=1`. El KML usa `lon,lat` en
su etiqueta `<coordinates>`, el mismo orden que GeoJSON, así que no hay que invertir nada — solo
descartar la altitud si viene. **Verificado en la carga real:** todas las coordenadas caen en
Bolivia (lat ≈ -17.3/-17.4, lon ≈ -66.15/-66.23).

**Línea Z12** — Sindicato Mixto de Transportistas Tiquipaya. `codigo: Z12`, id `...010`.

| Ruta | id | Vértices | Largo | Sentido |
|---|---|---|---|---|
| Salomón Romero → Villa Armonía | `...000000000011` (la del seed, editada en el lugar) | 117 | 20 213 m | ida |
| Villa Armonía → Univalle | `813c6130-2c30-46e4-b533-e3ca2ba17cd2` (nueva) | 138 | 20 413 m | vuelta |

La ruta de ida se **editó en el lugar** a propósito: la rotación publicada apunta a ese id, así
que reemplazar la geometría deja todo lo demás intacto. Los 2 puntos de control demo del seed se
dieron de baja.

**Puntos de control del sindicato** (las paradas del KML), radio **150 m**, `obligatorio: true`:
Salomón Romero y Villa Armonía en la ida; Villa Armonía y Univalle en la vuelta.

Dos paradas quedaron fuera por la validación de ≤100 m a la geometría, y ambas exclusiones son
correctas: **Univalle está a 656 m de la ruta de ida** (es el final del retorno, no de la ida), y
**Salomón Romero a 1 740 m de la ruta de vuelta**. Esto último merece confirmación con el
sindicato: el KML de retorno termina en Univalle, así que **si el trufi en realidad vuelve hasta
Salomón Romero, al mapa le falta el tramo final** y ese pedazo del recorrido queda sin ruta contra
la cual comparar.

**24 puntos de medición propios**, 12 por sentido, cada ~1 555 m (ida) y ~1 570 m (vuelta),
`orden 2..13`, radio 150 m, `obligatorio: false`. Se interpolaron sobre la polilínea: los 24
dieron **distancia 0.000000 m** al trazado.

Por qué existen: con solo 2 puntos reales por sentido no hay muestra — si detecta 1 de 2, no se
aprende nada. Con 14 el porcentaje significa algo. Y como caen exactamente sobre la ruta, **la
traza GPS cruda demuestra por sí sola que el vehículo pasó**, sin que nadie tenga que anotarlo: la
tasa de detección se calcula después cruzando `cumplimientos_pc` contra `gps_points`.

Dato clave para leer los resultados de mañana: la separación entre puntos de medición (~1.55 km)
está muy por encima del espaciado del GPS (100-150 m), así que **el muestreo no puede saltarse un
punto entero**. Si mañana alguno no se detecta, es un problema real de detección, no de que el GPS
haya muestreado en el momento equivocado. Eso es exactamente lo que se quería aislar.

**Limitación encontrada:** `puntos_control` **no tiene campo de nombre** — solo `orden`, `coord`,
`radioToleranciaM`, `obligatorio` y `estado`. No se pudieron etiquetar como `MEDICION-01`. Se
distinguen por `orden >= 2` (los del sindicato usan 0 y 1). Funciona, pero es frágil: cuando
lleguen los puntos de control reales del sindicato hay que insertarlos sin romper esa convención.

**El KML de la línea 120 ya está descargado también**, para cuando toque. Es más complejo: tronco
ida y vuelta más **7 ramales a comunidades** (Molinos, Encanto Pampa, Collpapampa, Gualberto
Villarroel, Villa Oruro, Apote, Molle Nova, Barrio Flores). La descripción del mapa lo explica:
*"llegando a Tiquipaya la línea 120 se reparte a sus diferentes comunidades mediante letrero"*.
Eso es exactamente lo que el modelo llama **variantes** de ruta — existen en el schema y hoy no
las usa nadie. Decisión pendiente: hoy el sistema asigna una ruta fija por jornada y no hay forma
de saber qué ramal tomó el conductor.

### Bug encontrado al cargar la ruta, y arreglado

Al dar de baja los puntos de control demo se descubrió que **el paquete del día no filtraba por
`estado`**: la app le bajaba al conductor los 2 puntos fantasma de la zona demo junto con los
reales. Peor, la query ni siquiera traía la columna `estado`, así que el móvil tampoco podía
filtrarlos. Bug preexistente que nadie había visto porque hasta hoy no se había dado de baja
ningún punto de control.

Arreglado en PR #25 y **desplegado a producción** (`api:v3`, revisión `quivo-api-00005-x72`).
Verificado en vivo: el paquete del día pasó de 16 a **14 puntos de control**, todos con radio
150 m y órdenes 0-13 sin huecos, sobre la ruta Z12 de 117 vértices. Readiness sano tras el
despliegue, sin rollback. El PR además encontró el **mismo patrón en `paradas`**. Se decidió a
conciencia **no** filtrar `Ruta.estado`: es una búsqueda por id, no una lista, y filtrarla
convertiría "geometría posiblemente vieja" en un `NotFoundException` que voltea el paquete del día
entero si alguien desactiva una ruta a mitad de ciclo — peor modo de falla, sin incidente que lo
justifique. Queda como follow-up.

### Brechas de modelo detectadas, para decidir después del piloto

- **Las "vueltas" no existen en el modelo.** La regla operativa real del sindicato es cumplir N
  vueltas por día, pero no hay ningún schema ni servicio que lo represente. El dato crudo queda
  capturado (cada pasada por un punto de control se registra), así que es derivable, pero hoy el
  sistema no calcula ni reporta "debía dar 5, dio 4".
- **La alternancia Z12/120 no está modelada como patrón.** La rotación actual asigna la misma ruta
  los 15 días. Cuando exista la 120 hay que rehacerla para que alterne.
- **`DELETE` de una asignación con sesión asociada devuelve 500** en vez de un 409 legible:
  `SesionOperativa.asignacion` tiene `onDelete: Restrict` y `rotaciones.service.ts` solo traduce
  P2002, no P2003.

### Cómo se mide el día 1 (decidido por council, 2026-08-16)

Se convocó un council de cuatro voces para decidir si recompilar el APK con
`disableElasticity: true`. **Veredicto unánime: no recompilar.** El razonamiento dominante no fue
técnico sino de riesgo: el APK costó cinco intentos y cinco bloqueantes distintos, y un sexto
build de madrugada sin dispositivo para probarlo, entregado a un conductor real al amanecer, es
peor riesgo que la elasticidad.

**El hallazgo que justifica el radio de 150 m:** `distanceFilter: 50` **no es fijo**. El SDK lo
escala con la velocidad (`disableElasticity` es `false` por default), así que el espaciado real
entre fixes es ~100 m entre 18-36 km/h y ~150 m entre 36-54 km/h. Además, en Android
`locationUpdateInterval` se ignora cuando `distanceFilter > 0`, así que el "cada 10 segundos" que
promete el comentario del código no aplica. **Y el trufi no frena en los puntos de control** salvo
que el tráfico lo obligue — eso invalida el argumento intuitivo de que el vehículo desacelera
justo donde se lo mide.

Con radio 30 m (el default del formulario del panel) el diámetro es 60 m: menor que el espaciado.
El vehículo cruza el punto entero sin que ninguna muestra caiga adentro, y **como el worker no
hace backfill, esa pasada se pierde para siempre**. Con 150 m la cuerda es 300 m y el margen es
real. Errar por ancho da un falso positivo medible y corregible después sobre la traza cruda;
errar por angosto no se recupera nunca.

**El umbral binario "0 detecciones fuera del radio" era infalsificable**, y lo marcaron dos voces
por separado: el worker revalida cada cumplimiento con **las mismas coordenadas que le mandó el
teléfono**, así que su veredicto siempre coincide con el de la app. Medir contra ese dato es
comparar el sistema consigo mismo — pasa por construcción, funcione o no. Y en headless el
conductor no recibe feedback, así que tampoco puede desmentirlo.

Por eso el día 1 se instrumenta en dos capas:

| Instrumento | Qué mide | Trabajo humano |
|---|---|---|
| 24 puntos de medición sobre la polilínea | Tasa de detección real, cruzando `cumplimientos_pc` contra `gps_points` | Ninguno |
| [`planilla-acompanante.md`](piloto/planilla-acompanante.md) | Verdad de campo independiente: hora de cada paso y **si el vehículo frenó** | Anotar a mano |

La columna "¿frenó?" es la que convierte un porcentaje en un diagnóstico. Si los puntos detectados
son los que frenaron y los perdidos los que pasaron de largo, la hipótesis del espaciado elástico
queda confirmada y se sabe exactamente qué ajustar. Sin esa columna, mañana termina con un número
y ninguna explicación.

**Post-piloto:** replay SQL sobre la traza cruda a 30/50/100/150 m para elegir el radio con datos
reales, y recién ahí decidir si vale `disableElasticity`.

### Qué queda

| Paso | Quién | Estado |
|---|---|---|
| **Prueba en teléfono real** — los 7 puntos del plan | CTO | ⏳ Pendiente. Es lo único que falta antes de mañana |
| Confirmar con el sindicato si el retorno llega hasta Salomón Romero | CTO | ⏳ El KML termina en Univalle, 1 740 m antes |
| Rotar el `SENTRY_AUTH_TOKEN` | CTO | ⏳ Se pegó en un chat; darlo por expuesto |

**Rotar el token:** revocarlo en Sentry, crear uno nuevo y recargarlo con `eas env:create`. El
alcance es solo Sentry —lectura/escritura del proyecto y lectura de la org, no toca el backend ni
la base— pero los eventos de Sentry de un piloto real pueden traer datos de ubicación.

### El punto ciego, ahora con cinco casos

Todo lo de arriba —los tres bloqueantes que encontraron los reviews más los cuatro que encontró
el build— vive en el mismo agujero:

Los bloqueantes del build salieron todos del mismo agujero: **la CI no corre `eas build`**. Todo
lo que solo se ejerce durante el build nativo —config plugins, resolución de binarios bajo pnpm,
inyección de variables de EAS, versión de Node del worker— hoy no lo prueba nadie hasta que
alguien aprieta el botón. Los cuatro casos concretos que pasaron limpios por `lint`, `typecheck`,
350 tests y dos CI verdes:

1. Una opción de config plugin que no existe en la versión instalada (`disableAutoUpload`).
2. Un binario (`@sentry/cli`) no resoluble bajo el layout aislado de pnpm, cuyo fallo devolvía
   `null` en Groovy sin lanzar, así que ni siquiera entraba en la rama de recuperación.
3. Un campo faltante (`environment`) del que depende que las variables secretas de EAS lleguen al
   job, porque se inyectan del lado del servidor.
4. **El primer build real murió en `INSTALL_DEPENDENCIES`, antes de instalar una sola
   dependencia**, por algo que no tenía nada que ver con Sentry: el worker de EAS corre Node
   20.19.4 por default, el repo declara `packageManager: pnpm@11.3.0`, y pnpm 11 requiere Node
   >= 22.13 porque usa `node:sqlite`:
   `Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite`.
   El repo pedía Node 22 en `engines`, en `.nvmrc` y en la CI (`node-version-file: .nvmrc`) —
   `eas.json` era el único lugar donde no estaba declarado.

**Issue post-piloto, ahora con evidencia de sobra:** un job de CI que corra `expo prebuild` +
`assembleRelease` sobre `apps/mobile`. No hace falta que firme ni que suba nada; alcanza con que
compile. **Habría atrapado los siete.** Cada vuelta de build costó ~15 minutos y descubrió
exactamente un bug, en serie, el día antes del piloto.

**Segundo issue post-piloto:** sacar `prisma generate` del `postinstall` de `packages/db` y
llamarlo explícitamente donde haga falta, en vez de que corra ciegamente en cualquier
`pnpm install` del monorepo — incluidos builds que no tocan esa carpeta. El placeholder de
`DATABASE_URL` en `eas.json` es un parche, no la solución.

**Tercer issue, menor:** el worker de EAS instaló `pnpm@10.14.0` pese a que el `package.json` de
la raíz declara `packageManager: pnpm@11.3.0` (parece leer el de `apps/mobile`, que no tiene ese
campo). No causó problemas porque el lockfile es compatible con ambas, pero local y worker no
coinciden.

**Segunda lección, más barata de aplicar ya:** verificar contra el `node_modules` instalado, no
contra la doc de `main` del proyecto upstream. Los dos primeros hallazgos fueron comentarios de
código que describían una versión del SDK distinta de la que corre acá.

### QUI-367 — el checklist ya tiene umbrales

[`piloto/checklist-aceptacion-e2e.md`](piloto/checklist-aceptacion-e2e.md) pasó de casillas
binarias a umbrales numéricos con criterios de aborto. Lo que cambió y por qué:

- **Gate previo reescrito.** Ya no pide el spike GPS de 8 h (QUI-216 quedó absorbido por la
  prueba del domingo). Ahora exige lo que sí es bloqueante hoy: `/health` por HTTPS desde fuera,
  aislamiento cross-tenant verificado a mano, y **que el APK firmado apunte a Cloud Run
  verificado en el APK instalado**, no solo en el `.env` del build.
- **Los 7 puntos de la prueba en teléfono** tienen umbral cada uno (batería ≤10%/h con objetivo
  ≤5%/h, ningún hueco GPS >2 min, ≥90% de puntos de control detectados solos, p95 de sync
  ≤5 min).
- **Umbrales binarios**, que un solo caso rompe: 0 eventos perdidos, 0 duplicados tras
  reintentos, 0 filas visibles cross-tenant, 0 detecciones fuera del radio.
- **7 criterios de aborto (A1–A7)** que dicen qué hacer, no solo que algo salió mal. El más
  importante: **abortar nunca significa borrar el outbox del teléfono** — los eventos pendientes
  son la única copia de la jornada. Ante pérdida de eventos (A2) se para la sincronización y no
  se reinstala la app. Ante fuga cross-tenant (A3) se para el piloto: es incidente de seguridad,
  no bug de campo.
- **Tabla de mediciones por jornada**, que es lo que después cierra QUI-253 con acta.

### Deuda asumida a conciencia para llegar al lunes

Ninguna bloquea el arranque, pero las tres primeras conviene no olvidarlas:

| Deuda | Riesgo real |
|---|---|
| **QUI-363** — prueba negativa de RLS | La suite de aislamiento nunca se verificó rompiendo una policy a propósito. Mientras no exista, su verde no prueba nada. Compensado hoy solo por la verificación manual cross-tenant |
| **QUI-213** — infra sin Terraform | El entorno del piloto no se puede recrear desde el repo |
| **Transistorsoft** — trial, vence **2026-09-15** | `grace_builds` en cero. Decidir la compra antes de esa fecha o el próximo build no sale |
| QUI-355, 360, 361, 362, 252, 347, 250 | Hardening diferido, 16 pts |

### Vía 2 — congelada por decisión del CTO

Los tres PRs de Valentina (#8 QUI-339, #9 QUI-340, #14 QUI-342) siguen abiertos y **no se tocan
hasta después del arranque**: no bloquean el lunes. Pendiente al retomar: **#14 tiene la CI en
rojo y ese rojo esconde un bug real** — el refactor de fechas renombró variables en 2 de 4
funciones, y `exportes.service.ts:191` y `:280` siguen interpolando `${desde}`/`${hasta}` en
`$queryRaw`; sin filtro de fecha eso mete `undefined` en el SQL.

### Lo que sigue sin validarse

El tracking en background **nunca se midió en un teléfono** y el load test (k6, QUI-250) nunca
corrió. El piloto de mañana es, en los hechos, la primera validación de campo del stack móvil.
Atenuante de diseño: la app es offline-first con outbox SQLite — solo necesita red para bajar el
paquete del día y sincronizar, no durante la jornada.

## Qué es el proyecto

Plataforma SaaS **multi-tenant** para gestión de sindicatos de transporte público:

- **Web admin**: CRUD de sindicatos, socios, vehículos, conductores, líneas, rutas/variantes, paradas, puntos de control; rotaciones; sanciones; dashboard de cumplimiento; auditoría.
- **App móvil (conductor)**: offline-first, GPS en background durante el recorrido, validación local de puntos de control (geofence), outbox local y sincronización idempotente por lotes al recuperar conexión.

Requerimientos de Producto (CPO): `~/Downloads/QUIVOcontrol.md` (RF-01..84, RNF, MVP, criterios de aceptación §8, 18 preguntas §9, entregables §10).

## Fuentes de verdad y decisiones ya cerradas

Nada de esto se vuelve a discutir salvo que cambie una restricción real.

| Qué | Dónde | Cuándo |
|---|---|---|
| Stack y arquitectura | [`plan-maestro.md`](plan-maestro.md) §Stack | Aprobado 2026-07-19 |
| Modelo de datos, API, sync, riesgos, las 18 preguntas del CPO | [`documento-tecnico-cto.md`](documento-tecnico-cto.md) | 2026-07-19 |
| Alcance, fases, asignación y fechas hasta el piloto | [`plan-piloto-lunes-17-agosto.md`](plan-piloto-lunes-17-agosto.md) — anula a [`plan-finalizacion-piloto.md`](plan-finalizacion-piloto.md) | 2026-08-15 |
| Umbrales de aceptación y criterios de aborto del piloto | [`piloto/checklist-aceptacion-e2e.md`](piloto/checklist-aceptacion-e2e.md) | 2026-08-16 |
| Infraestructura: **GCP**, `southamerica-west1` | [`adr/0002-gcp.md`](adr/0002-gcp.md) — anula el ADR 0001 | 2026-08-14 |
| Deliberación inicial (council) | `~/.council/Documents/council-20260719-083140/` | 2026-07-19 |
| Contratos de auth móvil | [`plan-auth-movil-quivo.md`](plan-auth-movil-quivo.md) | 2026-08-01 |
| Diagnóstico del bloqueo de CI y del design system perdido | [`plan-continuidad-quivo-control.md`](plan-continuidad-quivo-control.md) | Registro cerrado |
| Protocolo del spike GPS y sus 4 criterios de GO | [`spike-gps.md`](spike-gps.md) | Corregido en el PR #6 |

**Respuestas de Producto que fijan el alcance** (detalle en el documento técnico §15): solo
Android en el MVP · 2 sindicatos y 2000–3000 vehículos el año 1 · **login por vehículo**, el
chofer se identifica encima · GPS crudo 6 meses caliente, después archivo, **nunca se borra
evidencia** · evidencia de sanciones = datos de recorrido, fotos post-MVP.

**Memoria del proyecto:** la del harness, bajo `~/.claude/projects/<ruta-del-repo>/memory/` — es
local a cada máquina, así que la ruta exacta varía según dónde esté clonado el repo.

## Stack aprobado (resumen)

TypeScript punta a punta. Detalle y justificación completa en `docs/plan-maestro.md` §Stack.

- **Backend**: NestJS (adapter Fastify), monolito modular. Prisma para CRUD; SQL crudo (multi-row insert / `COPY`) para la ruta caliente de ingesta GPS.
- **DB**: PostgreSQL 16+ con PostGIS; `gps_points` particionada por rango de tiempo (pg_partman). TimescaleDB queda como palanca de escala posterior (no disponible en RDS/Aurora/Neon gestionados — verificado).
- **Cola**: Redis + BullMQ — absorbe ráfagas de sync; workers insertan por lote.
- **Auth / multi-tenancy**: Better-Auth + JWT con claims (`sindicato_id`, `rol`) + Row-Level Security en Postgres (shared schema).
- **Web**: Next.js (App Router) + Tailwind + TanStack Query.
- **Móvil**: Expo (React Native) + EAS Build; GPS background con Transistorsoft `react-native-background-geolocation` (licencia única ~US$400); expo-sqlite como outbox.
- **Sync idempotente**: UUIDv7 generado en cliente + `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
- **Mapas**: MapLibre GL + tiles OSM.
- **Infra**: **GCP** — Cloud Run (API) + Cloud Run Worker Pool (ingesta GPS) + Cloud SQL PG16/PostGIS + Memorystore Redis + Secret Manager, `apps/web` también en Cloud Run, archivado GPS en Cloudflare R2, IaC con Terraform, todo en **`southamerica-west1`** (Santiago) menos el Cloud Scheduler ([ADR 0002](adr/0002-gcp.md), 2026-08-14 — anula el ADR 0001 Railway vs Fly.io). EAS para móvil.

## Decisiones clave y por qué

1. **TS en vez de Go** (propuesta de Gemini): el equipo/entorno ya es TS/React/Expo; el cuello de la ingesta es la DB, no el runtime, y se neutraliza con batching + cola.
2. **Expo en vez de Flutter**: mismo SDK nativo subyacente (Transistorsoft); aprender Dart no aporta.
3. **Particionado nativo en vez de TimescaleDB día 1**: preserva portabilidad de hosting.
4. **Monolito modular, no microservicios**: velocidad de MVP; bordes limpios permiten extraer el servicio de tracking después sin reescritura.
5. **Shared-schema + RLS en vez de schema-per-tenant**: sin requisito legal de aislamiento físico; doble barrera JWT + RLS.

Camino de escalado (en orden): réplicas de lectura → workers de ingesta horizontales → particionado agresivo/compresión o migración TimescaleDB → extraer servicio de tracking solo si los números lo exigen.

## Riesgo #1

**GPS en background sobre Android gama baja** (Doze, battery killers de fabricantes). Mitigación: spike go/no-go en semana 1 de Fase 0 — app esqueleto con Transistorsoft, 8 h de tracking en dispositivo barato, medir batería (<5%/turno) y huecos (>2 min = fallo). Plan B: módulo nativo Kotlin (Foreground Service) dentro de la app Expo.

## Fases (plan)

0. Fundaciones + spike GPS (monorepo, CI, Postgres+PostGIS, auth+RLS, esqueleto NestJS).
1. Núcleo administrativo (RF-01–39).
2. Rotaciones (RF-51–57).
3. App móvil + offline + sync (RF-58–73).
4. Dashboard + auditoría + reportes (RF-74–84).
5. Hardening (load test k6, índices, RLS audit, `/security-review`).

Estimación: 14–18 semanas, equipo 2–3 devs. Detalle en `docs/documento-tecnico-cto.md` §11.

## Preguntas de Producto — respondidas (2026-07-19)

Detalle completo en `docs/documento-tecnico-cto.md` §15.

1. **Solo Android** en MVP; iOS post-MVP.
2. **2 sindicatos, 2000–3000 vehículos total** año 1 (~8–9M puntos GPS/día — dentro del diseño, sin cambios de stack).
3. **Login por vehículo** (chofer rota); credencial emitida por el sindicato, conductor se identifica al iniciar sesión operativa.
4. **GPS crudo: 6 meses caliente** (particiones diarias) → archivo S3/R2; nunca se borra evidencia. Derivados permanentes.
5. **Evidencia de sanciones: solo datos de recorrido** auto-vinculados; fotos post-MVP.

---

# Registro cronológico

De acá para abajo, el histórico de cómo se construyó el producto, en orden. **El estado vigente
está arriba** — si algo de esta sección contradice al "Estado", gana el "Estado": lo de abajo se
escribió el día que pasó y no se retoca después.

## Linear (creado 2026-07-19)

- **Proyecto:** [QUIVO Control — MVP](https://linear.app/quivo-tech/project/quivo-control-mvp-1d41fa072abf) — team Quivo-Tech (QUI), start 2026-07-20, target 2026-11-20, lead cto.josel.
- **Milestones (6):** M0 Fundaciones+Spike (2026-08-02) · M1 Núcleo admin (2026-08-30) · M2 Rotaciones (2026-09-13) · M3 Móvil+sync (2026-10-18) · M4 Dashboard/reglas (2026-11-08) · M5 Hardening+piloto (2026-11-20).
- **Issues:** 43 (QUI-211..253), todos con criterios de aceptación, estimates (puntos), labels por área y refs RF/§doc técnico.
- **Cycles:** verificado contra la API de Linear (2026-07-20) que la cadencia real es de **2 semanas**, no de 1 semana como decía una versión anterior de este documento. Sprint 1 = **Cycle 12** (2026-07-20 → 2026-08-03), 9 issues en Todo:
  - QUI-211 monorepo, QUI-212 CI, QUI-213 infra, QUI-214 esqueleto NestJS, QUI-215 shared, **QUI-216 spike GPS (URGENT, gate go/no-go)** — todos con fecha límite 2026-07-26.
  - QUI-217 Prisma schema, QUI-218 RLS (URGENT), QUI-219 auth — en **Cycle 13** (2026-08-03 → 2026-08-17), no dentro de Cycle 12.
- **Dependencias:** QUI-216 (spike) bloquea QUI-235 y QUI-237 (móvil M3); QUI-211 bloquea QUI-217.
- Labels nuevos creados: `backend`, `mobile`, `db`, `gps`.

## Kickoff Cycle 12 (2026-07-21) — QUI-211/212/213/214/215/216

Implementados en local (branches separadas por issue, sin mergear — ver "Pendientes de acceso"):

- **QUI-211** — monorepo pnpm+Turborepo: `apps/{api,web,mobile}` + `packages/{shared,db}`,
  tsconfig strict compartido, ESLint 9 flat config + Prettier, Node 22 LTS pinneado.
  Verificado: `pnpm install` + `turbo build/lint/typecheck/test` en verde en los 5 workspaces.
- **QUI-215** — `packages/shared`: enums (roles, estados), schemas Zod de entidades núcleo
  (sindicato/socio/vehículo/conductor), `EventoSyncSchema` con `event_id` UUIDv7, pipeline
  de generación OpenAPI (`zod-to-openapi`). Tests de contrato en vitest.
- **QUI-213** — `docker-compose.yml` local (Postgres 16+PostGIS en puerto **5434**, para no
  chocar con otros Postgres locales de esta máquina de desarrollo; Redis en 6379). ADR
  Railway vs Fly.io documentado (`docs/adr/0001-railway-vs-flyio.md`) **sin aprovisionar
  nada real** — decisión de infra cloud queda pendiente, confirmada por el usuario.
- **QUI-214** — esqueleto NestJS/Fastify: 14 módulos de dominio vacíos, `GET /v1/health`
  (chequea Postgres+Redis), `GET /v1/_internal/ping` (liveness), logging pino JSON con
  `request_id`, Sentry condicional a `SENTRY_DSN`, pipe global de validación Zod (`APP_PIPE`)
  probado end-to-end contra `packages/shared`. Nota: el health-check vive en `/v1/health`
  (versionado), no en `/health` sin prefijo — excluirlo del prefijo global rompe el hook de
  logging de `nestjs-pino` sobre Fastify (detalle en `apps/api/README.md`).
- **QUI-216** — código y protocolo del spike GPS listos (`apps/mobile`): config Transistorsoft,
  detección de huecos/batería con tests, outbox SQLite. **La ejecución física de las 8h
  (licencia Transistorsoft ~US$400 + Android real de gama baja) sigue pendiente** — ninguno
  de los dos recursos está disponible en este entorno. Detalle y protocolo en
  `docs/spike-gps.md`. **No cerrar QUI-216 en Linear hasta tener los números reales.**
- **QUI-212** — `.github/workflows/ci.yml`: lint/typecheck/test/build con cache de pnpm+Turborepo
  y services Postgres+PostGIS/Redis, `timeout-minutes: 10`. **Branch protection en `main`
  queda pendiente** (requiere `gh` CLI autenticado o ajuste manual en GitHub Settings).

## QUI-227 (web admin) + QUI-219 (auth real) — cerrado 2026-07-30

`apps/web`: scaffold Next.js 15 App Router consumiendo `@quivo/design-system` (repo hermano
`~/Proyectos/Web/Design_System_QUIVO`, symlink `link:`). Incluye login, layout con sidebar
filtrado por rol, refresh de sesión JWT (`src/lib/auth/jwt.ts` + `auth-context.tsx`), guard de
rutas por rol (`isRouteAllowedForRole`), demo CRUD navegable de los 8 módulos M1 (Sindicatos,
Socios, Vehículos, Conductores, Líneas, Rutas, Rotaciones, Reglas) sobre datos en memoria, y
dashboard con KPIs y gráficos de flota/socios. Detalle del patrón CRUD demo en `apps/web/README.md`.

`apps/api`+`packages/db`: `POST /v1/auth/login` y `/v1/auth/refresh` reales vía Better-Auth +
Prisma (reemplazan el bypass `NEXT_PUBLIC_DEV_BYPASS_AUTH` que solo debería usarse en dev local).
Usuarios seed (`packages/db/prisma/seed.ts`): `admin@quivo.local` (rol `admin_quivo`) y
`admin@sindicato.local` (rol `admin_sindicato`, `sindicatoId` fijo), password `Quivo123!` para
ambos — solo para desarrollo, nunca en producción.

**Verificado end-to-end (2026-07-30):** login/refresh real contra Postgres, rechazo de password
incorrecta (401), y el guard de rutas por rol funcionando con una sesión **real** (no solo el
bypass simulado) — `admin_sindicato` es redirigido fuera de `/sindicatos` igual que con el bypass.

## QUI-217 (schema núcleo) + QUI-218 (RLS) + QUI-220 (CRUD sindicatos) — cerrado 2026-07-30

QUI-220 dependía de QUI-217/218, que en Linear seguían en "Todo" sin implementar (QUI-219 se
había adelantado fuera de orden porque solo necesitaba las tablas de Better-Auth) — se hicieron
los tres en orden en la misma sesión.

**QUI-217 — `packages/db/prisma/schema.prisma`:** modelos `Sindicato`, `Socio`, `Vehiculo`,
`Conductor`, `Linea`, `Ruta`/`Variante`/`Parada`/`PuntoControl` (columnas `GEOGRAPHY` vía
`Unsupported(...)`, sin CRUD todavía — llega con QUI-225/226) y `AuditLog`. `estado` queda
como `String` libre en Prisma a propósito: la única fuente de verdad del enum es
`EstadoXSchema` en `@quivo/shared`, no un enum nativo de Postgres. Seeds (`prisma/seed.ts`):
2 sindicatos demo con IDs fijos (`11111111-...`/`22222222-...`, los mismos que ya usaba el
usuario `admin@sindicato.local` de QUI-219) + un socio/vehículo/conductor/línea de prueba
por sindicato.

**QUI-218 — RLS multi-tenant:** gotcha central de Postgres — **los superusers (y cualquier
rol con BYPASSRLS) ignoran las políticas RLS sin importar `FORCE ROW LEVEL SECURITY`**, y el
rol `quivo` de `docker-compose.yml`/CI es superuser. Se creó un rol de runtime separado
`quivo_app` (`NOSUPERUSER NOBYPASSRLS`, migración `20260730152500_rls_multi_tenant`) que es
el que de verdad usa `apps/api` (`RUNTIME_DATABASE_URL`, distinto de `DATABASE_URL` que sigue
siendo el rol de migraciones). Contexto por request vía `withTenantContext` en
`packages/db/src/tenant-context.ts` (`SELECT set_config('app.rol'/'app.sindicato_id', $1,
true)` dentro de una transacción — el `true` final es `SET LOCAL`, se descarta solo al
terminar esa transacción). Políticas con bypass explícito para `admin_quivo` en `sindicatos`,
`socios`, `vehiculos`, `conductores`, `lineas` y `audit_log`. **Deliberadamente sin RLS:**
tablas de Better-Auth (login necesita leer `user` por email antes de conocer su
`sindicato_id` — meterle RLS complica ese flujo sin ganancia real de aislamiento) y
`rutas`/`variantes`/`paradas`/`puntos_control` (heredan `sindicato_id` transitivamente vía
`lineaId`, sin API todavía). Test cross-tenant real (`packages/db/src/rls.integration.test.ts`,
9 casos) corre en CI vía `pnpm test` — crea dos sindicatos temporales, prueba que ninguno lea
ni escriba datos del otro, y que `admin_quivo` sí ve ambos.

**QUI-220 — `POST/GET/PATCH /v1/sindicatos`:** `JwtAuthGuard` (verifica el access token corto
vía `auth.api.verifyJWT`, stateless) + `RolesGuard`/`@Roles('admin_quivo')` — los sindicatos
son el tenant, `admin_sindicato` no tiene acceso a este endpoint en absoluto. Auditoría directa
en `audit_log` por acción (el interceptor genérico llega con QUI-230). Verificado con curl real:
sin token → 401, `admin_quivo` → 200/201, `admin_sindicato` → 403.

**Bug de configuración encontrado armando esto:** sin `BETTER_AUTH_URL`, el plugin `jwt` de
Better-Auth firma `iss`/`aud` vacíos (`""`), y su propio `verifyJWT` interno rechaza cualquier
payload con `aud` falsy — **incluso un token recién emitido y válido**. Sin esto, ningún
endpoint protegido con `JwtAuthGuard` puede autenticar nada. Se agregó `BETTER_AUTH_URL` a
`.env.example`/CI/los `.env` locales, y un test de integración contra Better-Auth real (no
mockeado) para que este bug no vuelva a pasar en silencio — el test con `verifyJWT` mockeado
no lo detecta porque nunca llega a firmar un JWT real.

## QUI-221..226 — resto del núcleo administrativo (M1) — cerrado 2026-07-30

Mismo día que QUI-217/218/220, se completó el resto de M1 en el mismo PR: **QUI-221**
(`/v1/socios`), **QUI-222** (`/v1/vehiculos`), **QUI-223** (`/v1/conductores`), **QUI-224**
(`/v1/lineas`), **QUI-225** (`/v1/lineas/:id/rutas` + variantes + paradas, con geometría
PostGIS) y **QUI-226** (`/v1/rutas/:id/puntos-control`). 55 tests de integración corriendo
contra Postgres real (con RLS activo donde aplica).

**Tenant-scoping real (no solo `admin_quivo`):** a diferencia de sindicatos (QUI-220, único
módulo restringido a `admin_quivo`), socios/vehículos/conductores/líneas los usan también
`admin_sindicato`/`operador`. Cada service resuelve `sindicatoId`: si el actor tiene uno
propio, se lo fuerza sin importar qué mande el body (nunca confiar en el cliente para elegir
de qué tenant es un alta — verificado con test: mandar el `sindicatoId` de otro sindicato en
el body no cuela); si es `admin_quivo` (sin tenant propio), lo toma del body o rechaza con 400.

**QUI-222 — máquina de transiciones de estado para vehículos:** `activo` puede ir a
cualquier otro estado; `inactivo`/`suspendido`/`mantenimiento` solo pueden volver a
`activo` (sin transiciones directas entre esos tres). **Asunción no confirmada por
Producto** — el doc técnico solo lista los 4 estados posibles, no las transiciones válidas;
ajustar en `vehiculos.service.ts` si Producto define otra cosa. También se agregó
`credencialHash` (nullable) al modelo `Vehiculo` para el login por vehículo de M3 (QUI-235)
— solo el campo, sin lógica de login, nunca expuesto en las respuestas del API.

**QUI-225/226 — geometría PostGIS vía SQL crudo:** las columnas `GEOGRAPHY` (`rutas.geometria`,
`paradas.coord`, `puntos_control.coord`) son `Unsupported(...)` en Prisma — el Client normal
ni siquiera expone esos campos, así que todo el CRUD de geometría usa `$queryRaw`/`$executeRaw`
con `ST_GeomFromGeoJSON`/`ST_AsGeoJSON` (GeoJSON in/out por la API, nunca WKT). Dos
validaciones geoespaciales: `ST_IsValid` antes de grabar la geometría de una ruta, y
`ST_DWithin` (100m, **asunción no confirmada por Producto**, en
`common/geo/proximidad-ruta.ts`) para que paradas y puntos de control no puedan crearse lejos
de la geometría de su ruta.

**Tenant-scoping sin RLS propia para rutas/variantes/paradas/puntos_control:** estas tablas
no tienen columna `sindicatoId` directa (la heredan transitivamente vía `lineaId` →
`linea.sindicatoId`), así que QUI-218 deliberadamente no les puso políticas RLS (ver esa
migración). La barrera de tenant vive en el código: `common/geo/tenant-checks.ts` resuelve
toda operación hacia arriba hasta `linea` (que sí tiene RLS) — si no es visible para el
actor, se trata como inexistente (**404, nunca 403** — no revela que el recurso existe en
otro tenant). Variantes y paradas viven dentro de `RutasModule` (no son módulos Nest propios,
así lo agrupaba ya el esqueleto de QUI-214 bajo RF-24..33); `control-points` sí es su propio
módulo (RF-34..39/QUI-226, issue separada).

## QUI-228 — apps/web conectada al API real — cerrado 2026-07-30

Sindicatos, socios, vehículos, conductores y líneas ya no usan `demo-data.ts` — pegan contra
`apps/api` de verdad. Rutas (editor de mapa, QUI-229), rotaciones, reglas y auditoría siguen
en modo demo (sin API real todavía para lo que necesitan). `ModuleTablePage` ahora soporta un
prop `dataSource` opcional (`list`/`create`/`update`) que activa el modo real; sin `dataSource`
sigue funcionando exactamente como antes (`useState` local), así que las páginas que siguen en
demo no cambiaron. **Sin botón de borrar en modo real** — ningún endpoint de M1 expone
`DELETE` (las entidades se desactivan vía `estado`, nunca se borran de la DB).

Los formularios muestran exactamente los campos del contrato real de `@quivo/shared` — se
sacaron los campos inventados de la demo (`ciudad`, conteos de `socios`/`vehiculos` en
sindicatos, nombre de sindicato como texto libre en vez de FK) que no existen en la API.
`admin_quivo` elige el sindicato desde un `<Select>` poblado con `/v1/sindicatos`
(`src/lib/api/use-sindicato-options.ts`, que además resuelve `sindicatoId → nombre` para las
columnas de tabla); `admin_sindicato`/`operador` no ven ese selector — el service ya los
fuerza a su propio tenant sin importar qué mande el formulario.

**Bug real encontrado y arreglado armando esto:** la config de CORS de `apps/api`
(`app.enableCors({ origin })`, sin `methods` explícito) solo dejaba pasar `GET,HEAD,POST` en
`Access-Control-Allow-Methods` — **todo PATCH quedaba bloqueado por el browser** con
`Failed to fetch`, aunque el preflight (OPTIONS) respondiera 204 igual. `curl` nunca lo sufrió
(CORS es una restricción del browser, no del server) por eso pasó desapercibido durante todo
QUI-220..226 hasta que `apps/web` hizo el primer PATCH real desde un browser de verdad. Se
agregó `methods: ['GET','POST','PATCH','PUT','DELETE']` explícito en `main.ts`.

**Verificado en browser real** (Chrome vía automatización, sesión inyectada con un login real
de `admin@quivo.local`, `NEXT_PUBLIC_DEV_BYPASS_AUTH=false` temporalmente): crear y editar un
sindicato, crear un socio con el selector de tenant, y carga correcta de vehículos/
conductores/líneas con el nombre de sindicato resuelto. Nota: durante esta sesión quedaron
sindicatos de prueba huérfanos en la DB local (de corridas de test interrumpidas) que había
que limpiar a mano — si aparecen filas raras tipo "Rutas Test A"/"Paradas Test B" etc. en la
DB local, son de eso, no de datos reales.

## QUI-229 — editor de rutas sobre mapa — cerrado 2026-07-31

M1 (núcleo administrativo) queda **completo de punta a punta**. Reutiliza `RouteMap` del
design system (`~/Proyectos/Web/Design_System_QUIVO`) — que usa **Leaflet, no MapLibre**
(la decisión original del doc técnico §1 nunca se implementó así; se decidió no duplicar
ese trabajo construyendo un componente MapLibre nuevo desde cero cuando uno funcional ya
existía). Se le agregó un prop `zones` (commit aparte en ese repo, **no pusheado
todavía** — solo local) para dibujar círculos a escala real en metros (radio de tolerancia
de un punto de control), distinto de los `stops` (radio fijo en píxeles).

Flujo: elegir línea real → ver/crear rutas de esa línea dibujando la geometría con clicks
sucesivos sobre el mapa → sobre una ruta seleccionada, agregar paradas y puntos de control
con un click + formulario mínimo → variantes como lista simple (sin geometría propia).
Todo contra los endpoints reales de QUI-225/226. **Verificado en browser real**: dibujar y
guardar una ruta de 3 puntos, agregar una parada, y un punto de control — la primera vez
rechazado por "lejos de la ruta" (ST_DWithin del backend funcionando en vivo), aceptado al
clickear más cerca, con el círculo de 30m visible en el mapa.

## QUI-230 (interceptor de auditoría genérico) + QUI-231 (schema rotaciones/asignaciones) — cerrado 2026-07-31

Arranca M2 (Rotaciones, RF-51..57). Plan completo: QUI-230 → QUI-231 → QUI-232 → QUI-233 → QUI-234.

**QUI-230 — `AuditInterceptor` global reemplaza los `auditar()` manuales de QUI-220..226:**
interceptor único (`APP_INTERCEPTOR`) + decorador `@Auditable('entidad')` por método de
controller. Usa `concatMap` (no `tap`) para que el `await` a `audit_log` bloquee la respuesta
— si la auditoría falla, la request falla (fail-loud, no fire-and-forget). Resolución de
`sindicatoId` en el log: el de la propia entidad devuelta → el propio `id` si `entidad ===
'sindicato'` → el del actor como fallback (imprecisión documentada para los 4 módulos de
geometría sin `sindicatoId` propio). Se sumó `GET /v1/auditoria` (`auditoria.service.ts`) con
filtros `entidad`/`accion`/`desde`/`hasta`, protegido por `@Roles('admin_quivo',
'admin_sindicato')` y RLS existente — sin lógica de tenant-scoping propia, RLS ya lo resuelve.

**QUI-231 — `Rotacion` + `Asignacion` (`packages/db/prisma/schema.prisma`):** el constraint
`@@unique([vehiculoId, fecha, horario])` en `asignaciones` es la barrera real contra el riesgo
#12 del doc técnico ("conflicto operativo real en la calle") — un vehículo no puede tener dos
asignaciones el mismo día en el mismo horario sin importar la rotación. `conductorId` nullable
(la rotación puede publicarse con el vehículo asignado y el conductor por confirmar después).
`TurnoSchema` nuevo en `@quivo/shared` (`manana`/`tarde`/`noche` — asunción no confirmada por
Producto, el doc técnico deja `horario` como texto libre). Migración escrita a mano
(`20260731060000_rotaciones_asignaciones`, mismo patrón que el resto de la sesión — `prisma
migrate dev` sigue roto por el gap de PostGIS en la shadow DB desde que existe la primera
columna `Unsupported("geography(...)")`). RLS agregada a `rotaciones` (tiene `sindicatoId`
propio, mismo patrón que socios/vehículos/conductores/líneas); `asignaciones` queda sin RLS
propia a propósito — no tiene `sindicatoId` directo (lo hereda vía `rotacionId →
rotacion.sindicatoId`), mismo caso que rutas/paradas, el tenant-check en código llega con
QUI-232. Test de integración contra Postgres real (`packages/db/src/asignaciones-constraint.test.ts`)
prueba que el constraint rechaza la segunda asignación en conflicto y permite variaciones
válidas (mismo vehículo, mismo día, horario distinto). Seed extendido con una ruta + rotación +
2 asignaciones demo para el Sindicato 1º de Mayo.

## QUI-232 — API de rotaciones (generar/editar/publicar/anular) — cerrado 2026-07-31

`POST /v1/rotaciones` genera un borrador repartiendo **round-robin** los vehículos y
conductores activos del sindicato entre las rutas/fechas/horarios pedidos (`GenerarRotacionSchema`)
— "regla de reparto" no está detallada en el doc técnico más allá de mencionarla, así que
round-robin con mejor esfuerzo es una asunción de este equipo: si el vehículo que le toca en
el turno ya está ocupado esa fecha/horario (por cualquier rotación), se prueba con el
siguiente; si se agotan todos, el slot queda sin cubrir en vez de abortar el resto de la
generación. **Gotcha real encontrado armando esto:** el chequeo de disponibilidad tiene que
ser en memoria _antes_ de insertar, no capturando el error del constraint único — Postgres
aborta la transacción completa apenas falla un statement (`25P02: current transaction is
aborted`), así que intentar seguir insertando después de un `23505` capturado dentro de la
misma transacción de `withTenantContext` no funciona (a diferencia de
`crearAsignacion`/`actualizarAsignacion`, que sí pueden traducir ese error a un 409 porque
cada una corre en su propia transacción y no necesita seguir haciendo más inserts después).

`POST /v1/rotaciones/:id/publicar` y `/anular` son transiciones de estado atómicas
(`borrador` ⇄ `publicada`) — atómicas porque viven dentro de la misma transacción que ya arma
`withTenantContext`, no por lógica extra. "Anular" es una asunción de este equipo: vuelve la
rotación a `borrador` para poder corregirla antes de que la app móvil la consuma, no es un
estado nuevo (`EstadoRotacionSchema` sigue siendo solo `borrador`/`publicada`). Edición manual
de asignaciones (alta/edición/borrado, `POST`/`PATCH`/`DELETE /v1/rotaciones/:id/asignaciones`)
solo mientras la rotación está en `borrador`.

**Extensión al interceptor de auditoría (QUI-230):** `@Auditable('entidad', 'accion')` ahora
acepta un override opcional — `publicar` y `anular` son ambos `POST` por contrato de API
(`docs/documento-tecnico-cto.md` §8) pero no son un alta; sin el override, el interceptor
genérico los etiquetaba como `crear` en `audit_log` (inferido solo del método HTTP), lo cual
es justo lo que pedía el ticket evitar ("Auditoría de publicar/anular"). Verificado en
`audit.interceptor.test.ts`.

Roles con acceso: `admin_quivo`/`admin_sindicato` (no `operador` — asunción de este equipo,
rotaciones es una función de planificación, no de operación diaria, a diferencia del resto de
M1 que sí incluye `operador`). Verificado end-to-end contra el API real (curl): generar un
borrador de 4 asignaciones, publicar, intentar publicar de nuevo (400), anular, y confirmar
en `GET /v1/auditoria?entidad=rotacion` que las 3 acciones (`crear`/`publicar`/`anular`)
quedan bien etiquetadas.

## QUI-233 — web admin: UI de rotaciones — cerrado 2026-07-31

`/rotaciones` deja de ser demo (`useState` local) y pasa a consumir el API real de QUI-232.
Layout igual al de `/rutas` (QUI-229): panel izquierdo con selector de sindicato
(`admin_quivo` únicamente, mismo patrón de `useSindicatoOptions` que socios/vehículos) +
formulario de generación (periodo, rango desde/hasta que se expande a la lista de días,
checkboxes de horarios y de rutas) + lista de rotaciones existentes; panel derecho con la
**grilla vehículo × fecha/horario** que pide el ticket — filas y columnas se derivan de las
asignaciones reales de la rotación seleccionada (no de un catálogo completo de vehículos),
cada celda clickeable abre un `Modal` de edición (ruta/conductor/horario + botón "Quitar")
mientras la rotación esté en `borrador`; publicar/anular usan `ConfirmDialog`. El error 409
de doble-asignación se muestra dentro del modal con el mensaje tal cual lo devuelve el
service (`"Ese vehículo ya tiene una asignación en esa fecha y horario"` — ya es lenguaje
llano de por sí, no necesitó traducción adicional en el frontend, que era el criterio de
aceptación del ticket).

**Bug real encontrado y arreglado armando esto:** `apiFetch` (cliente HTTP compartido,
`apps/web/src/lib/api/client.ts`) mandaba `Content-Type: application/json` en **toda**
request, incluidos los `POST /v1/rotaciones/:id/publicar`/`/anular` que no llevan body —
Fastify rechaza esa combinación con 400 (`"Body cannot be empty when content-type is set to
'application/json'"`). No había aparecido antes porque QUI-228/229 solo hicieron `POST`s con
body real. Fix: el header solo se manda si `init.body` está definido — afecta a cualquier
futuro endpoint sin body, no solo a rotaciones.

**Verificado en browser real** (mismo método que QUI-228/229: `next build && next start`
para que `NODE_ENV=production` desactive el bypass de dev automáticamente, sesión real de
`admin@quivo.local`): generar un borrador de 4 asignaciones (1 vehículo × 2 fechas × 2
horarios), editar una celda a un horario ya ocupado por el mismo vehículo y ver el error 409
en línea, publicar (badge cambia a verde "publicada", desaparecen los controles de edición),
y anular (vuelve a "borrador").

## QUI-234 — vencimiento de asignaciones por jornada (RF-57) — cerrado 2026-07-31, M2 completo

Job **BullMQ repeatable** (cada 5 min, `upsertJobScheduler` — idempotente entre reinicios,
no acumula schedulers duplicados) que marca `vencida` toda asignación `vigente` cuya
`venceAt` ya pasó. Nueva columna `Asignacion.estado` (`vigente`/`vencida`, default
`vigente`) + índice `(estado, venceAt)` para esa query.

**Bug real encontrado escribiendo los tests de borde de zona horaria que pedía el ticket:**
`venceAt` (QUI-232) se calculaba como `23:59:59 UTC` del mismo `fecha` — pero Bolivia es
**UTC-4 sin horario de verano** (único mercado del MVP), así que eso vencía una asignación
a las 19:59:59 hora local, **4 horas antes de lo real**. Nuevo helper
`apps/api/src/common/tiempo/jornada.ts` (`finDeJornadaBolivia`) calcula el instante UTC
correcto (03:59:59 del día siguiente al `fecha`) — 5 tests de borde (cambio de mes, de año,
29 de febrero de un bisiesto, "sin DST") lo verifican.

**Redis local desbloqueado:** el puerto 6379 lo tenía tomado otro proyecto de esta máquina
(`quivo-control-redis-1` no podía publicar su puerto) — bloqueo que venía arrastrándose
desde el plan inicial de M2. Redis de este proyecto ahora corre en el puerto host **6380**
(`docker-compose.yml`, `.env.example`, `.env` local), mismo patrón que el 5434 de Postgres.
De paso, `pnpm-workspace.yaml` necesitó aprobar el build script de `msgpackr-extract`
(dependencia nativa opcional de `bullmq`/`ioredis`) que pnpm empezó a ignorar por default.

**Fuera de alcance (documentado, no una decisión de Producto):** "API de consulta solo
devuelve vigentes" del ticket se refiere al futuro `GET /v1/mobile/asignacion-del-dia`
(RF-73, módulos `tracking`/`sync`, M3, QUI-240/241) — no existe todavía, así que no hay nada
que filtrar hoy. Los endpoints admin (`GET /v1/rotaciones*`, QUI-232/233) siguen devolviendo
**todas** las asignaciones con su `estado` visible en la respuesta — la UI de rotaciones
necesita ver el historial completo para poder editar/republicar, no solo lo vigente; filtrar
ahí habría roto esa pantalla. Verificado en vivo: la API arranca con Redis en 6380
(`"redis":"up"` en `/v1/health`) y el job corre al boot sin errores.

**M2 — Rotaciones (RF-51..57) queda completo:** QUI-230 (interceptor de auditoría genérico)
→ QUI-231 (schema + constraint anti doble-asignación) → QUI-232 (API generar/editar/
publicar/anular) → QUI-233 (UI web, grilla vehículo×fecha) → QUI-234 (vencimiento, este).

## M4 — dashboard/reglas/reportes: arrancado 2026-07-31

M3 (app móvil + offline + sync, RF-58..73) sigue bloqueado por recursos físicos que nadie
consiguió todavía (licencia Transistorsoft + Android real de gama baja, QUI-216). M4 no
depende de eso, así que se sigue por ahí: QUI-248 (auditoría) → QUI-244 (reglas/sanciones,
modelo+API) → QUI-245 (UI reglas/sanciones). QUI-246/247/249 (dashboard de cumplimiento,
reconstrucción de recorridos, reportes operativos) sí necesitan datos reales de
`gps_points`/sesiones que solo existen una vez que M3 esté armado — quedan para después.

## QUI-248 — web admin: auditoría con filtros — cerrado 2026-07-31

`/auditoria` deja de ser demo y consume `GET /v1/auditoria` (QUI-230) de verdad. Filtros por
entidad/acción/usuario/rango de fecha (se sumó `usuarioId` al `AuditoriaQuerySchema` y al
service — QUI-230 solo tenía entidad/acción/fecha). Tabla vía el componente `AuditLog` del
design system; cada fila tiene un botón "Ver diff" que abre un `Modal` con el diff completo
formateado (JSON pretty-printed) — alcanza para "legible" sin necesitar reconstruir un
`{antes, cambios}` estructurado (mismo criterio de simplicidad que QUI-230 ya había asumido).
Verificado en browser real: filas reales de `audit_log` cargando, modal de diff abriendo con
el contenido correcto (incluida una fila vieja pre-QUI-230 con el shape `{antes, cambios}`
de cuando la auditoría todavía era manual en cada service — se muestra tal cual está en la
DB, sin normalizar formatos históricos).

## QUI-244 — reglas y sanciones: modelo + API + transiciones — cerrado 2026-07-31

`Regla` (estatutos: nombre/tipo/gravedad/aplicaA/descripcion/estado) y `Sancion` (sujeto
polimórfico `vehiculo`/`conductor`/`socio` sin FK — mismo patrón que `AuditLog.entidadId`).
El doc técnico deja el modelo muy comprimido (`estatutos/reglas(id, sindicato_id, tipo,
gravedad, aplica_a, relacion)`) — se agregaron `nombre`/`descripcion` por usabilidad admin y
`gravedad` (`leve`/`grave`/`gravisima`) como asunciones de este equipo, no confirmadas por
Producto. RLS en ambas tablas (tienen `sindicatoId` propio, mismo patrón que rotaciones).

**Máquina de transiciones de `Sancion`** (el doc técnico solo lista los 5 estados —
`pendiente`/`aplicada`/`anulada`/`apelada`/`pagada` — sin definir las transiciones válidas
entre ellos, así que esto es una asunción de este equipo, mismo criterio que las
transiciones de vehículos de QUI-222):

```
pendiente → aplicada | anulada
aplicada  → apelada | pagada | anulada
apelada   → aplicada | anulada
pagada, anulada → (terminales)
```

Endpoints dedicados `POST /v1/sanciones/:id/{aplicar,anular,apelar,pagar}` (no un PATCH de
estado genérico), todos auditados con el override de acción de `@Auditable` (mismo mecanismo
de QUI-232). Edición (`PATCH /v1/sanciones/:id`) restringida a `motivo`/`evidenciaRef` y solo
mientras está `pendiente`.

**Límite conocido, documentado:** "evidencia = datos de recorrido auto-vinculados" (doc
técnico §15.5) necesita tracking real (M3: sesiones, `gps_points`, `cumplimientos_pc`), que
esta sesión no llegó a construir — `evidenciaRef` queda como texto libre que carga quien
registra la sanción, sin auto-vinculación todavía.

**Nota de consistencia de API:** `CrearReglaSchema`/`CrearSancionSchema` exigen `sindicatoId`
en el body (no opcional) — se alinearon con el patrón mayoritario de
vehículos/líneas/socios/conductores (el frontend lo autocompleta vía `createDefaults`,
`admin_quivo` lo elige en un `<Select>`), no con el patrón de `GenerarRotacionSchema`
(QUI-232) que lo dejó opcional. Ambos patrones funcionan (el service igual fuerza el tenant
real vía `resolverSindicatoId`), pero para evitar que conviva un tercer estilo, QUI-244 usa
el más extendido en la base de código.

Verificado end-to-end contra el API real (curl): crear regla → crear sanción (`pendiente`) →
aplicar → pagar → confirmar que `pagada` es terminal (`anular` devuelve 400).

## QUI-245 — web admin: UI de reglas y sanciones — cerrado 2026-07-31

`/reglas` deja de ser demo. Dos pestañas (`Tabs` del design system) sobre el mismo layout:
**Reglas** reutiliza `ModuleTablePage` con `dataSource` real (mismo patrón que
vehículos/líneas, QUI-228) — CRUD simple, sin lógica propia. **Sanciones** es una vista a
medida (mismo criterio que rotaciones, QUI-233): filtros por estado/regla, tabla con botones
de transición que cambian según el `estado` actual de cada fila (p. ej. `pendiente` muestra
Aplicar/Anular; `aplicada` muestra Apelar/Marcar pagada/Anular), cada transición con
`ConfirmDialog`, y un modal de alta con selector de sujeto dependiente del `sujetoTipo`
elegido (vehículo/conductor/socio).

**Bug real encontrado y arreglado armando esto:** `fechaHecho` es una fecha "pura" (guardada
como medianoche UTC), pero `toLocaleDateString('es-BO')` sin fijar `timeZone: 'UTC'` usa la
zona horaria del browser para convertir — en cualquier navegador al oeste de UTC (incluida
Bolivia, UTC-4) esto corre la fecha mostrada un día para atrás. Se vio en vivo: una sanción
con `fechaHecho: 2026-08-01` se mostraba como "31/7/2026" hasta forzar `timeZone: 'UTC'` en
el formateo. El campo `ts` de auditoría (QUI-248) no tiene este problema — es un timestamp
real, no una fecha pura, así que mostrarlo en hora local del browser es lo correcto ahí.

Verificado en browser real (Chrome, sesión `admin_quivo`): crear una regla con el selector de
sindicato, cambiar a la pestaña Sanciones, crear una sanción, aplicarla (con confirmación), y
confirmar que los botones de acción cambiaron correctamente a los de una sanción `aplicada`.

**M4 sigue así:** QUI-246 (dashboard de cumplimiento), QUI-247 (reconstrucción de
recorridos) y QUI-249 (reportes operativos) necesitan datos reales de `gps_points`/sesiones
que solo van a existir con M3 armado — quedan pendientes hasta que se resuelva el bloqueo de
hardware de QUI-216 (licencia Transistorsoft + Android real).

## Repaso M1-M4 (a pedido explícito, tras cerrar M2 y la parte de M4 sin M3) — 2026-07-31

Con M2 y la parte de M4 independiente de M3 cerradas, se hizo un repaso completo de todo lo
construido buscando huecos en vez de seguir a QUI-251 (que es un gate de pre-release, tiene
más sentido correrlo una sola vez cerca del release real, no ahora). Encontrado y corregido:

- **Bug real: el dashboard (`/`) seguía mostrando datos de `demo-data.ts`** (sindicatos/
  vehículos/conductores/socios de ejemplo) — nadie lo había migrado a las APIs reales al
  cerrar QUI-220..224, a pesar de ser la primera pantalla que ve cualquier admin. Ahora pega
  contra las 4 APIs reales; "sin socio asignado" se calcula de `socioId == null` (no de un
  `estado` que no existe en el modelo real); la tarjeta "Sindicatos activos" queda oculta
  para `admin_sindicato`/`operador` (no pueden llamar `GET /v1/sindicatos`, QUI-220 es
  `admin_quivo`-only). `src/lib/demo-data.ts` quedó huérfano y se borró.
- **Documentación desactualizada** en dos lugares: `apps/api/src/modules/README.md` seguía
  marcando "esqueleto" a 10 módulos que llevan sesiones enteras siendo reales (nunca se
  actualizó módulo por módulo); `apps/web/README.md` describía un modo demo (`ModuleTablePage`
  sin `dataSource`) que ya ninguna página usa. Ambos corregidos para reflejar el estado real.
- **Asimetría de API real: `variantes` (QUI-225) no tenía `GET /v1/variantes/:id`**, a
  diferencia de paradas/puntos-control/rutas que sí lo exponen — agregado
  service+controller+test siguiendo el mismo patrón (tenant-check vía `asegurarRutaVisible`).
- **`seed.ts` no tenía datos de ejemplo de reglas/sanciones** (QUI-244, llegó después del
  último seed) — agregada una regla + una sanción `pendiente` para el Sindicato 1º de Mayo.
- `/reportes` tenía un subtítulo desactualizado ("el dashboard real llega en M4" — ya estamos
  en M4 con partes reales) — corregido para nombrar específicamente QUI-246/249 como lo
  bloqueado, y por qué (necesitan datos de tracking que solo van a existir con M3).

**Encontrado pero deliberadamente NO implementado (para no salirme de "buscar huecos" hacia
"construir features nuevas" sin que se pida):** la mitad de QUI-249 (reportes operativos)
podría hacerse hoy sin M3 — "sanciones por sujeto/estado" ya tiene datos 100% reales
(QUI-244), a diferencia de "recorridos por periodo" que sí necesita tracking. Si se quiere
adelantar esa parte de QUI-249, es una decisión de alcance a tomar explícitamente, no algo
que se coló en este repaso.

## QUI-251 — Auditoría RLS + security review pre-release — cerrado 2026-07-31

Alcance del ticket: RLS en todas las tablas (M1-M4), test cross-tenant extendido, auth
(expiración/refresh), rate limiting, manejo de secrets, dependency audit, superficie de API.

**Encontrado y corregido (huecos reales):**

1. **No había rate limiting en ninguna parte de la API** — `/v1/auth/login` aceptaba fuerza
   bruta ilimitada por IP. Agregado `@nestjs/throttler`: límite global 100 req/min/IP, y uno
   mucho más estricto en `login` (5/min) vía `@Throttle`. Verificado en vivo: 6º intento de
   login devuelve `429`, `/v1/health` no se ve afectado (usa el límite general).
2. **"Cerrar sesión" no revocaba nada server-side** — `auth-context.tsx`'s `logout()` solo
   borraba `localStorage`; un `refreshToken` robado seguía siendo válido hasta su expiración
   natural (hasta 30 días) aunque el usuario ya hubiera "cerrado sesión". Nuevo
   `POST /v1/auth/logout` (`auth.api.signOut` de Better-Auth, revoca la fila real en
   `session`) + wiring del frontend (best-effort: si la API no responde, igual limpia la
   sesión local). Verificado tres formas: test de integración contra Better-Auth real
   (`auth.service.test.ts`), curl+conteo de filas en `session` antes/después, y click real
   en el botón (confirmado en los logs del server, aunque la extensión de Chrome reportó un
   503 fantasma que no coincidía con los logs reales del server — ver nota abajo).
3. **Next.js tenía 8 CVEs conocidos** (DoS/SSRF en Server Actions, SSRF en rewrites, DoS en
   Image Optimization con SVG, cache confusion) — verificado que ninguno aplica de verdad
   (esta app no usa Server Actions, no tiene `rewrites` custom, y su único `next/image` es un
   logo estático `.webp`, no SVG ni URL dinámica), pero se bumpeó igual a `15.5.22`
   (>=15.5.21 = parcheado) porque es un patch del mismo minor, sin riesgo.
4. **La matriz de roles por controller nunca quedó como test automático** — solo se había
   verificado a mano con curl (QUI-220..226). Nuevo `roles-matrix.test.ts` lee la metadata
   real de `@Roles(...)` de los 17 controllers vía `Reflect.getMetadata` y la compara contra
   la matriz documentada — si alguien afloja un rol sin querer, este test es el primero en
   romper.
5. **El test canónico de RLS cross-tenant (`packages/db/src/rls.integration.test.ts`,
   QUI-218) nunca se extendió a las tablas de M2/M4** — cubría sindicatos/socios/vehículos/
   conductores/líneas pero no `rotaciones`/`reglas`/`sanciones` (llegaron después). Ya
   tenían cobertura cross-tenant a nivel de sus propios módulos, pero no en el archivo que
   es la prueba canónica "RLS es la barrera real, no el código de arriba". Extendido con 5
   casos más (14 en total).

**Evaluado y confirmado que NO aplica (dependency audit, `pnpm audit --prod`):**

- **`better-auth` tiene un CVE crítico y varios altos** — todos son de plugins que esta app
  no usa (OAuth, OIDC provider, organization, admin, anonymous, SCIM, magic-link, email-OTP;
  `packages/db/src/auth.ts` solo tiene `emailAndPassword` + `bearer` + `jwt`). No existe un
  1.4.x parcheado (1.4.22 es el último de esa línea) — subir a 1.6.x rompería la
  compatibilidad con `@better-auth/cli` ya documentada. Riesgo real hoy: ninguno, dado el uso
  actual — **re-evaluar si alguna vez se habilita un plugin nuevo de Better-Auth**.
- **`drizzle-orm`, `@xmldom/xmldom`, `tar`, `postcss`, `brace-expansion` (vía
  `better-auth>drizzle-orm>expo-sqlite>expo>@expo/cli>...`)** — better-auth declara
  `drizzle-orm` como dependencia real (adapter opcional que este proyecto no usa, Prisma es
  el único ORM acá) y `drizzle-orm` a su vez arrastra el toolchain de `@expo/cli` como
  dependencia de UNO de sus muchos adapters posibles. Código muerto: ninguna de esas rutas
  se ejecuta nunca en este repo. Mismo origen para el `tar`/`postcss`/`brace-expansion` que
  aparecen vía `apps/mobile`'s propias devDependencies de Expo (tooling de build, no corre
  en el dispositivo final).
- **`find-my-way` (router de Fastify): DDoS vía HTTP2** — HTTP2 no está habilitado en
  `FastifyAdapter` (`apps/api/src/main.ts`), así que no es explotable con la config actual.
  Fastify mismo sigue fijando `find-my-way@9.6.0` internamente incluso en su versión más
  nueva (9.7.0 ya está parcheado y coexiste en el lockfile vía otra dependencia) — no hay
  override limpio sin arriesgar el comportamiento de ruteo interno de Fastify para un riesgo
  que hoy es cero.
- **`sharp` (CVEs de libvips heredadas)** — vía `next`'s Image Optimization opcional; esta
  app no procesa imágenes de usuarios ni URLs externas, solo el logo estático del branding.
- **`@opentelemetry/core` (memoria sin límite en W3C Baggage)** — vía `@sentry/node`
  (`apps/api`), ya en su última versión 8.x disponible (8.55.2); no hay nada más para
  actualizar hasta que Sentry libere un fix upstream. Exposición baja: requiere headers
  `baggage` controlados por el atacante Y `SENTRY_DSN` configurado.

**Confirmado correcto, sin hallazgos:**

- RLS habilitado+forzado exactamente en las 8 tablas con `sindicatoId` propio
  (`sindicatos`/`socios`/`vehiculos`/`conductores`/`lineas`/`rotaciones`/`reglas`/
  `sanciones`), ausente donde corresponde (tablas de Better-Auth, `rutas`/`variantes`/
  `paradas`/`puntos_control`/`asignaciones` con tenant-check transitivo en código) —
  verificado consultando `pg_class.relrowsecurity`/`relforcerowsecurity` directo en Postgres.
- Los 17 controllers de negocio tienen `JwtAuthGuard`+`RolesGuard`; solo `/v1/health` y
  `/v1/_internal/ping` quedan públicos, a propósito (liveness/readiness, sin datos).
- Sin secrets committeados (`.gitignore` cubre `.env*` con excepción explícita de
  `.env.example`); `JWT_SECRET` se referencia una sola vez, nunca se loggea.
- CORS con origen explícito (no wildcard) y métodos explícitos (sin `credentials`, no hace
  falta — la app usa Bearer, no cookies cross-origin).

**Nota metodológica:** al verificar el logout en un browser real, la extensión de Chrome
usada para automatizar reportó un `503` en la request a `/v1/auth/logout`, pero los logs
reales del server (pino, en `apps/api`) mostraban `204` para esa misma request tanto en
tiempo como en `requestId`. Se verificó de forma independiente contando filas en la tabla
`session` antes/después de un login+logout real vía curl: 47→48→47, confirmando que el
`503` fue un artefacto de la herramienta de automatización (probablemente por la
navegación de SPA disparándose mientras el fetch fire-and-forget seguía en vuelo), no un
fallo real del servidor. Vale la pena recordar esto si alguna vez se ve una discrepancia
similar entre lo que reporta el browser automatizado y lo que dicen los logs del server —
los logs del server son la fuente de verdad.

## Autenticación operativa móvil + identidad QUIVO — cerrado 2026-08-01

`apps/mobile` ya compone el flujo vehículo -> chofer -> operación con componentes nativos
basados en el Design System QUIVO. La sesión y el identificador de instalación viven en
SecureStore; reiniciar el proceso recupera el contexto y lo reconcilia con la API. El
GPS/outbox previo se conserva detrás de una sesión autenticada y ahora etiqueta eventos con
`sesionId`/`deviceId`.

El módulo `apps/api/src/modules/auth-movil` usa desafío corto de un solo uso y tokens
access/refresh opacos; Postgres guarda sólo hashes. La línea se deriva de
`asignacion -> ruta -> linea`. Refresh rota ambos tokens, logout revoca y un cambio de PIN
invalida desafíos/sesiones relacionadas con auditoría libre de credenciales. Los endpoints
y el modelo final están en `docs/plan-auth-movil-quivo.md`.

Verificado en `Pixel_10_Pro`: APK debug instalado, bundle Metro HTTP 200, ambos pasos de
login contra API LAN, contexto completo y restauración tras cold start. El logger Pino fue
endurecido globalmente para eliminar Authorization/cookies. El monorepo completo pasó
typecheck, lint, tests y build. El gate pendiente de licencia/hardware corresponde al
tracking GPS productivo, no al login/contexto móvil.

## PR #2 — vendorizar design system + CI verde — cerrado 2026-08-14

El PR #1 (`qui-227-web-nextjs-scaffold`, todo lo documentado arriba desde M0 hasta la
autenticación móvil) se mergeó a `main` el 2026-08-14, pero **nunca había pasado un CI verde**:
las 8 corridas de la historia del repo, incluida la del propio merge, fallaban en el paso
*Typecheck* con 136 errores. Causa raíz única: `apps/web/package.json` dependía de
`@quivo/design-system` vía `link:` hacia un repo hermano (`Design_System_QUIVO`), y ese repo
se perdió junto con el acceso a la máquina donde vivía. Se buscó exhaustivamente antes de
reconstruir nada: no está en la organización de GitHub (`Quivo-enterprise/Quivo-UI-UX` existe
pero está vacío), no está en la cuenta personal del CTO, no está en ningún checkout local de
`Quivo-control` (los 3 tienen el mismo symlink colgado), nunca estuvo en el historial de git
de este repo, y la caché de Turbo no tiene ningún `turbo-build` de `apps/web` del que extraer
el CSS/JS compilado. Diagnóstico y evidencia completos en
[`docs/plan-continuidad-quivo-control.md`](plan-continuidad-quivo-control.md).

1. **`@quivo/design-system` reconstruido como workspace del monorepo
   (`packages/design-system`).** No es un rediseño: la API, los ~30 tokens `--qv-*` y las
   ~13 clases `qv-*` se derivaron leyendo cada uno de los 25 archivos de `apps/web` que
   consumían el paquete (21 componentes en total — `AdminLayout`, `DataTable`, `RouteMap`,
   `Select`, `DatePicker`, etc.). `apps/web/package.json` solo cambió el `link:` externo por
   `workspace:*`; los imports de la app quedaron intactos. Esto solo llevó el typecheck de
   **136 errores a 0** (22 `TS2307` de módulo no encontrado más 114 derivados de perder la
   inferencia de tipos sin el paquete). Se descartó migrar a shadcn/ui: habría obligado a
   reescribir los 25 consumidores además del paquete nuevo, con más riesgo y sin resolver
   nada que la reconstrucción no resolviera ya.

2. **Bug de SSR en `RouteMap`:** el barrel de `packages/design-system` reexporta todo junto,
   así que el import estático de Leaflet a nivel de módulo se arrastraba a cualquier página
   que importara cualquier otro componente del design system — incluidas `/login` y
   `/conductores`, que ni siquiera tienen mapa — y rompía en SSR con `window is not defined`.
   `RouteMap` ahora es un wrapper client-only que carga la implementación real
   (`route-map-impl.tsx`) con `lazy()` recién después del mount.

3. **`Map container is already initialized`:** `/rutas` no cargaba en `next dev`. No era solo
   el doble-mount de Strict Mode: `MapContainer` de `react-leaflet@4.2.1` crea el mapa dentro
   de un ref callback cuyo `context` capturado queda `null` para siempre, y lo destruye en un
   efecto que depende de ese mismo `context` — el cleanup **nunca corría** y los mapas se
   acumulaban con sus listeners. Se reemplazó por un contenedor propio
   (`route-map-impl.tsx`) que maneja el ciclo de vida con cleanup real y publica el contexto
   con `LeafletProvider` (API pública de `@react-leaflet/core`). Dato técnico a recordar: el
   App Router de Next 15 corre su propio **React 19** internamente aunque `package.json` fije
   18.3.1, y es el doble-invoke de React 19 (que además desata y reata refs) el que dispara el
   fallo.

4. **RLS multi-tenant: los tests nunca habían probado nada.** Turbo corre en `envMode: strict`
   y `turbo.json` solo declaraba `DATABASE_URL` en `globalPassThroughEnv`, así que
   `RUNTIME_DATABASE_URL` se filtraba del entorno del proceso de test. `packages/db/src/client.ts`
   caía **en silencio** al fallback `?? DATABASE_URL`, que apunta al rol `quivo` (superusuario
   con `BYPASSRLS`) — Postgres ignora RLS para ese rol, y los 12 tests de aislamiento
   fallaban. Reproducido: `turbo run test --filter=@quivo/db` da 12 fallos; el mismo comando
   con `--env-mode=loose`, contra la misma base y en el mismo instante, da 17/17. **Las
   políticas en sí estaban bien** — las 15 tablas tienen `FORCE ROW LEVEL SECURITY`, las 15
   policies `tenant_isolation` existen y `quivo_app` no es superusuario ni tiene `BYPASSRLS`.
   Se declararon las variables (`RUNTIME_DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`,
   `BETTER_AUTH_URL`, `NODE_ENV`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`) en `env` de la tarea
   `test` de `turbo.json` (no en `globalPassThroughEnv`, para que entren al hash de caché:
   cambiar de base ahora invalida la caché en vez de replayear un resultado obtenido contra
   otra conexión). `client.ts` ahora **falla ruidosamente** fuera de `development` si falta
   `RUNTIME_DATABASE_URL`, en vez de degradar; y `rls.integration.test.ts` verifica primero
   como quién está conectada y aborta si detecta superusuario o `BYPASSRLS`, para que este
   tipo de falso-verde no pueda volver a pasar inadvertido.

   **Riesgo de despliegue que queda abierto, fuera del código:** no hay ningún manifiesto de
   deploy en el repo (`Dockerfile`, `fly.toml`, `render.yaml`). Antes de este fix, un entorno
   que olvidara `RUNTIME_DATABASE_URL` arrancaba la API sin ningún aviso con el aislamiento
   entre sindicatos apagado; con el fix ahora falla al arrancar, lo cual es mejor pero no
   elimina el riesgo — **hay que verificar si existe algún entorno ya desplegado y si tiene
   esa variable seteada**. Se agrava porque
   `apps/api/src/modules/socios/socios.service.ts:33` hace `findUnique({ where: { id } })`
   sin filtrar por `sindicatoId`, apoyándose en RLS como única barrera. Pendiente explícito,
   no resuelto en este PR.

5. **Seed en CI:** 4 tests de auth fallaban con 401 porque corren contra Better-Auth real con
   usuarios del seed (`admin@quivo.local`), y el job migraba la base pero nunca la sembraba.
   Se agregó el paso `Seed database`/`Seed acceptance data` al workflow.

6. **Cliente Prisma y caché de Turbo:** `@quivo/db:build` es `prisma generate && tsc`, pero
   `turbo.json` solo declara `dist/**` como output — el cliente que genera Prisma se escribe
   en `node_modules/.pnpm/@prisma+client@…/node_modules/.prisma`, que no se cachea. Con cache
   hit, Turbo restauraba `dist/` sin volver a ejecutar el comando, así que el cliente nunca se
   escribía y el seed explotaba con `"The requested module '@prisma/client' does not provide
   an export named 'PrismaClient'"`. **El pipeline solo había funcionado hasta ahora con
   caché fría.** Fix: `prisma:seed` corre `prisma generate` primero (se prefirió esto sobre
   agregar un paso al workflow porque protege también a cualquiera que corra el seed en local
   tras borrar `node_modules` o cambiar de rama, no solo a CI).

7. **Job `acceptance` (Playwright) agregado al pipeline.** `playwright.config.ts` y los 3
   tests de `tests/acceptance/admin-panel.spec.ts` ya existían en el repo pero no corrían en
   ningún workflow. El job nuevo corre con `needs: ci` y sube el reporte de Playwright como
   artifact si falla.

8. **`/code-review high`: 11 hallazgos, los 11 aplicados.** El más grave: el efecto de foco de
   `BaseDialog` dependía de `onClose`, recreado en cada render por todos los call sites — así
   que **cada tecla robaba el foco al input** y no se podía escribir más de un carácter en
   ningún modal de alta o edición. El callback pasa ahora a un `ref`, el foco solo se mueve en
   la transición de apertura. También: fallbacks de color `var(--qv-color-primary)` en
   atributos de presentación SVG de Leaflet, donde `var()` no se sustituye (las polilíneas se
   dibujaban invisibles — ahora usan un hex literal); `ColorPicker` que mostraba un color
   mientras almacenaba `''`; `Select` no operable con teclado ni con `role="combobox"`; y 10
   clases que se renderizaban sin estilo.

9. **Ramas borradas del remoto:** `qui-227-web-nextjs-scaffold`, `feat/mobile-ui-valentina` y
   `feat/mobile-ui-sprint-valentina`, las 3 verificadas con `git merge-base --is-ancestor` como
   100% mergeadas antes de borrarlas — ninguna tenía un commit propio pendiente de integrar.
   Solo queda `main` en el remoto. Estado y evidencia completos por rama en
   [`docs/ramas-sprint-m6.md`](ramas-sprint-m6.md).

**Patrón que vale la pena dejar escrito:** los puntos 3 a 6 comparten una misma causa de fondo
— **el CI nunca había pasado del paso `Typecheck`**, así que ni los tests unitarios, ni los de
RLS, ni los de aceptación se habían ejecutado jamás en un pipeline real. Arreglar el
typecheck no destapó "el" siguiente problema sino una serie: cada capa que por fin corría
revelaba la siguiente que tampoco había corrido nunca. Un pipeline que nunca fue verde no es
un pipeline — es, en el mejor de los casos, un linter.

**Otros pendientes que quedaron registrados en esta sesión, sin resolver:**

- **Branch protection en `main` sigue siendo imposible**: `gh api .../branches/main/protection`
  devuelve `403 Upgrade to GitHub Pro` — el repo es privado en plan free. El criterio de
  aceptación de QUI-212 no se puede cumplir sin cambiar de plan (hacerlo público quedó
  descartado).
- **Entorno local**: Turbo no propaga el `.env`, hay que exportar las variables a mano antes
  de correr comandos sueltos; la máquina del CTO tiene Node v24 mientras el repo pide
  `>=22 <23` (`npm_config_engine_strict=false` como workaround solo local — CI usa `.nvmrc` y
  está bien).
- **`test:acceptance:prepare`** hace `. apps/api/.env`, un archivo que no existe ni en local
  ni en CI — el script fallaría con `set -e` si algo lo invoca. Sin investigar todavía.
- **Riesgo latente de orden en el workflow de CI**: el paso `Test` depende implícitamente de
  que `Seed database` haya corrido antes y haya dejado el cliente Prisma escrito en disco.
  Funciona hoy por el orden de los pasos, no por una garantía estructural del workflow.

**Verificación de este PR:** clon limpio + `pnpm install && pnpm typecheck && pnpm test &&
pnpm build` sin ninguna ruta fuera del repo; `gh run list --limit 1` → primera corrida
`success` de la historia; `pnpm test:acceptance` (Playwright) verde en CI; `git branch -a` →
solo `main` en remoto.

## Pendientes de acceso

- **Repo `Design_System_QUIVO` (antes sibling en `~/Proyectos/Web/Design_System_QUIVO`): se
  perdió, no se recuperó, y ya no es una dependencia externa.** Este documento registraba acá
  un commit local sin pushear (`zones` de `RouteMap`, QUI-229) sobre ese repo — la máquina
  donde vivía dejó de estar disponible antes de poder pushearlo, y una búsqueda exhaustiva
  (organización de GitHub, cuenta personal del CTO, los 3 checkouts locales de
  `Quivo-control`, el historial completo de git, la caché de Turbo) confirmó que el fuente no
  existe en ningún lado. Se reconstruyó desde cero como `packages/design-system` dentro de
  este monorepo (PR #2, 2026-08-14), derivando la API por fidelidad de cada sitio de uso en
  `apps/web` — incluida la prop `zones` que este documento pedía no perder, ya incorporada en
  `route-map-impl.tsx`. `apps/web` ya no depende de ningún repo externo vía `link:`; el
  paquete es `workspace:*` y vive versionado en este mismo repo. Detalle completo en la
  sección "PR #2 — vendorizar design system + CI verde" arriba.
- **Push a GitHub:** ✅ resuelto (2026-07-30), sigue así.
- **`gh` CLI:** ✅ instalado y operativo en este entorno — se usó para diagnosticar el bloqueo
  de CI (`gh run list`), verificar los PRs (`gh pr view`) y confirmar branch protection. Único
  bloqueo que persiste: **branch protection en `main` sigue siendo imposible**, no por falta
  de `gh` sino porque `gh api .../branches/main/protection` devuelve `403 Upgrade to GitHub
  Pro` — el repo es privado en plan free. El criterio de aceptación de QUI-212 no se puede
  cumplir sin cambiar de plan (hacer el repo público quedó descartado).
- **Infra cloud real (QUI-213):** sin aprovisionar. **Actualizado el 2026-08-14:** la cuenta
  de GCP se reactivó y el destino ahora es GCP, así que el ADR
  `docs/adr/0001-railway-vs-flyio.md` quedó **obsoleto** — hay que reescribirlo o anularlo.
  Solo el `docker-compose.yml` local está listo.
- **Spike GPS físico (QUI-216): ✅ desbloqueado el 2026-08-14.** El **dispositivo ya se
  consiguió**, y la **licencia nunca fue un prerequisito real** — Transistorsoft es funcional
  en builds debug sin key y ofrece trial de 30 días para release; el paso 1 de
  `docs/spike-gps.md` está mal escrito y hay que corregirlo. Lo que sí falta antes de correr
  el spike: migrar a Expo SDK 54 + Transistorsoft v5 y arreglar los tres bugs de
  configuración. Ver "GPS y migración de Expo SDK" al final.

## Estado del roadmap (Linear, 2026-08-14)

Con `main` verde, el bloqueo que frenaba a cualquiera de clonar y trabajar el repo quedó
resuelto. Estado por milestone (64 issues / 248 pts, ~73% completado por puntos):

| Milestone                    | Target                      | Progreso | Qué falta                                                          |
| ----------------------------- | ---------------------------- | -------- | -------------------------------------------------------------------- |
| M0 Fundaciones + Spike GPS    | 2026-08-10 ❌ **vencido**     | 63,9%    | QUI-216 (gate GPS, Urgent), QUI-213 (infra)                          |
| M1 Núcleo administrativo      | 2026-08-30                   | 100%     | —                                                                     |
| M2 Rotaciones                 | 2026-09-13                   | 100%     | —                                                                     |
| M3 App móvil + sync           | 2026-10-18                   | 81,8%    | QUI-237 (tracking GPS producción, Urgent, en Backlog sin ciclo)      |
| M4 Dashboard/reglas/auditoría | 2026-11-08                   | 100%     | —                                                                     |
| M5 Hardening + piloto         | 2026-11-20                   | 41,1%    | QUI-250 (k6), QUI-252 (retención), QUI-253 (piloto) — las 3 en curso |
| M6 Sprint UI/UX Mobile        | 2026-08-10 ❌ vencido         | 97,6%    | resto en el roadmap nuevo de Valentina, ver abajo                    |

**Camino crítico, en orden** (reordenado el 2026-08-14 tras las decisiones del CTO — ver
"Decisiones del CTO" y "GPS y migración de Expo SDK" abajo):

1. **Migrar a Expo SDK 54 + Transistorsoft v5.** Precondición de todo lo demás en móvil: con
   Expo SDK 52 (`targetSdkVersion 34`) la app **no se puede publicar ni actualizar en Google
   Play**, que exige API 36 desde el 2026-08-31. El piloto va a Play, así que la migración
   dejó de ser opcional.
2. **QUI-216, gate GPS** (Urgent, vencido desde el 2026-08-10): **ya no está bloqueada por la
   licencia** — ese era un error del protocolo, no un hecho (detalle abajo). El Android de
   gama baja ya se consiguió. Correr el spike **sobre SDK 54 + v5**, no sobre el stack actual,
   para no validar algo que se va a tirar. Antes hay que corregir los tres bugs de
   configuración que hoy lo harían fallar con licencia o sin ella.
   **El gate ya se está bypasseando de hecho**: QUI-216 declara bloquear a QUI-235 y QUI-237,
   pero QUI-235 está `Done` y toda la app móvil se construyó encima — la premisa "nada de M3
   arranca sin este GO" dejó de sostenerse hace tiempo.
3. **QUI-213 (infra) y deploy de `apps/web`:** ambos se reevalúan **contra GCP**, cuya cuenta
   se reactivó. El ADR `docs/adr/0001-railway-vs-flyio.md` quedó **obsoleto** (compara Railway
   vs Fly.io) y hay que reescribirlo o anularlo.
4. **M5 (hardening + piloto):** QUI-250 (k6), QUI-252 (retención GPS) y QUI-253 (piloto), las
   3 en curso del CTO.

**Roadmap de Valentina reescrito contra el estado real de `main`** (2026-08-13/14): de las 12
issues abiertas, 3 se cerraron por estar ya hechas (**QUI-343** onboarding, **QUI-341** pase
visual del app pasajero, **QUI-345** tests de contraste) y **QUI-337** (limpiar ramas) se cerró
absorbida por el PR #2. Se rescopearon **QUI-336, 338, 340, 342 y 346** — cada una tenía partes
ya resueltas en `main` (ej. QUI-338 "estados de error": offline y sesión expirada ya estaban,
falta renderizar `errorSync` y distinguir permiso de ubicación denegado). Quedan **8 issues
vivas y ~21 puntos** (antes 34, sin priorizar ni asignar a milestone), ahora todas con
prioridad, milestone y un comentario de arranque — antes ninguna de las 12 tenía un solo
comentario, causa directa de que Valentina no entendiera el alcance. **QUI-348** (los 4 bugs
reales encontrados en la auditoría de mobile, closures viejas de React y timers sin limpiar)
queda vigente sin cambios. **QUI-339/347** (accesibilidad web) quedan explícitamente
dependientes de este `main` verde.

También se cerró **QUI-264** (planning del sprint M6 del CPO): el plan repartía 21 pts a
Estrella y 21 a Valentina, pero las 10 issues del sprint quedaron asignadas solo a Valentina —
contexto directo de por qué la calidad del código de M6 dejó los 4 bugs de QUI-348. Queda como
decisión abierta del CTO si Estrella se reincorpora al proyecto con carga real.

**Otros pendientes que siguen abiertos, sin cambios desde antes:**

- Validar con Producto las asunciones documentadas sin confirmar: transiciones de estado de
  vehículos (`vehiculos.service.ts`), tolerancia de 100m para paradas/puntos de control cerca
  de una ruta (`common/geo/proximidad-ruta.ts`), taxonomía de `tipo` en paradas
  (`packages/shared/src/entities/parada.ts`).
- Ritos Scrum sugeridos: daily corto, review/retro al cierre de cada cycle (cada 2 semanas).

Plan de trabajo completo de esta iteración, con toda la evidencia verificada, en
[`docs/plan-continuidad-quivo-control.md`](plan-continuidad-quivo-control.md).

## Decisiones del CTO — 2026-08-14

Once decisiones tomadas en la misma sesión, tras el merge del PR #2. Son el insumo del plan de
finalización.

| #   | Tema                            | Decisión                                                                                                                                       |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Entorno desplegado              | **No existe ninguno, todo es local.** El riesgo de `RUNTIME_DATABASE_URL` no está activo hoy, pero pasa a ser requisito del despliegue          |
| 2   | GCP                             | **La cuenta se reactivó.** El destino de infra ahora es GCP                                                                                     |
| 3   | `socios.service.ts:33`          | **Se agrega el filtro explícito por id.** RLS deja de ser la única barrera en los reads por id                                                  |
| 4   | QUI-212 (branch protection)     | **Se cierra la issue** — requiere GitHub Pro y la decisión es no gastar. No volver a listarlo como pendiente técnico                            |
| 5   | QUI-213 (infra)                 | **Reevaluar contra GCP**, no Railway/Fly                                                                                                        |
| 6   | Deploy de `apps/web`            | **Reevaluar** (el plan decía Vercel)                                                                                                            |
| 7   | Estrella                        | Sigue en otro proyecto esta semana; **no se cuenta en la capacidad todavía**                                                                    |
| 8   | Los 3 elementos excluidos       | **Se aceptan si no rompen nada.** Verificar antes de cerrar QUI-336                                                                             |
| 9   | Distribución del piloto         | **Se publica en Google Play.** Antes va una **demo con APK directo** al sindicato, que no pasa por Play                                        |
| 10  | Expo SDK                        | **Se migra antes del piloto** — obligado por Play (ver abajo)                                                                                   |
| 11  | Hardware del spike              | **El Android de gama baja ya se consiguió**                                                                                                    |

Sobre la 1: si `RUNTIME_DATABASE_URL` no se setea al desplegar en GCP, la API arranca sin
aislamiento entre sindicatos. Con el fix del PR #2 ahora **falla al arrancar** en vez de
degradar en silencio, así que se va a notar — pero conviene que esté escrito antes de
desplegar, no después.

Sobre la 8, los tres elementos son: el endpoint `GET /v1/mobile/perfil`
(`auth-movil.controller.ts:56-63`), el `refetchInterval` de 60s/300s en `use-perfil-query.ts:23`
y `react-native-shimmer-placeholder` (`package.json:50`, usado 8× en `perfil-screen.tsx`).
Entraron a `main` pese a estar excluidos del alcance original de QUI-336.

## Council — tres decisiones menores (2026-08-14)

Se convocó un council de cuatro voces sobre tres puntos de higiene del repo. **Unánime en los
tres**, con el criterio explícito de "qué deja el repo más difícil de romper para gente junior
que va a tocar esto sin el contexto de hoy":

- **Divergencia de Expo SDK:** dejar divergir, pero con **política escrita, con owner y fecha**
  — sin eso "es teatro". La app del pasajero en SDK 57 funciona como **canario** de la versión
  nueva. ⚠️ **Esta decisión quedó superada por el deadline de Play** — ver la sección
  siguiente. El council no tenía ese dato.
- **Script `test:acceptance:prepare` roto** (hace `. apps/api/.env`, archivo que no existe ni
  local ni en CI): **borrarlo**, y dejar **un solo camino que sea el que CI ejecuta**. Un
  script que nadie corre "le enseña al junior que el repo miente". Regla que salió del council:
  **si CI no lo ejecuta, no existe.**
- **Dependencia implícita de orden en CI:** hacerla **estructural** (`prisma generate` como
  precondición vía `pretest`/`postinstall`), nunca un comentario — "los comentarios no se
  ejecutan; el junior que rompe esto no está leyendo el YAML". **No** declarar el cliente
  generado como output de Turbo: la caché puede restaurar un cliente stale, que es exactamente
  el bug que se pagó en este PR.

**Observación que las tres voces levantaron por separado:** un CI verde por primera vez no
prueba que los tests detecten algo; podrían estar pasando en vacío.

La evidencia dice que **sí detectan**: cuando la conexión caía al rol `quivo` (superusuario con
`BYPASSRLS`), **12 de 14 tests de RLS fallaron**; con `quivo_app`, 17/17 pasan. Límite que
queda abierto: eso prueba que la suite detecta **RLS globalmente desactivado**, no que detecte
**una policy mal escrita en una tabla puntual**. Vale romper una policy específica antes del
piloto y confirmar que el test de esa tabla se pone rojo.

## GPS y migración de Expo SDK — investigado 2026-08-14

### El hallazgo que desbloquea QUI-216

**La licencia nunca fue el bloqueo.** Transistorsoft es *fully functional en builds debug sin
key*, y ofrece trial de 30 días para builds release. **El paso 1 de `docs/spike-gps.md` está
mal escrito** — pone "agregar la licencia" como prerequisito, y por eso el spike quedó parado
un mes. Los US$399 no compran la capacidad de *medir*, sino la de *distribuir un release
firmado*. **Hay que corregir ese paso del protocolo.**

Con el teléfono ya conseguido, el spike se puede correr esta semana.

### Tres bugs de configuración que harían fallar el spike igual

Verificados en el repo. Ninguno tiene que ver con la licencia:

- `apps/mobile/src/gps/background-geolocation.config.ts` **no setea** `stopOnTerminate`,
  `startOnBoot` ni `enableHeadless`. Los defaults de Transistorsoft son `stopOnTerminate: true`
  / `startOnBoot: false`, o sea que **el tracking muere al cerrar la app y no vuelve tras el
  reboot** — que es exactamente el criterio C del GO.
- `apps/mobile/index.js` **no registra headless task** (solo `registerRootComponent`). Sin eso,
  con la app terminada nada escribe en `quivo-outbox.db`, que es la fuente de la evidencia de
  sanciones (RF-67..73).
- `logLevel: LOG_LEVEL_VERBOSE` en una config marcada como de producción: escribe a SQLite en
  cada tick durante las 8 horas de la medición.

### GCP no sirve para el tracking

El problema es de **proceso local en el dispositivo**: cuando Android congela el proceso, nadie
lee el chip GPS, y ningún servicio remoto puede leerlo por él. **Fleet Engine** queda
descartado — requiere contrato firmado, apunta a >1M viajes/año, cobra por tarea, su SDK es
nativo sin binding de React Native, y reemplazaría Postgres+PostGIS por un backend propietario.
**Roads API** costaría ~US$27.000/mes al volumen del proyecto. Lo que **sí** sirve de GCP es
Cloud Run + Cloud SQL para el backend, que es la decisión 5.

### Ninguna alternativa opensource cumple

`expo-location` falla los tres criterios GO, con dos bugs abiertos y fechados:
[expo/expo#46788](https://github.com/expo/expo/issues/46788) (junio 2026 — Android ignora
`timeInterval`/`distanceInterval` en background y cae a ~3s, con el fix sin publicar) y
[expo/expo#47595](https://github.com/expo/expo/issues/47595) (julio 2026, **abierto** — el
foreground service se congela tras cualquier update de la app: la notificación sigue visible y
no llega un solo punto, así que el chofer no se entera).

Migrar ida y vuelta cuesta ~2 semanas que se tiran, y de paso rompe `battery-gap-monitor.ts`,
que usa `location.battery.level` — dato que `expo-location` no provee.

### Destino de la migración: **Expo SDK 54**

**Play exige API 36 desde el 2026-08-31** (extensión posible hasta el 2026-11-01). Expo SDK 52
da **API 34**, así que hoy la app no se puede publicar ni actualizar.

SDK 54 (RN 0.81 / React 19.1) es la **única versión que cumple las dos condiciones a la vez**:
la primera que da `targetSdkVersion 36`, y la última que todavía permite
`newArchEnabled: false`. Esa intersección existe en exactamente un SDK.

| Expo SDK    | RN       | React      | targetSdk    | Transistorsoft                      | New Arch obligatoria         |
| ----------- | -------- | ---------- | ------------ | ----------------------------------- | ---------------------------- |
| 52 (hoy)    | 0.76     | 18.3.1     | 34 ❌ Play   | v4 legacy                           | No                           |
| 53          | 0.79     | 19.0       | 35 ❌ Play   | v5 usado                            | No                           |
| **54** ✅   | **0.81** | **19.1**   | **36** ✅    | **v5, entorno más reportado**       | **No — último con opt-out**  |
| 55          | 0.83     | 19.2       | 36 ✅        | v5 usado                            | Sí                           |
| 56          | 0.85     | 19.2       | 36 ✅        | v5 usado                            | Sí                           |
| 57          | 0.86     | 19.2       | 36 ✅        | **sin evidencia (0 reportes)**      | Sí                           |

### Hallazgos que condicionan la migración

- **Hay que migrar Transistorsoft v4 → v5, y es una migración aparte.** La versión instalada
  real es **4.19.4** (el `package.json` declara `^4.17.3`, engaña) y **no tiene
  `codegenConfig`**: es bridge legacy puro. v5 implementa TurboModules y, sobre todo, **solo v5
  maneja bridgeless en el path del headless task** — el corazón del producto. v4 bajo New
  Architecture es riesgo en el único camino que no puede fallar.
- **La licencia v4 no sirve para v5** (v5 usa formato JWT). Como todavía no se compró, no hay
  dinero perdido: **comprar directamente la key v5**. La demo por APK directo puede salir como
  build **debug sin licencia**; el piloto en Play sí la necesita. Transistorsoft responde lento
  a temas de licencia (hay un pedido de trial que quedó sin respuesta 30 días), así que
  conviene comprar con margen.
- **Los fixes de foreground service de Android 16 viven en el nativo de v5**
  (`tslocationmanager` 4.4.x, clase `FgsLaunchGate`). Apuntar a API 36 con v4 = crashes de FGS.
  El patrón de fallas reportado es **Motorola y Samsung de gama baja**, que es justamente el
  hardware objetivo del proyecto.
- **Subir `targetSdkVersion` a 36 con `expo-build-properties` quedándose en SDK 52 no es una
  salida:** los crashes de FGS pegan en v4; edge-to-edge es obligatorio con targetSdk 36 y RN
  0.76 no lo soporta (llegó en RN 0.81); y el toolchain (AGP/Gradle) de Expo 52 es anterior al
  soporte de API 36. Parece que funciona hasta que corre en un teléfono real.

### Plan de migración en dos PRs, con palanca de rollback

1. **SDK 52 → 54 + Transistorsoft v4 → v5**, con `newArchEnabled: false`. Cumple Play sobre la
   arquitectura vieja, que es el camino conocido para Transistorsoft.
2. **Flip a New Architecture**, como cambio separado. Si rompe el headless task, se revierte
   solo el (2) y se publica igual, porque el cumplimiento de Play ya está en el (1).

**Verificación barata antes de comprometerse (~1 día):** build **debug** de dev-client en SDK
54 + v5.4.0 (sin licencia), sobre el Android de gama baja real, con test de tracking con la app
terminada 2–4 h. Si pasa, comprar la key v5 y correr el spike completo.

**Riesgo principal:** no es el salto de SDK, es Transistorsoft v5 sobre Android 16 en gama
baja — la clase de bug más viva del tracker (`ForegroundServiceDidNotStartInTimeException` en
`FgsLaunchGate`, con issues de julio y agosto 2026). Es ortogonal al SDK elegido: viene con API
36. Mitigación: pinear **exactamente 5.4.0** (no rango `^`) y probar en Motorola/Samsung real,
no en emulador.

**Calidad de la evidencia** (importa para decidir): SDK 54 + v5 tiene evidencia **fuerte**
(~10 reportes de producción recientes en el tracker); SDK 55/56 **moderada**; **SDK 57 / RN
0.86: cero reportes** — es ausencia de evidencia, no evidencia de incompatibilidad, pero para
el módulo que es el riesgo #1 del proyecto no conviene ser el primero con un piloto encima.
Transistorsoft **no publica matriz de compatibilidad** (sin `peerDependencies` ni `engines` en
su `package.json`), así que la compatibilidad solo se puede leer del código y del tracker.

## PR #6 — desbloquear el gate GPS (N1) — 2026-08-14

Primer ítem de la fase F0 del [plan de finalización](plan-finalizacion-piloto.md). El spike
GPS (QUI-216) es el gate go/no-go del stack móvil y llevaba **un mes parado** por una causa
evitable: el paso 1 de `docs/spike-gps.md` afirmaba que hacía falta comprar la licencia de
Transistorsoft, y es falso — el SDK es funcional en builds debug sin key, y hay trial de 30
días para release. Los US$399 compran distribuir un release firmado, no medir. Ese documento
quedó corregido.

Pero el spike **habría fallado igual, con licencia o sin ella**, y ese fue el hallazgo real
del ciclo. Lo que se arregló se agrupa en tres capas, cada una descubierta al cerrar la
anterior.

### 1. Configuración: el tracking moría justo donde el spike mide

Faltaban `stopOnTerminate: false`, `startOnBoot: true` y `enableHeadless: true`. Los defaults
del SDK son los contrarios, así que el tracking moría al cerrar la app y no volvía tras el
reboot — que es **exactamente el criterio C del GO**. Y `index.js` no registraba headless
task: con la app terminada el SDK seguía grabando en su SQLite interna, pero nada copiaba esos
puntos a `quivo-outbox.db`, la fuente de la evidencia legal (RF-67..73). `index.js` es el
único lugar donde el SDK permite registrarlo.

El headless task corre fuera de React, sin hooks ni contexto, así que la lógica de
`onLocation` se partió en dos: `location-task.ts` con la parte pura (testeada) y
`headless-task.ts` con la de E/S. El hook y el task comparten ahora un solo camino de
escritura al outbox. El estado que el task necesita se lee de donde ya estaba persistido
(`deviceId` y `sesionId` de SecureStore, puntos de control del paquete del día en SQLite), sin
inventar almacenamiento nuevo.

### 2. El timestamp de la evidencia estaba corrido

`encolarEvento` sella el `ts` con el reloj del momento de **encolado**. Mientras el único
productor fue la suscripción `onLocation` en vivo eso coincidía aproximadamente con el fix
GPS. Con el tracking headless recién habilitado, no: el SDK entrega las ubicaciones
**bufferadas, tarde y en ráfaga** al salir de Doze, así que un tramo entero de manejo se
encolaba en segundos y se persistía con timestamps casi idénticos. El recorrido reconstruido
(`recorridos.service.ts`, `ORDER BY ts`) quedaba deformado — y es evidencia legal.

El payload lleva ahora `tsFix` (el `location.timestamp` del fix real) y el worker persiste ese
instante vía `resolverTsFix` (`packages/shared/src/sync/evento.ts`). Aplica a los **dos** tipos
de evento: `gps_point` y `cumplimiento_punto_control` — este último con más peso, porque la
hora de paso por el punto de control es el hecho que sustenta la sanción (RF-64..66), no un
punto suelto del trazado.

Decisiones de diseño que conviene no revertir sin leer esto:

- **`tsFix` es opcional a propósito.** Cuando esto se despliegue puede haber eventos ya
  encolados en dispositivos con una versión anterior de la app que nunca lo van a traer. Esos
  siguen siendo válidos y se ingestan con el `ts` del sobre.
- **El fallback ya no es silencioso.** Se cuenta (`tsFixDescartados` / `tsFixDescartado`) y se
  loguea, porque un fallback callado es justamente el modo de fallo que este campo existe para
  eliminar.
- **La ventana de aceptación tiene techo y piso.** Techo de 1 min (deriva de reloj / corrección
  NTP). Piso de 7 días: sin él, un `tsFix` absurdo — zod acepta el año 500 sin chistar — caía
  fuera del rango de particiones diarias de `gps_points`, el `INSERT` multi-fila levantaba
  `23514 no partition found` y **se llevaba puestos los otros 499 eventos del lote** a
  `sync_errors`, que no tiene reproceso. Pérdida definitiva de evidencia por un solo evento
  corrupto.
- **Idempotencia verificada, no asumida.** `resolverTsFix` es determinista sobre el payload
  bajo cualquier zona horaria (probado bajo cuatro), así que un reenvío calcula el mismo `ts` y
  `ON CONFLICT (event_id, ts)` deduplica igual que antes. `cumplimientos_pc` deduplica solo por
  `eventId` (`@unique` simple, no compuesto), así que cambiar el `ts` no lo afecta.

### 3. El spike podía dar GO sin haber medido nada

Lo más grave del ciclo, y lo encontró la revisión, no la implementación. **Dos falsos GO**, los
dos por la misma causa: el veredicto se calculaba desde refs de React que el camino headless no
alimenta.

- **Criterio B (huecos).** `detectarHuecos` corría sobre un `useRef` que solo llenaba el
  `onLocation` del hook. Si el chofer mata la app a las 2 h — que es **el criterio C, lo que el
  spike va a hacer a propósito** — el proceso que reabre arranca con el ref vacío, no hay
  muestras que bordeen el agujero, y el criterio B reportaba `0 huecos` sobre horas que nunca
  miró. Un battery-killer del fabricante matando el SDK 4 de esas 5 h salía como GO limpio.
  Ahora los huecos y la duración salen del **outbox**, filtrados por sesión: cubren la ventana
  headless y sobreviven a la muerte del proceso.
- **Criterio A (batería).** No puede salir del outbox — el payload de `gps_point` es evidencia,
  no instrumentación de spike. Así que se extrapola sobre **su propia ventana**, no sobre la de
  los huecos, con piso absoluto de 1 h y cobertura mínima del 50% de la medición. Sin eso, 30
  min de muestras contra una corrida de 8 h daban 1% estimado y GO. Arreglar solo los huecos
  habría **agravado** este: antes las dos métricas usaban la misma ventana corta y se
  cancelaban; después el numerador quedaba corto y el denominador largo.

El veredicto imprime ahora las dos ventanas y el nivel de log con el que se midió — una corrida
contaminada por logging `VERBOSE` (I/O extra a la SQLite nativa, que es justo lo que el
criterio A mide) y una limpia producían el mismo string.

### Otros hallazgos de la revisión

- `obtenerPaqueteDiaLocal` protegía el `safeParse` pero **no el `JSON.parse`**: una fila
  corrupta lanzaba, el throw subía hasta el catch externo del headless y **descartaba cada tick
  del turno entero**, en silencio y con la app terminada, o sea sin nadie mirando el
  `console.error`. Exactamente lo contrario de lo que el código promete tres archivos más
  arriba. Devuelve `null` (el camino ya soportado, que sigue registrando `gps_point` sin puntos
  de control) y `guardarPaqueteDia` pasó a ser transaccional — su `DELETE`+`INSERT` sin
  transacción era la forma de corromper la fila.
- `iniciar()` reseteaba el Set de cumplimientos a vacío. Tras un kill con cumplimientos ya
  emitidos por el headless, un segundo paso por el mismo punto en una ruta circular generaba
  una **segunda fila para la misma sanción** (el worker deduplica por `eventId`, y la
  reemisión lleva uno nuevo). Ahora siembra desde el outbox, igual que el lado headless.
- El `stop()` por paquete vencido apaga también `startOnBoot`: decisión **irreversible sin
  intervención humana**, tomada con `Date.now()` en el camino de arranque tras reboot, donde el
  reloj es menos confiable (RTC drift, todavía sin NTP). Se le dieron **2 h de gracia — valor
  provisional, pendiente de confirmación del CTO**. Descartar el punto sigue siendo inmediato;
  lo que se demora es apagar el plugin.
- El centinela `-1` de batería entraba como `-100%` en el cálculo: con la primera muestra sin
  lectura y la última con, `Math.max(0, -180)` daba **0% de consumo** sin importar el consumo
  real. Las muestras sin lectura usable ya no se cuentan.

### Restricción de despliegue

**El API va antes que el release móvil, y no se rollbackea el API mientras haya clientes con
`tsFix` en la calle.** Con la versión vieja del API y `tsFix` ya en dispositivos, un reenvío
tras timeout se ingestaría una vez con `evento.ts` y otra con `tsFix` — dos `ts` distintos, y
la PK `(event_id, ts)` deja dos filas. `cumplimientos_pc` no sufre esto.

### Deuda que este PR deja abierta, a propósito

| Deuda | Por qué se difirió |
|---|---|
| Partición `DEFAULT` en `gps_points`, o degradación fila por fila en `insertarGpsPoints` | Necesita migración y decisión de diseño. El piso de `resolverTsFix` ya cierra el camino realista; esto es defensa en profundidad |
| Reproceso de `sync_errors` | Hoy solo hay un `@Get`: lo que cae ahí es pérdida definitiva. Duele recién cuando algo cae |
| Reconstruir el instante con `location.age` | El caso es un teléfono con el RTC descargado que arranca con la fecha de build, y hace que el `tsFix` correcto de GNSS parezca "del futuro". Es hardware de gama baja, o sea el del piloto — pero no bloquea el spike |
| Índice `(tipo, ts)` en el outbox + enganchar `purgarAcusadosAntesDe` | La tabla nunca se purga (la función existe y **no la llama nadie**) y el scan crece con ella, dentro del presupuesto de un tick en Doze |
| Validar con `PayloadGpsPointSchema` los casts del worker | Ahora que el schema existe es un arreglo de dos líneas, pero cambia el comportamiento ante error |
| Tests de `headless-task.ts` | Importa nativos. Sin cobertura quedan el gate `vencido → stop()`, el orden de la siembra y el `try/catch` externo |

**Lo que este PR NO hace: correr el spike.** Eso es validación física y sigue pendiente — si
los flags se comportan como documentan sobre un fabricante real con battery killers, si el task
dispara de verdad tras un kill o un reboot, y los números de batería y huecos de las 8 h. Y
debe correrse sobre **Expo SDK 54 + Transistorsoft 5.4.0**, no sobre el stack actual: validar
un stack que se va a tirar no valida nada.

Verificación del PR: `typecheck`, `lint` y `test` en 9/9, con **331 tests** (api 202, shared 52,
mobile 38, web 22, db 17). Los conteos de shared y mobile subieron con los tests nuevos de la
ventana de aceptación y del veredicto no concluyente.

### El CI verde de ayer también era casualidad

Este PR destapó el defecto que el council había señalado el 2026-08-14 y que se había
registrado como "hacer estructural la garantía del cliente Prisma". `typecheck` depende de
`^build`, y el build de `@quivo/db` es `prisma generate && tsc`. **Un cache hit de Turbo
restaura `dist/**` pero no reejecuta el comando**, así que `prisma generate` no corre y el
cliente nunca se escribe en `node_modules`. Sin cliente, los tipos de `@quivo/db` degradan a
`unknown`/`{}` y `@quivo/api` falla el typecheck con ~40 errores que **no son errores de
tipos**.

El CI venía verde porque `@quivo/db#build` siempre había sido cache *miss*. Este PR cambió
`apps/api` sin tocar `packages/db`: primera vez que ese build da hit mientras
`@quivo/api#typecheck` da miss. Había dos parches previos por el mismo motivo, y los dos eran
**comentarios largos explicando la trampa en vez de eliminarla**.

Ahora `packages/db` tiene `postinstall: prisma generate`. `pnpm install` lo corre siempre —con
`--frozen-lockfile`, en CI, con `node_modules` fresco— antes de que Turbo tenga la chance de
servir un cache hit. **No** se declaró la ruta del cliente como `outputs` de Turbo: la caché
puede restaurar un cliente *stale*, y eso ya rompió una corrida antes con `SyntaxError:
@prisma/client does not provide an export named 'PrismaClient'`.

Es la segunda vez en dos ciclos que aparece la misma lección: *un pipeline que pasa por el
orden de sus pasos, y no por una garantía estructural, no es un pipeline*. Vale releer con eso
en mente el resto del workflow — el paso `Test` sigue dependiendo de que `Seed database` haya
corrido antes.

## PR #7 — ADR 0002: GCP (N19) — 2026-08-14

Cierra **F0**. Único ítem de la fase que no era trámite externo del CTO.

`docs/adr/0001-railway-vs-flyio.md` queda **anulado** (banner al principio + "Decisión final"
reescrita) y se conserva como registro histórico de por qué la infra estuvo sin decidir desde el
Cycle 12 — nunca se creó cuenta ni se aprovisionó nada en Railway ni en Fly.io, así que no hay
recursos que dar de baja. Lo sustituye `docs/adr/0002-gcp.md`, que fija la arquitectura de
despliegue del plan de finalización como decisión formal: Cloud Run para `apps/api`
(`min-instances=1`), **Cloud Run Worker Pool** para el worker de ingesta —GA desde abril de 2026,
y la razón concreta de la elección: un Cloud Run *service* normal moriría por falta de tráfico—,
Cloud Run Job + Scheduler para la retención, Cloud SQL PG16 con PostGIS, Memorystore, Secret
Manager, `apps/web` también en Cloud Run y archivado en Cloudflare R2.

Tres cosas que el ADR deja escritas porque son las que muerden después:

- **RLS en Cloud SQL depende de un detalle no obvio:** el usuario `postgres` de Cloud SQL no es
  superusuario real (es `cloudsqlsuperuser`), así que `quivo_app` sin BYPASSRLS y `FORCE ROW LEVEL
  SECURITY` se comportan como en Postgres vanilla — que es el supuesto sobre el que se construyó
  todo QUI-218. Queda como verificación obligatoria correr `rls.integration.test.ts` **contra la
  instancia real**, no contra el Docker local.
- **R2 en vez de GCS es deliberado**, no un descuido de coherencia: egreso $0 permanente contra
  ~$0,12/GB, y evita el footgun de los checksums del AWS SDK contra GCS. Cero cambio de código.
- **El objetivo de costo del doc técnico (US$50–150/mes) es inalcanzable** con servicios
  gestionados en región sudamericana: ~US$255–290/mes en el piloto, ~US$1.200–2.800/mes en
  régimen. El ADR lo acepta explícito en vez de dejar el número viejo flotando.

### La región quedó cerrada: `southamerica-west1` (Santiago)

El plan de finalización dejaba la región abierta con un *lean* por São Paulo apoyado en dos
supuestos —"catálogo más completo" e intuición geográfica— y pedía explícitamente medir antes de
comprometerse. **Se midió, y los dos supuestos eran falsos.**

Latencia real desde la conexión del CTO (La Paz, AXS Bolivia `AS26210`), 12 requests HTTPS sobre
una **única conexión TLS reusada** por región, descartando el handshake:

| Región | RTT mediana |
|---|---|
| **`southamerica-west1`** (Santiago) | **52 ms** |
| `southamerica-east1` (São Paulo) | 110 ms |
| `us-east4` | 199 ms |
| `us-central1` | 230 ms |

**Trampa de medición que conviene no repetir:** medir con `time_connect` de `curl`, o con
conexiones nuevas, da ~40 ms para *todas* las regiones por igual — eso es el borde Anycast de
Google, no el datacenter. La diferencia aparece recién reusando la conexión.

Y en costo Santiago **también** gana: Cloud Run y Worker Pools son de 2 tiers (Santiago y São
Paulo cuestan idéntico), pero Cloud SQL es 6,7% y Memorystore 19,5% más baratos en Santiago —
−6,5% en el total. La mitad de latencia y más barato: no hubo tradeoff que deliberar.

**Los dos gaps de Santiago, y por qué ninguno bloquea:**

- **Cloud Scheduler no existe en `southamerica-west1`** (verificado en la doc oficial). Acá solo
  dispara el Job de retención GPS, **una vez por día**: se pone en `southamerica-east1` apuntando
  al Job en Santiago —el endpoint de la Admin API es global— y cuesta ~30 ms diarios. Es la única
  pieza multi-región y hay que dejarla explícita en el Terraform para que no se lea como error.
- **Firebase App Hosting no tiene ninguna región sudamericana** (`us-central1`, `us-east4`,
  `us-east5`, `asia-east1`, `asia-southeast1`, `europe-west4`). No es un gap de Santiago sino del
  servicio, y **se resolvió sacándolo de la arquitectura** — ver abajo.

**Cloud Run Worker Pools sí corre en Santiago, verificado en vivo.** Era el único gap capaz de
descartar la región (sostiene el worker de ingesta) y no tiene tabla de regiones publicada: la
doc no documenta restricción ni lo confirma en positivo. Se comprobó contra la API real con
`POST .../locations/southamerica-west1/workerPools?validateOnly=true`, que valida sin crear nada
— aceptado en ambas regiones, con `Listed 0 items` confirmado después. Control: la misma llamada
contra una región inexistente falla. **Lección reusable: `validateOnly=true` convierte una
inferencia de documentación en un hecho, gratis.**

### Cambio de arquitectura: `apps/web` va en Cloud Run, no en Firebase App Hosting

Al no existir App Hosting en Sudamérica, había que decidir si valía servir el panel desde
`us-east4` (199 ms medidos) con un proveedor y un camino de deploy extra. Se fue a ver si dolía:
**todo `page`/`layout` de `apps/web` salvo `app/layout.tsx` es `'use client'`**, y el fetching es
TanStack Query contra `NEXT_PUBLIC_API_URL` desde el navegador. El panel es un SPA con cáscara
Next.js — **el host web no está en el camino de datos**, el browser pega directo contra la API.
Sin SSR con datos, sin Server Actions y sin ISR, App Hosting no compra nada.

Servirlo como un Cloud Run más deja todo en una plataforma, un proveedor de Terraform y una
región. **Consecuencia no prevista por N6:** son **dos** `Dockerfile` (Next.js en modo
`standalone` además del de API+worker), no una imagen con dos `CMD`. Y si `apps/web` alguna vez
incorpora SSR con datos reales, esta decisión hay que revisarla.

### Costo corregido

El ~US$160–230/mes que circulaba en el plan **estaba corto: el número verificado es ~US$255–290
/mes**. La causa no es la región sino el sizing — **Cloud SQL 2 vCPU/8 GB es la línea dominante y
está sobredimensionada para 40 vehículos**. El tier definitivo se decide con el resultado del k6
(QUI-250), no antes. Corregido en el plan, el doc técnico y este handoff.

Los documentos de stack que seguían diciendo "Railway o Fly.io + Vercel" se corrigieron
(`plan-maestro.md` §Stack, `documento-tecnico-cto.md` §1/§10 y la respuesta 14 del §15, y el
resumen de stack de este handoff). **No** se tocó `plan-continuidad-quivo-control.md`: es el
registro cerrado del diagnóstico del PR #2 y sus menciones son históricas.

## PR #10 — migración Expo SDK 54 + Transistorsoft 5.4.0 (QUI-353) — 2026-08-15

Primer ítem de **F1**, el camino crítico. Desbloquea el gate: correr QUI-216 sobre SDK 52 + v4
sería validar un stack que se va a tirar.

`newArchEnabled: false` queda **explícito** en `app.json` — en SDK 54 el default es `true`, así
que omitirlo habría activado la New Architecture sin que nadie lo pidiera, que es justo el
riesgo que el plan difiere a M7 (QUI-368).

### El `Config` de v5 es compuesto, y los tipos del paquete mienten

v5 reagrupa las claves planas de v4 en `geolocation` / `app` / `http` / `activity` / `logger`.
Los tipos canónicos viven en `@transistorsoft/background-geolocation-types@5.2.2`; el
`src/declarations/interfaces/Config.d.ts` que **todavía trae el paquete es plano y stale**, y no
es el que resuelve TypeScript (el entry real es `src/index.d.ts`, que re-exporta el paquete de
tipos). Quien lo lea creyendo que es la fuente de verdad va a reintroducir la forma vieja.

Las tres banderas del criterio C del spike (`stopOnTerminate: false`, `startOnBoot: true`,
`enableHeadless: true`, todas de PR #6) viven ahora bajo `app`. `foregroundService` se quitó: el
SDK nativo lo fuerza a `true` desde Android 8 y v5 ya no lo declara configurable.

Nota para el que toque esto: **`stopOnStationary` existe en `GeoConfig` y en `ActivityConfig` a
la vez**. Quedó en `activity`. Como el valor es `false` (el default), no cambia comportamiento
en ninguno de los dos — pero TypeScript no marca la ambigüedad.

### Tres bugs que ni `tsc` ni los tests ven

Los encontró `/code-review high`, no la implementación. Dos solo aparecen en dispositivo o en CI.

- **Los enums no existen en runtime.** `import { DesiredAccuracy, LogLevel } from
  'react-native-background-geolocation'` type-chequea porque `index.d.ts` hace `export *` del
  paquete de tipos — pero el runtime (`src/index.js:83`) exporta **solo la clase por default**, y
  los enums son getters estáticos (`static get LogLevel()`, línea 147). Los bindings nombrados
  quedan `undefined`: `TypeError: Cannot read property 'High' of undefined` al evaluar el módulo,
  y como `use-gps-operativo.ts` lo importa, se cae la función GPS entera. Ahora se leen de la
  clase. **Regla general que deja este caso: en este paquete, todo lo que se use como valor sale
  de `BackgroundGeolocation`; los imports nombrados solo sirven para tipos.**
- **`@types/react@19` rompía `@quivo/design-system`.** React 19.1 obliga a `@types/react` 19 en
  `apps/mobile`, que entra al pool hoisted de pnpm
  (`node_modules/.pnpm/node_modules/@types/react`). `react-leaflet`/`@react-leaflet/core` no
  declaran `@types/react` como dependencia real, así que sus `.d.ts` resolvían desde ese pool en
  vez de la 18.3.31 local: 10 errores `TS2786` en `route-map-impl.tsx`, typecheck **y** build en
  rojo — y `@quivo/web` depende de ese build. **Una caché stale de Turbo lo tapaba: se reproduce
  solo con `--force`.**
- **`Location.timestamp` se ensanchó a `string | number`.** Un epoch numérico perdía el
  `.datetime()` de `PayloadGpsPointSchema` y hacía caer `resolverTsFix` en silencio al `ts` de
  encolado — exactamente la deformación del recorrido por buffering headless que ese campo existe
  para evitar (PR #6). Se normaliza a ISO al construir el payload, devolviendo `undefined` ante un
  timestamp ilegible en vez de fabricar `"Invalid Date"`. `resolverTsFix` no se tocó: es contrato
  con el worker.

### Cómo conviven las dos versiones de `@types/react`

`apps/mobile` necesita la 19 (React 19.1); `design-system` y `web` se quedan en la 18.3.31 —
migrarlos era alcance ajeno a este PR. Se **aíslan**, no se unifican: `paths` en el
`tsconfig.json` de ambos, apuntando al **`.d.ts` concreto**, no al directorio del paquete —
`@types/react` publica un `exports` map y la sustitución a un directorio cae de vuelta al pool
hoisted **en silencio**. No toca el lockfile, así que sobrevive a `pnpm install --frozen-lockfile`
con `node_modules` limpio, que es lo que hace el CI.

Descartadas: `pnpm.overrides` no sirve (un override fija versión en edges que ya existen, y acá
el edge no existe porque `react-leaflet` no declara la dependencia; además es global al lockfile
y no puede dar 18 a unos y 19 a otro). `packageExtensions` resolvería la causa raíz pero exige
regenerar el lockfile. **Si algún día `design-system` y `web` migran a React 19, estos `paths`
sobran y hay que borrarlos.**

### Otras decisiones

- **`react-native-reanimated` fijado en `~3.19.0`**, no la 4.x que trae SDK 54: Reanimated 4
  **solo funciona con New Architecture**. `expo-doctor` marca el mismatch — es esperado y correcto
  mientras la arquitectura vieja siga. No "arreglarlo" subiendo a 4.
- `expo-modules-autolinking` sigue pineado pese a que `expo-doctor` lo desaconseja: sacarlo rompe
  la resolución real bajo el linking aislado de pnpm (probado).
- `usesCleartextTraffic` **no se tocó**: es QUI-357, de Valentina.

Verificación: `typecheck` + `build` + `lint` con `--force` en **18/18 tareas**, y **40 tests** de
mobile (38 previos + 2 del fix de `tsFix`).

**Lo que este PR NO valida:** que Android acepte de verdad el Config compuesto (el JS solo hace
pass-through al nativo), el headless task tras kill y reboot, y la licencia JWT de v5 — las
licencias v4 no sirven. Eso es **QUI-216**, el gate D1, en el teléfono real.

## Insumos para el plan de finalización — resueltos

Los 4 puntos que quedaron abiertos el 2026-08-14 antes de planificar (revisar Linear issue por
issue, ordenar migración/spike/piloto, cerrar infra, aplicar el council) están **resueltos** en
[`docs/plan-finalizacion-piloto.md`](plan-finalizacion-piloto.md), que es desde ahora la fuente
de verdad del alcance, las fases, la asignación y las fechas. Este handoff registra la
ejecución; el plan registra la intención.

## Cierre del 2026-08-15 — higiene de Linear y decisiones abiertas

**F0 cerrada del lado del código. F1 arrancada:** la migración está en `main`, falta el teléfono.
El detalle vigente de qué bloquea está en "Estado" al principio del documento; acá queda lo que
se ajustó en el tablero ese día y las decisiones que siguen esperando.

**Tablero:** las tareas `N*` del plan ya existen como **QUI-349..369** — usar esos IDs. QUI-213
(infra GCP) se movió de M0 a M5, porque el plan lo ubica en F2, después del gate, y en M0 impedía
cerrar el milestone hasta tener infra desplegada; su descripción decía `southamerica-east1` y
~US$160–230/mes, corregida a Santiago y ~US$255–290 según el ADR 0002. La descripción de M0
también estaba vieja. QUI-250/252/253 volvieron a **Todo**: habían pasado a *In Progress* en una
operación masiva el 2026-08-03 (las tres en seis segundos), sin PR ni rama, y dependen de cosas
que todavía no existen — el board reportaba 9 pts en curso que nadie tocaba.

**Los ciclos son de 1 semana** (C14 = 10–17 ago), no de 2 como decía una versión anterior de este
documento. Con esa cadencia, el C22–C24 del plan cae exactamente en el 5 al 26 de octubre: las
fechas del plan son consistentes.

**Decisiones esperando al CTO**, ninguna bloqueante hoy:

- **El margen de gracia de 2 h** antes del `stop()` irreversible por paquete vencido
  (`GRACIA_STOP_TRAS_VENCIMIENTO_MS`). Valor provisional elegido por defecto razonable.
- **D2 del plan: ¿cuenta de Play personal o de organización?** Si es personal, exige 12 testers
  × 14 días de closed testing antes de producción, y el reclutamiento pasa de C20 a C16 — o sea
  que la respuesta cambia el cronograma, no solo el trámite.
- **D3: ¿padrón completo o muestra?** De esto depende que el recorte de paginación sea válido o
  deuda que explota en campo. El plan recomienda la muestra; se decide con el sindicato en la mano.

## Cierre del 2026-08-16 — víspera del piloto: despliegue, PR #16 y umbrales

Día de dos entregas y un hallazgo que casi cuesta el arranque.

**PR #15 (`3876384`) mergeado a `main`:** todo el bloque "Sábado" del plan de un saque —
Dockerfiles, guardarraíl de `JWT_SECRET`, RLS en `gps_points`, `usesCleartextTraffic: false`,
rotación del refresh token web, seed del sindicato piloto, Sentry, y los tres bugs de M6 que toca
el conductor. Migraciones, seed y suite de RLS corridas contra la instancia real de Cloud SQL. El
backend quedó **desplegado y verificado en Cloud Run**: liveness 200, readiness con `db` y `redis`
arriba, login real y aislamiento cross-tenant confirmado a mano.

**El hallazgo del día:** el code review de PR #16 encontró que el build de release **iba a
fallar**, no a degradarse. `disableAutoUpload: true` no es una opción del config plugin de
`@sentry/react-native` 7.2.0 — pertenece a una versión posterior. Se pasaba y se ignoraba, la
tarea de subida de source maps se registraba igual dentro de `assembleRelease`, y sin org ni
token `sentry-cli` salía con exit code 1 dentro de un `exec {}` sin `ignoreExitValue`. Verificado
ejecutando a mano el `sentry-cli` que trae el repo:
`error: An organization ID or slug is required (provide with --org)`.

**Lección que conviene no repetir:** el comentario del código describía el comportamiento de una
versión del SDK distinta de la instalada, y la CI no lo detecta porque **la CI no corre
`eas build`**. Todo lo que solo se ejerce en el build nativo es, hoy, un punto ciego: verificarlo
contra el `node_modules` real, no contra la doc de `main` del proyecto upstream.

Otros tres hallazgos del mismo review, ya detallados en "Estado": faltaba `metro.config.js` con
`getSentryExpoConfig` (sin Debug ID los source maps no matchean, así que el token solo no
alcanzaba), Sentry inicializaba después de los imports hoisteados (dejando sin cubrir justo el
headless task de GPS), y el perfil `development` de `eas.json` apuntaba al Cloud Run de
producción — un build de development manejando en la calle habría escrito en la misma base que
guarda la evidencia del piloto.

**Decisión del CTO:** se va con **source maps funcionando**, no con el atajo de desactivar la
subida. `SENTRY_AUTH_TOKEN` como secret de EAS, `SENTRY_ORG` y `SENTRY_PROJECT` como env del
perfil, el token nunca en el repo.

**QUI-367 cerrado:** el checklist de aceptación pasó de casillas binarias a umbrales numéricos y
criterios de aborto A1–A7, y se le sacó el gate obsoleto del spike GPS de 8 h. Detalle en
"Estado".

**Vía 2 congelada:** los tres PRs de Valentina no se tocan hasta después del arranque.

**Decisión D2 resuelta por el camino:** la cuenta de Play deja de importar para el piloto — la
distribución es por APK sideload, así que ni el closed testing ni los 12 testers están en el
camino crítico. Vuelve a ser relevante recién cuando se quiera distribuir por Play (QUI-351,
diferida).

**Queda pendiente para hoy mismo:** cargar el secret de Sentry, mergear PR #16, generar el build
firmado **después** del merge —un APK buildeado antes apunta al backend viejo— y correr los 7
puntos de la prueba en teléfono real. El fallback sigue vigente: si el tracking en background
falla categóricamente, el lunes se corre con registro manual del conductor.
