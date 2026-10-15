# Plan — Vueltas, designación a Molinos y APK siguiente (2026-10-13)

> Sale del PR F de `docs/plan-en-vivo-alertas.md` y lo divide en dos. Modelo de operación:
> memoria `operacion-lineas-tiquipaya` y la sección "Operación de la Línea 16" de ese plan.

## Decisiones del CTO (2026-10-13)
- Bucket GCS: aprobado y **creado** (`gs://quivo-control-prod-media`, `southamerica-west1`, acceso uniforme, `allUsers` = `legacyObjectReader`, SA de la API = `objectAdmin`).
- `expo-updates` / EAS Update: aprobado explícitamente.
- **El aviso de designación a Molinos va dentro del APK** (no por OTA). El APK espera a F1.
- El piloto `1616PIL` funcionó en campo. Las correcciones del CTO llegan en el breakpoint del APK, junto con sus cambios estéticos.

## División
- **F1 (bloquea el APK):** vueltas en el servidor, designación a Molinos, ruta ajustada, alertas de Molinos, aviso al chofer y los dos pendientes de E.
- **F2 (después del APK, solo API y web):** cupos de vueltas por día, fuera de horario, turno no cumplido, vueltas faltantes y agenda de sanciones compensatorias. Ninguno toca la app, así que no frena el build. Falta la tolerancia de "fuera de horario" (CTO).

## Hechos del código (exploración, 2026-10-13)
- **No hay vueltas ni terminales en el servidor.** El recorrido son eventos manuales `inicio_recorrido`/`fin_recorrido` (`EventoOperativo`). La app cuenta vueltas solo en el cliente (`progreso-vuelta.ts`), sin sincronizar.
- **`Variante` no tiene geometría** ni se vincula a la `Asignacion`. La asignación apunta a una sola `Ruta`.
- **El desvío se mide contra `rutas.geometria` base** (`procesarDesvioSesion`). Solo corre con `desvioHabilitado=true`, que la L16 no tiene.
- **La geometría L16 en prod** (`scripts/cargar-linea-16.ts`) es v0..v150 + regreso v91..v43 + conector de ~77 m + ramal Putucu, y **termina en Molinos**.
  - Los PC son 0 SR (no obligatorio), 1 Molinos (no obligatorio) y 2 Honduras (obligatorio), con radio de 150 m.
- **La app baja el paquete del día una sola vez** (`GET /mobile/asignacion-del-dia`, guardado en SQLite). El único poll recurrente es `GET /mobile/vecinos-ruta`, cada 30 s. `POST /sync/batches` responde solo `{aceptados}`.
- **El aviso de PC** (`anuncio-punto-control.ts`) usa `expo-speech` al acercarse y una notificación local de `expo-notifications` al llegar. El canal es `quivo-anuncio-punto-control-v2`, con sonido y vibración. La UI está en `control-feedback-toast`, `vuelta-completada-banner` y `next-control-sheet`, dentro de `operation-screen.tsx`.
- **No hay `expo-updates`** ni `runtimeVersion`. `eas.json` usa `appVersionSource: remote` con `autoIncrement`.

## F1 — Diseño

### Datos (migración + RLS `tenant_isolation`, ENABLE+FORCE)
- **`puntos_control.rol`:** `TEXT NULL`, con `CHECK` en `'terminal' | 'retorno' | 'espera'`, más `espera_min INT NULL` (solo para `espera`). En la L16: SR = `terminal`, Honduras = `retorno`, Molinos = `espera` con 30 min.
- **`variantes.geometria`:** `geography(LineString,4326) NULL`, el **tramo adicional** de la variante (no el recorrido completo). Más `variantes.punto_espera_id` (FK a PC, NULL).
  - En la L16, la variante "vía Molinos" tiene como tramo `conector + ramal + bajada` del trazado por calles (v43 → Molinos → v43, ida y vuelta: la bajada va por la calzada contraria; 208 vértices, 2,54 km) y como punto de espera el PC Molinos. La base es `ida + regreso + salomon` (1218 vértices, 30,26 km), ver `docs/plan-trazado-linea-16.md`.
- **Tabla `vueltas`:**
  - Columnas: `id, sindicatoId, sesion_id, vehiculo_id, conductor_id, linea_id, ruta_id, fecha (día local Bolivia), numero, inicio_ts, fin_ts NULL, estado ('en_curso'|'completa'|'abierta_al_cierre'), paso_retorno_ts NULL, variante_id NULL, designada_por NULL, designada_en NULL, acuse_en NULL, espera_llegada_ts NULL, espera_salida_ts NULL`.
  - Únicos: `(sesion_id, numero)` y uno parcial `(sesion_id) WHERE estado='en_curso'`.
