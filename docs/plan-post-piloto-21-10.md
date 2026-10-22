# Plan — fixes post-piloto 21/10 para el piloto del 22/10

## Contexto

Hallazgos del piloto L16 del 21/10 (handoff "2026-10-21, 17:00" y memoria `post-piloto-21-10-fixes`).
Decisiones del CTO (21/10, noche):
- Antes del piloto del 22/10 entran los ítems **1, 2, 3, 4, 8, 9**.
- **5** (variante en el mapa) y **6** (fase de vecinos sin vuelta) quedan para antes del sábado 25/10.
- **Sin** límite de distancia para vecinos.
- El trazado nuevo de SR lo arma Claude con el GPS real del 21/10; el CTO lo revisa antes de aplicarlo.

## Entregas (3 PRs de código + 1 cambio de datos + docs)

### PR A — app (OTA): ítems 2 y 9 · rama `fix/app-paquete-y-terminal` · Sonnet 1

**Ítem 2: refrescar el paquete del día**
- Hoy `usePaqueteDia` descarga una sola vez por montaje (`apps/mobile/src/features/operacion/use-paquete-dia.ts:83-87`); `recargar` (`:89`) no tiene llamadores.
- Agregar al hook:
  - un listener de `AppState` a `active` que llame `cargar()`, con un mínimo de 60 s entre cargas (copiar el patrón de `features/jornada/use-jornada.ts:76`);
  - un intervalo de 10 min mientras la app esté en primer plano.
- Un fallo de red mantiene el paquete local (fallback actual `:57-70`).
- **Trampa a verificar primero:** el background task lee los PC de SQLite (`gps/headless-task.ts:859,891`) al armar su contexto.
  - Si el contexto se cachea entre ticks, hay que hacer que relea cuando cambie `descargado_en` (`db/paquete-dia.ts`); si no, el refresco no llega a la geocerca en segundo plano.
  - Ver también qué fuente usa `use-gps-operativo.ts:637`.
  - Test: la geocerca usa la coord nueva del PC tras un refresco.

**Ítem 9: terminal no re-detectado**
- **Diagnóstico primero (solo lectura, chairman):** revisar en prod la sesión de PIL `f34d5d70…` entre 21:10 y 21:20Z (eventos, huecos de GPS, reinicio de la app).
  - Hipótesis (b): la semilla `clavesCumplimientoDesdePayloads` (`gps/location-task.ts:419-481`) marca `dentro:true` a todo PC con historial. Si la app se reabrió cerca de SR (se les pidió reabrir), el terminal nace "dentro" y nunca emite.
  - Hipótesis (a), RADIO_CONFIRMACION_M=40: solo afecta el anuncio (`decidir-anuncio.ts:202`), no el cumplimiento. Pierde peso, y además el ítem 1 pone el PC sobre la parada.
- **Fix:** no sembrar `dentro:true` para PC con `rol === 'terminal'`. Se mantienen `pasadas` y `ultimoEmitidoMs`, así `PASADA_MIN_MS` (2 min) evita el doble disparo inmediato.
- **Trampa:** tras reiniciar estando en la fila, el terminal puede re-emitir. El Sonnet verifica, con tests, que un segundo cumplimiento `terminal` sin `pasoRetornoTs`:
  - no cierre ni abra vuelta (`apps/api/src/modules/ingesta-worker/vueltas.ts`);
  - no rompa la ventana de `pc_omitido` (`deteccion-infracciones.ts`).
  - Si alguno de los dos falla, se corrige del lado del servidor dentro del PR B.
- **Tests:** `gps/location-task.test.ts` (describe `:631`) cubre la semilla de terminal con `dentro:false` y otros PC con `dentro:true`. Un caso en `geofence.test.ts` cubre que, reiniciado dentro del radio del terminal, emite.

### PR B — servidor: ítem 4 · rama `fix/fila-salida-servidor` · Sonnet 2 (en paralelo con A)

