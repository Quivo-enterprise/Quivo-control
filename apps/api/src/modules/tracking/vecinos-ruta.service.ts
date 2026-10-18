import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  PRECISION_MAX_M,
  prepararCircuito,
  progresoEnCircuito,
  UMBRAL_VECINO_FRESCO_MS,
  VecinosRutaSchema,
  type CircuitoPreparado,
  type FaseCircuito,
  type VecinosRuta,
  type VecinosRutaQuery,
} from '@quivo/shared';
import { RUTA_PROXIMIDAD_TOLERANCIA_METROS } from '../../common/geo/proximidad-ruta.js';
import { fechaActualBolivia } from '../../common/tiempo/jornada.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import {
  CacheTtl,
  seleccionarVecinos,
  VECINOS_GEOMETRIA_TTL_MS,
  type CandidatoVecino,
  type EntradaRuta,
} from './vecinos-ruta.util.js';

type Coord = [number, number];

interface MiPosicionRow {
  rutaId: string;
  lat: number | null;
  lng: number | null;
  /** Fase de la vuelta en curso de mi sesión; `null` si no tiene vuelta. */
  fase: FaseCircuito | null;
}

interface GeometriaRow {
  geojson: string;
  retornoLng: number | null;
  retornoLat: number | null;
}

interface CandidatoRow {
  sesionId: string;
  vehiculoId: string;
  placa: string;
  numeroInterno: string | null;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  colorSecundario: string | null;
  lat: number;
  lng: number;
  ultimoFixTs: Date;
  fase: FaseCircuito | null;
}

const DIA_MS = 24 * 60 * 60_000;

/**
 * Fix con el que se ubica a una sesión (ver `res` en el caller): el del resumen GPS si su precisión
 * es nula o ≤ `PRECISION_MAX_M`; si no, el último fix bueno de `gps_points` desde `fixDesde` (acota las
 * particiones). Sin fix bueno no devuelve filas. `buscarSi` evita la lectura de `gps_points` cuando no
 * hace falta (p. ej. el request ya trae mi posición).
 */
const fixElegido = (fixDesde: Date, buscarSi: Prisma.Sql) => Prisma.sql`
  SELECT res.lat, res.lng, res.ts
  WHERE res.accuracy IS NULL OR res.accuracy <= ${PRECISION_MAX_M}::float8
  UNION ALL
  (SELECT gp.lat, gp.lng, gp.ts
   FROM gps_points gp
   WHERE res.accuracy > ${PRECISION_MAX_M}::float8
     AND ${buscarSi}
     AND gp.sesion_id = so.id::uuid
     AND gp."sindicatoId" = so."sindicatoId"
     AND gp.ts >= ${fixDesde}
     AND (gp.accuracy IS NULL OR gp.accuracy <= ${PRECISION_MAX_M}::float8)
   ORDER BY gp.ts DESC
   LIMIT 1)
`;

/**
 * Fase de una vuelta: el worker marca `pasoRetornoTs` al cumplir el PC de retorno (Honduras).
 * `null` si la sesión no tiene vuelta en curso.
 *
 * shortcut: la fase de un candidato depende de que el worker registre el PC de retorno (Honduras,
 * obligatorio). Fuera de calles compartidas el fallback geométrico de `progresoEnCircuito` lo cubre;
 * en calles compartidas un retorno no registrado igual desubica a ese vehículo. Revisar si se ve en campo.
 */
const FASE_LATERAL = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT CASE WHEN v."pasoRetornoTs" IS NOT NULL THEN 'regreso' ELSE 'ida' END AS fase
    FROM vueltas v
    WHERE v."sesionId" = so.id AND v."sindicatoId" = so."sindicatoId" AND v.estado = 'en_curso'
    ORDER BY v.numero DESC
    LIMIT 1
  ) vu ON true
