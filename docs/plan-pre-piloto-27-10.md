# Plan: correcciones antes del piloto L16 del lunes 27/10, y lo que queda para después

## Contexto
La prueba simulada del 24/10 (teléfono del CTO más 2 emuladores) confirmó que la fila y el cierre de vuelta en SR andan bien, después de #261 y #263. También dejó bugs anotados en el handoff (PR #265).

Este plan los ordena por impacto en el piloto del lunes y propone corregir antes los que afectan la operación o los datos de ese día. El resto queda para después del piloto.

Hoy es sábado 25. Hay dos días: el sábado y el domingo se implementa, el domingo a la noche se publica la OTA y el deploy, y el lunes es el piloto.

### Corrección de lo que dije antes sobre Molinos
El PC km 26 tiene `obligatorio=false`, así que **no genera `pc_omitido`** (`seleccionarPcOmitidos` en `deteccion-infracciones.ts` solo mira los obligatorios).

Tampoco hubo ninguna infracción `desvio` en las 43 sesiones de L16 desde el 15/10, ni siquiera el 22/10, cuando los trufis iban a 84–98 m del trazado. Eso sugiere que `rutas.desvioHabilitado=false` en L16. Es una inferencia y no está verificado en la base.

Por eso el ramal mal trazado tiene un efecto **visual** en la app: la línea del mapa no coincide con la calle y el km 26 aparece "omitido" mientras suben a Molinos. El CTO confirmó que al bajar vuelven por la misma calle y pasan por el km 26, así que al terminar queda "pasado".

No hay trazas reales de Molinos en prod. Las sesiones 9001–9003TST tienen el cumplimiento pero no tienen puntos cerca. Por eso **Molinos pasa a después del piloto**: el lunes cada vuelta designada deja una traza real de la que se saca la bifurcación.

## Urgente: antes del lunes

### PR A: panel `/en-vivo` (API y web, deploy r34)
1. **Una sesión cerrada sigue mostrándose "Reportando".**
   - Causa: el logout (`auth-movil.service.ts:595-619`) deja `recorridoEstado='en_curso'`, y `clasificarFrescura` (`apps/api/src/modules/reportes/en-vivo.service.ts:205-231`) ignora `fin` y `estado`.
   - Fix: si la sesión tiene `fin` o `estado !== 'activa'`, clasificarla como `finalizado` antes de las demás reglas, y pasar `fin` y `estado` a `derivarFrescura`.
2. **Aparece la sesión vieja del mismo vehículo duplicada.**
   - Fix: en `obtenerPosiciones` (`en-vivo.service.ts:~550`), una fila por `vehiculoId`.
   - Se elige la sesión activa (`fin IS NULL`) y, si no hay, la más reciente.
   - Se puede hacer con `DISTINCT ON (so."vehiculoId")` y el orden actual `(so.fin IS NULL) DESC, ...`, o filtrando en el `map`. Se elige lo más corto.
   - Hay un precedente de excluir otras sesiones del mismo vehículo en `vecinos-ruta.util.ts:140`.
3. **Tests:**
   - Unit de `clasificarFrescura` con una sesión cerrada.
   - Integración o unit de la deduplicación con 2 sesiones del mismo vehículo.

### PR B: re-login y app (móvil, OTA)
Es el de más impacto en datos. Una sesión re-logueada nunca emite `inicio_recorrido`, y eso tiene tres efectos:
- queda oculta en vecinos;
- el worker no abre vueltas, porque la vuelta la abre el primer `terminal` *posterior* al `inicio_recorrido` (`vueltas.ts:15-30`);
- no se detecta `pc_omitido`, porque no hay ventana de recorrido (`deteccion-infracciones.ts:425-436`).

En resumen, **las vueltas del chofer que re-loguea no cuentan.**

