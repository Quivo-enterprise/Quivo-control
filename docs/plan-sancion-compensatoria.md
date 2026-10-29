# Plan — "Sancionar" = agendar sanción compensatoria (sin editar el hecho)

## Contexto
Hoy "Sancionar" en `/en-vivo` abre `NuevaSancionModal` prellenado: Regla, Tipo de sujeto, Sujeto,
Motivo, **Fecha del hecho** y **Referencia de evidencia** son editables, y la API
(`POST /infracciones/:id/sancionar`) **acepta del body** `motivo`, `fechaHecho`, `evidenciaRef` y
`reglaId`. Un delegado puede alterar el hecho y "solapar" al chofer. Además el botón no agenda
nada: no hay vueltas, turno, parada ni día de cumplimiento.

Objetivo (CTO 28/10):
- Desde una infracción, el hecho es **inmutable**: regla, sujeto, motivo, fecha del hecho y
  evidencia los fija el **servidor** a partir de la infracción. El cliente no puede mandarlos.
- "Sancionar" pide solo: **día de cumplimiento** (de mañana a hoy + 1 mes, Bolivia),
  **cantidad de vueltas**, **turno** (mañana / tarde / noche desde las 17:00) y
  **parada de salida** (Salomón Romero o Molinos).
- Sujeto = **conductor** de la infracción (cae al vehículo si no tiene conductor).

## Decisiones
- Rango: `mañana ≤ fechaCumplimiento ≤ hoy + 1 mes calendario` (Bolivia), validado en el servidor.
  Fuera de rango, 400. Sin fecha límite aparte (respuesta del CTO).
- Regla derivada en el servidor con la lógica actual de `reglaInicialSancion`
  (`apps/web/src/lib/en-vivo/alertas.ts:248`): `reglaId` de la infracción si está activa; si no,
  la activa del mismo `tipo`; desvío/Molinos caen a `desvio_ruta`. Sin regla, 409 "No hay regla
  activa para <tipo>". La función pasa a `packages/shared` y la usan API y web.
- `paradaSalida` = enum `salomon_romero | molinos` (`PuntoControl` no tiene nombre; SR = `rol
  terminal`, Molinos = `rol espera`). `shortcut: nombres fijos de la L16, migrar a FK a
  puntos_control cuando se cargue otra línea con terminales propias`.
- Vueltas 1..10 (entero).
- La sanción nace `pendiente`, como hoy (aplicar/anular sigue igual, auditado).
- `POST /sanciones` manual (`/reglas`) **no cambia**: los campos nuevos son opcionales ahí.
- `PATCH /sanciones/:id` → **409** si la sanción está vinculada a una infracción
  (`infracciones."sancionId" = id`). Cierra la otra vía de editar el motivo/evidencia.
- No se crea `Asignacion` ni se cuenta el cumplimiento de vueltas (no pedido; ver "Fuera").

## Pasos (implementa Sonnet; el chairman revisa)
1. **DB** — migración `packages/db/prisma/migrations/20261029100000_sancion_compensatoria/`:
   `ALTER TABLE sanciones ADD "fechaCumplimiento" date, "vueltas" int, "turno" text,
   "paradaSalida" text` + CHECKs: vueltas 1..10, turno in (manana,tarde,noche), paradaSalida in
   (salomon_romero,molinos), y todo-o-nada (los 4 NULL o los 4 NOT NULL). Actualizar el modelo
   `Sancion` en `packages/db/prisma/schema.prisma:668`. RLS: la tabla ya tiene `tenant_isolation`.
2. **Shared** (`packages/shared`):
   - `enums/`: `ParadaSalidaSchema`. Reusar `TurnoSchema` (`enums/turno.ts`).
   - `entities/infraccion.ts`: `SancionarInfraccionSchema` nuevo,
     `z.object({ fechaCumplimiento, vueltas, turno, paradaSalida }).strict()` (manda `motivo` o
     `fechaHecho` = 400).
   - `entities/sancion.ts`: `SancionSchema` (salida) suma los 4 campos `nullable`.
   - Mover `reglaInicialSancion`, `motivoSancion` (+ `etiquetaTipoInfraccion`/`detalleInfraccion`
     si son puros) a shared. La hora del motivo se formatea con `timeZone: 'America/La_Paz'`
     (el servidor corre en UTC).
   - Helper puro `rangoCumplimiento(hoyBolivia)` → `{min, max}` (mañana, hoy + 1 mes con clamp de
     fin de mes) usado por la API (validación) y por la web (`min`/`max` del input).
