/**
 * Carga la **línea 120** (sindicato piloto) en producción: la línea, el tronco (ida, vuelta
 * y la ruta `circuito` que une ambas), los 8 ramales, los 17 puntos de control (16 de
 * `puntos-control-andry.json` + `PARADA 120 UNIVALLE` como marcador de vuelta) y las 10
 * paradas — y reasigna la rotación del piloto para que alterne **Z12 / 120 día por medio**
 * (QUI-383) del 2026-08-17 al 2026-08-31.
 *
 * ## ⚠ Calidad de la geometría del tronco — LEER ANTES DE USAR ESTE DATO PARA OTRA COSA
 *
 * El KML de origen (`scripts/data/linea-120/linea-120-my-maps.kml`, Google My Maps del
 * sindicato) es un **boceto dibujado a mano**, no una traza GPS real:
 *
 *   - Tronco ida  (`RUTA 120 DE NORTE A SUD`):    79 vértices / 12,4 km — salto medio 159 m,
 *     máximo **641 m**.
 *   - Tronco vuelta (`RETORNO LINEA 120 SUD A NORTE`): 67 vértices / 13,8 km — máximo
 *     **1348 m**.
 *
 * Comparar contra la Z12 (`scripts/cargar-circuito-z12.ts`): 1255 vértices para 40,7 km,
 * ~32 m entre puntos, derivada de trazas GPS reales. Un salto de 1,3 km entre vértices del
 * tronco 120 sirve perfectamente para el matcheo por radio de los puntos de control (ver más
 * abajo), pero **NO sirve** para medir desvío de ruta ni para dibujar el recorrido con
 * precisión en un mapa — no usar esta geometría para eso sin re-trazarla primero.
 *
 * ## Fix 2026-08-18 — por qué existe la ruta `circuito` (bug verificado contra prod)
 *
 * La primera corrida de este script (ya aplicada) cargó el tronco como **dos rutas
 * separadas** (`ida` `…0021`, `vuelta` `…0022`) y repartió los 16 puntos de control entre
 * ellas y los ramales: `ida: 7 | vuelta: 4 | ramal:collpapampa: 3 | ramal:barrio_flores: 2`.
 * Las asignaciones apuntaban a `ida`. Verificado en vivo contra `GET
 * /v1/mobile/asignacion-del-dia` con la credencial real: el endpoint devolvía solo 7 puntos
 * de control y 1 parada — el vehículo hace ida **y** vuelta en la misma jornada, así que los
 * 4 puntos del retorno (incluida la terminal sur donde arranca el regreso) nunca se
 * registraban.
 *
 * El precedente correcto es la Z12 (`scripts/cargar-circuito-z12.ts`): una sola ruta,
 * `sentido = 'circuito'` (`…0011`), con los 26 puntos de control del recorrido completo
 * colgando de ella. Este script replica esa forma para la 120:
 *
 *   - Ruta nueva `circuito` (id fijo `…0023`, `sentido = 'circuito'`) = concatenación de
 *     `RUTA 120 DE NORTE A SUD` (ida, 79 vértices) + `RETORNO LINEA 120 SUD A NORTE` (vuelta,
 *     67 vértices) = 146 vértices. El empalme ida→vuelta mide ~9,87 m (dos puntos distintos,
 *     no se deduplica ningún vértice — ver `EMPALME_TRONCO_MISMO_PUNTO_MAX_M` y Paso 0). NO
 *     se agrega ningún conector inventado — se concatena tal cual el KML.
 *   - Los 11 puntos de control del tronco (antes 7 en `ida` + 4 en `vuelta`) cuelgan ahora
 *     TODOS de `circuito`. Los 5 puntos de ramal (`A2`,`A3`,`C1`,`C2`,`C3`) no se tocan. Ver
 *     la nota completa sobre `A1` vs `C1` (mismo lugar físico, ~15 m entre sí) junto a
 *     `PUNTOS_CONTROL_CONFIG`.
 *
 * **Fix 2026-08-18 (v2, dato del CTO) — el recorrido de HOY sale de Univalle, no de PARADA
 * 120.** Verificado contra el KML: `PARADA 120 UNIVALLE` (`-17.3327797, -66.2266681`) está a
 * **~25 m del último vértice del RETORNO** (el KML del retorno termina prácticamente ahí) y a
 * **~856 m del primer vértice de la IDA** (que arranca en `PARADA 120`, `-17.33860,
 * -66.22140`). Eso es lo que explica el hueco de ~880 m del extremo norte que se documentaba
 * acá antes: **no es un error de trazo, son dos terminales norte distintas** — la ida arranca
 * en `PARADA 120` y la vuelta termina 856 m más al norte, en Univalle. El KML no trae el
 * tramo Univalle↔PARADA120; NO se inventa un conector para taparlo (mismo criterio que el
 * conector Villa Armonía↔Salomón de la Z12: ver `docs/plan-ruta-real-z12.md`, "La mejor
 * fuente del conector es la traza del lunes 17" — cuando haya traza GPS real del vehículo
 * recorriendo ese tramo, esa es la fuente correcta para cerrarlo, no OSM ni el KML).
 *
 * Consecuencias concretas:
 *   - `PARADA 120 UNIVALLE` entra como punto de control **orden 0, obligatorio = true** de
 *     `circuito` — es el marcador de vuelta (el conductor sale de ahí y vuelve ahí, así que
 *     es lo que permite contar cada vuelta completa). Coordenada real del KML (el mismo Point
 *     que ya se usaba para la parada), no viene de `puntos-control-andry.json` — se inserta
 *     aparte en el Paso 4. El circuito pasa a tener **12 puntos de control**, no 11 (17 en
 *     total para la línea 120, no 16).
 *   - El resto del tronco corre un lugar: `A1` orden 1, `N1..N5` orden 2..6, `N6` orden 7,
 *     `N7..N10` orden 8..11 — secuencia real: Univalle (salida) → `PARADA 120`/`A1` (terminal
 *     norte) → `N1..N5` (bajando al sur) → `N6` (terminal sur, arranca el retorno) →
 *     `N7..N10` (subiendo al norte) → cierra de nuevo en Univalle.
 *   - Parada `PARADA 120 UNIVALLE` pasa a `tipo: 'origen'` de `circuito` (antes: `destino` de
 *     `vuelta`); `PARADA 120` queda como `tipo: 'intermedia'` de `circuito` (antes: `origen`
 *     de `ida`).
 *   - Las asignaciones alternadas (Paso 6) apuntan a `circuito` en vez de a `ida`.
 *   - `ida` y `vuelta` se siguen upserteando tal cual (mismo dato del KML) — quedan sin
 *     puntos de control ni asignaciones, pero siguen sirviendo para dibujar cada sentido por
 *     separado si hace falta.
 *
 * Idempotente respecto de la corrida anterior: el soft-delete (`estado = 'inactivo'`) scoped a
 * `lineaId` del Paso 4/5 ya cubre las filas viejas de `ida`/`vuelta` (misma `lineaId`), y los
 * ids deterministas (UUIDv5, ver "Ids deterministas") hacen que el upsert que sigue reactive
 * exactamente las mismas filas en vez de crear otras — así que re-correr este script termina
 * con los 12 puntos del circuito (11 del tronco + Univalle) activos y ninguno duplicado.
 *
 * ## Qué hace, en orden
 *
 *   1. Parsea el KML (troncos + 8 ramales + 10 paradas) y `puntos-control-andry.json` — todo
 *      en memoria, ANTES de tocar la base. Si falta algún Placemark/punto esperado, aborta ahí.
 *      También arma acá la geometría de `circuito` (concatenación ida+vuelta, ver fix arriba).
 *   2. Upsert de la línea 120 (id fijo).
 *   3. Upsert de las tres rutas del tronco — ida, vuelta y circuito (ids fijos); `ida`/`vuelta`
 *      con geometría tal cual el KML, `circuito` con la concatenación.
 *   4. Upsert de los 8 ramales (ver decisión de modelado abajo) + 8 `variantes` de catálogo.
 *   5. Recrea (soft-delete + upsert con ids deterministas, ver "Idempotencia") los puntos de
 *      control y las paradas de la línea 120 a partir de los datos verificados del sindicato —
 *      los del tronco van a `circuito`, los de ramal a su ramal.
 *   6. Reasigna `rutaId` en las 30 asignaciones ya existentes del piloto (15 del vehículo
 *      titular `…0014` + 15 del pasante `…0024`, 2026-08-17..31) alternando Z12/120 por
 *      conteo de días desde la época fija 2026-08-17 (día Z12) módulo 2 (QUI-383) — el día
 *      que toca 120 apunta a `circuito` (`…0023`).
 *   7. Verificación de solo lectura (vértices —incluido `circuito`—, variantes, puntos de
 *      control —incluido el conteo específico de `circuito`—, paradas, y que la asignación de
 *      HOY de ambos vehículos apunte a la línea que le toca) — recién ahí decide COMMIT o
 *      ROLLBACK.
 *
 * ## Decisión de modelado — por qué los ramales NO son solo `variantes`
 *
 * El pedido original era "cargar los ramales como `variantes` de la ruta de ida". Leyendo
 * `packages/db/prisma/schema.prisma`, `Variante` es: `id, rutaId, nombre, estado,
 * createdAt, updatedAt` — **no tiene columna de geometría**. Es un catálogo de nombres
 * colgado de una ruta, no una entidad con su propio trazado (a diferencia de `Ruta`, que sí
 * tiene `geometria geography(LineString,4326)`).
 *
 * El brief también dice explícitamente "no inventar geometría… si un ramal del KML tiene
 * pocos vértices, se carga tal cual" — lo cual solo tiene sentido si la geometría de cada
 * ramal se guarda en algún lado. Con el schema tal como está, la única tabla que puede
 * guardar un `LineString` es `rutas`. Por eso este script:
 *
 *   - Crea una fila en `rutas` por cada ramal (ids fijos `…0030`..`…0037`), con
 *     `sentido = 'ramal:<slug>'` (string libre, sin enum — `sentido` es
 *     `z.string().min(1).max(50)` en `packages/shared/src/entities/ruta.ts`, nunca comparado
 *     contra un literal en el código, mismo hallazgo que documentó
 *     `cargar-circuito-z12.ts` para su propio `sentido = 'circuito'`). Ahí vive la
 *     geometría real de cada ramal, tal cual el KML.
 *   - Crea TAMBIÉN una fila en `variantes` por cada ramal (ids fijos `…0040`..`…0047`),
 *     `rutaId` = la ruta de ida del tronco (`…0021`), `nombre` = el nombre del ramal —
 *     así queda satisfecho literalmente el pedido ("cargar los ramales como variantes") y el
 *     catálogo de nombres es descubrible desde la ruta principal vía `GET
 *     /v1/rutas/:rutaId/variantes`, aunque la geometría real vive en la `Ruta` hermana.
 *
 * Ninguna asignación apunta jamás a la `rutaId` de un ramal — quedan fuera del camino
 * crítico, tal como pide el brief ("el sistema no las usa"). Es dato para que exista, no
 * para operar sobre él todavía: **hoy el sistema no puede saber qué ramal tomó el
 * conductor** (ver nota en `docs/handoff.md`).
 *
 * ## Puntos de control: de dónde sale cada dato
 *
 * La geometría de 16 de los 17 puntos sale de `puntos-control-andry.json` (coordenadas reales
 * mandadas por el sindicato, ya verificadas por el CTO contra el KML — 14/16 a <20 m del
 * trazo), NO del KML — el 17°, `PARADA 120 UNIVALLE`, sale directo del Point del KML (ver
 * "Fix 2026-08-18 (v2)" arriba). `rutaId`/`orden` se derivan del campo `nota` de cada punto
 * (para Univalle, del rol que le dio el CTO: marcador de vuelta, orden 0):
 *
 *   - `PARADA 120 UNIVALLE` (marcador de vuelta, orden 0) + `A1` (terminal norte, orden 1) +
 *     `N1`..`N6` (ida norte→sud, `N6` = terminal sur, orden 2..7) + `N7`..`N10` (retorno
 *     sud→norte, orden 8..11) → ruta `circuito`, en secuencia real de recorrido (ver "Fix
 *     2026-08-18 (v2)" arriba para la secuencia completa).
 *   - `C1`..`C3` (Collpapampa)                → ramal Collpapampa (`C1` = inicio del ramal,
 *     mismo lugar físico que `A1` a ~15 m, pero es un punto distinto — ver la nota junto a
 *     `PUNTOS_CONTROL_CONFIG`).
 *   - `A2`..`A3` (sobre ramal Barrio Flores)   → ramal Barrio Flores.
 *
 * `radioToleranciaM = 150`: el mismo valor que usan HOY los 14 puntos de control activos de
 * la Z12 (confirmado consultando `puntos_control` en la base real — los que están en 100 son
 * puntos ya `inactivo`, herencia del seed genérico, no el valor vigente).
 *
 * `obligatorio`: mismo criterio observado en los puntos activos de la Z12 (2 de 14 son
 * `obligatorio = true`, exactamente los dos extremos del tramo — el resto, intermedios, en
 * `false`). Acá: `true` en 5 puntos — `PARADA 120 UNIVALLE` (marcador de vuelta, pedido
 * explícito del CTO) y `A1`/`N10` (los dos extremos geométricos del `circuito`) son extremo o
 * cierre de vuelta real; `N6` (fin ida/terminal sur) y `N7` (inicio del retorno) ya no son
 * "extremo de ruta" con el tronco unificado, pero se mantienen obligatorios porque siguen
 * siendo el checkpoint operativo real (confirman que el vehículo llegó a la terminal sur y
 * arrancó el regreso — justo el dato que el bug original no podía capturar). Los 7 restantes
 * (intermedios del circuito + los 5 de ramales) en `false`.
 *
 * Las 10 `PARADA 120 *` del KML son 1:1 con: `PARADA 120 UNIVALLE` (ruta `circuito`, `tipo:
 * 'origen'` — hoy el recorrido SALE de ahí, ver "Fix 2026-08-18 (v2)"), `PARADA 120` (misma
 * ruta `circuito`, `tipo: 'intermedia'`, terminal norte de paso) y una parada terminal por
 * cada uno de los 8 ramales (`tipo: 'destino'`, el nombre de cada Placemark de parada
 * coincide con el nombre de su ramal).
 *
 * ## Idempotencia
 *
 *   - Línea, las 3 rutas del tronco (ida, vuelta, circuito), las 8 rutas-ramal y las 8
 *     variantes: `id` fijo, `INSERT ... ON CONFLICT (id) DO UPDATE` — converge sin duplicar.
 *   - Puntos de control y paradas de la línea 120 (17 puntos de control + 10 paradas): fix
 *     2026-08-18 (revisión pre-merge PR #37, hallazgo CRÍTICO) — la versión original de este
 *     script hacía `DELETE` real + `INSERT` con `randomUUID()`, lo cual violaba el contrato
 *     de `schema.prisma:298-310` ("Soft-delete (nunca DELETE real): `CumplimientoPc.puntoControlId`
 *     referencia este id sin FK — un DELETE real dejaría ese historial apuntando a un id
 *     inexistente") y ni siquiera era idempotente en sentido fuerte (cada corrida generaba ids
 *     nuevos). Ahora cada fila recibe un id UUIDv5 determinista (ver "Ids deterministas
 *     (UUIDv5)" más abajo, derivado de `LINEA_120_ID` + un identificador de negocio estable —
 *     "A1", "N6", el nombre de la parada, etc.), y el Paso 4/5 hace `UPDATE ... SET estado =
 *     'inactivo'` (scoped SIEMPRE a `"rutaId" IN (SELECT id FROM rutas WHERE "lineaId" =
 *     LINEA_120_ID)` — nunca toca una fila cuya ruta no cuelgue de la línea 120, así que los
 *     puntos/paradas de la Z12 quedan intactos) seguido de `INSERT ... ON CONFLICT (id) DO
 *     UPDATE` — mismo patrón que `lineas`/`rutas`/`variantes` arriba, y el mismo enfoque que ya
 *     usa `cargar-circuito-z12.ts` (líneas ~535 y ~644) para no romper `CumplimientoPc`. Esto
 *     también sigue resolviendo la migración de `ida`/`vuelta` → `circuito` de la corrida
 *     anterior: `circuito` cuelga de la misma `lineaId`, así que el soft-delete scoped ya
 *     cubre los puntos/paradas viejos de `ida`/`vuelta`.
 *   - Asignaciones: son un `UPDATE` de `rutaId` sobre filas que YA existen (creadas por
 *     `crear-credencial-pasante.ts` y el flujo normal del piloto) — repetir la corrida
 *     recalcula la misma alternación y vuelve a escribir el mismo `rutaId`, no crea filas
 *     nuevas ni duplica nada.
 *
 * ## Fechas: por qué esta vez NO hace falta el `getTypeParser` a medida
 *
 * `crear-credencial-pasante.ts` explica en detalle (ver su cabecera) el problema de que `pg`
 * reconstruye columnas `date`/`timestamp without time zone` con el reloj LOCAL de la máquina.
 * Ese problema aparece cuando el script **lee de vuelta** una de esas columnas como `Date`.
 * Este script nunca lo hace: `fecha` viaja siempre como texto ya formaddo (`'YYYY-MM-DD'`,
 * vía `fechaIsoDeUtc`, calculado 100% en JS con aritmética UTC) tanto en el `WHERE` como en
 * cualquier parámetro, y ninguna query de este script hace `SELECT fecha` — solo se filtra
 * por ella y se leen `id`/`rutaId`. Sin lectura de columna `date`, no hay override que
 * necesitar; se documenta acá para que quede claro que es una omisión deliberada, no un
 * descuido.
 *
 * ## Cómo se corre
 *
 *   DATABASE_URL=postgresql://postgres:...@127.0.0.1:5433/quivo_control \
 *     node_modules/.bin/tsx scripts/cargar-linea-120.ts              # dry-run (default)
 *
 *   DATABASE_URL=postgresql://postgres:...@127.0.0.1:5433/quivo_control \
 *     node_modules/.bin/tsx scripts/cargar-linea-120.ts --apply      # aplica de verdad
 *
 * Dry-run real (no una simulación en JS): mismas queries dentro de una transacción real con
 * ROLLBACK forzado salvo `--apply` + todas las verificaciones OK — mismo mecanismo que
 * `cargar-circuito-z12.ts`.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

// --- Resolución de 'pg' anclada a packages/db/package.json — mismo truco que
// cargar-circuito-z12.ts y crear-credencial-pasante.ts: este script es standalone, no se
// acopla al estado de build de packages/.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const requireDesdeDb = createRequire(path.join(REPO_ROOT, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = requireDesdeDb('pg') as typeof import('pg');

// ============================================================================================
// Constantes — ids fijos, todos bajo el namespace `33333333-3333-4333-8333-0000000000XX` del
// sindicato piloto, ya en uso por cargar-circuito-z12.ts / crear-credencial-pasante.ts.
// ============================================================================================

const SINDICATO_PILOTO_ID = '33333333-3333-4333-8333-333333333333';

const LINEA_120_ID = '33333333-3333-4333-8333-000000000020';
const RUTA_120_IDA_ID = '33333333-3333-4333-8333-000000000021';
const RUTA_120_VUELTA_ID = '33333333-3333-4333-8333-000000000022';
/** Fix 2026-08-18 (ver "Fix 2026-08-18" y "Fix 2026-08-18 (v2)" en la cabecera) — la ruta que
 * agrupa ida+vuelta en una sola geometría, con los 12 puntos de control del tronco (11 +
 * PARADA 120 UNIVALLE como marcador de vuelta) y las 2 paradas principales colgando de ella.
 * Es la que reciben las asignaciones (mismo patrón que la Z12). */
