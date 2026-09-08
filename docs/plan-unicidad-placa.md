# Plan — unicidad de placa de vehículo

> **Estado:** decidido 2026-09-08, sin implementar. Decisión de modelo de datos tomada con Opus,
> supuestos verificados por el chairman contra las bases locales.
> Cancela el "PENDIENTE 1" de `docs/handoff.md` (ambigüedad de placas duplicadas).

## El problema

`packages/db/prisma/schema.prisma`, modelo `Vehiculo`, tiene dos reglas incompatibles:

- `@@unique([sindicatoId, placa])` (`:183`) — "la placa es única POR SINDICATO", y además sobre la
  placa **cruda**: hoy `"123 ABC"` y `"123ABC"` conviven en el mismo sindicato.
- `placaNormalizada String? @unique` (`:159`) — "es única GLOBALMENTE".

Como `placaNormalizada` es nullable y en Postgres los NULL no colisionan en un índice único, la
regla global **no se aplica** a ninguna fila con NULL. La migración `20260801153000` puso NULL a
propósito en los duplicados históricos para poder crear el índice — resolvió el síntoma y dejó el
agujero.

De ahí salió la rama de fallback de `buscarVehiculosActivosPorPlaca`
(`apps/api/src/modules/auth-movil/auth-movil.service.ts`), que matchea también filas con
`placaNormalizada IS NULL` recomputando el regexp, puede devolver >1 fila, y hace que
`autenticarSesion` se quede con una arbitraria. Consecuencias: el conductor del vehículo perdedor
no puede loguearse nunca, y sus intentos fallidos acumulan lockout sobre el vehículo del **otro
sindicato**.

## Medición (2026-09-08, bases locales — no hay producción)

| Métrica | `quivo_control` | `quivo_control_e2echeck` |
|---|---|---|
| Placas normalizadas duplicadas entre activos | 0 | 0 |
| Colisiones bajo `estado <> 'inactivo'` | 0 | 0 |
| Vehículos activos | 69 | 11 |
| Activos con `placaNormalizada IS NULL` | 64 | 8 |

**Los 64 NULL son residuo del suite de tests**, no datos reales: sindicatos con UUID aleatorio,
creados vía Prisma directo sin pasar por `vehiculos.service`. Los únicos vehículos legítimos (seed,
16-ago) son 3 y los tres tienen `placaNormalizada`. O sea: **la suite de tests corre entera por la
rama de fallback**, validando un camino que va a dejar de existir.

**No existe base de producción**: el GCP anterior se descartó y el nuevo no está creado. Nunca va a
haber un momento más barato para cambiar esto.

## Decisión

**Unicidad global acotada a lo vigente, con columna generada por la base.**

Ninguna de las opciones evaluadas sirve tal cual:

- *Unicidad global dura* es correcta sobre la realidad física (RUAT emite placas únicas) pero rompe
  el dominio: si un vehículo migra de sindicato, el viejo no puede borrar su fila (`Asignacion`,
  `SesionOperativa`, `HistorialEstadoVehiculo` y `Sancion` la referencian, con `onDelete: Restrict`
  en `:155`) y el nuevo nunca podría registrarlo.
- *Unicidad sólo entre `activo`* deja entrar el doble registro como `pendiente` y explota recién al
  activar, que es el peor momento.
- *Unicidad sólo por sindicato* es inviable: el chofer tipea placa + PIN y nada más, no hay
  discriminante para elegir sindicato.

El predicado correcto es el más ancho que aún permite migración: **`estado <> 'inactivo'`**, porque
`inactivo` es el único estado que significa "ya no es mío" (`EstadoVehiculoSchema`,
`packages/shared/src/enums/estados.ts:8-15`).

### Esquema
- `placaNormalizada String` **NOT NULL**,
  `GENERATED ALWAYS AS (regexp_replace(upper(btrim(placa)),'[^A-Z0-9]','','g')) STORED`.
  Las tres funciones son IMMUTABLE, así que Postgres lo acepta.
- **Se va** el `@unique` global de `:159`.
- **Se va** `@@unique([sindicatoId, placa])` de `:183` (está sobre la placa cruda), reemplazado por
  `@@unique([sindicatoId, placaNormalizada])`.
