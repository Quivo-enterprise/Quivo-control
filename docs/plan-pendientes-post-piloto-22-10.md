# Plan — pendientes post-piloto (ítems 5, 6, 7, 9) — 2026-10-22

Sigue a `docs/plan-post-piloto-21-10.md`. Objetivo: cerrar los pendientes antes del piloto del sábado 25/10.

## Hallazgos de la exploración (22/10)

- **Ítem 5, variante en el mapa:**
  - La app **ya dibuja** el tramo designado: `DesignacionMapa`, `apps/mobile/src/features/mapa/route-map.tsx:741-781`. Lo muestra en ámbar con la "M" en el punto de espera, solo con `fase !== 'ida'`, a propósito.
  - Falta la **web /en-vivo**. `construirRutas` (`apps/web/app/(dashboard)/en-vivo/map-builders.ts:8`) no dibuja `contexto.variantes`, aunque `posicionSeleccionada.vuelta.varianteId` ya llega en el poll.
- **Ítem 6, fase de vecinos sin vuelta:**
  - `FASE_LATERAL` (`apps/api/src/modules/tracking/vecinos-ruta.service.ts:92-100`) solo mira la vuelta `en_curso`. Sin vuelta, la fase es `null` y el vehículo se proyecta en toda la polilínea, así que cae en la mitad equivocada.
- **Ítem 9, terminal no re-detectado (PIL, 21/10):**
  - Emitió todos los PC hasta las 21:07Z, así que la geocerca estaba viva y el terminal re-armado.
  - Entró al radio del terminal a las 21:15:32Z, a 77 m, y hubo un hueco de GPS de 78 s, de 21:15:59 a 21:17:17.
  - Después quedó estacionado a 48 m sin emitir.
  - Causa más consistente: la re-siembra del contexto, sea el foreground `sembrarCumplimientos` o el headless, que corre `clavesCumplimientoDesdePayloads` (`apps/mobile/src/gps/location-task.ts:419-481`). Esa función siembra `dentro:true` a todo PC con una emisión previa, y como la visita en curso todavía no estaba confirmada, el terminal queda trabado hasta alejarse 225 m.
- **Ítem 7, margen de "demorado":** hoy es `demorado: i === 0 && ahoraMs > etaMs` (`packages/shared/src/fila-salida.ts:165`).

## Entregas

| PR | Rama | Ítem | Contenido |
|---|---|---|---|
| D | `feat/en-vivo-variante` | 5 | Web: `construirRutas` recibe el `varianteId` de la vuelta seleccionada y suma la geometría de la variante como `MapRoute` superpuesta, de color distinto, sólida y `sinOffset`. Más un test en map-builders. |
| E | `fix/vecinos-fase-sin-vuelta` | 6 | API: si no hay vuelta en curso, la fase sale del último `cumplimientos_pc` cumplido de la sesión (regla abajo). Más tests de integración en `vecinos-ruta.service.test.ts`. |
| F | `fix/app-terminal-resiembra` | 9 + seguimiento del #232 | App: la siembra no marca `dentro:true` a un PC si después de su última emisión hubo otra de un PC a más de 1,5 × su radio. También: no reportar a Sentry los errores de red del refresco del paquete. |
| G | `fix/fila-margen-demorado` | 7 | Shared: `demorado` solo pasa `MARGEN_DEMORADO_MS` (2 min) después de la ETA. |

**Regla de fase del ítem 6** (decisión del chairman): se toma el último cumplimiento `cumplido=true` de la sesión.
- Si su PC es `terminal`, la fase es `ida`.
- Si el `orden` de su PC es mayor o igual que el `orden` del PC `retorno` activo de la ruta, la fase es `regreso`; si no, `ida`.
- Si no hay cumplimientos ni retorno, queda `null` como hoy.

**Regla de siembra del ítem 9:** si después de la última emisión de un PC hay emisiones de otros PC a más de 1,5 × su radio, el vehículo ya salió.
- En ese caso se siembra `dentro:false`, re-armado, conservando `pasadas` y `ultimoEmitidoMs` (`PASADA_MIN_MS` sigue protegiendo).
- Si no hay coordenadas para comparar, se mantiene `dentro:true`, el comportamiento de hoy.
- Esto evita las pasadas fantasma del fix descartado el 21/10, que ponía `dentro:false` al terminal siempre.
- Además se verifica que `combinarConVisitasPendientes` conserve una visita en curso sin confirmar.

## Diferido

- Alinear el plan de `cargar-linea-16.ts` con los PC reales de prod (retorno=8, espera=15, PC16). Solo hace falta antes de volver a correr `--apply` y exige un dry-run contra prod, así que no bloquea al sábado.

## Verificación

- `tsc` en web, api, mobile y shared.
- Tests: vitest de web (map-builders), integración de vecinos con Postgres en docker, vitest de mobile (location-task y geofence, con el caso PIL: siembra tras la vuelta completa y emisión estando estacionado), tests de shared de fila-salida.
- Gate: `/code-review` y `/ponytail-review`. `/codex-debug verify-fix` en los `fix:`, o "no verificado" si no hay cuota.
- Merge con ci y acceptance en verde.

## Despliegue

- API y worker r26 (PR E y la parte de shared del PR G).
- Web (PR D y PR G).
- OTA (PR F y PR G), con el bundle verificado mediante `publicar-ota.sh`.
- Todo sin sesiones activas en L16 y con el OK del CTO.
- Rollback: API `quivo-api-00032-w5h` / worker `api:r25-20261021`; OTA, el grupo `ec674f05-3871-4be3-b989-cd3f07b264cd`.
