import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  MobilityCityIdSchema,
  PublicMobilityCitySchema,
  PublicLineDetailSchema,
  PublicLineSchema,
  PublicRouteSchema,
  PublicStopSchema,
  PublicVehicleQrSchema,
  type PublicMobilityCity,
  type PublicLine,
  type PublicLineDetail,
  type PublicRoute,
  type PublicStop,
  type PublicVehicleQr,
} from '@quivo/shared';
import type { Prisma } from '@quivo/db';

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
  updatedAt: Date;
}

interface RouteRow {
  id: string;
  cityId: string;
  lineId: string;
  direction: string;
  geometry: string;
  updatedAt: Date;
}

interface VariantRow { id: string; name: string }

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

interface CityRow {
  id: string;
  name: string;
  departmentCode: string | null;
  departmentName: string | null;
  countryCode: string;
  timezone: string;
  coverageStatus: string;
  sourceType: string | null;
  sourceName: string | null;
  sourceLicense: string | null;
  sourceUpdatedAt: Date | null;
  availableModes: string[];
  auxiliaryServices: string[];
}

@Injectable()
export class PublicMobilityService {
  async listarCiudades(): Promise<{ items: PublicMobilityCity[] }> {
    const rows = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.$queryRaw<CityRow[]>`
        SELECT
          id,
          nombre AS name,
          "departamentoCodigo" AS "departmentCode",
          "departamentoNombre" AS "departmentName",
          "paisCodigo" AS "countryCode",
          "zonaHoraria" AS timezone,
          "estadoCobertura" AS "coverageStatus",
          "fuenteTipo" AS "sourceType",
          "fuenteNombre" AS "sourceName",
          "fuenteLicencia" AS "sourceLicense",
          "fuenteActualizadaAt" AS "sourceUpdatedAt",
          "modosDisponibles" AS "availableModes",
          "serviciosAuxiliares" AS "auxiliaryServices"
        FROM mobility_cities
        ORDER BY CASE "estadoCobertura"
          WHEN 'ready' THEN 0
          WHEN 'community' THEN 1
          ELSE 2
        END, nombre ASC
      `,
    );
    return { items: rows.map(toPublicCity) };
  }

  async listarLineas(query: string | undefined, rawLimit: string | undefined, requestedCityId?: string): Promise<{ items: PublicLine[] }> {
    const limit = parseLimit(rawLimit);
    const term = normalizarConsulta(query);
    const cityId = normalizarCityId(requestedCityId);
    const rows = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.$queryRaw<LineRow[]>`
        SELECT
          l.id, l."cityId" AS "cityId", c.nombre AS "cityName",
          c."departamentoCodigo" AS "departmentCode", c."departamentoNombre" AS "departmentName",
          s.id AS "operatorId", s.nombre AS "operatorName", l.codigo AS code, l.nombre AS name,
          l.descripcion AS description, l.color AS "primaryColor", l."colorSecundario" AS "secondaryColor",
          l."colorTexto" AS "textColor", l."logoUrl" AS "logoUrl", l."nombreCorto" AS "shortName",
          l.lema AS tagline, l."distintivoTipo" AS "markerType", l."distintivoValor" AS "markerValue",
          l."cartelSuperior" AS "roofSign", l."updatedAt" AS "updatedAt"
        FROM lineas l
        JOIN sindicatos s ON s.id = l."sindicatoId"
        JOIN mobility_cities c ON c.id = l."cityId"
        WHERE l."publicStatus" = 'publicado'
          AND l."cityId" = ${cityId}
          AND (${term} = ''
            OR l.codigo ILIKE ${`%${term}%`}
            OR l.nombre ILIKE ${`%${term}%`}
            OR l."nombreCorto" ILIKE ${`%${term}%`}
            OR s.nombre ILIKE ${`%${term}%`})
        ORDER BY l.codigo ASC
        LIMIT ${limit}
      `,
    );
    return { items: rows.map(toPublicLine) };
  }

  async obtenerLinea(id: string, requestedCityId?: string): Promise<PublicLineDetail> {
    const cityId = normalizarCityId(requestedCityId);
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const line = await obtenerLineaPublica(tx, id, cityId);
      const routes = await listarRutasPublicas(tx, id, cityId);
      return PublicLineDetailSchema.parse({ ...toPublicLine(line), routes });
    });
  }

  async obtenerRuta(id: string, requestedCityId?: string): Promise<PublicRoute> {
    const cityId = normalizarCityId(requestedCityId);
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const rows = await tx.$queryRaw<RouteRow[]>`
        SELECT r.id, l."cityId" AS "cityId", r."lineaId" AS "lineId", r.sentido AS direction,
               ST_AsGeoJSON(r.geometria) AS geometry, r."updatedAt" AS "updatedAt"
        FROM rutas r
        JOIN lineas l ON l.id = r."lineaId"
        WHERE r.id = ${id}
          AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
          AND l."publicStatus" = 'publicado'
          AND l."cityId" = ${cityId}
      `;
      const row = rows[0];
      if (!row) throw new NotFoundException('Ruta pública no encontrada');
      return toPublicRoute(row, await listarVariantesPublicas(tx, row.id), await listarParadasPublicas(tx, row.id));
    });
  }

  async obtenerParada(id: string, requestedCityId?: string): Promise<PublicStop> {
    const cityId = normalizarCityId(requestedCityId);
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const rows = await tx.$queryRaw<StopRow[]>`
        SELECT p.id, l."cityId" AS "cityId", p."rutaId" AS "routeId", p.nombre AS name, p.referencia AS reference,
               p.tipo AS type, p.orden AS order, ST_AsGeoJSON(p.coord) AS coordinate,
               p."updatedAt" AS "updatedAt"
        FROM paradas p
        JOIN rutas r ON r.id = p."rutaId"
        JOIN lineas l ON l.id = r."lineaId"
        WHERE p.id = ${id}
          AND p."publicStatus" = 'publicado' AND p.estado = 'activo'
          AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
          AND l."publicStatus" = 'publicado'
          AND l."cityId" = ${cityId}
      `;
      const row = rows[0];
      if (!row || !row.name) throw new NotFoundException('Parada pública no encontrada');
      return toPublicStop(row);
    });
  }

  /** Autocompletado de destino para pasajeros; sólo retorna paradas publicadas. */
  async listarParadas(query: string | undefined, rawLimit: string | undefined, requestedCityId?: string): Promise<{ items: PublicStop[] }> {
    const term = normalizarConsulta(query);
    const limit = parseLimit(rawLimit);
    const cityId = normalizarCityId(requestedCityId);
    if (term.length < 2) return { items: [] };
    const rows = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.$queryRaw<StopRow[]>`
        SELECT p.id, l."cityId" AS "cityId", p."rutaId" AS "routeId", p.nombre AS name, p.referencia AS reference,
               p.tipo AS type, p.orden AS order, ST_AsGeoJSON(p.coord) AS coordinate,
               p."updatedAt" AS "updatedAt"
        FROM paradas p
        JOIN rutas r ON r.id = p."rutaId"
        JOIN lineas l ON l.id = r."lineaId"
        WHERE p."publicStatus" = 'publicado' AND p.estado = 'activo'
          AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
          AND l."publicStatus" = 'publicado'
          AND l."cityId" = ${cityId}
          AND p.nombre IS NOT NULL
          AND (p.nombre ILIKE ${`%${term}%`} OR p.referencia ILIKE ${`%${term}%`} OR l.codigo ILIKE ${`%${term}%`} OR l.nombre ILIKE ${`%${term}%`})
        ORDER BY p.nombre ASC, p.orden ASC
        LIMIT ${limit}
      `,
    );
    return { items: rows.map(toPublicStop) };
  }

  /**
   * Resuelve el QR impreso de un vehículo sin proyectar datos personales ni la placa.
   * El vínculo sólo existe mientras la sesión y su asignación estén vigentes.
   */
  async resolverQrVehiculo(token: string): Promise<PublicVehicleQr> {
    if (!/^[A-Za-z0-9._~-]{16,256}$/.test(token)) {
      throw new BadRequestException('Código QR inválido');
    }
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const rows = await tx.$queryRaw<{ lineId: string }[]>`
        SELECT l.id AS "lineId"
        FROM vehiculos v
        JOIN sesiones_operativas so ON so."vehiculoId" = v.id
          AND so.estado = 'activa' AND so.fin IS NULL
        JOIN asignaciones a ON a.id = so."asignacionId"
          AND a.estado = 'vigente' AND a."venceAt" > NOW()
        JOIN rutas r ON r.id = a."rutaId"
          AND r.estado = 'activo' AND r."publicStatus" = 'publicado'
        JOIN lineas l ON l.id = r."lineaId" AND l."publicStatus" = 'publicado'
        WHERE v."publicQrToken" = ${token} AND v.estado = 'activo'
        ORDER BY so.inicio DESC
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) throw new NotFoundException('Código QR no disponible');
      return PublicVehicleQrSchema.parse(row);
    });
  }
}

async function obtenerLineaPublica(tx: Prisma.TransactionClient, id: string, cityId: string): Promise<LineRow> {
  const rows = await tx.$queryRaw<LineRow[]>`
    SELECT
      l.id, l."cityId" AS "cityId", c.nombre AS "cityName",
      c."departamentoCodigo" AS "departmentCode", c."departamentoNombre" AS "departmentName",
      s.id AS "operatorId", s.nombre AS "operatorName", l.codigo AS code, l.nombre AS name,
      l.descripcion AS description, l.color AS "primaryColor", l."colorSecundario" AS "secondaryColor",
      l."colorTexto" AS "textColor", l."logoUrl" AS "logoUrl", l."nombreCorto" AS "shortName",
      l.lema AS tagline, l."distintivoTipo" AS "markerType", l."distintivoValor" AS "markerValue",
      l."cartelSuperior" AS "roofSign", l."updatedAt" AS "updatedAt"
    FROM lineas l
    JOIN sindicatos s ON s.id = l."sindicatoId"
    JOIN mobility_cities c ON c.id = l."cityId"
    WHERE l.id = ${id} AND l."publicStatus" = 'publicado' AND l."cityId" = ${cityId}
  `;
  const row = rows[0];
  if (!row) throw new NotFoundException('Línea pública no encontrada');
  return row;
}

async function listarRutasPublicas(tx: Prisma.TransactionClient, lineId: string, cityId: string): Promise<PublicRoute[]> {
  const rows = await tx.$queryRaw<RouteRow[]>`
    SELECT r.id, l."cityId" AS "cityId", r."lineaId" AS "lineId", r.sentido AS direction,
           ST_AsGeoJSON(r.geometria) AS geometry, r."updatedAt" AS "updatedAt"
    FROM rutas r
    JOIN lineas l ON l.id = r."lineaId"
    WHERE r."lineaId" = ${lineId} AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
      AND l."publicStatus" = 'publicado' AND l."cityId" = ${cityId}
    ORDER BY r."createdAt" ASC
  `;
  return Promise.all(rows.map(async (route) =>
    toPublicRoute(route, await listarVariantesPublicas(tx, route.id), await listarParadasPublicas(tx, route.id)),
  ));
}

async function listarVariantesPublicas(tx: Prisma.TransactionClient, routeId: string): Promise<VariantRow[]> {
  return tx.$queryRaw<VariantRow[]>`
    SELECT id, nombre AS name FROM variantes
    WHERE "rutaId" = ${routeId} AND "publicStatus" = 'publicado' AND estado = 'activo'
    ORDER BY nombre ASC
  `;
}

async function listarParadasPublicas(tx: Prisma.TransactionClient, routeId: string): Promise<PublicStop[]> {
  const rows = await tx.$queryRaw<StopRow[]>`
    SELECT p.id, l."cityId" AS "cityId", p."rutaId" AS "routeId", p.nombre AS name, p.referencia AS reference, p.tipo AS type,
           p.orden AS order, ST_AsGeoJSON(p.coord) AS coordinate, p."updatedAt" AS "updatedAt"
    FROM paradas p
    JOIN rutas r ON r.id = p."rutaId"
    JOIN lineas l ON l.id = r."lineaId"
    WHERE p."rutaId" = ${routeId} AND p."publicStatus" = 'publicado' AND p.estado = 'activo'
      AND r."publicStatus" = 'publicado' AND r.estado = 'activo'
      AND l."publicStatus" = 'publicado'
      AND p.nombre IS NOT NULL
    ORDER BY p.orden ASC
  `;
  return rows.map(toPublicStop);
}

function toPublicLine(row: LineRow): PublicLine {
  return PublicLineSchema.parse({
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
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toPublicRoute(row: RouteRow, variants: VariantRow[], stops: PublicStop[]): PublicRoute {
  return PublicRouteSchema.parse({
    id: row.id,
    cityId: row.cityId,
    lineId: row.lineId,
    direction: row.direction,
    geometry: JSON.parse(row.geometry),
    variants,
    stops,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toPublicStop(row: StopRow): PublicStop {
  if (!row.name) throw new NotFoundException('Parada pública sin nombre');
  return PublicStopSchema.parse({
    id: row.id,
    cityId: row.cityId,
    routeId: row.routeId,
    name: row.name,
    reference: row.reference,
    type: row.type,
    order: row.order,
    coordinate: JSON.parse(row.coordinate),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function toPublicCity(row: CityRow): PublicMobilityCity {
  return PublicMobilityCitySchema.parse({
    id: row.id,
    name: row.name,
    departmentCode: row.departmentCode,
    departmentName: row.departmentName,
    countryCode: row.countryCode,
    timezone: row.timezone,
    coverageStatus: row.coverageStatus,
    sourceType: row.sourceType,
    sourceName: row.sourceName,
    sourceLicense: row.sourceLicense,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    availableModes: row.availableModes ?? [],
    auxiliaryServices: row.auxiliaryServices ?? [],
  });
}

function normalizarConsulta(query: string | undefined): string {
  const value = query?.normalize('NFC').trim() ?? '';
  if (value.length > 80) throw new BadRequestException('La búsqueda no puede superar 80 caracteres');
  return value;
}

function normalizarCityId(cityId: string | undefined): string {
  const value = cityId?.trim() || 'cochabamba';
  const result = MobilityCityIdSchema.safeParse(value);
  if (!result.success) throw new BadRequestException('cityId inválido');
  return result.data;
}

function parseLimit(rawLimit: string | undefined): number {
  if (rawLimit === undefined) return 30;
  if (!/^\d+$/.test(rawLimit)) throw new BadRequestException('limit debe ser un entero positivo');
  const limit = Number(rawLimit);
  if (limit < 1 || limit > 100) throw new BadRequestException('limit debe estar entre 1 y 100');
  return limit;
}