const RUTA_120_CIRCUITO_ID = '33333333-3333-4333-8333-000000000023';

/** La ruta de la Z12 a la que hoy apuntan las 30 asignaciones del piloto (ver
 * crear-credencial-pasante.ts y docs/handoff.md §"La línea Z12"). */
const RUTA_Z12_ID = '33333333-3333-4333-8333-000000000011';

const VEHICULO_TITULAR_ID = '33333333-3333-4333-8333-000000000014';
const VEHICULO_PASANTE_ID = '33333333-3333-4333-8333-000000000024';
const HORARIO_ROTACION = 'manana';
const PRIMERA_FECHA = '2026-08-17';
const ULTIMA_FECHA = '2026-08-31';

/** Mismo valor que usan hoy los 14 puntos de control ACTIVOS de la Z12 — ver "Puntos de
 * control: de dónde sale cada dato" en la cabecera. */
const RADIO_TOLERANCIA_M = 150;

const KML_PATH = path.join(REPO_ROOT, 'scripts/data/linea-120/linea-120-my-maps.kml');
const PUNTOS_CONTROL_JSON_PATH = path.join(REPO_ROOT, 'scripts/data/linea-120/puntos-control-andry.json');

/** Los 8 ramales — ver "Decisión de modelado" en la cabecera. `kmlLineName`/`kmlParadaName`
 * son los nombres EXACTOS (post-trim) de los Placemarks en el KML; se validan al parsear. */
