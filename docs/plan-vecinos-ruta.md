# Plan: vecinos de ruta estables (delante/detrás) — L16

## Context
3115SRI reporta (6/11, 11:05–11:20 BOT) que "delante" cambia de trufi muchas veces. Replay de prod: correcto hasta 15:04Z; desde ahí 2–3 trufis parados en la fila de la terminal (prog ≈ 0, fase `ida`, `recorridoEstado = en_curso`) cuentan como "delante", y el desempate por fix más reciente los alterna (7 cambios en 35 min). Además aparecen vecinos con fix de 4–7 min (umbral 10 min).

Decisiones CTO (6/11): excluir a los que están en la fila; umbral de frescura 5 min; solo contar a los de mi sentido (doble vía).

Sentido de circulación: ya lo resuelve la fase. `progresoEnCircuito` (`packages/shared/src/circuito.ts:187`) proyecta a cada trufi en el ramal de su fase (ida o regreso), así que uno que viene en contrario por la misma calle queda ~15 km lejos en el circuito, no a 200 m. Hueco: si la fase es `null` (`:194`) se proyecta sobre la geometría entera y en una calle compartida puede caer en el ramal equivocado.

## Cambios (solo API + shared; sin APK ni OTA)
1. `apps/api/src/modules/tracking/vecinos-ruta.service.ts`, SQL de candidatos (~:249-270):
   - `AND NOT EXISTS (SELECT 1 FROM fila_salida f WHERE f."sesionId" = so.id AND f."sindicatoId" = so."sindicatoId" AND f.estado = 'en_fila')`. Patrón de `ingesta-worker/fila-backstop.ts:59-61`. Quien salió (`salio`) sigue contando.
   - Excluir candidatos con fase `null` cuando la ruta está partida (ida/regreso). Reaparecen con su primer cumplimiento o vuelta.
2. `packages/shared/src/sync/vecinos-ruta.ts`: `UMBRAL_VECINO_FRESCO_MS` de 10 a 5 min.
3. `apps/api/src/modules/tracking/vecinos-ruta.util.ts` `seleccionarVecinos`: empate por `sesionId`, no por fix más reciente (determinista).

## Tests
- Unit `vecinos-ruta.util.test.ts`: el empate es estable aunque cambie `ultimoFixTs` (se reemplaza el caso `:133-144`).
- Integración `vecinos-ruta.service.test.ts` (ampliar `crearSesion` con fila):
  - `en_fila` excluido; `salio` incluido.
  - fase `null` excluida en la ruta partida.
  - fix de 6 min excluido; 4 min incluido.
  - doble vía: uno de fase `regreso` en el mismo punto que yo (`ida`) no sale a 0 m.
- Replay de regresión (scratchpad `vecinos-serie.mjs` + intervalos de `fila_salida` de prod, SQL de solo lectura), 3115SRI 14:55–15:30Z: los cambios de "delante" bajan de 7 a solo los adelantamientos reales.

## Cierre
- Sonnet implementa. Gates: `/code-review` + `/ponytail-review` + `/codex-debug verify-fix` (sin cuota: "no verificado").
- PR, `ci` y `acceptance` en verde, merge, deploy API.
- Verificación en prod: replay con los datos del día siguiente al deploy.
- Handoff y `docs/plan-vecinos-ruta.md`.

## Riesgos
- Un trufi que entra a la terminal y no queda registrado en la fila (sin señal) sigue contando, igual que hoy.
- Fase `null` excluida: un trufi que entra a mitad de ruta no aparece hasta su primer PC.
- La fase sale de que el worker registre el PC de retorno (Honduras). Si lo pierde, el trufi queda proyectado en el ramal equivocado (deuda conocida, `vecinos-ruta.service.ts:91`).
