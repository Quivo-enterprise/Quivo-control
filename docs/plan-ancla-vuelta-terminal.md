# Plan — anclar la vuelta 1 en la terminal (SR), solo servidor, hoy antes de las 15:00

## Contexto

Si el chofer toca COMENZAR RUTA antes de llegar a Salomón Romero, el `inicio_recorrido` abre la vuelta 1 en ese lugar
(`apps/api/src/modules/ingesta-worker/vueltas.ts:256-259`). Los PC que pasa camino a SR quedan dentro de esa vuelta.
El caso grave: si en el camino pasa por Honduras (`retorno`), se fija `pasoRetornoTs`, y al llegar a SR la vuelta se
cierra como `completa` (`:285-290`). Resultado: una vuelta falsa en la cuota, y alertas `pc_omitido` falsas
(`deteccion-infracciones.ts:370-373,423`, la ventana arranca en `inicio_recorrido`).

La app del chofer **ya** ancla su contador local en la terminal (`apps/mobile/src/features/operacion/progreso-vuelta.ts:223-226`).
El que cuenta mal es solo el servidor. Decisión del CTO (21/10): **no se bloquea COMENZAR RUTA**, se ancla en el
servidor, y **entra hoy para el piloto de las 15:00**.

Objeción registrada (una vez): cambiar el conteo de vueltas el mismo día que debuta la fila, sin prueba en la calle,
suma un segundo riesgo al piloto. Mitigación: cambio chico, solo API y worker (sin OTA), y rollback a r22 en un comando.

## Alcance (lo mínimo)

**Sí:**
1. **`vueltas.ts` — `avanzarVueltas`:** si la ruta tiene un PC `terminal` activo (`anclaEnTerminal`):
   - un `inicio_recorrido` sin vuelta en curso pone `recorridoEnCurso = true` y **no abre la vuelta**; la abre el
     primer cumplimiento `terminal` posterior (rama existente `:283-286`);
   - un `inicio_recorrido` con una vuelta en curso que tiene `pasoRetornoTs` la cierra como `abierta_al_cierre`
     (igual que hoy) y **no abre otra**;
   - sin PC `terminal` en la ruta: comportamiento de hoy, sin cambios (otras líneas).

   Los PC previos a la apertura ya se ignoran solos porque no hay vuelta `en_curso` (`:301`, `:307`, `:323`).
2. **`deteccion-vueltas.ts`:** calcular `anclaEnTerminal` con la consulta de PC de la ruta que ya hace
   (`~:225-230`) y pasarlo a `avanzarVueltas`.
3. **`deteccion-infracciones.ts` — `pc_omitido` (en vivo `:423` y al `fin_recorrido` `:472`):** con
   `anclaEnTerminal`, la ventana arranca en el primer cumplimiento `terminal` posterior al `inicio_recorrido`, no en
   el `inicio_recorrido`. Si no hubo paso por la terminal, no hay ventana y no se marca nada.
   **Regla de corte:** si a las 12:45 este punto no está listo y revisado, sale solo 1 y 2 (las alertas de `pc_omitido`
   solo avisan, no sancionan).
4. Comentario desactualizado en `packages/shared/src/entities/vuelta.ts:105-108`.

**No (fuera de hoy):** bloqueo de COMENZAR RUTA, cartel "Dirigite a SR" en la app (necesita OTA), contar la llegada a
la fila como paso por la terminal, reprocesar vueltas viejas.

## Pasos y horario

| Hora | Paso | Quién |
|---|---|---|
| 11:00 | Volcar este plan a `docs/plan-ancla-vuelta-terminal.md`, puntero en el handoff, rama `fix/ancla-vuelta-terminal` | chairman |
| 11:05–12:30 | Implementar 1–4, con tests | 1 subagente Sonnet |
| 12:30–13:00 | Revisar el diff + `/code-review` + `/ponytail-review` + `/codex-debug verify-fix` (si no hay cuota: "no verificado"); fixes con un Sonnet nuevo | chairman + Sonnet |
| 13:00–13:30 | PR → CI y acceptance en verde → merge → deploy r23 de API y worker | chairman (deploy con ok del CTO) |
| 13:30–14:00 | Verificar en prod + prueba en la calle | chairman + CTO |
| 14:00 | Go/no-go | CTO |

## Tests (los escribe el Sonnet)

En `vueltas.test.ts` (`describe` de `:328`, "primera vuelta y recorrido en curso"), con `anclaEnTerminal = true`:
- `inicio` lejos, después `retorno` y después `terminal`: no hay vuelta `completa`; la vuelta 1 abre en el `terminal`.
- `inicio` y luego `terminal` (arranca en SR): la vuelta 1 abre en el `terminal`.
- Vuelta normal después del anclaje (`terminal`, `retorno`, `terminal`): `completa`, y abre la 2.
- `inicio` con vuelta en curso con retorno: la cierra `abierta_al_cierre` y no abre otra hasta el `terminal`.
- `anclaEnTerminal = false`: los casos de hoy siguen igual (los 70 tests existentes pasan sin cambios, o se
  parametrizan).

En `deteccion-infracciones`: un PC pasado antes de la terminal no genera `pc_omitido`.

Ajustar `vueltas.integration.test.ts` si algún caso asume que el `inicio` abre la vuelta en una ruta con terminal.