1. **`inicio_recorrido` en el re-enganche de una sesión nueva.**
   - Dónde: `apps/mobile/src/features/operacion/use-gps-operativo.ts`.
     - `reengancharNativoActivo` (~1130-1190).
     - La rama de `iniciar()` que re-engancha con el nativo activo (~1805-1835).
     - La reconciliación de `reconciliar-tracking.ts`.
   - Hoy el estado de `inicio-recorrido-retry.ts` vive en un ref (`eventId:null` al montar), así que en el re-enganche no emite nada.
   - Fix:
     - Persistir el `sesionId` del recorrido activo, con el mismo storage que ya usa la app para la pausa o la designación (`leerPausa` / `leerDesignacionOrdenLocal`).
     - Escribirlo en `ejecutarIniciar`.
     - En el re-enganche, si el `sesionId` persistido es distinto del actual (re-login), llamar `reiniciarEstadoInicioRecorrido` y luego `asegurarInicioRecorrido`, y persistir el actual.
     - En la misma sesión (app reabierta) no se re-emite. Un `inicio_recorrido` duplicado en mitad de una vuelta podría cerrarla en el worker.
   - En el mismo punto: si `terminalParaInicio(...).enTerminal`, llamar `silenciarTerminalAnclado`, igual que hace `ejecutarIniciar` en las líneas 1669-1675. Así no sale el toast de SR al re-loguear dentro de la terminal.
   - Test: unit del helper de decisión (persistido vs actual, con null, igual o distinto) y de que la rama de re-enganche lo invoca.
2. **El botón "Estoy en la fila" no cierra la vuelta.**
   - Extraer el cuerpo del callback `alDetectarLlegada` de primer plano (`use-gps-operativo.ts:~663-709`) a una función `confirmarLlegadaTerminal` expuesta por `useGpsOperativo`.
   - Esa función hace `confirmarVisitasVencidasEnCola(..., umbral 0, soloPuntoControlId = terminalIdDeLaRuta(...))`, los anuncios y `setUltimaDeteccion`.
   - La usan `onLocation` y `estoyEnLaFila` (`features/fila-salida/use-fila-salida.ts:166-175`), que la llama antes de `registrarLlegada`. `operation-screen.tsx:117` se la pasa a `useFilaSalida`.
   - El headless queda como está, porque corre en otro contexto JS.
   - Test: `estoyEnLaFila` llama la confirmación antes de `registrarLlegada`, y no la llama si está en pausa.
3. **El toast muestra "#ea0f".**
   - `features/operacion/control-feedback-toast.tsx:157` imprime `puntoControlId.substring(0,4)`.
   - Fix: `operation-screen.tsx:793` le pasa `numero`, calculado con `ubicarEnOrdenEfectivo` (`anuncio-punto-control.ts:211-222`) sobre `puntosControl` y la designación actual.
   - Si `numero` es undefined, muestra "Punto de control" sin número, igual que la voz.

### PR C: vehículo quieto que parece muerto (móvil, misma OTA; es el más riesgoso)
**Síntomas:**
- Un trufi en la fila de SR, con más de 10 min de espera cuando hay varios, sale de vecinos (`UMBRAL_VECINO_FRESCO_MS`, `ultimo_fix_ts`).
- Con más de 15 min, el panel lo muestra "Sin señal". Esto se basa en `ultimo_ingreso_ts` (`en-vivo.service.ts:152-153, 205-231`).

**Hechos:**
- El heartbeat de primer plano llama `getCurrentPosition({samples:1, persist:true})` (`use-gps-operativo.ts:759`), pero en la prueba no llegaron fixes con el vehículo quieto: PIL con la pantalla encendida estuvo 42 min "sin señal", y los emuladores, que no tienen MIUI, también.
- El heartbeat headless (`headless-task.ts:1464`) por diseño no registra ningún punto.

**Pasos:**
1. **Diagnóstico primero, en un emulador** (no mueve código de producción): logcat con el emulador quieto con mock GPS fijo durante 5 min.
   - ¿Se dispara `onHeartbeat`?
   - ¿`getCurrentPosition` dispara `onLocation`?
   - ¿`registrarPuntoGps` lo encola o lo descarta, por ejemplo por un filtro de distancia o de duplicado?

   Así no adivinamos (regla 0). Este es el bug que no cedió al primer intento, así que corresponde la regla 13. Codex no tiene cuota, así que queda como "no verificado" en Codex.
2. **Fix según el diagnóstico.** La forma esperada es que en el heartbeat, de primer plano y headless, la posición devuelta por `getCurrentPosition` se registre explícitamente con `registrarPuntoGps` como `gps_point`. Así no dependemos de que el SDK reenvíe a `onLocation`.
   - Como mucho 1 punto por heartbeat, cada 60 s.
   - El fix tiene `ts` nuevo, así que avanza `ultimo_fix_ts` y `ultimo_ingreso_ts`. No hace falta tocar el servidor.
   - En headless, `manejarHeartbeatHeadless` pasa a pedir la posición. Hay que cambiar el docblock de la línea 1449, que hoy dice que no escribe puntos.