interface RamalConfig {
  kmlLineName: string;
  kmlParadaName: string;
  rutaId: string;
  varianteId: string;
  slug: string;
}

const RAMALES: RamalConfig[] = [
  {
    kmlLineName: '120 MOLINOS',
    kmlParadaName: 'PARADA 120 MOLINOS',
    rutaId: '33333333-3333-4333-8333-000000000030',
    varianteId: '33333333-3333-4333-8333-000000000040',
    slug: 'molinos',
  },
  {
    kmlLineName: '120 ENCANTO PAMPA . SALOMON ROMERO',
    kmlParadaName: 'PARADA 120 SALOMON ROMERO',
    rutaId: '33333333-3333-4333-8333-000000000031',
    varianteId: '33333333-3333-4333-8333-000000000041',
    slug: 'encanto_pampa_salomon_romero',
  },
  {
    kmlLineName: '120 COLLPAPAMPA',
    kmlParadaName: 'PARADA 120 COLLPAPAMPA',
    rutaId: '33333333-3333-4333-8333-000000000032',
    varianteId: '33333333-3333-4333-8333-000000000042',
    slug: 'collpapampa',
  },
  {
    kmlLineName: '120 GUALBERTO VILLARROEL',
    kmlParadaName: 'PARADA 120 GUALBERTO VILLARROEL',
    rutaId: '33333333-3333-4333-8333-000000000033',
    varianteId: '33333333-3333-4333-8333-000000000043',
    slug: 'gualberto_villarroel',
  },
  {
    kmlLineName: '120 VILLA ORURO',
    kmlParadaName: 'PARADA 120 VILLA ORURO',
    rutaId: '33333333-3333-4333-8333-000000000034',
    varianteId: '33333333-3333-4333-8333-000000000044',
    slug: 'villa_oruro',
  },
  {
    kmlLineName: '120 APOTE',
    kmlParadaName: 'PARADA 120 APOTE',
    rutaId: '33333333-3333-4333-8333-000000000035',
    varianteId: '33333333-3333-4333-8333-000000000045',
    slug: 'apote',
  },
  {
    kmlLineName: '120 MOLLE NOVA',
    kmlParadaName: 'PARADA 120 MOLLE NOVA',
    rutaId: '33333333-3333-4333-8333-000000000036',
    varianteId: '33333333-3333-4333-8333-000000000046',
    slug: 'molle_nova',
  },
  {
    kmlLineName: '120 BARRIO FLORES',
    kmlParadaName: 'PARADA 120 BARRIO FLORES',
    rutaId: '33333333-3333-4333-8333-000000000037',
    varianteId: '33333333-3333-4333-8333-000000000047',
    slug: 'barrio_flores',
  },
];

function ramalPorSlug(slug: string): RamalConfig {
  const r = RAMALES.find((x) => x.slug === slug);
  if (!r) throw new Error(`Ramal con slug "${slug}" no está en RAMALES — bug en el script.`);
  return r;
}

const RAMAL_COLLPAPAMPA = ramalPorSlug('collpapampa');
const RAMAL_BARRIO_FLORES = ramalPorSlug('barrio_flores');

/** Nombres EXACTOS (post-trim) de los 2 Placemarks LineString del tronco, tal como aparecen
 * en el KML — se validan al parsear. */
const KML_TRONCO_IDA = 'RUTA 120 DE NORTE A SUD';
const KML_TRONCO_VUELTA = 'RETORNO LINEA 120 SUD A NORTE';
const KML_PARADA_PRINCIPAL = 'PARADA 120';
const KML_PARADA_UNIVALLE = 'PARADA 120 UNIVALLE';

