import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  MobilityCityIdSchema,
  PublicLineDetailSchema,
  type PublicLineDetail,
  type PublicRoute,
  type PublicStop,
} from '@quivo/shared';

const LIMITE_DEFECTO = 100;
const LIMITE_MAXIMO = 500;

export interface ListarLineasPublicasQuery {
  cityId?: string;
  since?: Date;
  limit?: number;
  afterId?: string;
}

interface LineaCursorRow {
  id: string;
  effectiveUpdatedAt: Date;
}

interface LineRow {
  id: string;
  cityId: string;
  cityName: string;
  departmentCode: string | null;
  departmentName: string | null;
  operatorId: string;
  operatorName: string;
  code: string;
  name: string;
  description: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  textColor: string | null;
  logoUrl: string | null;
  shortName: string | null;
  tagline: string | null;
  markerType: string | null;
  markerValue: string | null;
  roofSign: string | null;
}

interface RouteRow {
  id: string;
  cityId: string;
  lineId: string;
  direction: string;
  geometry: string; // GeoJSON como texto — ST_AsGeoJSON devuelve `text`, no JSON nativo.
  updatedAt: Date;
}

interface VariantRow {
  id: string;
  name: string;
}

interface VariantRowBatch extends VariantRow {
  rutaId: string;
}

interface StopRow {
  id: string;
  cityId: string;
  routeId: string;
  name: string | null;
  reference: string | null;
  type: 'origen' | 'intermedia' | 'destino';
  order: number;
  coordinate: string;
  updatedAt: Date;
}

/**
 * Catálogo público de sincronización para QUIVO Rutas (producto aparte, repo aparte):
 * un único endpoint de lectura masiva — `GET /public/mobility/lines` — que expone las
 * líneas publicadas de Control con su árbol completo (rutas → variantes/paradas). No hay
 * guarda de tenant: la única barrera es la proyección Zod (`PublicLineDetailSchema`), así
 * que cada columna que sale acá tiene que estar pensada para ser pública.
 *
 * **Esta sincronización no informa bajas.** Una línea despublicada o borrada simplemente
 * deja de aparecer en el resultado — no hay tombstones. Un `since` incremental nunca se
 * entera de esa ausencia. QUIVO Rutas tiene que hacer, además de la descarga incremental,
 * una descarga completa periódica (sin `since`) para reconciliar bajas por comparación de
 * conjuntos, o vivir con datos obsoletos de líneas que ya no existen.
 *
 * **Cinco queries fijas por página, nunca una por entidad.** El cursor trae los ids de la
 * página; después una consulta trae todas las líneas de esa página, otra todas sus rutas,
 * otra todas las variantes y otra todas las paradas — cada una con `WHERE ... IN (...)`
 * sobre los ids ya resueltos, nunca un round-trip por fila. Con `limit=500` y varias rutas
 * por línea, un N+1 acá multiplica por miles los round-trips de una sola transacción — la
 * transacción quedaría abierta mucho tiempo y un cliente sincronizando el catálogo completo
 * empezaría a ver timeouts. El agrupado por `lineaId`/`rutaId` se hace en memoria, no en SQL.
 *
 * **Corre como `admin_quivo` (`sindicatoId: null`), o sea que la política RLS lo deja leer
 * TODOS los sindicatos.** Es necesario para armar un catálogo público que cruza tenants y
 * lo aprobó el CTO — pero significa que el radio de daño de un error en este archivo es
 * todos los tenants, no uno. Por eso la proyección explícita (nunca `SELECT *`, columna por
 * columna) y los filtros de `publicStatus`/`estado` en los cuatro niveles (línea, ruta,
 * variante, parada) no son opcionales ni negociables al tocar este archivo.
 */