- **Salida detectada por el worker con GPS.** Para la sesión con una entrada `en_fila` (por `sesionId`), dentro de `procesarVueltasSesion` (`deteccion-vueltas.ts:194`, junto al backstop, bajo el mismo lock):
  - si hay **2 fixes consecutivos** con accuracy ≤ 50 m, a más de `radio × 1,5` del PC terminal **actual de la DB**, y con `ts ≥ llegadaTs + 60 s`, se marca `salio`, `salidaOrigen = 'deteccion'`, y `salidaTs` = ts del primer fix de la racha (acotado a `ahora`);
  - `anticipada` se calcula con la misma lógica de `salidas.logic.ts:43-47`.
- Reusar `aplicarBackstopFila` (`fila-backstop.ts`) como lugar: es un disparador más, con el mismo `UPDATE … WHERE estado='en_fila'` y `bloquearTerminal`, así la carrera con el POST de la app queda resuelta (gana el primero).
- **Trampa:** hay que pasar los GPS del lote a `procesarVueltasSesion`. El Sonnet traza `procesarGpsPoints` (`ingesta-worker.service.ts:299`) hasta ahí. Se usan solo los fixes del lote; no se lee el historial.
- Los clientes no cambian, porque el cliente ya tolera `fila:null` en su POST de salida.
- **Tests:** unitarios del disparador (racha, accuracy, margen de 60 s, PC movido) y uno de integración con Postgres en docker. Repite el caso de PIF: sale sin POST y queda `salio` con la frecuencia anclada.

### PR C — app (OTA): ítems 3 y 8 · rama `fix/app-fila-racha-pausa` · Sonnet 3 (en paralelo)

**Ítem 3: la racha "afuera" se reinicia al entrar a la fila**
- Hoy la llegada manual (`use-fila-salida.ts:166-175`) no toca `deteccion.estado`.
- En `decidirAccionFila` (`features/fila-salida/zona-terminal.ts:55-89`), sumar `enFilaPrevio` a `EstadoDeteccionFila`. En la transición `!enFilaPrevio && enFila` se hace `fuerasConsecutivos = 0` y `ultimoIntentoMs = ahoraMs`, así no hay salida en los 60 s siguientes.
- Una sola regla pura que cubre la llegada manual, la automática y la sincronizada del servidor, en los dos contextos JS.
- **Test:** caso PID (llegada manual con racha 2 arrastrada: un fix lejos 2 s después no da salida) en `zona-terminal.test.ts`.

**Ítem 8: confirmación al PAUSAR estando en la fila**
- En `next-control-sheet.tsx:380-391`, si el chofer está en la fila, PAUSAR abre `QuivoConfirmDialog` (patrón de `:408-422`) con este texto: "Si pausás, perdés tu lugar en la fila. ¿Pausar igual?" (decisión CTO). Confirmar llama `onPause`.
- **Trampa:** "está en la fila" no es lo mismo que `filaSalida !== null`. El Sonnet confirma qué indica que el propio trufi tiene entrada `en_fila`.

### Ítem 1 — trazado L16 en SR (dato de prod) · rama `data/l16-tramo-sr` · Sonnet 4

1. Bajar `trazaGps` del 21/10 (`/v1/reportes/recorridos/:sesionId`) de PIL, PID, PIF, PIB y PIC. Recortar a ±600 m de la parada nueva (`-17.3188935, -66.2280664`), con accuracy ≤ 30 m.
2. Ver por qué calles entran y salen de la parada. Ajustar los waypoints del tramo en `scripts/data/linea-16/trazado-calles.json`, para seguir con el pipeline existente `scripts/cargar-linea-16.ts`.
3. Dry-run: `packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts --solo-trazado`. Generar un HTML de preview con el trazado viejo, el nuevo, las trazas GPS y la parada. **El CTO lo revisa.**
4. Con el OK del CTO y **0 sesiones activas en L16**, el chairman:
   - guarda un backup de la geometría y de la coord del PC SR;
   - corre `--solo-trazado --apply --excepciones-revisadas`;
   - hace PATCH del PC SR `ea0f624c…` a la parada (radio 150).
5. Verificar, por SQL de solo lectura:
   - todos los PC de L16 a ≤ 100 m del trazado nuevo (el PATCH de geometría **no** los revalida);
   - las paradas validadas;
   - la variante "Vía Molinos" `3f806192…` sigue empalmando con la base.
6. Cache de vecinos: geometría con TTL de 5 min. Hay que esperar o aceptarlo.