/** `rutaId`/`orden`/`obligatorio` de cada uno de los 16 puntos de `puntos-control-andry.json`
 * (A1, A2, A3, C1, C2, C3, N1..N10), indexados por su `id` — ver "Puntos de control: de dónde
 * sale cada dato" en la cabecera. El 17° punto (`PARADA 120 UNIVALLE`, orden 0) NO vive acá
 * — sale del KML, no de ese JSON — se inserta aparte en el Paso 4 (ver "Fix 2026-08-18 (v2)").
 *
 * Fix 2026-08-18: los 11 puntos del TRONCO (antes repartidos 7 en `ida` + 4 en `vuelta`)
 * cuelgan ahora todos de la ruta `circuito` (`RUTA_120_CIRCUITO_ID`).
 *
 * Fix 2026-08-18 (v2, dato del CTO): el recorrido de HOY sale de Univalle, no de PARADA 120
 * — `orden` real de recorrido es 0 (Univalle) → 1 (A1) → 2..6 (N1..N5) → 7 (N6) → 8..11
 * (N7..N10) → cierra de nuevo en Univalle. Los 5 puntos de RAMAL (`A2`,`A3`,`C1`,`C2`,`C3`)
 * NO se tocan — siguen colgando de su ramal, igual que antes.
 *
 * `A1` vs `C1` (mismo caso físico, ~15 m entre sí — ver `puntos-control-andry.json`): la nota
 * de `A1` es "terminal norte (PARADA 120) — compartido con inicio Collpapampa" (es el punto
 * del TRONCO, coincide con la parada principal `PARADA 120`); la de `C1` es "inicio
 * Collpapampa (= terminal norte)" (es el punto donde arranca ESE ramal). Decisión: van los
 * DOS, cada uno en su ruta — `A1` al `circuito` (orden 1), `C1` se queda en
 * `ramal:collpapampa` (orden 0, sin cambios). No se fusionan en uno solo porque marcan cosas
 * distintas (el inicio del tronco vs. el inicio del ramal) y porque así el reparto
 * `ramal:collpapampa: 3` no cambia — solo se reordena el tronco.
 *
 * `obligatorio`: sin cambios respecto de la versión anterior para los puntos que ya eran
 * `true` (`A1` inicio del tronco, `N6` fin ida/terminal sur donde arranca el retorno, `N7`
 * inicio del retorno, `N10` fin del tronco) — más el nuevo `PARADA 120 UNIVALLE` (orden 0,
 * `obligatorio = true`, pedido explícito del CTO por ser el marcador de vuelta). `A1` y `N10`
 * siguen siendo los dos extremos geométricos del `circuito`; `N6`/`N7` ya no son "extremo de
 * ruta" en sentido estricto (están a mitad del `circuito`), pero se mantienen en `obligatorio
 * = true` porque siguen siendo el checkpoint operativo real: confirman que el vehículo llegó
 * a la terminal sur y arrancó el regreso, que es justo el dato que el bug original no podía
 * capturar. */
const PUNTOS_CONTROL_CONFIG: Record<string, { rutaId: string; orden: number; obligatorio: boolean }> = {
  // orden 0 es PARADA_120_UNIVALLE_CONTROL — no viene de este dict (no está en
  // puntos-control-andry.json, sale del Point del KML) — se inserta aparte en el Paso 4. Ver
  // "Fix 2026-08-18 (v2)" en la cabecera: hoy el recorrido SALE de Univalle.
  A1: { rutaId: RUTA_120_CIRCUITO_ID, orden: 1, obligatorio: true },
  N1: { rutaId: RUTA_120_CIRCUITO_ID, orden: 2, obligatorio: false },
  N2: { rutaId: RUTA_120_CIRCUITO_ID, orden: 3, obligatorio: false },
  N3: { rutaId: RUTA_120_CIRCUITO_ID, orden: 4, obligatorio: false },
  N4: { rutaId: RUTA_120_CIRCUITO_ID, orden: 5, obligatorio: false },
  N5: { rutaId: RUTA_120_CIRCUITO_ID, orden: 6, obligatorio: false },
  N6: { rutaId: RUTA_120_CIRCUITO_ID, orden: 7, obligatorio: true },
  N7: { rutaId: RUTA_120_CIRCUITO_ID, orden: 8, obligatorio: true },
  N8: { rutaId: RUTA_120_CIRCUITO_ID, orden: 9, obligatorio: false },
  N9: { rutaId: RUTA_120_CIRCUITO_ID, orden: 10, obligatorio: false },
  N10: { rutaId: RUTA_120_CIRCUITO_ID, orden: 11, obligatorio: true },
  C1: { rutaId: RAMAL_COLLPAPAMPA.rutaId, orden: 0, obligatorio: false },
  C2: { rutaId: RAMAL_COLLPAPAMPA.rutaId, orden: 1, obligatorio: false },
  C3: { rutaId: RAMAL_COLLPAPAMPA.rutaId, orden: 2, obligatorio: false },
  A2: { rutaId: RAMAL_BARRIO_FLORES.rutaId, orden: 0, obligatorio: false },
  A3: { rutaId: RAMAL_BARRIO_FLORES.rutaId, orden: 1, obligatorio: false },
};

// ============================================================================================
// Tipos
// ============================================================================================

type Coord = [number, number]; // [lon, lat], GeoJSON estándar (RFC 7946)

interface PuntoControlAndry {
  id: string;
  lat: number;
  lon: number;
  nota: string;
}

interface KmlParseado {
  documentoNombre: string;
  linestrings: Map<string, Coord[]>; // nombre de Placemark (trim) -> vértices
  puntos: Map<string, Coord>; // nombre de Placemark (trim) -> [lon, lat]
}

// ============================================================================================
// Helpers de geometría — copiados a propósito de cargar-circuito-z12.ts (mismo motivo: script
// standalone, no se acopla a packages/shared en runtime).
// ============================================================================================

function redondear(n: number): number {
  return Math.round(n * 1e7) / 1e7; // ~1.1 cm de precisión, suficiente y legible
}

// Copiada a propósito de cargar-circuito-z12.ts (mismo motivo que el resto de los helpers de
// geometría de este archivo: script standalone, no se acopla a packages/shared en runtime).
const RADIO_TIERRA_METROS = 6_371_000;

function haversineMetros(a: Coord, b: Coord): number {
  const [lonA, latA] = a;
  const [lonB, latB] = b;
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLon = (lonB - lonA) * rad;
  const senoLat = Math.sin(dLat / 2);
  const senoLon = Math.sin(dLon / 2);
  const h = senoLat * senoLat + Math.cos(latA * rad) * Math.cos(latB * rad) * senoLon * senoLon;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Umbral para decidir si el fin de la ida y el inicio de la vuelta son "el mismo punto"
 * (duplicar el vértice al concatenar) o dos puntos distintos que hay que conservar ambos.
 * Medido en los datos reales: 9,87 m — muy por debajo de este umbral, así que NO se
 * deduplica nada (ver Paso 0). Se deja como constante, no como número mágico inline, para
 * que quede claro que es una decisión ("¿qué cuenta como el mismo punto?"), no un dato. */
const EMPALME_TRONCO_MISMO_PUNTO_MAX_M = 2;

// ============================================================================================
// Ids deterministas (UUIDv5) — fix 2026-08-18 (revisión pre-merge PR #37, hallazgo CRÍTICO).
//
// `puntos_control`/`paradas` tienen el mismo contrato de soft-delete que documenta
// `schema.prisma:298-310` para `PuntoControl` ("Soft-delete (nunca DELETE real):
// CumplimientoPc.puntoControlId referencia este id sin FK — un DELETE real dejaría ese
// historial apuntando a un id inexistente"). Antes de este fix, el Paso 4/5 hacía
// `DELETE` real + `INSERT` con `randomUUID()` — violaba ese contrato Y generaba un id nuevo
// en cada corrida, así que ni siquiera era idempotente en el sentido fuerte (dos corridas
// dejaban dos ids distintos para "el mismo" punto físico).
//
// Fix: en vez de `randomUUID()`, cada punto/parada recibe un id UUIDv5 derivado de su propia
// identidad estable (`LINEA_120_ID` + un identificador de negocio que no cambia entre
// corridas) — re-correr el script converge al mismo id, así que el Paso 4/5 pasa a ser un
// `UPDATE ... SET estado = 'inactivo'` (soft-delete de lo que ya no aplica, igual que
// `cargar-circuito-z12.ts` líneas ~535 y ~644) seguido de un upsert `ON CONFLICT (id) DO
// UPDATE` — mismo patrón que ya usa este script para `lineas`/`rutas`/`variantes`.
//
// No se usa la librería `uuid` porque no está en las dependencias del monorepo (verificado:
// no aparece en ningún `package.json` del workspace ni en `pnpm-lock.yaml`) — se implementa
// UUIDv5 a mano con `crypto.createHash('sha1')` siguiendo RFC 4122 §4.3: SHA-1 del namespace
// (16 bytes) + nombre (UTF-8), los primeros 16 bytes del hash con el nibble de versión (5) y
// el de variante (RFC 4122) forzados.

/** Namespace fijo y arbitrario, propio de este script — no es el id de ninguna entidad real,
 * solo tiene que ser constante entre corridas para que UUIDv5 sea determinista. */
const UUID_NAMESPACE_LINEA_120 = '6f1d9c3a-6b2a-4f3b-8f1a-3d9b7c2e4a10';

function uuidNamespaceABytes(namespace: string): Buffer {
  const hex = namespace.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`Namespace UUID inválido: "${namespace}" (se esperaban 32 hex chars sin guiones).`);
  return Buffer.from(hex, 'hex');
}

/** UUIDv5 determinista (RFC 4122 §4.3), implementado a mano porque `uuid` no está entre las
 * dependencias del monorepo (ver nota arriba). */