3. **API**:
   - `infracciones.service.ts:90 sancionar`: deriva `reglaId`, sujeto, `motivo`, `fechaHecho`
     (día Bolivia de `inicioTs`, helpers de `common/tiempo`) y `evidenciaRef`
     (`infraccion:<id> sesion:<sesionId>`); valida rango de `fechaCumplimiento`; mantiene el
     reclamo atómico de estado y la transacción única.
   - `sanciones.service.ts`: `crearEnTx` acepta los 4 campos opcionales (tipo interno, no
     `CrearSancion`); `actualizar` → 409 si hay infracción vinculada; `toSancion` los expone.
4. **Web**:
   - Modal nuevo en `apps/web/app/(dashboard)/en-vivo/` (o reemplazo de `ModalSancion` de
     `panel-vehiculo.tsx:815`): resumen **solo lectura** (regla, chofer + placa, fecha y hora del
     hecho, detalle) + Día de cumplimiento (date, `min`/`max` del helper), Vueltas (1..10), Turno
     (Mañana / Tarde / Noche — desde las 17:00), Parada de salida (Salomón Romero / Molinos).
     Botón "Sancionar".
   - `infraccionesApi.sancionar` (`apps/web/src/lib/api/infracciones.ts`) con el body nuevo.
   - `NuevaSancionModal` (`reglas/nueva-sancion-modal.tsx`): **borrar** las props de modo
     infracción que queden sin uso (`valoresIniciales`, `onSubmitOverride`, `sujetoTipos`,
     `sujetosPermitidos`, `sujetosEtiquetas`, `avisoRegla`, `evidenciaFija`).
   - `abrirSancion` (`panel-vehiculo.tsx:298`): dejar de pedir vehículos/conductores si ya no se
     usan.
   - Sanciones (`reglas/page.tsx`): mostrar "3 vueltas · Noche · desde Molinos · 05/11" bajo el
     motivo y en el Expediente cuando existan.
   - UI: feature puntual, camino único (regla 7.c): `impeccable` + estilos del proyecto.
5. **Docs**: copiar este plan a `docs/plan-sancion-compensatoria.md` + puntero en
   `docs/handoff.md` antes de tocar código (regla 8).

## Tests
- Shared: schema strict (rechaza `motivo`/`fechaHecho`), `rangoCumplimiento` (31/10 → 30/11,
  31/01 → 28/02), `reglaInicialSancion` movida (tests de `alertas.test.ts` migrados).
- API integración (`infracciones.controller.integration.test.ts`): body nuevo OK y sanción con
  regla/motivo/fecha derivados; body viejo 400; fecha hoy o > 1 mes, 400; sin regla, 409;
  `PATCH /sanciones/:id` de una vinculada, 409; manual sigue editable.
- Migración aplicada contra Postgres local + `rls.integration.test.ts` verde.

## Verificación
- `pnpm -r tsc`, tests de shared/api/web, lint.
- Playwright contra API local: `/en-vivo` → infracción → Sancionar: no hay campos de fecha del
  hecho / evidencia / motivo; elegir día/vueltas/turno/parada; la sanción aparece en `/reglas`
  con el resumen. Request con `motivo` en el body por curl → 400.
- Gates: `/code-review` + `/ponytail-review` + `/security-review` (endpoint + anti-alteración);
  `web-design-guidelines` sobre el modal. Codex: no verificado (sin cuota hasta 16/11).
- PR → CI (`ci` y `acceptance` en pass) → merge → handoff.

## Riesgo / timing
- Piloto **jueves 29/10 9:00**. Trae migración y cambia el contrato del endpoint (web y API deben
  desplegarse juntas). Recomendación: mergear, pero **deploy lo decide el CTO**, idealmente
  después del piloto.

## Fuera (no pedido)
- Crear la `Asignacion` compensatoria o avisar al chofer en la app (H19 abierto).
- Contar si las vueltas compensatorias se cumplieron y marcar incumplida automáticamente.
- Reprogramar el día de cumplimiento.
- Restringir `anular` (otra vía para que un delegado "solape": queda auditada, no se toca).