- **Infracciones:** se suman los tipos `molinos_omitido` (default `grave`, porque es una alteración de ruta) y `espera_corta` (default `leve`, por decisión del CTO).
  - Cambian el `CHECK` y `TipoInfraccionSchema`, se agregan a `REGLA_TIPO_POR_INFRACCION`/`GRAVEDAD_DEFAULT_POR_TIPO` y a las sugerencias de `/reglas`, y se actualizan las etiquetas en la web.
  - `espera_corta` solo alerta, como `pc_omitido`. `molinos_omitido` sí se puede sancionar ("una vuelta más").

### Conteo de vueltas (worker, después de `procesarCumplimientoEnTx`)
- **Apertura de la primera vuelta:** con el primer cumplimiento del PC `terminal`, o con `inicio_recorrido`, lo que llegue primero.
- **`paso_retorno_ts`:** se setea con el cumplimiento del PC `retorno` en la vuelta en curso.
- **Cierre:** un cumplimiento del PC `terminal` con `paso_retorno_ts` seteado cierra la vuelta como `completa` y abre la siguiente con el mismo `ts`, de modo que siempre haya una en curso.
- **Fin de sesión:** con `fin_recorrido` y al final de la sesión, la vuelta en curso pasa a `abierta_al_cierre`.
- **Limitación documentada:** si se pierde el cumplimiento de SR por un hueco de GPS, dos vueltas se fusionan. La detección de PC omitido de Honduras sigue funcionando.

### Designación (web `/en-vivo`: admin y control)
- **Quién (CTO, 2026-10-13):** la designación se hace **solo desde la web**. La app del chofer solo recibe el aviso y confirma con "Entendido".
  - La hacen el admin (`admin_quivo`/`admin_sindicato`) y **el control**, que usa el rol existente **`operador`**.
  - `operador` gana acceso a `/en-vivo` en modo **"ver mapa + designar"**: ve el mapa, las posiciones y el panel del vehículo, y puede designar.
  - `operador` **no** atiende, descarta ni sanciona infracciones. En la web esos botones no se renderizan y en la API responden 403.
  - Hay que revisar qué endpoints de `reportes/en-vivo` abrir a `operador` (lista, posiciones, contexto, traza). Las infracciones de la sesión puede verlas en solo lectura.
- **`PUT /reportes/en-vivo/:sesionId/vuelta-actual/designacion`** con `{varianteId: uuid | null}`.
  - Roles `admin_quivo`/`admin_sindicato`/`operador`, `@Auditable`, `withTenantContext`.
  - Solo se puede designar o cambiar con la vuelta `en_curso` y `espera_llegada_ts` en NULL. Si no, responde 409 con un motivo en español.
  - Guarda `designada_por`/`designada_en` y **limpia `acuse_en`**.
  - Cada cambio queda en la auditoría.
- **Sugerencia:**
  - Por vehículo: "Sugerido: Molinos" si hoy no tiene ninguna vuelta con `variante_id` de espera, y la línea está por debajo del ritmo objetivo.
  - El ritmo objetivo es un intervalo = ventana diurna (10 h) / flota activa en la línea, o sea un envío cada ~5 min con 125 móviles. Constante en `packages/shared`; se vuelve configurable en F2.
  - En el HUD, por línea: "Molinos: X en espera · último envío hace N min · próximo sugerido en M min".
  - Aviso si ya subió hoy ("ya fue a Molinos hoy"), pero se permite.

### Alertas
- **`molinos_omitido`:** la vuelta designada cierra en SR sin cumplimiento del punto de espera.
  - Dedupe `molinos_omitido:{vueltaId}`.
- **`espera_corta`:**
  - La llegada sale del cumplimiento del PC de espera durante la vuelta designada.
  - La salida es el primer GPS (`accuracy ≤ 30 m`) a más de radio + 30 m, con 2 puntos consecutivos.
  - Si `salida - llegada < espera_min`, se crea la infracción con `detalle {esperaMin, requeridoMin}`.
  - Dedupe `espera_corta:{vueltaId}`.
- **Desvío:** con la vuelta designada, la distancia es `LEAST(dist(base), dist(tramo de la variante))`. Sin designación, subir a Molinos cuenta como desvío, si el desvío está habilitado.
- **Pendiente E #1:** el LATERAL de `obtenerPosiciones` también cuenta las `atendida`.
  - El marcador muestra el ícono fijo (`parpadea=false`) con el nivel máximo entre abiertas y atendidas.
  - Solo parpadea si hay abiertas.