@Injectable()
export class PublicMobilityService {
  /**
   * `updatedAt` en la respuesta es el máximo entre el propio de la línea y el de toda su
   * descendencia visible (rutas/variantes/paradas publicadas) — nunca el campo crudo de
   * `lineas.updatedAt`. Si sólo mirara el propio, un cambio exclusivo en una parada (mover
   * una coordenada, renombrarla) no movería el cursor de esa línea: quien sincroniza con
   * `since = <último valor recibido>` jamás volvería a verla, con datos desactualizados
   * para siempre y sin ningún error visible. Ordenar, filtrar (`since`/`afterId`) y exponer
   * tienen que usar ese mismo valor — si se ordenara por un campo y se filtrara por otro,
   * la paginación con `afterId` podría saltear o repetir filas.
   */
  async listarLineas(query: ListarLineasPublicasQuery): Promise<PublicLineDetail[]> {
    const cityId = query.cityId !== undefined ? parseCityId(query.cityId) : null;
    const limit = parseLimite(query.limit);

    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const cursor = query.afterId !== undefined ? await resolverCursor(tx, query.afterId) : null;
      if (query.afterId !== undefined && !cursor) {
        // El id no existe, no es una línea, o ya no es visible (se despublicó entre una
        // página y la siguiente) — no hay una posición válida desde donde continuar.
        throw new BadRequestException('afterId no corresponde a una línea pública visible');
      }

      const cursorFilter = construirFiltroCursor(query.since, cursor);
      const cityFilter = cityId !== null ? Prisma.sql`AND l."cityId" = ${cityId}` : Prisma.empty;

      const filas = await tx.$queryRaw<LineaCursorRow[]>`
        WITH linea_efectiva AS (
          ${lineaEfectivaSelect(cityFilter)}
        )
        SELECT id, "effectiveUpdatedAt"
        FROM linea_efectiva
        ${cursorFilter}
        ORDER BY "effectiveUpdatedAt" ASC, id ASC
        LIMIT ${limit}
      `;

      return construirDetallesPagina(tx, filas);
    });
  }
}

/**
 * CTE reusado por la query principal y por `resolverCursor`: calcula, por línea publicada
 * (con el filtro de ciudad opcional que le pase el caller), el `effectiveUpdatedAt` —
 * `GREATEST` entre `lineas.updatedAt` y el máximo `updatedAt` de sus rutas/variantes/paradas
 * publicadas y activas. Los `LEFT JOIN LATERAL` devuelven `NULL` cuando la línea no tiene
 * ningún descendiente publicado todavía (línea recién publicada, sin rutas debajo) — de ahí
 * el `COALESCE` a `l."updatedAt"` en cada rama.
 */