`;

/**
 * Release 13 / B — vehículo de adelante y de atrás sobre MI ruta.
 *
 * 1. Una consulta liviana resuelve mi `rutaId` (desde la asignación de MI sesión, nunca del
 *    cliente), mi último fix bueno (`lat`/`lng` del request pisan al de la BD) y mi fase.
 * 2. La geometría de la ruta y el PC de retorno se cachean por ruta (`geometrias`).
 * 3. Los candidatos (mismo `rutaId`, `recorridoEstado = 'en_curso'`, fix fresco y preciso) salen
 *    de `sesiones_operativas` + resumen GPS (o el último fix bueno de `gps_points` si el del
 *    resumen es impreciso). Cada uno se proyecta en JS (`progresoEnCircuito`) sobre la mitad de
 *    su fase; la lista se cachea 15 s por `(sindicatoId, rutaId)`.
 * 4. `seleccionarVecinos` (puro) pone a cada uno en un solo lado: en un circuito, el más corto.
 *
 * Aislamiento: `withTenantContext` (RLS por sindicato) + filtro explícito por `sindicatoId` y
 * por `rutaId`. `asignaciones`/`rutas` no tienen RLS: solo se alcanzan a través de
 * `sesiones_operativas` (con RLS) y siempre con `so."sindicatoId"` fijado.
 */
@Injectable()
export class VecinosRutaService {
  /** Público solo para que los tests puedan vaciarlo entre casos. */
  readonly cache = new CacheTtl<EntradaRuta>();
  private readonly geometrias = new CacheTtl<CircuitoPreparado>(VECINOS_GEOMETRIA_TTL_MS);

  limpiarCache(): void {
    this.cache.clear();
    this.geometrias.clear();
  }

  async obtener(
    sesion: SesionMovilAutenticada,
    query: VecinosRutaQuery,
    ahora: Date = new Date(),
  ): Promise<VecinosRuta> {
    const calculadoEn = ahora.toISOString();
    const lat = query.lat ?? null;
    const lng = query.lng ?? null;
    // `YYYY-MM-DD` de hoy y de ayer (jornada boliviana), como `EnVivoService.obtenerPosiciones`:
    // la PK de `gps_sesion_resumen` es `(sesion_id, jornada, sindicatoId)` y una sesión que
    // cruza el corte de jornada puede tener su último fix en cualquiera de las dos. Se pasan
    // como string para que Postgres no reinterprete el instante según el TimeZone.
    const jornada = fechaActualBolivia(ahora);
    const jornadaStr = jornada.toISOString().slice(0, 10);
    const jornadaAyerStr = new Date(jornada.getTime() - DIA_MS).toISOString().slice(0, 10);
    // `gps_points` está particionada por `ts`: siempre se acota para que el plan solo toque las
    // particiones recientes.
    const fixDesde = new Date(ahora.getTime() - UMBRAL_VECINO_FRESCO_MS);

    return withTenantContext({ rol: 'conductor', sindicatoId: sesion.sindicatoId }, async (tx) => {
      const [mia] = await tx.$queryRaw<MiPosicionRow[]>`
        SELECT a."rutaId" AS "rutaId",
          COALESCE(${lat}::float8, pos.lat) AS lat,
          COALESCE(${lng}::float8, pos.lng) AS lng,
          vu.fase AS fase
        FROM sesiones_operativas so
        JOIN asignaciones a ON a.id = so."asignacionId"
        LEFT JOIN LATERAL (
          SELECT p.lat, p.lng
          FROM (
            SELECT gr.lat, gr.lng, gr.accuracy, gr.ultimo_fix_ts AS ts
            FROM gps_sesion_resumen gr
            WHERE gr.sesion_id = so.id::uuid
              AND gr."sindicatoId" = so."sindicatoId"
              AND gr.jornada IN (${jornadaStr}::date, ${jornadaAyerStr}::date)
            ORDER BY gr.ultimo_fix_ts DESC
            LIMIT 1
          ) res
          CROSS JOIN LATERAL (${fixElegido(fixDesde, Prisma.sql`${lat}::float8 IS NULL`)}) p
        ) pos ON true
        ${FASE_LATERAL}
        WHERE so.id = ${sesion.sesionId} AND so."sindicatoId" = ${sesion.sindicatoId}
      `;
      if (!mia) {
        throw new UnauthorizedException('La sesión ya no existe');
      }
      if (mia.lat === null || mia.lng === null) {
        return VecinosRutaSchema.parse({ delante: null, detras: null, calculadoEn });
      }

      const ahoraMs = ahora.getTime();
      const claveGeometria = `${sesion.sindicatoId}:${mia.rutaId}`;
      let geometria = this.geometrias.get(claveGeometria, ahoraMs);
      if (!geometria) {
        // Pasa por `sesiones_operativas` (con RLS): `rutas` no tiene RLS propio.
        const [fila] = await tx.$queryRaw<GeometriaRow[]>`
          SELECT ST_AsGeoJSON(ru.geometria::geometry) AS geojson, rt."retornoLng", rt."retornoLat"
          FROM sesiones_operativas so
          JOIN asignaciones a ON a.id = so."asignacionId"
          JOIN rutas ru ON ru.id = a."rutaId"
          LEFT JOIN LATERAL (
            SELECT ST_X(pc.coord::geometry) AS "retornoLng", ST_Y(pc.coord::geometry) AS "retornoLat"
            FROM puntos_control pc
            WHERE pc."rutaId" = a."rutaId" AND pc.estado = 'activo' AND pc.rol = 'retorno'
            ORDER BY pc.orden
            LIMIT 1
          ) rt ON true
          WHERE so.id = ${sesion.sesionId} AND so."sindicatoId" = ${sesion.sindicatoId}
        `;
        if (!fila) {
          throw new UnauthorizedException('La sesión ya no existe');
        }
        geometria = prepararCircuito(
          (JSON.parse(fila.geojson) as { coordinates: Coord[] }).coordinates,
          fila.retornoLng !== null && fila.retornoLat !== null
            ? [fila.retornoLng, fila.retornoLat]
            : null,
        );
        this.geometrias.set(claveGeometria, geometria, ahoraMs);
      }

      const claveCache = `${sesion.sindicatoId}:${mia.rutaId}`;
      let entrada = this.cache.get(claveCache, ahoraMs);
      if (!entrada) {
        const filas = await tx.$queryRaw<CandidatoRow[]>`
          SELECT so.id AS "sesionId", so."vehiculoId" AS "vehiculoId",
            v.placa, v."numeroInterno", v.tipo, v.marca, v.modelo, v.color, v."colorSecundario",
            pos.lat, pos.lng, pos.ts AS "ultimoFixTs",
            vu.fase AS fase
          FROM sesiones_operativas so
          JOIN asignaciones a ON a.id = so."asignacionId"
          JOIN vehiculos v ON v.id = so."vehiculoId" AND v."sindicatoId" = so."sindicatoId"
          JOIN LATERAL (
            SELECT p.lat, p.lng, p.ts
            FROM (
              SELECT gr.lat, gr.lng, gr.accuracy, gr.ultimo_fix_ts AS ts
              FROM gps_sesion_resumen gr
              WHERE gr.sesion_id = so.id::uuid
                AND gr."sindicatoId" = so."sindicatoId"
                AND gr.jornada IN (${jornadaStr}::date, ${jornadaAyerStr}::date)
                AND gr.ultimo_fix_ts >= ${fixDesde}
              ORDER BY gr.ultimo_fix_ts DESC
              LIMIT 1
            ) res
            CROSS JOIN LATERAL (${fixElegido(fixDesde, Prisma.sql`true`)}) p
          ) pos ON true
          ${FASE_LATERAL}
          WHERE so."sindicatoId" = ${sesion.sindicatoId}
            AND a."rutaId" = ${mia.rutaId}
            AND so."recorridoEstado" = 'en_curso'
            -- Sesión de login vigente (mismos campos que valida AuthMovilGuard): el logout deja
            -- recorridoEstado en_curso, así que sin esto un vehículo ya cerrado/revocado
            -- seguiría apareciendo como vecino hasta agotar el umbral de frescura del fix.
            AND so.estado = 'activa' AND so."revokedAt" IS NULL AND so.fin IS NULL
            AND pos.lat IS NOT NULL AND pos.lng IS NOT NULL
        `;
        const candidatos: CandidatoVecino[] = [];
        for (const f of filas) {
          const p = progresoEnCircuito(
            [f.lng, f.lat],
            geometria,
            f.fase,
            RUTA_PROXIMIDAD_TOLERANCIA_METROS,
          );
          // Más lejos que la tolerancia de ambas mitades: no está en MI ruta (desvío o fix errado).
          if (p.distanciaAlTrazadoM > RUTA_PROXIMIDAD_TOLERANCIA_METROS) continue;
          candidatos.push({
            sesionId: f.sesionId,
            vehiculoId: f.vehiculoId,
            placa: f.placa,
            numeroInterno: f.numeroInterno,
            tipo: f.tipo,
            marca: f.marca,
            modelo: f.modelo,
            color: f.color,
            colorSecundario: f.colorSecundario,
            progresoM: p.progresoM,
            ultimoFixTs: f.ultimoFixTs,
          });
        }
        // Una ruta sin candidatos igual se cachea: evita repetir la consulta.
        entrada = { candidatos };
        this.cache.set(claveCache, entrada, ahoraMs);
      }

      // Mi propia distancia al trazado NO se descarta: puedo ir algo desviado y aun así quiero ver a
      // mis vecinos; el filtro de tolerancia aplica a los demás, que son quienes podrían no estar en la ruta.
      // Mi fase viene del teléfono porque mi posición es en vivo; los demás usan la del servidor
      // con su posición ingerida.
      const yo = progresoEnCircuito(
        [mia.lng, mia.lat],
        geometria,
        query.fase ?? mia.fase,
        RUTA_PROXIMIDAD_TOLERANCIA_METROS,
      );
      const { delante, detras } = seleccionarVecinos(
        yo,
        entrada.candidatos,
        sesion.sesionId,
        ahora,
        sesion.vehiculoId,
      );
      return VecinosRutaSchema.parse({ delante, detras, calculadoEn });
    });
  }
}
