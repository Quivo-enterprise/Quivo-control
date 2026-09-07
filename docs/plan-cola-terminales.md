# Plan (SIN IMPLEMENTAR) — punto de control maestro y cola de salida en terminales

> **Estado: propuesta, no implementada.** Documento entregado por Jairo el 2026-09-07.
> Verificado contra la rama `integracion/redesign-jairo`: cero ocurrencias de `TurnoTerminal`,
> `turnos_terminal`, `tiempoEsperaMinMin` ni de los módulos `terminales/` en API o web. No forma
> parte del PR #51 ni de ningún trabajo en curso.
>
> **Decisión del CTO (2026-09-07): aparcado.** La prioridad es dejar funcional lo que Jairo ya
> implementó (el rediseño). Esta funcionalidad va después, en su propia rama y su propio PR.
>
> ## Defecto ya detectado, pendiente de arreglar antes de implementar
>
> **El despacho automático nunca dispararía.** La fórmula propuesta es
> `ETA = GREATEST(llegadaTs_del_primero, now()) + posición × tiempoEspera`, y el worker despacha
> "toda fila cuya ETA calculada ya pasó". Con `now()` dentro del `GREATEST`, la ETA de cualquier
> posición ≥ 1 es siempre `now() + algo`: futura por construcción, y se corre hacia adelante a la
> misma velocidad que el reloj. Ninguna fila vence jamás y la cola solo se vacía a mano. El ancla
> tiene que ser fija — la última salida real registrada en ese punto, o la llegada del primero —
> nunca el reloj.
>
> La auditoría completa del plan contra el código real quedó sin correr (se cortó por decisión de
> prioridad). Antes de implementar hace falta verificar, como mínimo: si el worker de ingesta GPS
> corre con contexto de tenant (`app.sindicato_id`) para que el insert no choque con RLS; si el
> chequeo de idempotencia propuesto aguanta concurrencia o necesita un índice único parcial; y la
> incoherencia entre el alcance declarado (solo paradas `origen`/`destino`) y la marca `maestro`,
> que va sobre `PuntoControl`, otra entidad.

---

# Punto de control maestro — cola de salida en terminales

## Contexto

El usuario quiere una funcionalidad nueva para las cabeceras/terminales de línea (paradas de
tipo `origen`/`destino`): un "punto de control maestro" que, cuando un vehículo llega, lo
registra solo en una fila de salida. El conductor ve la placa del vehículo que tiene adelante
y una hora aproximada de salida; un operador puede adelantarle la salida a mano desde el panel.
Sirve además de auditoría: confirma que un vehículo llegó de verdad hasta el final de la ruta.

Confirmado por exploración exhaustiva (schema, API, docs): **no existe nada de esto hoy**. Los
puntos de control actuales (`PuntoControl`) son círculos simples con un único evento de cruce
(`CumplimientoPc`), sin ningún concepto de cola, orden de llegada entre vehículos, ni llegada/
salida como par.

Decisiones ya acordadas con el usuario:
- **Salida**: automática (hora estimada calculada) + override manual de un operador.
- **Alcance**: solo paradas cabecera/terminal (`Parada.tipo` en `origen`/`destino`), no
  cualquier punto de control.
- **Geometría**: círculo más grande (mismo `radioToleranciaM` que ya existe), no polígono —
  para reutilizar el 100% de la detección GPS y del editor de mapa ya construidos.

## Diseño

### Por qué extender `PuntoControl` en vez de crear una entidad paralela

`PuntoControl` ya tiene: geometría circular, el `ST_DWithin` de detección server-side
(`ingesta-worker.service.ts:procesarCumplimientoEnTx`, líneas ~347-430), el CRUD completo
(`control-points.service.ts`) y el editor de mapa en `apps/web/app/(dashboard)/rutas/`. Marcar
un punto existente como `tipo: 'maestro'` (en vez de inventar una tabla de geometría paralela)
reutiliza todo eso sin tocar la detección GPS. La "llegada a la fila" se deriva del mismo
`CumplimientoPc` que ya se crea hoy — no hace falta un evento nuevo del lado móvil ni tocar el
outbox.