- **Entra**, en SQL crudo porque Prisma no expresa índices parciales:
  `CREATE UNIQUE INDEX vehiculos_placa_norm_vigente_key ON vehiculos("placaNormalizada") WHERE estado <> 'inactivo'`.
  Precedente de índices sólo-SQL: `migrations/20260818163000_public_mobility_indexes/migration.sql:9-16`.
- **Entra** `@@index([placaNormalizada])` — el índice parcial no es confiable para el lookup del
  login, porque depende de que el planner pruebe `='activo' ⇒ <>'inactivo'`.
- **Entra** `CHECK ("placaNormalizada" ~ '^[A-Z0-9]{3,20}$')`: sanidad estructural, **no** el patrón
  PTA. El formato lo dicta RUAT y puede cambiar; esa validación se queda en `PlacaVehiculoSchema`.

### Migración
Postgres 16 no convierte una columna existente en generada, así que: `DROP COLUMN` (se lleva el
índice único viejo) + `ADD COLUMN ... GENERATED ALWAYS AS ... STORED`. **No hace falta backfill**,
la columna es derivada.

Antes de crear el índice parcial, un bloque `DO $$ ... RAISE EXCEPTION` que **aborte listando las
placas en conflicto**. Falla ruidosa a propósito: poner NULL en silencio fue exactamente el pecado
de `20260801153000` y es la razón de que este problema exista. Medido hoy: 0 colisiones.

Sin down migration (convención del repo, y no hay producción que revertir).

### Cerrar los caminos de escritura
La columna generada es lo único que no se puede evadir por `$queryRaw`, seed, script ni test. En
**Verificado con un spike ejecutado (2026-09-08, Postgres 16.4 + Prisma 7.9.1) — ya no es una
incógnita.** Postgres acepta la columna generada, el índice único parcial y el CHECK; las tres
funciones son IMMUTABLE. Pero la declaración de Prisma **hay que copiarla literal de
`prisma db pull`**, no escribirla a mano:

```prisma
generator client {
  previewFeatures = ["partialIndexes"]   // por el índice PARCIAL, no por la columna generada
}

placaNormalizada String @unique(map: "vehiculos_placa_norm_vigente_key", where: raw("(estado <> 'inactivo'::text)"))
  @default(dbgenerated("regexp_replace(upper(btrim(placa)), '[^A-Z0-9]'::text, ''::text, 'g'::text)"))
```

Sólo esa forma da `migrate diff` vacío en ambas direcciones. **Las variantes "obvias" producen
drift permanente que rompe al aplicarse:**

- `@default(dbgenerated())` sin argumento → valida y genera, pero `migrate diff` emite
  `ALTER COLUMN ... SET DEFAULT ...`, que contra una columna generada falla con
  `column ... is a generated column`.
- `String` sin default o `@ignore` → el diff emite `DROP DEFAULT`, que falla igual.
- `@default(dbgenerated(""))` ni siquiera valida.

**Procedimiento obligatorio:** `prisma migrate dev --create-only`, editar el SQL a mano, y correr
`prisma db pull` inmediatamente después para clavar la declaración correcta en el schema
versionado. No confiar en que alguien la escriba de memoria.

El fallback de trigger `BEFORE INSERT OR UPDATE` también se probó y funciona sin drift, pero da una
garantía **más débil**: escribir un valor explícito se acepta en silencio y se sobreescribe, así que
el cliente cree que escribió algo que no escribió; y si alguien dropea el trigger no hay ninguna
señal. Con la columna generada eso es estructuralmente imposible. Se descarta.

Hay que sacar las escrituras explícitas de `packages/db/prisma/seed.ts:178,191,1064` y
`scripts/crear-credencial-pasante.ts:417-423`.

## Consecuencia: el PENDIENTE 1 del handoff queda CANCELADO

Con `placaNormalizada` NOT NULL y unicidad garantizada entre no-inactivos,
`WHERE estado='activo' AND "placaNormalizada"=$1` devuelve **0 o 1 fila por construcción**.

- `buscarVehiculosActivosPorPlaca`: se borran la rama `placaNormalizada IS NULL`, el
  `regexp_replace` recomputado y el `ORDER BY ("placaNormalizada" IS NULL)`. Queda un `findFirst`;
  se puede tirar el `$queryRaw`.
- `autenticarSesion`: `candidatosVehiculo[0]` deja de ser una elección arbitraria y pasa a ser el
  único resultado posible.