function lineaEfectivaSelect(cityFilter: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      l.id,
      GREATEST(
        l."updatedAt",
        COALESCE(rutas_max."updatedAt", l."updatedAt"),
        COALESCE(variantes_max."updatedAt", l."updatedAt"),
        COALESCE(paradas_max."updatedAt", l."updatedAt")
      ) AS "effectiveUpdatedAt"
    FROM lineas l
    LEFT JOIN LATERAL (
      SELECT MAX(r."updatedAt") AS "updatedAt"
      FROM rutas r
      WHERE r."lineaId" = l.id AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
    ) rutas_max ON true
    LEFT JOIN LATERAL (
      SELECT MAX(v."updatedAt") AS "updatedAt"
      FROM variantes v
      JOIN rutas r2 ON r2.id = v."rutaId"
      WHERE r2."lineaId" = l.id AND r2."publicStatus" = 'publicado' AND r2.estado = 'activo'
        AND v."publicStatus" = 'publicado' AND v.estado = 'activo'
    ) variantes_max ON true
    LEFT JOIN LATERAL (
      SELECT MAX(p."updatedAt") AS "updatedAt"
      FROM paradas p
      JOIN rutas r3 ON r3.id = p."rutaId"
      WHERE r3."lineaId" = l.id AND r3."publicStatus" = 'publicado' AND r3.estado = 'activo'
        AND p."publicStatus" = 'publicado' AND p.estado = 'activo'
    ) paradas_max ON true
    WHERE l."publicStatus" = 'publicado'
    ${cityFilter}
  `;
}

/**
 * Resuelve el `effectiveUpdatedAt` exacto de `afterId` en este momento (no el que tenía
 * cuando el cliente lo recibió) — es la posición desde la que se retoma la paginación. Sin
 * filtro de ciudad: `afterId` ya identifica una línea puntual, no hace falta re-acotarla.
 */
async function resolverCursor(
  tx: Prisma.TransactionClient,
  afterId: string,
): Promise<LineaCursorRow | null> {
  const filas = await tx.$queryRaw<LineaCursorRow[]>`
    WITH linea_efectiva AS (
      ${lineaEfectivaSelect(Prisma.empty)}
    )
    SELECT id, "effectiveUpdatedAt" FROM linea_efectiva WHERE id = ${afterId}
  `;
  return filas[0] ?? null;
}

/**
 * `(a, b) > (x, y)` es comparación de tuplas de Postgres (orden lexicográfico) — evita
 * escribir a mano el `OR` de desempate (`effectiveUpdatedAt > x OR (effectiveUpdatedAt = x
 * AND id > y)`) que necesita cualquier keyset pagination con más de una columna de orden.
 * `afterId` manda sobre `since` cuando ambos vienen: es la posición exacta de la última fila
 * ya entregada, más precisa que el timestamp que el cliente guardó.
 */
function construirFiltroCursor(since: Date | undefined, cursor: LineaCursorRow | null): Prisma.Sql {
  if (cursor) {
    return Prisma.sql`WHERE ("effectiveUpdatedAt", id) > (${cursor.effectiveUpdatedAt}::timestamp, ${cursor.id}::text)`;
  }
  if (since) {
    return Prisma.sql`WHERE "effectiveUpdatedAt" > ${since}::timestamp`;
  }
  return Prisma.empty;
}

/**
 * Ensambla la página completa con cinco queries fijas (una por el cursor, ya hecha por el
 * caller, más las cuatro de acá) en vez de una por línea/ruta — ver el docstring de la clase
 * para el porqué. El agrupado por `lineaId`/`rutaId` pasa a memoria; el orden final sigue
 * viniendo de SQL en cada nivel (`ORDER BY` de cada query), nunca de un `Array.sort` que
 * pudiera desviarse silenciosamente del contrato ("rutas por `createdAt`, variantes por
 * nombre, paradas por `orden`" — igual que antes del refactor).
 */
async function construirDetallesPagina(
  tx: Prisma.TransactionClient,
  pagina: LineaCursorRow[],
): Promise<PublicLineDetail[]> {
  if (pagina.length === 0) return [];
  const lineIds = pagina.map((fila) => fila.id);

  const lineas = await obtenerLineasFilas(tx, lineIds);
  const lineaPorId = new Map(lineas.map((linea) => [linea.id, linea]));

  const rutas = await listarRutasDeLineas(tx, lineIds);
  const routeIds = rutas.map((ruta) => ruta.id);

  const [variantes, paradas] =
    routeIds.length > 0
      ? await Promise.all([listarVariantesDeRutas(tx, routeIds), listarParadasDeRutas(tx, routeIds)])
      : [[] as VariantRowBatch[], [] as StopRow[]];

  // Los tres `ORDER BY ... , <criterio propio>` de las queries de abajo (rutas por
  // "lineaId", "createdAt"; variantes por "rutaId", nombre; paradas por "rutaId", orden)
  // hacen que agrupar preservando el orden de llegada alcance — no hace falta un sort acá.
  const rutasPorLinea = agruparPor(rutas, (ruta) => ruta.lineId);
  const variantesPorRuta = agruparPor(variantes, (variante) => variante.rutaId);
  const paradasPorRuta = agruparPor(paradas, (parada) => parada.routeId);

  const detalles: PublicLineDetail[] = [];
  for (const fila of pagina) {
    // La línea se despublicó entre la query del cursor y ésta (dos sentencias, no una sola
    // foto de la transacción) — se omite de la página en vez de romper toda la respuesta.
    const linea = lineaPorId.get(fila.id);
    if (!linea) continue;

    const routes = (rutasPorLinea.get(fila.id) ?? []).map((ruta) =>
      toPublicRoute(
        ruta,
        (variantesPorRuta.get(ruta.id) ?? []).map(toPublicVariant),
        (paradasPorRuta.get(ruta.id) ?? []).map(toPublicStop),
      ),
    );
    detalles.push(
      PublicLineDetailSchema.parse({
        ...toPublicLine(linea, fila.effectiveUpdatedAt),
        routes,
      }),
    );
  }
  return detalles;
}

function agruparPor<T, K>(filas: T[], clave: (fila: T) => K): Map<K, T[]> {
  const mapa = new Map<K, T[]>();
  for (const fila of filas) {
    const llave = clave(fila);
    const grupo = mapa.get(llave);
    if (grupo) {
      grupo.push(fila);
    } else {
      mapa.set(llave, [fila]);
    }
  }
  return mapa;
}

/**
 * Proyección explícita, columna por columna — nunca `SELECT l.*`. Nada de esto puede filtrar
 * `credencialHash`, ids internos de sindicato ajenos al operador público, ni ninguna columna
 * que no tenga ya su lugar en `PublicLineSchema`. `ids` va parametrizado vía `Prisma.join`
 * (cada id es su propio bind, nunca texto interpolado).
 */
async function obtenerLineasFilas(tx: Prisma.TransactionClient, ids: string[]): Promise<LineRow[]> {
  return tx.$queryRaw<LineRow[]>`
    SELECT
      l.id, l."cityId" AS "cityId", c.nombre AS "cityName",
      c."departamentoCodigo" AS "departmentCode", c."departamentoNombre" AS "departmentName",
      s.id AS "operatorId", s.nombre AS "operatorName", l.codigo AS code, l.nombre AS name,
      l.descripcion AS description, l.color AS "primaryColor", l."colorSecundario" AS "secondaryColor",
      l."colorTexto" AS "textColor", l."logoUrl" AS "logoUrl", l."nombreCorto" AS "shortName",
      l.lema AS tagline, l."distintivoTipo" AS "markerType", l."distintivoValor" AS "markerValue",
      l."cartelSuperior" AS "roofSign"
    FROM lineas l
    JOIN sindicatos s ON s.id = l."sindicatoId"
    JOIN mobility_cities c ON c.id = l."cityId"
    WHERE l.id IN (${Prisma.join(ids)}) AND l."publicStatus" = 'publicado'
  `;
}

async function listarRutasDeLineas(tx: Prisma.TransactionClient, lineIds: string[]): Promise<RouteRow[]> {
  return tx.$queryRaw<RouteRow[]>`
    SELECT r.id, l."cityId" AS "cityId", r."lineaId" AS "lineId", r.sentido AS direction,
           ST_AsGeoJSON(r.geometria) AS geometry, r."updatedAt" AS "updatedAt"
    FROM rutas r
    JOIN lineas l ON l.id = r."lineaId"
    WHERE r."lineaId" IN (${Prisma.join(lineIds)}) AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
      AND l."publicStatus" = 'publicado'
    ORDER BY r."lineaId" ASC, r."createdAt" ASC
  `;
}

async function listarVariantesDeRutas(tx: Prisma.TransactionClient, routeIds: string[]): Promise<VariantRowBatch[]> {
  return tx.$queryRaw<VariantRowBatch[]>`
    SELECT id, "rutaId" AS "rutaId", nombre AS name FROM variantes
    WHERE "rutaId" IN (${Prisma.join(routeIds)}) AND "publicStatus" = 'publicado' AND estado = 'activo'
    ORDER BY "rutaId" ASC, nombre ASC
  `;
}

async function listarParadasDeRutas(tx: Prisma.TransactionClient, routeIds: string[]): Promise<StopRow[]> {
  return tx.$queryRaw<StopRow[]>`
    SELECT p.id, l."cityId" AS "cityId", p."rutaId" AS "routeId", p.nombre AS name, p.referencia AS reference,
           p.tipo AS type, p.orden AS order, ST_AsGeoJSON(p.coord) AS coordinate, p."updatedAt" AS "updatedAt"
    FROM paradas p
    JOIN rutas r ON r.id = p."rutaId"
    JOIN lineas l ON l.id = r."lineaId"
    WHERE p."rutaId" IN (${Prisma.join(routeIds)}) AND p."publicStatus" = 'publicado' AND p.estado = 'activo'
      AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
      AND l."publicStatus" = 'publicado'
      AND p.nombre IS NOT NULL
    ORDER BY p."rutaId" ASC, p.orden ASC
  `;
}

function toPublicLine(row: LineRow, effectiveUpdatedAt: Date) {
  return {
    id: row.id,
    cityId: row.cityId,
    cityName: row.cityName,
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    operator: { id: row.operatorId, name: row.operatorName },
    code: row.code,
    name: row.name,
    description: row.description,
    branding: {
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      textColor: row.textColor,
      logoUrl: row.logoUrl,
      shortName: row.shortName,
      tagline: row.tagline,
      markerType: row.markerType,
      markerValue: row.markerValue,
      roofSign: row.roofSign,
    },
    updatedAt: effectiveUpdatedAt.toISOString(),
  };
}

function toPublicRoute(row: RouteRow, variants: VariantRow[], stops: PublicStop[]): PublicRoute {
  return {
    id: row.id,
    cityId: row.cityId,
    lineId: row.lineId,
    direction: row.direction,
    geometry: JSON.parse(row.geometry),
    variants,
    stops,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicVariant(row: VariantRowBatch): { id: string; name: string } {
  return { id: row.id, name: row.name };
}

function toPublicStop(row: StopRow): PublicStop {
  // Invariante, no una entrada de usuario: la query ya filtra `p.nombre IS NOT NULL`. Si
  // esto dispara es un bug de la query, no un 400 del cliente.
  if (!row.name) throw new Error(`Parada pública ${row.id} sin nombre pese al filtro SQL`);
  return {
    id: row.id,
    cityId: row.cityId,
    routeId: row.routeId,
    name: row.name,
    reference: row.reference,
    type: row.type,
    order: row.order,
    coordinate: JSON.parse(row.coordinate),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function parseCityId(cityId: string): string {
  const result = MobilityCityIdSchema.safeParse(cityId);
  if (!result.success) throw new BadRequestException('cityId inválido');
  return result.data;
}

export function parseLimite(limit: number | undefined): number {
  if (limit === undefined) return LIMITE_DEFECTO;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BadRequestException('limit debe ser un entero positivo');
  }
  return Math.min(limit, LIMITE_MAXIMO);
}