### Modelo de datos (`packages/db/prisma/schema.prisma` + migración nueva)

```prisma
model PuntoControl {
  // ...campos existentes sin cambios...
  tipo               String  @default("ordinario") // 'ordinario' | 'maestro' — validado en Zod
  tiempoEsperaMinMin  Int?                          // minutos de espera usados para la ETA; solo aplica si tipo='maestro'
}

model TurnoTerminal {
  id            String    @id @default(uuid())
  sindicatoId   String
  sindicato     Sindicato @relation(fields: [sindicatoId], references: [id], onDelete: Restrict)
  puntoControlId String                              // polimórfico, sin FK — mismo patrón que CumplimientoPc.puntoControlId
  sesionId      String
  sesion        SesionOperativa @relation(fields: [sesionId], references: [id], onDelete: Cascade)
  vehiculoId    String
  vehiculo      Vehiculo  @relation(fields: [vehiculoId], references: [id], onDelete: Restrict)
  llegadaTs     DateTime  @default(now())
  salidaTs      DateTime?
  origenSalida  String?                              // 'automatico' | 'manual'
  estado        String    @default("en_cola")        // 'en_cola' | 'salio'
  createdAt     DateTime  @default(now())

  @@index([sindicatoId])
  @@index([puntoControlId, estado, llegadaTs])
  @@index([sesionId])
  @@map("turnos_terminal")
}
```

RLS igual que las 15 tablas existentes (policy `tenant_isolation` sobre `sindicatoId`, ver
`20260730152500_rls_multi_tenant`). **Sin columna `posicion`**: se calcula al leer con
`ROW_NUMBER() OVER (PARTITION BY puntoControlId ORDER BY llegadaTs)` — evita reescribir todas
las filas cada vez que alguien sale, mismo estilo de SQL crudo con window functions que ya usa
`en-vivo.service.ts`.

**Idempotencia de la llegada**: antes de insertar, chequear que no exista ya una fila
`estado='en_cola'` para ese `(sesionId, puntoControlId)` — cubre reintentos del outbox y
reenganches del geofence (que ya tiene su propio piso de 2 min, `geofence.ts:PASADA_MIN_MS`).

**Fórmula de ETA (v1, ajustable)**: `horaSalidaEstimada = GREATEST(llegadaTs_del_primero, now())
+ (posición_en_cola * tiempoEsperaMinMin)`. Se calcula al leer, no se guarda — así un cambio en
`tiempoEsperaMinMin` o una salida manual recalculan la fila entera sin migración de datos.

**Auditoría de "llegó hasta el final"**: no hace falta campo nuevo — el solo hecho de que exista
una fila de `TurnoTerminal` para `(sesionId, puntoControlId)` de un punto maestro en la cabecera
de destino ya es la prueba.

### Backend (`apps/api/src/modules/`)

1. **Migración**: agrega `tipo`/`tiempoEsperaMinMin` a `puntos_control`, crea `turnos_terminal`
   con RLS (seguir el patrón exacto de `20260817130000_particion_gps_points_idempotente` para
   los bloques `DO $$ ... IF NOT EXISTS`, aunque acá no hay particiones).
2. **`packages/shared/src/entities/punto-control.ts`**: agregar `tipo`/`tiempoEsperaMinMin` al
   schema base + `Crear`/`Actualizar`.
3. **`packages/shared/src/entities/turno-terminal.ts`** (nuevo): `TurnoTerminalSchema` +
   un schema derivado tipo `EstadoColaTerminalSchema` (mismo criterio que `FrescuraEnVivoSchema`
   en `entities/en-vivo.ts`: calculado en servidor, nunca en cliente) con `miTurno` (posición,
   placa, ETA), `adelante` (placa o null) y la cola completa para la vista web.
4. **`ingesta-worker.service.ts`**: dentro de `procesarCumplimientoEnTx`, la query de geofence ya
   hace `JOIN` contra `puntos_control` — se agrega `tipo` al `SELECT`. Si `tipo='maestro'` y
   `cumplido=true` y no hay fila `en_cola` previa para esa sesión+punto, insertar `TurnoTerminal`.
