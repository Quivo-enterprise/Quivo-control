# Plan — Designación a Molinos en cualquier momento del viaje (línea 16)

## Contexto
Regla nueva del CTO (2026-10-17): el control (`operador`) y el encargado pueden designar un móvil a
Molinos **en cualquier momento del viaje**, mientras ese móvil **no haya hecho todavía su pasada por
Molinos hoy**.
Decisiones del CTO:
- "Ya fue una vez" se cuenta **por día** (Bolivia).
- Si se lo designa **después** de pasar la bifurcación (v43) en el regreso, la designación **vale para la
  próxima vuelta**.

**Lo que ya existe** (mapeo con Explore): la API, el worker y la web ya permiten designar en cualquier
momento de la vuelta en curso. No miran fase, posición ni Honduras (`vueltas.service.ts:60-163`,
`vuelta.ts:113-117` de la web).

**Lo que falta:**
1. El tope por día: hoy solo se bloquea dentro de la misma vuelta; lo diario es un aviso ("igual podés
   enviarlo de nuevo").
2. La designación tardía: hoy se acepta en la vuelta en curso y termina en un `molinos_omitido` grave
   falso.
3. `molinosHoy` y `sinMolinosHoy` cuentan vueltas **designadas**, no vueltas que **llegaron** a Molinos.

**Mobile: sin cambios, no hace falta OTA.** La designación copiada a la vuelta nueva llega por
`/mobile/vuelta-actual` como cualquier otra. El aviso y el acuse no miran la fase. El texto "Después de
Honduras subí por Putucu" sigue siendo correcto, porque la subida está en el regreso.

## Cambios

### 0. Persistir el plan (regla 8)
Copiar este plan a `docs/plan-molinos-cualquier-momento.md` y poner el puntero en `docs/handoff.md`.

### 1. DB — migración Prisma (`packages/db`)
Agregar a `vueltas` tres columnas nullable:
- `molinosProximaVarianteId` (uuid, FK a `variantes`);
- `molinosProximaPor`;
- `molinosProximaEn`.

Son la designación diferida, guardada en la vuelta en curso.

### 2. API — `apps/api/src/modules/vueltas/vueltas.service.ts` (`designar`)
Dentro del mismo lock de asesoría y del mismo orden de chequeos actual:

**a. Tope por día.** Si `varianteId != null` y existe una vuelta del mismo `vehiculoId` con
`fecha = fecha de la vuelta en curso` y `esperaLlegadaTs IS NOT NULL` (que no sea la actual), responder
409 `MSG_YA_FUE_HOY` ("Ya fue a Molinos hoy."). Cancelar con `null` sigue permitido.

**b. Tardía.** La vuelta es tardía si `pasoRetornoTs != null` y existe un cumplimiento `cumplido` de la
sesión con `ts >= pasoRetornoTs` sobre un PC de la ruta con `orden >= ordenBifurcacion`.
- `ordenBifurcacion` es el `orden` del PC activo, `rol IS NULL` y `orden > retorno.orden` más cercano a
  `ST_StartPoint(variante.geometria)`. En la L16 es "Control km 26", a unos 50 m del v43.
- Es una sola consulta SQL. Sale de los datos, sin ids ni órdenes hardcodeados.
- Restringir a `ts >= pasoRetornoTs` evita contar el paso por la ida (km 4 queda a ~185 m).

**c. Si es tardía,** guardar la designación en `molinosProxima*` de la vuelta en curso, sin tocar
`varianteId`, y responder `{ aplica: 'proxima_vuelta' }`. Si no es tardía, el flujo actual, que responde
`{ aplica: 'vuelta_actual' }`.
- Ajustar el tipo de respuesta del PUT en `packages/shared/src/entities/vuelta.ts`.
- **Antes, leer qué devuelve hoy el PUT, para no romper el cliente web.**

**d. Cancelar (`null`)** limpia la designación actual (con las reglas actuales) **y también**
`molinosProxima*`.

**e. Semántica de "ya fue".** `molinosHoy` (`en-vivo.service.ts:503-508`) y `sinMolinosHoy`
(`vueltas.service.ts:293-298`) pasan a contar `esperaLlegadaTs IS NOT NULL` en lugar de
`varianteId IS NOT NULL`. `VueltaPosicionSchema` suma `molinosProxima: boolean`, que vale `true` si la
vuelta en curso tiene `molinosProximaVarianteId`.

### 3. Worker — `apps/api/src/modules/ingesta-worker/deteccion-vueltas.ts`
Al hacer `tx.vuelta.create` de una vuelta nueva (`:368+`):
- Si la vuelta anterior de la sesión (`numero - 1`) tiene `molinosProximaVarianteId`, la vuelta nueva se
  crea con `varianteId`, `designadaPor` y `designadaEn` copiados, y `acuseEn = null`.
- Hay que agregar las columnas `molinosProxima*` a los SELECT de `:202` y `:276`.
- La máquina pura `vueltas.ts` no cambia. El lote siguiente relee la fila con `puntoEsperaId`, como
  ya ocurre con cualquier designación. Molinos queda unos 26 km después de abrir la vuelta, así que no
  hay carrera dentro del mismo lote.
- Si la sesión se cierra sin abrir otra vuelta, la designación diferida se pierde. Es aceptable: era del
  día y del recorrido.

### 4. Web — `apps/web`
- **`src/lib/en-vivo/vuelta.ts`, `motivoBloqueo`:** recibe también `molinosHoy`. Si fue hoy y la
  vuelta actual no está designada, muestra "Ya fue a Molinos hoy."
- **`esSugerido`:** no cambia, pero `molinosHoy` pasa a significar "llegó hoy". El móvil que fue
  designado y omitió vuelve a ser candidato, que es lo que pide la regla.
- **`app/(dashboard)/en-vivo/panel-vuelta.tsx`:**
  - quitar "igual podés enviarlo de nuevo" (`:190-192`);
  - con `molinosProxima`, mostrar "Va a Molinos en la próxima vuelta" con la opción de cancelar;
  - el optimista de `useDesignarVuelta` (`src/lib/en-vivo/use-en-vivo.ts:322`) usa
    `aplica: 'proxima_vuelta'` para marcar `molinosProxima` en lugar de `varianteId`.
- **UI puntual sin bake-off (regla 7.c):** copiar el patrón del panel existente y pasar el gate
  `web-design-guidelines`.

### 5. Docs
- `docs/plan-molinos-designacion.md:58-72, 147-156`: el tope por día, la designación diferida y que se
  cierra la limitación de la designación tardía.
- `docs/plan-en-vivo-alertas.md:210-213`.
- `docs/handoff.md:472` ("en Honduras se manda…").

## Reparto
- Chairman Opus: este plan, la revisión y la verificación.
- Un Sonnet implementa los pasos 1 a 4 en un worktree.
- Los hallazgos de las revisiones los aplica un Sonnet nuevo.

## Verificación
- **Tests nuevos de API** (`ingesta-worker/vueltas.integration.test.ts`, patrón de `:346` y `:978`):
  - el móvil llega a Molinos en la vuelta 1 → designar en la vuelta 2 da 409 `MSG_YA_FUE_HOY`;
  - designado y omitido en la vuelta 1 → en la vuelta 2 se puede designar;
  - designar en la ida y antes de Honduras → aplica a la vuelta actual (ya cubierto, se mantiene);
  - designar tras cumplir km 26 en el regreso → `aplica: 'proxima_vuelta'`, la vuelta actual cierra en SR
    **sin** `molinos_omitido` y la vuelta nueva abre con `varianteId` y `acuseEn` null;
  - cancelar con `null` limpia la diferida;
  - `molinosHoy` y `sinMolinosHoy` cuentan llegadas.
- **Web:** tests de `vuelta.test.ts` para `motivoBloqueo` con `molinosHoy` y el estado `molinosProxima`.
- `pnpm -r typecheck`, los tests de api y web, y en CI `ci` + `acceptance` en pass.
- **Gates:** `/code-review` + `/ponytail-review` + `/security-review` (toca un endpoint, roles y un
  tenant) + `web-design-guidelines`. No es `fix:`, así que no corre `verify-fix`. Codex automático si
  hay cuota.
- **Deploy:** api + worker + web con `scripts/deploy-gcp.sh`, lo corre el CTO. Confirmar que el deploy
  aplica la migración. Después, `GET /reportes/en-vivo/posiciones` debe traer `molinosProxima`.
- **Prueba en la calle:** designar durante la ida; designar después de km 26 y ver que el aviso llega
  al arrancar la vuelta siguiente; intentar mandar a Molinos a un móvil que ya fue y ver el bloqueo.

## Riesgos y límites
- Si el GPS pierde la llegada a Molinos, ese móvil no cuenta como que fue y se lo puede volver a mandar.
- Si se pierde el cumplimiento de km 26 en el regreso, la tardía se detecta recién en km 28 (orden 16,
  unos 2 km después de la bifurcación). En ese tramo una designación todavía cae en la vuelta actual y
  termina en `molinos_omitido`. Es el mismo comportamiento de hoy, acotado.