### Posiciones y panel (web)
- **`PosicionEnVivo`** gana `vuelta {numero, varianteId, varianteNombre, designadaEn, acuseEn, enEspera, esperaDesdeTs} | null` y `molinosHoy` (boolean).
  - Viaja en el poll de 2 s porque cambia; el contexto se cachea con `staleTime: Infinity`.
- **Panel del vehículo, sección "Vuelta N de hoy":**
  - Control segmentado "Directo / Vía Molinos" con la chip "Sugerido".
  - Estado del chofer: "Avisado 14:32 · **visto ✓ 14:33**" o "esperando que el chofer lo vea…".
  - Bloqueado (con motivo) una vez que llegó a Molinos.
  - En espera: contador "en Molinos hace 12 min (faltan 18)".
- **Marcador:** un pequeño badge "M" cuando la vuelta está designada a Molinos (`MapPoint` del design-system).
- **Pendiente E #2:** en ≤ 720 px el panel es una hoja plegable de dos alturas. "Ver en mapa" la pliega.

### App del chofer (APK)
- **`GET /mobile/vuelta-actual`** (`AuthMovilGuard`, sesión del token) devuelve `{vueltaId, numero, designacion: {varianteId, nombre, designadaEn, tramo: LineString GeoJSON, puntoEspera: {id, coord, esperaMin}} | null, enEspera: {desdeTs} | null}`.
  - **`POST /mobile/vuelta-actual/acuse`** con `{vueltaId, designadaEn}`: idempotente, setea `acuse_en`.
- **Hook `useVueltaActual`:**
  - Poll cada 20 s con la app en primer plano.
  - También se dispara desde los eventos de ubicación, con un piso de 20 s (patrón `drenaje-oportunista`), para que corra con la app en segundo plano mientras el JS esté vivo.
  - Cache en SQLite para mostrar el estado sin red.
- **Cuando llega o cambia una designación:**
  - Aviso en pantalla grande y persistente, en la línea visual de `vuelta-completada-banner`/`control-feedback-toast`: "Esta vuelta: **vía Molinos**. Después de Honduras subí por Putucu y esperá 30 min." Botón **"Entendido"**, que manda el acuse.
  - Voz (`expo-speech`).
  - Notificación local en el canal de PC, con sonido y vibración, para que se vea en segundo plano.
  - Si se cancela, aviso de "Designación cancelada: volvé directo a Salomón Romero".
- **Mapa:** dibuja el tramo de la variante resaltado y el PC de espera destacado. En la tarjeta de ruta, "Honduras → Molinos → Salomón Romero".
- **En Molinos:** contador de espera ("Podés salir en 18 min") calculado desde `enEspera.desdeTs`, sin bloquear nada.

### Datos de la L16 en prod (script, con el ok del CTO antes de `--apply`)
- `scripts/cargar-linea-16.ts` corrige la geometría base: el circuito v0..v150 + v91..v0 **termina en SR**.
- Crea la variante "Vía Molinos" con el tramo (`conector + ramal + bajada`) y `punto_espera` = PC Molinos.
- Setea `rol`/`espera_min` en los 3 PC.
- Es idempotente y dry-run por defecto. Se corre por la API después del deploy de F1.
- Antes de pisar la ruta (`460c9015…`, piloto activo), leer qué asignaciones la usan.

## APK — PRs restantes y orden
| PR | Qué | Depende de |
|---|---|---|
| B | `Conductor.telefono` | — (en review) |
| C | StorageService GCS + foto del vehículo (API/web), logos fuera del disco efímero | bucket (creado) |
| G | `feat(mobile)`: `expo-updates`. `runtimeVersion: { policy: 'fingerprint' }`, canal `production` en `eas.json`, chequeo al iniciar + botón "Buscar actualización" en Perfil | — |
| D | `feat(mobile)`: foto del vehículo (`expo-image-picker` + `expo-image-manipulator`, permiso de cámara) | C, G (lockfile) |
| F1-api | Migración, vueltas, designación, alertas, endpoints, LATERAL | C (conflictos en `en-vivo.service`) |
| F1-web | Panel, HUD, hoja plegable, badge M | F1-api |
| F1-mobile | `useVueltaActual`, aviso, mapa, contador | F1-api, D |
| Datos | Script L16 en prod (ok CTO) | deploy de F1 |
| — | **Breakpoint APK:** changelog al CTO + sus correcciones del piloto + estética. Después, el build. | todo lo anterior |