## Verificación

- Local: `tsc` en api y shared, `vitest` de `ingesta-worker` (unitarios + integración con Postgres en docker, como el
  E2E del 21/10).
- Prod, después del deploy: health ok, worker en `api:r23-…`, sin errores nuevos en Sentry ni en los logs.
- En la calle (CTO): tocar COMENZAR RUTA lejos de SR y llegar. En `/en-vivo` no debe aparecer vuelta antes de SR, y
  sí aparece la vuelta 1 al pasar por SR.

## Rollback

API a `quivo-api-00028-tzs` (r22) y worker a `api:r22-20261021`. No hay migración, así que el rollback es inmediato.
Las vueltas que se hayan abierto con r23 quedan válidas para r22.

## Riesgos

- Si el GPS no detecta SR, la vuelta no abre hasta el próximo paso por SR: se pierde esa vuelta. Hoy se cuenta una
  falsa; con esto se puede perder una real. Se prefiere esta falla porque la vuelta es SR→SR (regla inamovible).
- Los 4 trufis que salen del centro: su primer tramo hasta SR ya no cuenta. Es lo correcto por la misma regla.
- No verificado: que el primer fix dentro de SR, al arrancar parado ahí, emita el cumplimiento `terminal` (histéresis
  de `apps/mobile/src/gps/geofence.ts`). El Sonnet lo confirma leyendo `geofence.test.ts` antes de implementar.

## Avance — 21/10, 11:15

- **Hecho por el primer Sonnet:** puntos 1, 2 y 4, con 9 unitarios nuevos (79/79). Agregó algo que el plan no listaba: con el ancla, un `terminal` con el recorrido en curso abre la vuelta N+1 aunque la anterior ya esté terminada. Sin eso, después de `fin` + `inicio` nunca se volvía a abrir una vuelta.
- **Punto 3 (`pc_omitido`) fuera de este PR**, por la regla de corte. Acotar la ventana al primer `terminal` deja afuera el paso por SR de quien espera más de 2 min en la fila antes de COMENZAR RUTA (la ventana arranca en `inicio − 120 s`). Eso da falsos negativos en recorridos normales. Siguen apareciendo `pc_omitido` falsos por los PC del camino a SR; son solo avisos.
- **Revisión del chairman, dos hallazgos que se mandaron a corregir a un Sonnet nuevo:**
  1. **FIN → COMENZAR RUTA parado en SR**: la app no vuelve a emitir el paso por SR. El estado del geofence no se resetea (`use-gps-operativo.ts:279`, `geofence.ts:476-483`). Con el ancla, esa vuelta se perdería entera.
     - **Fix:** un `inicio_recorrido` con un fix GPS dentro del radio de la terminal (fix más cercano en ±120 s) abre la vuelta como antes. Uno lejos de SR espera el cumplimiento `terminal`.
  2. **Integración 310/311**: un `fin` huérfano hacía que `recorridoEnCursoAntesDe` devolviera `true`, y la terminal abría una vuelta con el recorrido ya terminado.
     - **Fix:** con la última vuelta terminada, el recorrido está en curso solo si hubo un `inicio` posterior a su `finTs`.
- **Dato confirmado leyendo el código del móvil:** no se emiten cumplimientos antes del primer COMENZAR RUTA, porque el GPS arranca recién ahí (`use-gps-operativo.ts:1477-1488`).
- **Integración local:** Postgres de docker, DB nueva `quivo_control_ancla`. La DB `quivo_control_e2echeck` tiene una migración fallida de antes; quedó sin tocar.
- **Fixes de la review (11:08)**, después de `/code-review` y `/ponytail-review`, hechos por un Sonnet nuevo:
  - `>=` en el chequeo del recorrido en curso cuando la vuelta previa está terminada. Con `>`, si un `inicio` lejano cierra la vuelta con `finTs` igual al `ts` de ese inicio, la vuelta siguiente no abre.
  - La posición del `inicio` es el primer fix en `[inicio, +120 s]`; si no hay, el último fix `<= inicio`. Así se cubre la carrera en la que el `inicio` llega antes que sus fixes.
  - Sin consulta cuando la sesión está cerrada.
- **Descartados o anotados:**
  - Una vuelta cerrada por un `inicio` lejano queda `abierta_al_cierre` si el paso por SR cae fuera de la tolerancia. Ya pasaba antes del cambio.
  - Un `inicio` offline tardío, entre el `fin` y la terminal, se ignora.
  - Queda para después quitar el modo sin ancla, que no se usa en prod.
  - `vuelta-actual` devuelve `null` hasta pasar por SR, igual que antes de la primera vuelta.
- **Verificación local:** vitest de `ingesta-worker` 318/318 (unitarios + integración con Postgres), `tsc` limpio en api y shared, eslint limpio.
  - Codex `verify-fix`: **no verificado (sin cuota hasta el 16/11)**.
  - No se comprobó que los 2 tests de integración nuevos fallen sin su fix.
- **Riesgo conocido:** FIN en SR, el chofer se va sin GPS y toca COMENZAR RUTA lejos antes de que llegue un fix nuevo. Ahí la vuelta abre lejos (falso positivo). Es menos probable que el caso que corrige.