5. **Módulo nuevo `apps/api/src/modules/terminales/`** (module+controller+service+processor+test,
   convención exacta de `control-points/`):
   - `GET /v1/terminales/puntos-control/:puntoControlId/cola` — cola completa (panel web).
   - `GET /v1/mobile/terminales/:puntoControlId/mi-turno` — mi posición/ETA/placa de adelante
     (bajo el guard de auth móvil existente, para el polling del conductor).
   - `POST /v1/terminales/puntos-control/:puntoControlId/cola/:turnoId/despachar` — override
     manual del operador (`Roles: admin_quivo, admin_sindicato, operador`), marca
     `salidaTs=now()`, `estado='salio'`, `origenSalida='manual'`. Con `@Auditable('turno_terminal')`.
   - **`DespachoTerminalProcessor`**: Queue+Worker en la misma clase (patrón exacto de
     `rotaciones/vencimiento.processor.ts`), `upsertJobScheduler` cada 1-2 min, marca como
     `salio`/`automatico` toda fila `en_cola` cuya ETA calculada ya pasó.

### Panel web (`apps/web/app/(dashboard)/`)

1. **`rutas/`**: en el formulario de "agregar/editar punto de control" (dentro de
   `use-rutas-data.ts` + el `Card` de modo `agregar-punto-control` en `page.tsx`), agregar un
   checkbox "Es una terminal (punto maestro)" + input de minutos de espera cuando está marcado.
   Cambio aditivo sobre lo que ya armamos hoy, sin nuevo hook.
2. **Página nueva `apps/web/app/(dashboard)/terminales/page.tsx`**: lista, por punto maestro, la
   cola en vivo (placa, hora de llegada, ETA, botón "Despachar ahora"), con polling ~10-15s
   (mismo patrón que `use-en-vivo.ts`). Va aparte de `en-vivo/` porque esa pantalla es por-sesión
   (un vehículo a la vez) y esta es por-punto-de-control (varios vehículos agregados) — mismo
   criterio de encapsulación que ya establecimos: `use-terminales.ts` (hook de datos/polling) +
   `page.tsx` de composición. Agregar la entrada en `src/lib/nav-items.ts`.

### App móvil (`apps/mobile/src`)

1. **`use-mi-turno-terminal.ts`** (nuevo, en `features/operacion/`): polling cada ~15s (mismo
   intervalo que `use-sync-status.ts:REFRESCO_MS`), activo solo mientras el conductor tiene un
   turno `en_cola` en un punto maestro.
2. **`next-control-sheet.tsx`**: nueva tarjeta ("En fila · posición N · adelante: placa XYZ ·
   salida aprox. HH:MM"), mismo patrón visual que la tarjeta `readyCard` existente.
3. Opcional: reusar el patrón de `control-feedback-toast.tsx` (toast + vibración) para el
   momento en que el servidor confirma que el conductor entró a la fila.

## Verificación

- `packages/db`: `prisma migrate dev` aplica limpio; extender
  `rls.integration.test.ts` con el caso cross-tenant de `turnos_terminal`.
- `apps/api`: nuevo `terminales.service.test.ts` (vitest contra DB real, dos tenants, mismo
  criterio que `control-points.service.test.ts`); extender `ingesta-worker` tests para el caso
  "cumplimiento en punto maestro crea turno".
- `pnpm typecheck && pnpm build && pnpm lint && pnpm test` en la raíz, en verde.
- Smoke manual: marcar un punto de control como maestro en `/rutas`, simular un
  `cumplimiento_punto_control` vía `POST /v1/sync/batches` (como ya hacen los tests existentes)
  y confirmar que aparece en `/terminales` con ETA calculada; probar "Despachar ahora".
- `pnpm --filter @quivo/mobile typecheck`.

## Orden de entrega sugerido

1. Schema + migración + `ingesta-worker` (backend puro, testeable sin UI).
2. Módulo `terminales/` (API) + tests.
3. Panel web (`rutas/` checkbox + página `terminales/`).
4. App móvil (sheet + polling).