function uuidv5(nombre: string, namespace: string = UUID_NAMESPACE_LINEA_120): string {
  const nsBytes = uuidNamespaceABytes(namespace);
  const nombreBytes = Buffer.from(nombre, 'utf8');
  const hash = createHash('sha1').update(Buffer.concat([nsBytes, nombreBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // versión 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC 4122
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Id determinista de un punto de control de la línea 120, a partir de su identificador de
 * negocio estable (el `id` de `puntos-control-andry.json` — p. ej. "A1", "N6" — o un literal
 * fijo para el marcador de Univalle, que no sale de ese JSON). */
function idPuntoControl120(identificador: string): string {
  return uuidv5(`${LINEA_120_ID}:puntoControl:${identificador}`);
}

/** Id determinista de una parada de la línea 120, a partir de su nombre (los 10 nombres de
 * `paradasAInsertar` son únicos entre sí — 2 del tronco + 1 por ramal). */
function idParada120(identificador: string): string {
  return uuidv5(`${LINEA_120_ID}:parada:${identificador}`);
}

// ============================================================================================
// Parser del KML — regex sobre el texto crudo, no XML DOM: no hay ninguna librería XML en
// node_modules del repo (`xml2js`/`fast-xml-parser` no están instalados) y el documento es lo
// bastante simple y regular (20 `<Placemark>` planos, sin anidar, confirmado a mano) como para
// no justificar agregar una dependencia nueva solo para este script de una vez.
// ============================================================================================

function parseKml(kmlTexto: string): KmlParseado {
  const documentoMatch = kmlTexto.match(/<Document>[\s\S]*?<name>([\s\S]*?)<\/name>/);
  if (!documentoMatch) throw new Error(`${KML_PATH}: no se encontró <Document><name>.`);
  const documentoNombre = documentoMatch[1]!.trim();

  const linestrings = new Map<string, Coord[]>();
  const puntos = new Map<string, Coord>();

  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match: RegExpExecArray | null;
  let total = 0;
  while ((match = placemarkRegex.exec(kmlTexto)) !== null) {
    total++;
    const bloque = match[1]!;
    const nombreMatch = bloque.match(/<name>([\s\S]*?)<\/name>/);
    const nombre = nombreMatch ? nombreMatch[1]!.trim() : '';
    if (!nombre) throw new Error(`Placemark #${total} del KML sin <name> — no se puede identificar.`);

    const lineStringMatch = bloque.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    const pointMatch = bloque.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);

    if (lineStringMatch) {
      const coords = parseCoordinatesTexto(lineStringMatch[1]!);
      if (coords.length < 2) throw new Error(`Placemark "${nombre}": LineString con menos de 2 vértices.`);
      if (linestrings.has(nombre)) throw new Error(`Placemark "${nombre}" (LineString) duplicado en el KML.`);
      linestrings.set(nombre, coords);
    } else if (pointMatch) {
      const coords = parseCoordinatesTexto(pointMatch[1]!);
      if (coords.length !== 1) throw new Error(`Placemark "${nombre}": Point con ${coords.length} coordenadas, se esperaba 1.`);
      if (puntos.has(nombre)) throw new Error(`Placemark "${nombre}" (Point) duplicado en el KML.`);
      puntos.set(nombre, coords[0]!);
    }
    // Placemarks sin LineString ni Point (ninguno esperado, pero no es motivo de abortar acá)
    // se ignoran silenciosamente — la validación de "qué se esperaba encontrar" pasa más abajo.
  }

  if (total !== 20) {
    throw new Error(
      `El KML tiene ${total} Placemarks, se esperaban 20 (2 tronco + 8 ramales + 10 paradas — ya ` +
        'inspeccionado a mano por el CTO). El archivo cambió: revisar antes de continuar.',
    );
  }

  return { documentoNombre, linestrings, puntos };
}

function parseCoordinatesTexto(texto: string): Coord[] {
  return texto
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length > 0)
    .map((tok) => {
      const partes = tok.split(',');
      const lon = Number(partes[0]);
      const lat = Number(partes[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        throw new Error(`Coordenada KML inválida: "${tok}"`);
      }
      // Mismo footgun documentado en cargar-circuito-z12.ts: datos de sindicato a veces
      // vienen lat,lon invertido.
      if (Math.abs(lon) <= 90 && Math.abs(lat) > 90) {
        throw new Error(`Coordenada [${lon}, ${lat}] parece [lat, lon] invertido.`);
      }
      return [redondear(lon), redondear(lat)] as Coord;
    });
}

function cargarPuntosControlAndry(rutaArchivo: string): PuntoControlAndry[] {
  const contenido = JSON.parse(fs.readFileSync(rutaArchivo, 'utf8')) as { puntos: PuntoControlAndry[] };
  if (!Array.isArray(contenido.puntos) || contenido.puntos.length === 0) {
    throw new Error(`${rutaArchivo}: no tiene un array "puntos" no vacío.`);
  }
  for (const p of contenido.puntos) {
    if (typeof p.id !== 'string' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) {
      throw new Error(`${rutaArchivo}: punto inválido ${JSON.stringify(p)}.`);
    }
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) {
      throw new Error(`${rutaArchivo}: punto "${p.id}" con lat/lon fuera de rango: [${p.lon}, ${p.lat}].`);
    }
  }
  return contenido.puntos;
}

// ============================================================================================
// Helpers de fecha — copiados de crear-credencial-pasante.ts (misma fórmula, ver "Fechas" en
// la cabecera de este script sobre por qué acá no hace falta el getTypeParser a medida).
// ============================================================================================

const BOLIVIA_UTC_OFFSET_HOURS = 4;

function fechaUtcDeIso(fechaIso: string): Date {
  const [anio, mes, dia] = fechaIso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function sumarDiasUtc(fecha: Date, dias: number): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + dias));
}

function fechaIsoDeUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function fechaActualBolivia(ahora: Date = new Date()): Date {
  const bolivia = new Date(ahora.getTime() - BOLIVIA_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
}

/** Las 15 fechas `2026-08-17`..`2026-08-31`, ambas inclusive. */
function fechasRotacion(): Date[] {
  const primera = fechaUtcDeIso(PRIMERA_FECHA);
  const ultima = fechaUtcDeIso(ULTIMA_FECHA);
  const dias = Math.round((ultima.getTime() - primera.getTime()) / 86_400_000) + 1;
  return Array.from({ length: dias }, (_, i) => sumarDiasUtc(primera, i));
}

/** Fix 2026-08-18 (revisión pre-merge PR #37, hallazgo ALTO): la versión original alternaba
 * con `fecha.getUTCDate() % 2` (paridad del DÍA DEL MES) — se rompe en cualquier cambio de
 * mes de 31 días, porque el día 31 y el día 1 siguiente son ambos impares (dos Z12 seguidos
 * en vez de alternar). Se reemplaza por conteo de días desde una época fija, con módulo 2 —
 * insensible a dónde cae el corte de mes. `EPOCA_ALTERNACION` = 2026-08-17, Z12 por
 * definición (QUI-383: "el grupo alterna Z12 y 120 día por medio", ejemplo del brief:
 * 17=Z12, 18=120, 19=Z12, 20=120…) — se eligió esa fecha exacta (y no otra) porque es la que
 * deja la secuencia ya cargada en producción para 2026-08-17..31 sin ningún cambio (17=Z12 …
 * 31=Z12, verificado imprimiendo ambas versiones antes de aplicar este fix). */
const EPOCA_ALTERNACION = fechaUtcDeIso('2026-08-17');

function lineaParaFecha(fecha: Date): 'Z12' | '120' {
  const dias = Math.round((fecha.getTime() - EPOCA_ALTERNACION.getTime()) / 86_400_000);
  return ((dias % 2) + 2) % 2 === 0 ? 'Z12' : '120'; // doble módulo por si la fecha es previa a la época
}

function rutaIdParaFecha(fecha: Date): string {
  // Fix 2026-08-18: apuntaba a RUTA_120_IDA_ID (solo 7 de los 16 puntos de control, sin el
  // retorno) — ahora apunta al circuito completo, mismo patrón que la Z12.
  return lineaParaFecha(fecha) === '120' ? RUTA_120_CIRCUITO_ID : RUTA_Z12_ID;
}

// ============================================================================================
// CLI args
// ============================================================================================

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  DATABASE_URL=postgresql://postgres:...@127.0.0.1:5433/<db> tsx scripts/cargar-linea-120.ts [opciones]

Opciones:
  --apply    Aplica de verdad (COMMIT). Sin esto, siempre dry-run (ROLLBACK forzado).
  --help     Esta ayuda.
`);
  process.exit(0);
}

// ============================================================================================
// main
// ============================================================================================

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Falta DATABASE_URL en el entorno. Ejemplo:');
    console.error('  DATABASE_URL=postgresql://postgres:PASSWORD@127.0.0.1:5433/quivo_control tsx scripts/cargar-linea-120.ts');
    process.exit(1);
  }

  console.log('='.repeat(90));
  console.log(`Línea 120 — modo: ${APLICAR ? 'APPLY (va a hacer COMMIT si todo verifica)' : 'DRY-RUN (siempre hace ROLLBACK, no escribe nada)'}`);
  console.log('='.repeat(90));

  // ------------------------------------------------------------------------------------
  // Paso 0 — Parsear TODOS los insumos en memoria antes de abrir conexión. Si algo del
  // KML o del JSON de puntos de control no matchea lo esperado, se aborta acá, sin tocar
  // la base ni siquiera en dry-run.
  // ------------------------------------------------------------------------------------
  console.log('\n--- Paso 0: parseo de insumos ---');

  const kmlTexto = fs.readFileSync(KML_PATH, 'utf8');
  const kml = parseKml(kmlTexto);
  console.log(`  KML: "${kml.documentoNombre}" — ${kml.linestrings.size} LineStrings, ${kml.puntos.size} Points.`);

  const tronoIda = requerirLineString(kml, KML_TRONCO_IDA);
  const troncoVuelta = requerirLineString(kml, KML_TRONCO_VUELTA);
  console.log(`  Tronco ida:    "${KML_TRONCO_IDA}" — ${tronoIda.length} vértices.`);
  console.log(`  Tronco vuelta: "${KML_TRONCO_VUELTA}" — ${troncoVuelta.length} vértices.`);

  // Fix 2026-08-18: geometría de la ruta "circuito" — concatenación de ida + vuelta, mismo
  // patrón que cargar-circuito-z12.ts (una sola ruta, sentido = 'circuito', con TODOS los
  // puntos de control del recorrido completo colgando de ella). Ver PUNTOS_CONTROL_CONFIG.
  const distEmpalmeTronco = haversineMetros(tronoIda[tronoIda.length - 1]!, troncoVuelta[0]!);
  const empalmeEsMismoPunto = distEmpalmeTronco <= EMPALME_TRONCO_MISMO_PUNTO_MAX_M;
  console.log(
    `  Empalme tronco (fin ida → inicio vuelta): ${distEmpalmeTronco.toFixed(2)} m` +
      `${empalmeEsMismoPunto ? ' — se toma como el mismo punto, no se duplica el vértice.' : ' — son dos puntos distintos, se concatenan ambos.'}`,
  );
  const troncoVueltaParaCircuito = empalmeEsMismoPunto ? troncoVuelta.slice(1) : troncoVuelta;
  const circuitoCoords: Coord[] = [...tronoIda, ...troncoVueltaParaCircuito];
  console.log(`  Ruta circuito: ${tronoIda.length} (ida) + ${troncoVueltaParaCircuito.length} (vuelta) = ${circuitoCoords.length} vértices.`);

  // El circuito NO cierra geométricamente en el extremo norte — es un dato conocido del KML
  // del sindicato (boceto a mano, no traza GPS), no un bug de este script. Fix 2026-08-18
  // (v2, dato del CTO): son dos terminales norte DISTINTAS, no un trazo cortado — la ida
  // arranca en PARADA 120 y la vuelta termina ~856 m más al norte, en Univalle (que a su vez
  // queda a solo ~25 m del último vértice del KML de la vuelta). NO se agrega un conector
  // inventado acá (ver cabecera "⚠ Calidad de la geometría del tronco" y "Fix 2026-08-18
  // (v2)") — el matcheo por radio de los puntos de control (RADIO_TOLERANCIA_M = 150 m) no
  // depende de que el LineString cierre; cuando exista traza GPS real del tramo
  // Univalle↔PARADA120, esa es la fuente correcta para cerrarlo (mismo criterio que el
  // conector de la Z12, ver docs/plan-ruta-real-z12.md).
  const distAperturaNorteCircuito = haversineMetros(troncoVuelta[troncoVuelta.length - 1]!, tronoIda[0]!);
  console.log(
    `  ⚠ Apertura del circuito en el extremo norte (fin vuelta → inicio ida): ${distAperturaNorteCircuito.toFixed(1)} m — ` +
      'dos terminales norte distintas (PARADA 120 vs. Univalle), no cierra perfecto, es el dato tal cual vino del KML, no se maquilla ni se inventa un conector.',
  );

  const ramalesConGeometria = RAMALES.map((r) => ({
    ...r,
    coords: requerirLineString(kml, r.kmlLineName),
    paradaCoord: requerirPunto(kml, r.kmlParadaName),
  }));
  console.table(ramalesConGeometria.map((r) => ({ ramal: r.kmlLineName, vertices: r.coords.length, parada: r.kmlParadaName })));

  const paradaPrincipalCoord = requerirPunto(kml, KML_PARADA_PRINCIPAL);
  const paradaUnivalleCoord = requerirPunto(kml, KML_PARADA_UNIVALLE);

  const puntosAndry = cargarPuntosControlAndry(PUNTOS_CONTROL_JSON_PATH);
  console.log(`  puntos-control-andry.json: ${puntosAndry.length} puntos.`);
  const idsConfigurados = new Set(Object.keys(PUNTOS_CONTROL_CONFIG));
  const idsJson = new Set(puntosAndry.map((p) => p.id));
  for (const id of idsJson) {
    if (!idsConfigurados.has(id)) throw new Error(`puntos-control-andry.json trae "${id}" pero PUNTOS_CONTROL_CONFIG no lo tiene mapeado — bug en el script.`);
  }
  for (const id of idsConfigurados) {
    if (!idsJson.has(id)) throw new Error(`PUNTOS_CONTROL_CONFIG espera "${id}" pero no está en puntos-control-andry.json.`);
  }
  if (puntosAndry.length !== 16) {
    throw new Error(`puntos-control-andry.json tiene ${puntosAndry.length} puntos, se esperaban 16.`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('BEGIN');
    // Bypass de RLS — `lineas` tiene FORCE ROW LEVEL SECURITY + policy `tenant_isolation`
    // (rutas/variantes/paradas/puntos_control heredan tenant vía lineaId, sin RLS propia).
    // Mismo mecanismo que cargar-circuito-z12.ts / crear-credencial-pasante.ts.
    await client.query(`SELECT set_config('app.rol', 'admin_quivo', true)`);
    await client.query(`SELECT set_config('app.sindicato_id', '', true)`);

    // ------------------------------------------------------------------------------------
    // Paso 1 — Línea 120
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 1: línea 120 ---');
    await client.query(
      `INSERT INTO lineas (id, "sindicatoId", codigo, nombre, "createdAt", "updatedAt")
       VALUES ($1, $2, '120', $3, now(), now())
       ON CONFLICT (id) DO UPDATE SET "sindicatoId" = EXCLUDED."sindicatoId", codigo = EXCLUDED.codigo, nombre = EXCLUDED.nombre, "updatedAt" = now()`,
      [LINEA_120_ID, SINDICATO_PILOTO_ID, kml.documentoNombre],
    );
    console.log(`  Línea 120 (${LINEA_120_ID}): codigo="120", nombre="${kml.documentoNombre}".`);

    // ------------------------------------------------------------------------------------
    // Paso 2 — Las 10 rutas: 2 del tronco + 8 ramales (misma tabla, ver "Decisión de
    // modelado" en la cabecera).
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 2: rutas (tronco ida/vuelta + 8 ramales) ---');

    const rutasAUpsertear: { id: string; sentido: string; coords: Coord[] }[] = [
      // Fix 2026-08-18: `circuito` es la ruta que ahora lleva las asignaciones y los puntos
      // de control del tronco (ver Paso 4 y Paso 6). `ida`/`vuelta` se mantienen tal cual
      // (mismo dato del KML, siguen sirviendo para dibujar cada sentido) pero ya no cuelgan
      // puntos de control ni reciben asignaciones — ver "Idempotencia" en la cabecera.
      { id: RUTA_120_IDA_ID, sentido: 'ida', coords: tronoIda },
      { id: RUTA_120_VUELTA_ID, sentido: 'vuelta', coords: troncoVuelta },
      { id: RUTA_120_CIRCUITO_ID, sentido: 'circuito', coords: circuitoCoords },
      ...ramalesConGeometria.map((r) => ({ id: r.rutaId, sentido: `ramal:${r.slug}`, coords: r.coords })),
    ];

    const tablaRutas: { id: string; sentido: string; vertices: number }[] = [];
    for (const r of rutasAUpsertear) {
      const geoJson = JSON.stringify({ type: 'LineString', coordinates: r.coords });
      await client.query(
        `INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)::geography, 'activo', now(), now())
         ON CONFLICT (id) DO UPDATE SET
           "lineaId" = EXCLUDED."lineaId", sentido = EXCLUDED.sentido, geometria = EXCLUDED.geometria,
           estado = 'activo', "updatedAt" = now()`,
        [r.id, LINEA_120_ID, r.sentido, geoJson],
      );
      const validez = await client.query<{ valida: boolean }>(`SELECT ST_IsValid(geometria::geometry) as valida FROM rutas WHERE id = $1`, [r.id]);
      if (!validez.rows[0]?.valida) throw new Error(`Ruta ${r.id} ("${r.sentido}"): geometría inválida para PostGIS (ST_IsValid = false).`);
      tablaRutas.push({ id: r.id, sentido: r.sentido, vertices: r.coords.length });
    }
    console.table(tablaRutas);

    // ------------------------------------------------------------------------------------
    // Paso 3 — 8 variantes de catálogo (ver "Decisión de modelado")
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 3: variantes (catálogo de ramales, colgadas de la ruta de ida) ---');
    for (const r of RAMALES) {
      await client.query(
        `INSERT INTO variantes (id, "rutaId", nombre, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'activo', now(), now())
         ON CONFLICT (id) DO UPDATE SET "rutaId" = EXCLUDED."rutaId", nombre = EXCLUDED.nombre, estado = 'activo', "updatedAt" = now()`,
        [r.varianteId, RUTA_120_IDA_ID, r.kmlLineName],
      );
    }
    console.log(`  ${RAMALES.length} variantes upserteadas, todas colgando de la ruta de ida (${RUTA_120_IDA_ID}).`);

    // ------------------------------------------------------------------------------------
    // Paso 4 — Puntos de control: soft-delete (estado = 'inactivo') + upsert con ids
    // deterministas, scoped a lineaId = línea 120 (ver "Ids deterministas (UUIDv5)" y
    // "Idempotencia" en la cabecera — nunca toca puntos de otra línea, y respeta el contrato
    // de `schema.prisma:298-310`: nunca DELETE real de `puntos_control`).
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 4: puntos de control (17: 16 de puntos-control-andry.json + Univalle) ---');

    const softDeletePc = await client.query(
      `UPDATE puntos_control SET estado = 'inactivo', "updatedAt" = now()
       WHERE "rutaId" IN (SELECT id FROM rutas WHERE "lineaId" = $1) AND estado = 'activo'`,
      [LINEA_120_ID],
    );
    console.log(`  ${softDeletePc.rowCount} punto(s) de control previos de la línea 120 → estado 'inactivo' (soft-delete, nunca DELETE real).`);

    const tablaPc: { id: string; rutaId: string; orden: number; obligatorio: boolean }[] = [];

    // Fix 2026-08-18 (v2, dato del CTO): PARADA 120 UNIVALLE entra como punto de control
    // orden 0 del circuito — es el marcador de vuelta (el conductor sale de ahí y vuelve ahí,
    // así que es lo que permite contar cada vuelta completa). Coordenada: el mismo Point del
    // KML que ya usamos para la parada (`paradaUnivalleCoord`, Placemark "PARADA 120
    // UNIVALLE") — dato real del sindicato, no un punto inventado. No sale de
    // puntos-control-andry.json (ese archivo no lo trae), por eso se inserta aparte del loop
    // de abajo en lugar de vivir en PUNTOS_CONTROL_CONFIG. Identificador de negocio fijo
    // ("UNIVALLE_MARCADOR_VUELTA") para que el id UUIDv5 sea estable entre corridas.
    {
      const id = idPuntoControl120('UNIVALLE_MARCADOR_VUELTA');
      await client.query(
        `INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, 'activo', now(), now())
         ON CONFLICT (id) DO UPDATE SET
           "rutaId" = EXCLUDED."rutaId", orden = EXCLUDED.orden, coord = EXCLUDED.coord,
           "radioToleranciaM" = EXCLUDED."radioToleranciaM", obligatorio = EXCLUDED.obligatorio,
           estado = 'activo', "updatedAt" = now()`,
        [id, RUTA_120_CIRCUITO_ID, 0, paradaUnivalleCoord[0], paradaUnivalleCoord[1], RADIO_TOLERANCIA_M, true],
      );
      tablaPc.push({ id: 'UNIVALLE', rutaId: RUTA_120_CIRCUITO_ID, orden: 0, obligatorio: true });
    }

    for (const p of puntosAndry) {
      const cfg = PUNTOS_CONTROL_CONFIG[p.id]!; // ya validado arriba que todo id está mapeado
      const id = idPuntoControl120(p.id);
      await client.query(
        `INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, 'activo', now(), now())
         ON CONFLICT (id) DO UPDATE SET
           "rutaId" = EXCLUDED."rutaId", orden = EXCLUDED.orden, coord = EXCLUDED.coord,
           "radioToleranciaM" = EXCLUDED."radioToleranciaM", obligatorio = EXCLUDED.obligatorio,
           estado = 'activo', "updatedAt" = now()`,
        [id, cfg.rutaId, cfg.orden, p.lon, p.lat, RADIO_TOLERANCIA_M, cfg.obligatorio],
      );
      tablaPc.push({ id: p.id, rutaId: cfg.rutaId, orden: cfg.orden, obligatorio: cfg.obligatorio });
    }
    console.table(tablaPc);

    // ------------------------------------------------------------------------------------
    // Paso 5 — Paradas: soft-delete (estado = 'inactivo') + upsert con ids deterministas,
    // scoped a lineaId = línea 120 (mismo tratamiento que el Paso 4 — ver "Ids deterministas
    // (UUIDv5)" en la cabecera; nada referencia hoy `paradaId`, pero la convención del schema
    // es la misma que `PuntoControl`).
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 5: paradas (10, desde el KML) ---');

    const softDeleteParadas = await client.query(
      `UPDATE paradas SET estado = 'inactivo', "updatedAt" = now()
       WHERE "rutaId" IN (SELECT id FROM rutas WHERE "lineaId" = $1) AND estado = 'activo'`,
      [LINEA_120_ID],
    );
    console.log(`  ${softDeleteParadas.rowCount} parada(s) previa(s) de la línea 120 → estado 'inactivo' (soft-delete, nunca DELETE real).`);

    const paradasAInsertar: { nombre: string; rutaId: string; tipo: 'origen' | 'intermedia' | 'destino'; orden: number; coord: Coord }[] = [
      // Fix 2026-08-18: las 2 paradas del tronco pasan a colgar de la ruta `circuito`
      // (antes: principal en `ida`, univalle en `vuelta` — cada una con su propio orden 0).
      // Fix 2026-08-18 (v2, dato del CTO): hoy el recorrido SALE de Univalle, no de PARADA
      // 120 — Univalle pasa a `origen`, PARADA 120 queda como `intermedia` del circuito.
      { nombre: KML_PARADA_UNIVALLE, rutaId: RUTA_120_CIRCUITO_ID, tipo: 'origen', orden: 0, coord: paradaUnivalleCoord },
      { nombre: KML_PARADA_PRINCIPAL, rutaId: RUTA_120_CIRCUITO_ID, tipo: 'intermedia', orden: 1, coord: paradaPrincipalCoord },
      ...ramalesConGeometria.map((r) => ({
        nombre: r.kmlParadaName,
        rutaId: r.rutaId,
        tipo: 'destino' as const,
        orden: 0,
        coord: r.paradaCoord,
      })),
    ];

    for (const p of paradasAInsertar) {
      const id = idParada120(p.nombre);
      await client.query(
        `INSERT INTO paradas (id, "rutaId", tipo, orden, coord, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, 'activo', now(), now())
         ON CONFLICT (id) DO UPDATE SET
           "rutaId" = EXCLUDED."rutaId", tipo = EXCLUDED.tipo, orden = EXCLUDED.orden, coord = EXCLUDED.coord,
           estado = 'activo', "updatedAt" = now()`,
        [id, p.rutaId, p.tipo, p.orden, p.coord[0], p.coord[1]],
      );
    }
    console.table(paradasAInsertar.map((p) => ({ nombre: p.nombre, rutaId: p.rutaId, tipo: p.tipo })));
    console.log(`  ${paradasAInsertar.length} paradas upserteadas (ids deterministas — re-correr converge, no duplica).`);

    // ------------------------------------------------------------------------------------
    // Paso 6 — Reasignar la rotación: alternar Z12/120 día por medio (QUI-383) para las 30
    // asignaciones ya existentes (15 titular + 15 pasante).
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 6: alternación Z12/120 de la rotación (2026-08-17..31) ---');

    const fechas = fechasRotacion();
    const tablaAlternacion = fechas.map((f) => ({ fecha: fechaIsoDeUtc(f), linea: lineaParaFecha(f), rutaId: rutaIdParaFecha(f) }));
    console.table(tablaAlternacion);

    for (const vehiculoId of [VEHICULO_TITULAR_ID, VEHICULO_PASANTE_ID]) {
      for (const fecha of fechas) {
        const fechaTexto = fechaIsoDeUtc(fecha);
        const rutaId = rutaIdParaFecha(fecha);
        const resultado = await client.query(
          `UPDATE asignaciones SET "rutaId" = $1, "updatedAt" = now()
           WHERE "vehiculoId" = $2 AND fecha = $3 AND horario = $4`,
          [rutaId, vehiculoId, fechaTexto, HORARIO_ROTACION],
        );
        if (resultado.rowCount !== 1) {
          throw new Error(
            `Esperaba actualizar exactamente 1 asignación para vehiculoId=${vehiculoId}, fecha=${fechaTexto}, horario='${HORARIO_ROTACION}' ` +
              `y se actualizaron ${resultado.rowCount}. El brief asume que las 30 asignaciones (15+15) ya existen — revisar antes de continuar.`,
          );
        }
      }
      console.log(`  Vehículo ${vehiculoId}: 15 asignaciones reasignadas según la tabla de arriba.`);
    }

    // ------------------------------------------------------------------------------------
    // Paso 7 — Verificación final de solo lectura
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 7: verificación final ---');

    const vertIda = await contarVertices(client, RUTA_120_IDA_ID);
    const vertVuelta = await contarVertices(client, RUTA_120_VUELTA_ID);
    const vertCircuito = await contarVertices(client, RUTA_120_CIRCUITO_ID);
    console.log(`  Vértices ruta ida:      ${vertIda} (esperado ${tronoIda.length})`);
    console.log(`  Vértices ruta vuelta:   ${vertVuelta} (esperado ${troncoVuelta.length})`);
    console.log(`  Vértices ruta circuito: ${vertCircuito} (esperado ${circuitoCoords.length}, calculado en el Paso 0 — no hardcodeado)`);
    if (vertIda !== tronoIda.length) throw new Error(`Ruta ida: ST_NumPoints devuelve ${vertIda}, se esperaban ${tronoIda.length}.`);
    if (vertVuelta !== troncoVuelta.length) throw new Error(`Ruta vuelta: ST_NumPoints devuelve ${vertVuelta}, se esperaban ${troncoVuelta.length}.`);
    if (vertCircuito !== circuitoCoords.length) throw new Error(`Ruta circuito: ST_NumPoints devuelve ${vertCircuito}, se esperaban ${circuitoCoords.length}.`);

    // +1 = PARADA 120 UNIVALLE (orden 0), que no sale de puntos-control-andry.json — ver Paso 4.
    const puntosControlCircuito = puntosAndry.filter((p) => PUNTOS_CONTROL_CONFIG[p.id]!.rutaId === RUTA_120_CIRCUITO_ID).length + 1;
    const puntosControlCircuitoCount = await contarFilas(client, `SELECT count(*) FROM puntos_control WHERE "rutaId" = $1 AND estado = 'activo'`, [RUTA_120_CIRCUITO_ID]);
    console.log(`  Puntos de control activos de la ruta circuito: ${puntosControlCircuitoCount} (esperado ${puntosControlCircuito})`);
    if (puntosControlCircuitoCount !== puntosControlCircuito) {
      throw new Error(`Ruta circuito: se esperaban ${puntosControlCircuito} puntos de control activos, hay ${puntosControlCircuitoCount}.`);
    }

    const variantesCount = await contarFilas(client, `SELECT count(*) FROM variantes WHERE "rutaId" = $1 AND estado = 'activo'`, [RUTA_120_IDA_ID]);
    console.log(`  Variantes activas de la ruta ida: ${variantesCount} (esperado ${RAMALES.length})`);
    if (variantesCount !== RAMALES.length) throw new Error(`Se esperaban ${RAMALES.length} variantes activas, hay ${variantesCount}.`);

    const puntosControlCount = await contarFilas(
      client,
      `SELECT count(*) FROM puntos_control pc JOIN rutas r ON r.id = pc."rutaId" WHERE r."lineaId" = $1 AND pc.estado = 'activo'`,
      [LINEA_120_ID],
    );
    // +1 = PARADA 120 UNIVALLE (no viene de puntos-control-andry.json, ver Paso 4).
    const puntosControlEsperadosTotal = puntosAndry.length + 1;
    console.log(`  Puntos de control activos de la línea 120: ${puntosControlCount} (esperado ${puntosControlEsperadosTotal})`);
    if (puntosControlCount !== puntosControlEsperadosTotal) {
      throw new Error(`Se esperaban ${puntosControlEsperadosTotal} puntos de control activos, hay ${puntosControlCount}.`);
    }

    const paradasCount = await contarFilas(
      client,
      `SELECT count(*) FROM paradas p JOIN rutas r ON r.id = p."rutaId" WHERE r."lineaId" = $1 AND p.estado = 'activo'`,
      [LINEA_120_ID],
    );
    console.log(`  Paradas activas de la línea 120: ${paradasCount} (esperado ${paradasAInsertar.length})`);
    if (paradasCount !== paradasAInsertar.length) throw new Error(`Se esperaban ${paradasAInsertar.length} paradas activas, hay ${paradasCount}.`);

    console.log('\n  ¿La asignación de HOY (fecha calendario Bolivia) de ambos vehículos apunta a la ruta que le toca?');
    const hoyBolivia = fechaActualBolivia();
    const hoyTexto = fechaIsoDeUtc(hoyBolivia);
    const hoyDentroDeRango = hoyTexto >= PRIMERA_FECHA && hoyTexto <= ULTIMA_FECHA;
    if (!hoyDentroDeRango) {
      console.warn(`  ⚠ Hoy (${hoyTexto}) cae fuera del rango ${PRIMERA_FECHA}..${ULTIMA_FECHA} — no hay nada que verificar para "hoy".`);
    } else {
      const rutaEsperadaHoy = rutaIdParaFecha(hoyBolivia);
      const lineaEsperadaHoy = lineaParaFecha(hoyBolivia);
      for (const vehiculoId of [VEHICULO_TITULAR_ID, VEHICULO_PASANTE_ID]) {
        const fila = await client.query<{ rutaid: string }>(
          `SELECT "rutaId" as rutaid FROM asignaciones WHERE "vehiculoId" = $1 AND fecha = $2 AND horario = $3`,
          [vehiculoId, hoyTexto, HORARIO_ROTACION],
        );
        const rutaIdActual = fila.rows[0]?.rutaid;
        if (rutaIdActual !== rutaEsperadaHoy) {
          throw new Error(
            `Vehículo ${vehiculoId}: hoy (${hoyTexto}, línea ${lineaEsperadaHoy}) su asignación apunta a rutaId=${rutaIdActual ?? '(ninguna)'} ` +
              `pero se esperaba ${rutaEsperadaHoy}.`,
          );
        }
        console.log(`  ✅ Vehículo ${vehiculoId}: hoy (${hoyTexto}) → línea ${lineaEsperadaHoy} → rutaId ${rutaIdActual}. OK.`);
      }
    }

    // ------------------------------------------------------------------------------------
    // Cierre
    // ------------------------------------------------------------------------------------
    if (APLICAR) {
      await client.query('COMMIT');
      console.log('\n✅ COMMIT. Cambios aplicados en producción.');
    } else {
      await client.query('ROLLBACK');
      console.log('\n🟡 DRY-RUN: ROLLBACK explícito — nada quedó escrito en la base.');
      console.log('   Para aplicar de verdad: agregar --apply a la misma línea de comando.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Abortado, ROLLBACK. Nada quedó escrito en la base.');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// ============================================================================================
// Helpers de parseo/consulta
// ============================================================================================

function requerirLineString(kml: KmlParseado, nombre: string): Coord[] {
  const coords = kml.linestrings.get(nombre);
  if (!coords) throw new Error(`KML: no se encontró el Placemark LineString "${nombre}".`);
  return coords;
}

function requerirPunto(kml: KmlParseado, nombre: string): Coord {
  const coord = kml.puntos.get(nombre);
  if (!coord) throw new Error(`KML: no se encontró el Placemark Point "${nombre}".`);
  return coord;
}

async function contarVertices(client: InstanceType<typeof Client>, rutaId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(`SELECT ST_NumPoints(geometria::geometry) as n FROM rutas WHERE id = $1`, [rutaId]);
  const n = rows[0]?.n;
  if (n === undefined) throw new Error(`Ruta ${rutaId} no encontrada al verificar vértices.`);
  return Number(n);
}

async function contarFilas(client: InstanceType<typeof Client>, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await client.query<{ count: string }>(sql, params);
  return Number(rows[0]!.count);
}

main();