- **Se cancelan por innecesarios**: iteración de candidatos, `estadoLockout`, presupuesto de nivel 2
  compartido, tope de 9 scrypt, `MAX_VEHICULOS_POR_PLACA` y el fixture de segundo sindicato con sus
  9 tests. El envenenamiento cruzado de lockout desaparece **en la base**, no en la app.
- `autenticarVehiculo` (legado) sigue funcionando: su chequeo de "exactamente-1" pasa a ser
  trivialmente cierto.

### Otros ajustes de código
- `vehiculos.service.ts`: se quitan las escrituras de `placaNormalizada` (`:109,119,163`) — la base
  las rechaza. `verificarPlaca` (`:66-103`) debe filtrar `estado: { not: 'inactivo' }`, y el mensaje
  de `asegurarPlacaDisponible` (`:330`) pasa a hablar de dar de baja. `validarRequisitosActivacion`
  (`:253`) pierde el chequeo `!row.placaNormalizada` (ya imposible) y `toVehiculo` (`:360`) pierde
  el `?? normalizarPlacaVehiculo(...)`.
- **Alinear `normalizarPlacaVehiculo`** (`packages/shared/src/entities/vehiculo.ts:263`, hoy borra
  sólo espacios y guiones) con `normalizarPlaca` (`auth-movil.service.ts:1084`, borra `[^A-Z0-9]`).
  La base usará la segunda; si no se alinean quedan tres definiciones de "normalizar" que sólo
  coinciden sobre input ya validado por Zod.

## Tests

Los ~14 archivos que hacen `tx.vehiculo.create` sin `placaNormalizada` **no rompen**: la columna
generada la rellena la base. Eso es lo bueno del diseño — hoy corren por la rama de fallback y
pasan a ejercitar el camino real sin tocarlos.

Rompen y hay que corregir los que escriben la columna a mano: `vehiculos.service.test.ts:204-217,238-250`.

Agregar:
1. Unicidad entre dos sindicatos con la misma placa en `pendiente`/`activo` → P2002.
2. Migración permitida: A pasa a `inactivo`, luego B crea la misma placa.
3. Reingreso al mismo sindicato bloqueado por `@@unique([sindicatoId, placaNormalizada])`.
4. `INSERT` crudo con `placaNormalizada` explícita → error de la base (prueba de que el camino está
   cerrado). **Ojo, corregido por el spike: eso NO da `P2002` sino `P2039`**, con el mensaje
   `cannot insert a non-DEFAULT value into column "placaNormalizada"` (SQLSTATE 428C9). `P2002` es
   sólo para la violación del índice único. Violar el CHECK también da `P2039`.
5. Guardia: verificar en `pg_indexes` que `vehiculos_placa_norm_vigente_key` existe, contra el
   riesgo de que un `prisma migrate dev` lo borre por no estar en el datamodel.

## Riesgos y lo que NO cubre

1. **Vehículo que se va sin darse de baja**: si el sindicato A no lo marca `inactivo`, B no puede
   registrarlo. Es el precio explícito de permitir migración sin permitir duplicados vigentes;
   necesita una vía de `admin_quivo`, no es falla del modelo.
2. **`verificarPlaca` filtra el nombre del sindicato ajeno** (`vehiculos.service.ts:79-102`, corre
   con `CONTEXTO_ADMIN` y saltea RLS). Ya pasa hoy. Es una fuga cross-tenant que conviene decidir a
   conciencia en vez de heredarla.
3. **`prisma migrate dev` puede emitir un `DROP INDEX`** del índice parcial por no verlo en el
   datamodel. Mitigado por el test de guardia, no eliminado.
4. **Placas no-PTA ya sembradas**: `PILOTO001` pasa el CHECK estructural pero `VehiculoSchema.parse`
   la rechaza, así que `listar` la descarta vía `mapearTolerante`. Bug preexistente, fuera del
   alcance, pero conviene arreglar el seed en el mismo PR.
5. **No cubre** la colisión de PIN entre conductores del mismo vehículo ni el throttle por IP bajo
   CGNAT.

## Addendum 2026-09-08 — riesgo aceptado tras la revisión de seguridad

La revisión de seguridad (Opus, sobre el diff ya implementado) encontró la **imagen espejo del
riesgo 1**, y es la más grave de las dos:

6. **Toma unilateral de placa liberada, sin retorno.** Con el índice parcial
   `WHERE estado <> 'inactivo'`, en cuanto el sindicato B marca un vehículo `inactivo`, cualquier
   `operador` del sindicato A puede quedarse con esa placa para siempre:
   - `crear` escribe `estado: 'pendiente'`, que el predicado del índice cuenta como **vigente**, así
     que A ni siquiera necesita cumplir los requisitos de activación — un `POST /v1/vehiculos` basta.
   - B ya no puede reactivar su propia fila: el `UPDATE` choca con
     `vehiculos_placa_norm_vigente_key` y sale el 409 de `cambiarEstado`.
   - B **no tiene ninguna vía en el producto** para destrabarlo: la única acción que liberaría la
     placa es poner la fila de A en `inactivo`, y RLS se lo impide.
   - `verificarPlaca` empeora el silencio: devuelve `disponible: true` para una placa que en realidad
     pertenece al vehículo retirado de otro sindicato, así que la toma también ocurre por accidente.

   **Decisión: se acepta para este MVP, no se rediseña el esquema.** La toma de placa entre
   sindicatos ES el diseño elegido — es lo que permite que un vehículo migre — y está cubierta por el
   test 2. No hay producción, ni tenants reales, ni datos: el costo de revisarlo después sigue siendo
   cero. Cambiar el predicado ahora sería relitigar una decisión ya tomada con criterio.

   **Lo que sí entra en este PR** (barato y sin tocar el modelo): el 409 de `cambiarEstado` distingue
   si quien bloquea es del mismo sindicato (instrucción ejecutable: dar de baja ese vehículo,
   nombrándolo) o de otro (contactar a QUIVO), en vez de dar una orden imposible de cumplir.

   **Pendiente real que esto deja abierto** (mismo pendiente que el riesgo 1, ahora con dos motivos):
   una vía de `admin_quivo` para transferir o liberar una placa entre sindicatos. Sin eso, el primer
   conflicto de placa en producción no tiene resolución por producto, solo por SQL a mano.

### Lo que la revisión confirmó sano (verificado contra el código, no contra este plan)

- **El login móvil no cruza tenants.** `buscarVehiculosActivosPorPlaca` corre bajo `CONTEXTO_ADMIN`
  y sin predicado de sindicato, pero eso no cambió: el tenant sale siempre del vehículo resuelto
  (`vehiculo.sindicatoId` alimenta la sesión, el JWT y todas las consultas siguientes, esas sí con
  RLS). El tenant nunca se toma del request. El cambio **mejora**: antes dos filas `activo` con la
  misma placa en sindicatos distintos era un estado esperado y `candidatosVehiculo[0]` elegía una
  arbitrariamente; ahora la consulta devuelve 0 o 1 fila por construcción.
- **El envenenamiento cruzado de lockout desaparece de verdad**, no se reubica: el estado que lo
  hacía posible (dos filas `activo` con la misma placa normalizada) es irrepresentable.
- **No hay divergencia posible entre `toUpperCase()` de JS y `upper()` de Postgres.** El regex
  `^[A-Za-z0-9 -]+$` de `PlacaVehiculoSchema` es lo que la garantiza, y además `limpiarDatosVehiculo`
  pasa a mayúsculas en JS antes de escribir. Ese regex es **load-bearing para seguridad**: si alguien
  amplía el alfabeto, una `А` cirílica en `АBC123` se stripea y produce una `placaNormalizada`
  distinta que escapa al índice único mientras la placa se ve idéntica. Queda comentado en el código.
- **`verificarPlaca` no empeora la fuga del riesgo 2**: la reduce. Ya corría con `CONTEXTO_ADMIN` y
  ya devolvía `sindicatoNombre` antes de este cambio; lo nuevo es que ahora **oculta** las filas
  `inactivo` de los demás sindicatos.

### Peligro latente, sin call site hoy

`@unique(map:…, where: raw(…))` deja `placaNormalizada` dentro de `VehiculoWhereUniqueInput`, así que
un `findUnique({ where: { placaNormalizada } })` compilaría y emitiría `WHERE ... LIMIT 1` **sin** el
predicado parcial: puede matchear muchas filas `inactivo` y devolver una arbitraria. Hoy no existe
ningún uso así en el repo (verificado por grep en `apps`, `packages` y `scripts`). Usar siempre
`findFirst` con el filtro de estado explícito.
