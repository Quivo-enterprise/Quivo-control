# Plan: salida libre desde Molinos (2026-10-21)

## Pedido del CTO

- Ya no es obligatorio esperar 30 minutos en Molinos. Hay que sacar los "30 minutos" de la tarjeta que avisa la designación.
- En Molinos no se aplica la frecuencia de salida: cada trufi sale cuando quiere.
- Al volver a SR desde Molinos rige la frecuencia base de siempre.
- Decisión: `esperaMin` del PC Molinos pasa a `null` en prod.

## Estado actual (exploración del 21/10)

- **Fila y frecuencia:** solo existen en el PC `terminal` (SR): `fila.service.ts`, `fila-datos.ts` y `fila-salida-deteccion.ts`. En Molinos no hay fila. La parte de "volver a SR" ya funciona así y no cambia.
- **Espera mínima de Molinos:** sale de `puntos_control.esperaMin` (30). Se usa en:
  - la tarjeta, la notificación y la voz de la designación: `partesAvisoDesignada` / `textoAvisoDesignada` ("…y esperá 30 minutos.") en `apps/mobile/src/features/vuelta-actual/vuelta-actual-core.ts:386-403`;
  - el contador "Podés salir en N min" / "Ya podés salir": `restanteEsperaMin` y `ContadorEsperaMolinos`;
  - el worker, que solo cierra la espera (pone `esperaSalidaTs`) si hay `esperaMin`, y emite la alerta `espera_corta` (`deteccion-vueltas.ts:354`, `vueltas.ts:466` `cerrarEspera`);
  - el panel web /en-vivo: "en Molinos hace N min (faltan M)", con `ESPERA_MIN_DEFAULT = 30` como fallback (`apps/web/src/lib/en-vivo/vuelta.ts`).
- **`esperaMin` es obligatorio** para un PC `espera` y para designar:
  - `control-points.service.ts:47`;
  - `variantes.service.ts:96-107`;
  - `vueltas.service.ts:124-134`;
  - `vuelta-actual` devuelve `designacion: null` si falta (`vueltas.service.ts:336`);
  - el schema shared `VueltaActualMovil.designacion.puntoEspera.esperaMin` es positivo y requerido.

## Diseño

`esperaMin = null` en un PC `espera` significa **salida libre**: sin espera mínima, sin contador y sin `espera_corta`. Un número mayor que 0 conserva el comportamiento de hoy, así que se puede volver atrás tocando solo el dato.

1. **shared:** `designacion.puntoEspera.esperaMin` pasa a `positive().nullable()`.
2. **API:**
   - un PC `espera` acepta `esperaMin` en `null` (`control-points.service.ts`); `esperaMin` sigue valiendo solo con rol `espera`;
   - `validarPuntoEspera` y la designación exigen solo `rol === 'espera'`;
   - `vuelta-actual` devuelve la designación aunque `esperaMin` sea `null`.
3. **Worker:** la salida de la espera se resuelve siempre, para que `esperaSalidaTs` cierre la espera. `espera_corta` solo se emite con `esperaMin > 0`.
4. **App:**
   - con `esperaMin` en `null`, la tarjeta, la notificación y la voz dicen "Esta vuelta: vía Molinos. Después de Honduras subí por Putucu." (sin minutos);
   - no se muestra el contador.
5. **Web /en-vivo:**
   - sin `ESPERA_MIN_DEFAULT`; con `null` muestra "en Molinos hace N min", sin "faltan" ni "cumplida";
   - las alertas `espera_corta` viejas se siguen mostrando.
6. **Script L16:** `puntos-control.json` con Molinos en `esperaMin: null`, y se ajusta su validación. Va después del PR del script (#242+).

## Despliegue (orden obligatorio)

1. API y worker r27, más la OTA. El código nuevo con el dato todavía en 30 se comporta igual que hoy.
2. Los choferes reabren la app para tomar la OTA.
3. **Recién después**, PATCH de Molinos a `esperaMin: null` con el script `--apply` (dry-run antes: 1 escritura) y sin sesiones activas.
   - Riesgo: una app sin la OTA nueva rechaza `esperaMin: null` en el schema de `vuelta-actual` y no ve la designación.
- **Rollback:** PATCH de Molinos a `esperaMin: 30` y vuelve el comportamiento de hoy.

## Verificación

- `tsc` en shared, api, mobile y web.
- Tests:
  - de texto con `null` y con 30;
  - del worker: espera cerrada sin `espera_corta` con `null`;
  - de integración: designar con `esperaMin` en `null`, y PATCH de PC `espera` a `null`;
  - web: `esperaMolinos` con `null`.
- Gate: `/code-review`, `/ponytail-review` y `/security-review` (toca la validación del endpoint de PC).

## Cola de Molinos (orden de llegada)

- La cola de Molinos es **solo por orden de llegada**, sin tiempo ni frecuencia: el primero sale cuando quiere y el segundo puede salir apenas el primero salió. Es informativa para el chofer; no hay infracción ni alerta nueva.
- `GET mobile vuelta-actual` devuelve `enEspera.posicion` = 1 + las otras vueltas del mismo punto de espera y sindicato, `en_curso`, con `esperaLlegadaTs` y sin `esperaSalidaTs`, que llegaron antes (empate por id). Una consulta SQL; las vueltas cerradas o abandonadas no cuentan, así que nunca bloquean la cola. `posicion` es opcional en el schema shared (servidores/caches viejos).
- App, con `esperaMin` en `null`: la pastilla de Molinos muestra "Es tu turno. Podés salir" (posición 1) o "Sos el N.º en Molinos. Salís después del que está adelante."; sin `posicion` no hay pastilla. Con `esperaMin` numérico sigue la cuenta regresiva de siempre.