3. **Riesgos:**
   - Toca el núcleo del GPS.
   - Un punto quieto repetido no debe disparar geocercas ni la máquina de fila de forma rara. La fila ya trata los "fixes quieto" (`procesarFixFila`), pero hay que revisarlo.
   - Si el diagnóstico no termina el domingo, PR C sale de la OTA y el lunes se opera con lo conocido: el chofer queda "sin señal" en la fila.

### Operativo (CTO, sin código)
- **Descartar las infracciones de prueba de PIC**: sesión 759dc961, `pc_omitido` b4b9cfe0 y c7f91ff7. Lo puedo hacer yo con tu OK. Además, decidir d88805f3 y el PC8 del 22/10.
- **Limpiar tu teléfono:**
  - desinstalar Appium Settings;
  - sacarlo como app de ubicación simulada;
  - apagar "Pantalla siempre encendida" y la depuración inalámbrica.
- **Choferes:**
  - batería en "Sin restricciones" (Xiaomi);
  - abrir la app antes de empezar el día para que baje la OTA.
  - Hasta que salga PR B, si re-loguean: Terminar el día y luego COMENZAR RUTA.
- **El lunes, designar al menos una vuelta a Molinos**, para tener la traza real.
- **Confirmar `desvioHabilitado` de L16** con un SELECT de solo lectura.

## Después del piloto (en el handoff, sin cambios)
- **Trazado Molinos:**
  - con la traza real del lunes, `regreso` termina en la bifurcación F;
  - `ramal` va de F a Molinos y `bajada` es el mismo camino al revés;
  - `salomon` arranca en F;
  - re-ordenar los PC: Molinos 14 y km 26 15, porque `cargar-linea-16.ts:1103,1120` exige que el orden siga el avance de la base. El script tiene que soportar el cambio de `orden` con la restricción única;
  - actualizar `fase-vuelta.replay.test.ts` y su fixture;
  - `--apply` lo corre el CTO.
- **Numeración de PC en el panel según la variante de la vuelta.** `map-builders.ts:77-83` usa `index+1` sobre todos los PC; tiene que usar el orden efectivo con `posicion.vuelta.varianteId`.
- **Marcador antes de SR** en el detalle de `/en-vivo` (snap y animación de `segmentos-traza.ts:59`).
- **Pendientes sin cambios:**
  - heartbeat y MIUI;
  - outbox de PIF;
  - la medianoche en la fila;
  - el refactor del bloque duplicado de confirmación forzada (parte de esto sale con B2);
  - Codex sobre #261–#263 y sobre este lote cuando vuelva la cuota.

## Ejecución
- Rama y PR por bloque:
  - `fix/en-vivo-sesiones-cerradas` (A);
  - `fix/relogin-fila-toast` (B);
  - `fix/heartbeat-quieto` (C).
- Implementa un Sonnet por PR. B y C tocan `use-gps-operativo.ts`: van en serie (C después de B), o en un solo subagente si el diagnóstico de C es corto.
- Antes de cada PR: `/code-review` y `/ponytail-review`, más `/codex-debug verify-fix` (sin cuota, queda "no verificado"). A no toca auth, pero filtra por sesión, así que no necesita `/security-review`.
- Merge cuando `ci` y `acceptance` estén en pass. Después: deploy r34 (A) y una OTA con B y C (bundle verificado; la publica el CTO con `printf 'y\n' |`).
- Primero: mergear el PR #265 (handoff, CI ya terminado) y volcar este plan a `docs/plan-pre-piloto-27-10.md`, con el puntero en el handoff.

## Verificación
- tsc, lint y vitest en api, web, mobile y shared.
- A: después del deploy, `GET /reportes/en-vivo/posiciones` no trae sesiones cerradas como `reportando` y trae una fila por vehículo. Revisar `/en-vivo` en el navegador.
- B y C, con la OTA publicada, en los 2 emuladores (AVD `quivo_trufi2`/`quivo_trufi3`; hay que rehacer los scripts de mock GPS, porque el scratchpad se borró con el reinicio):
  - Re-login a mitad del recorrido: la sesión nueva queda con `recorridoEstado=en_curso` (vecinos del otro emulador la ve) y la vuelta siguiente aparece en `/reportes/recorridos/:id`.
  - "Estoy en la fila" manual: cumplimiento del terminal y vuelta cerrada.
  - El toast muestra el número.
  - Quieto 15 min: `ultimoFixTs` avanza cada ~60 s, sigue en vecinos y el panel sigue en "Reportando".
- Rollback: republicar la OTA anterior (01a16f83) si algo falla el domingo a la noche.