## Orden y horario (hora Bolivia; confirmar la hora del piloto del 22/10)

| Paso | Quién |
|---|---|
| Volcar el plan a `docs/plan-post-piloto-21-10.md` y poner el puntero en el handoff | chairman |
| Diagnóstico de PIL 21:17Z (ítem 9) | chairman, solo lectura |
| Sonnet 1, 2, 3 y 4 en paralelo, cada uno en su rama o worktree | Sonnet |
| Revisión de cada diff: `/code-review` y `/ponytail-review`; `/security-review` en el PR B; `/codex-debug verify-fix` → "Codex: no verificado (sin cuota)" | chairman |
| Fixes post-review con un Sonnet nuevo | Sonnet |
| PRs: merge con ci **y** acceptance en verde | chairman |
| Deploy r25 de API y worker (PR B) | chairman, con OK del CTO |
| OTA única desde main (PR A y PR C) con `publicar-ota.sh`; bundle verificado (shared fresco y `EXPO_PUBLIC_*` en el `.hbc`) | CTO publica, o chairman con su OK |
| Aplicar el trazado y el PC SR (ítem 1) sin sesiones activas | chairman, con OK del CTO |
| Pedir a todos que reabran la app (OTA más paquete nuevo) | CTO |
| Actualizar handoff y memoria | chairman |

## Verificación

- **Local:**
  - `tsc` en mobile, api y shared;
  - jest de mobile (zona-terminal, location-task, geofence, use-paquete-dia);
  - vitest de ingesta-worker, más la integración con Postgres en docker.
- **Bundle de la OTA:** guard `assert-bundle-singletons.mjs` y `grep -aF` de `EXPO_PUBLIC_API_URL` y `SENTRY_DSN`.
- **Prod tras el deploy:**
  - `/v1/health` responde bien y el worker corre la imagen `r25`;
  - Sentry y `gcloud logging` ERROR quedan limpios.
- **Trazado:**
  - SQL de distancia de PC y paradas a la geometría;
  - `/v1/rutas/:id/variantes`;
  - una captura de /en-vivo.
- **En la calle (22/10), con monitor de la fila:**
  - llegada automática a la parada nueva;
  - salida sin botón que el servidor marca `salio`/`deteccion`;
  - sin salida falsa tras llegada manual;
  - PAUSAR en la fila pide confirmación;
  - el terminal se detecta tras reabrir la app en SR.

## Rollback

- API a `quivo-api-00031-5z9` y worker a `api:r24-20261021`. No hay migración.
- OTA: republicar el grupo `08acdc79-af82-49e2-8b67-f55e1eed6534` (r24).
- Trazado: PATCH con la geometría del backup. PC SR a `-17.3185525, -66.2277902`.

## Riesgos y lo no verificado

- No verificado: si el background task relee SQLite en cada tick (ítem 2). Es lo primero que revisa el Sonnet 1.
- Ítem 9: la causa no está confirmada. El fix ataca la hipótesis más fuerte, y el diagnóstico de PIL la confirma o la descarta antes de mergear.
- Salida por servidor: si el GPS del lote llega tarde (outbox offline), `salidaTs` sale del fix y no del reloj, así que la frecuencia queda bien anclada; la fila en vivo se actualiza con retraso.
- Trazado: cambia el largo del circuito y la proyección de los vecinos, y no hay versionado ni historial, solo el backup manual.

## Avance

- **21/10 noche — diagnóstico del ítem 9 (PIL, sesión `f34d5d70`):**
  - El teléfono tenía el PC SR nuevo: emitió el terminal a las 19:31:16Z a 50 m.
  - En la 2.ª pasada estuvo estacionado a 48–51 m desde las 21:15:19 hasta las 21:19:26Z, con 21 fixes dentro del radio de 150 m y accuracy de 2 a 6 m. No hubo cumplimiento.
  - El GPS fue continuo, sin un reinicio visible.
  - Hipótesis (a), el radio: **descartada**.
  - Hipótesis (b), la semilla: **no confirmada**, porque exige reiniciar el contexto JS cerca de SR.
  - Se suma la hipótesis (c): una 2.ª pasada por el terminal no emite (re-armado, filtro de PC, fila o outbox). El Sonnet del PR A la reproduce con un test antes del fix.