## Trampas
- Los PRs móviles tocan `package.json`, `pnpm-lock.yaml` y `app.config.ts`. Van en serie (G, D, F1-mobile), no en paralelo.
- `fingerprint` cambia con cualquier dependencia nativa. Una OTA solo llega a APKs con el mismo fingerprint. Se verifica con `npx expo-updates fingerprint:generate` antes y después.
- La designación vive en la vuelta, no en la sesión. Si la vuelta cierra en SR antes de que el admin designe, la designación cae en la vuelta nueva, que es lo correcto.
- El cumplimiento de PC trae el `ts` del GNSS y el `inicio_recorrido` el reloj del sistema. Hay que reusar la tolerancia de 120 s de `pc_omitido`.
- RLS en `vueltas` y test de aislamiento entre sindicatos.

## Verificación
- **API:** vitest de la máquina de vueltas como función pura:
  - SR → Honduras → SR cierra.
  - SR → SR sin Honduras no cierra.
  - Vía Molinos con espera de 35 min no da alerta; con 20 min da `espera_corta`.
  - Designada que no pasa por Molinos da `molinos_omitido`.
  - Lotes desordenados.
  - Integración del worker con lotes sintéticos, RLS, y 409 al designar después de llegar a Molinos.
- **Web:** Playwright con API mockeada (patrón `scratchpad/ev.mjs`): designar, cambiar, el acuse aparece, la hoja plegable a 390 px. Más `web-design-guidelines`.
- **Mobile:** Expo Go / MCP `mobile` con la designación simulada: aparece el aviso, se manda el acuse, el tramo se dibuja. En segundo plano, la notificación local. Prueba real en el APK, a cargo del CTO.
- **Gates:** `/code-review` en todos. `/security-review` en F1-api (endpoints nuevos, RLS), C (subida de archivos, bucket público) y B (PII).

## F1-mobile — decisiones de implementación (2026-10-14)
- **El servidor es la verdad** de la vuelta y la designación. La app no deduce cierres de vuelta para invalidarla: refleja la última respuesta de `GET /mobile/vuelta-actual`, cacheada en SQLite (`vuelta_actual_local`) y atada al recorrido activo (cache de otro recorrido se descarta; respuestas en vuelo de un recorrido anterior también).
- **`rol` viaja en el paquete del día** (opcional; paquetes viejos sin `rol` se comportan como antes). Orden efectivo de PCs (`ordenEfectivoPuntos`): el PC `espera` queda fuera del progreso, mapa, voz y total sin designación; con designación va justo después del PC `retorno`. Los pasos por el PC de espera se registran siempre pero no anclan ni cierran la vuelta. Esto arregla un bug previo: con el orden SR(0)/Molinos(1)/Honduras(2) la app mandaba a Molinos después de SR y lo marcaba omitido.
- **Cuenta regresiva en Molinos:** `Date.now()` contra `enEspera.desdeTs` + 1 min de margen (la sanción `espera_corta` compara timestamps del fix GPS).
- **Limitaciones aceptadas:** (a) un reloj del teléfono desfasado más de 1 min puede adelantar el "Ya podés salir"; (b) una designación que llega después de pasar un PC posterior al retorno marca Molinos omitido (en la L16 no hay PCs entre Honduras/Molinos y SR); (c) la llegada a Molinos segundos antes de que la designación llegue al cache no se notifica (el paso igual se registra).
- (d) Sin red, una designación de una vuelta que ya cerró puede seguir mostrándose ("sin actualizar") hasta la próxima respuesta del servidor. Se probó suprimirla al cerrar la vuelta localmente y se descartó: si el cierre local y el del servidor discrepan (geocerca de Honduras perdida, outbox sin drenar), el chofer perdía un aviso vigente y el servidor registraba `molinos_omitido` (grave). Subir de más a Molinos no se sanciona en la L16 (desvío deshabilitado).
- **Pendiente API (F2):** si el admin designa justo cuando el vehículo ya llegó a SR pero el outbox no drenó, la designación cae en la vuelta que físicamente terminó y el servidor la cierra como `molinos_omitido`. Mitigación posible: en el panel, avisar "llegando/llegó a SR" con la última posición, o mover la designación a la vuelta siguiente si el cierre llega dentro de N s.
- Sin registro persistido de recorrido (se probó una tabla `recorrido_actual` y se descartó por carreras con el flujo de GPS): headless consulta porque solo corre con GPS nativo encendido; foreground solo con `tracking`; `iniciar()`/`detener()` limpian el cache (fire-and-forget) e incrementan una generación en memoria que descarta respuestas en vuelo. El código del aviso nunca bloquea ni abre transacciones en el flujo crítico de GPS.
