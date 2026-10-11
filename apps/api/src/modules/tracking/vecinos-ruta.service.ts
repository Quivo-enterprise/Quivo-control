import { Injectable, UnauthorizedException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  UMBRAL_VECINO_FRESCO_MS,
  VecinosRutaSchema,
  type VecinosRuta,
  type VecinosRutaQuery,
} from '@quivo/shared';
import { fechaActualBolivia } from '../../common/tiempo/jornada.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import {
  CacheTtl,
  seleccionarVecinos,
  type CandidatoVecino,
  type EntradaRuta,
} from './vecinos-ruta.util.js';

interface MiPosicionRow {
  rutaId: string;
  /** `null` si no hay posición (ni `lat`/`lng` del request ni fila en `gps_sesion_resumen`). */
  frac: number | null;
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
  frac: number;
  ultimoFixTs: Date;
  largoM: number;
}

const DIA_MS = 24 * 60 * 60_000;

/**
 * Release 13 / B — vehículo de adelante y de atrás sobre MI ruta.
 *
 * Enfoque SQL:
 * 1. Una consulta liviana resuelve mi `rutaId` (desde la asignación de MI sesión, nunca del
 *    cliente) y mi `frac` = `ST_LineLocatePoint` de `lat`/`lng` del request o, si no vinieron,
 *    de mi último `gps_sesion_resumen`.
 * 2. Los candidatos (mismo `rutaId`, `recorridoEstado = 'en_curso'`, fix fresco) salen de
 *    `sesiones_operativas` + `LEFT JOIN LATERAL` al último resumen (hoy/ayer), cada uno
 *    proyectado con `ST_LineLocatePoint`; esa lista se cachea 15 s por `(sindicatoId, rutaId)`.
 * 3. `seleccionarVecinos` (puro) elige menor `frac` mayor al mío y mayor `frac` menor al mío.
 * 4. `distanciaM = |Δfrac| × ST_Length(geography)`; `edadFixS` contra `ahora`.
 *
 * Aislamiento: `withTenantContext` (RLS por sindicato) + filtro explícito por `sindicatoId` y
 * por `rutaId`. `asignaciones`/`rutas` no tienen RLS: solo se alcanzan a través de
 * `sesiones_operativas` (con RLS) y siempre con `so."sindicatoId"` fijado.
 */
@Injectable()
export class VecinosRutaService {
  /** Público solo para que los tests puedan vaciarlo entre casos. */
  readonly cache = new CacheTtl<EntradaRuta>();

  limpiarCache(): void {
    this.cache.clear();
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
    const fixDesde = new Date(ahora.getTime() - UMBRAL_VECINO_FRESCO_MS);

    return withTenantContext({ rol: 'conductor', sindicatoId: sesion.sindicatoId }, async (tx) => {
      const [mia] = await tx.$queryRaw<MiPosicionRow[]>`
        SELECT a."rutaId" AS "rutaId",
          ST_LineLocatePoint(
            ru.geometria::geometry,
            ST_SetSRID(ST_MakePoint(
              COALESCE(${lng}::float8, yo.lng),
              COALESCE(${lat}::float8, yo.lat)
            ), 4326)
          ) AS frac
        FROM sesiones_operativas so
        JOIN asignaciones a ON a.id = so."asignacionId"
        JOIN rutas ru ON ru.id = a."rutaId"
        LEFT JOIN LATERAL (
          SELECT gr.lat, gr.lng
          FROM gps_sesion_resumen gr
          WHERE gr.sesion_id = so.id::uuid
            AND gr."sindicatoId" = so."sindicatoId"
            AND gr.jornada IN (${jornadaStr}::date, ${jornadaAyerStr}::date)
          ORDER BY gr.ultimo_fix_ts DESC
          LIMIT 1
        ) yo ON true
        WHERE so.id = ${sesion.sesionId} AND so."sindicatoId" = ${sesion.sindicatoId}
      `;
      if (!mia) {
        throw new UnauthorizedException('La sesión ya no existe');
      }
      if (mia.frac === null) {
        return VecinosRutaSchema.parse({ delante: null, detras: null, calculadoEn });
      }

      const claveCache = `${sesion.sindicatoId}:${mia.rutaId}`;
      const ahoraMs = ahora.getTime();
      let entrada = this.cache.get(claveCache, ahoraMs);
      if (!entrada) {
        const filas = await tx.$queryRaw<CandidatoRow[]>`
          SELECT so.id AS "sesionId", so."vehiculoId" AS "vehiculoId",
            v.placa, v."numeroInterno", v.tipo, v.marca, v.modelo, v.color, v."colorSecundario",
            ST_LineLocatePoint(
              ru.geometria::geometry,
              ST_SetSRID(ST_MakePoint(res.lng, res.lat), 4326)
            ) AS frac,
            res."ultimoFixTs" AS "ultimoFixTs",
            ST_Length(ru.geometria) AS "largoM"
          FROM sesiones_operativas so
          JOIN asignaciones a ON a.id = so."asignacionId"
          JOIN rutas ru ON ru.id = a."rutaId"
          JOIN vehiculos v ON v.id = so."vehiculoId" AND v."sindicatoId" = so."sindicatoId"
          JOIN LATERAL (
            SELECT gr.lat, gr.lng, gr.ultimo_fix_ts AS "ultimoFixTs"
            FROM gps_sesion_resumen gr
            WHERE gr.sesion_id = so.id::uuid
              AND gr."sindicatoId" = so."sindicatoId"
              AND gr.jornada IN (${jornadaStr}::date, ${jornadaAyerStr}::date)
              AND gr.ultimo_fix_ts >= ${fixDesde}
            ORDER BY gr.ultimo_fix_ts DESC
            LIMIT 1
          ) res ON true
          WHERE so."sindicatoId" = ${sesion.sindicatoId}
            AND a."rutaId" = ${mia.rutaId}
            AND so."recorridoEstado" = 'en_curso'
            -- Sesión de login vigente (mismos campos que valida AuthMovilGuard): el logout deja
            -- recorridoEstado en_curso, así que sin esto un vehículo ya cerrado/revocado
            -- seguiría apareciendo como vecino hasta agotar el umbral de frescura del fix.
            AND so.estado = 'activa' AND so."revokedAt" IS NULL AND so.fin IS NULL
            AND res.lat IS NOT NULL AND res.lng IS NOT NULL
        `;
        const candidatos: CandidatoVecino[] = filas.map((f) => ({
          sesionId: f.sesionId,
          vehiculoId: f.vehiculoId,
          placa: f.placa,
          numeroInterno: f.numeroInterno,
          tipo: f.tipo,
          marca: f.marca,
          modelo: f.modelo,
          color: f.color,
          colorSecundario: f.colorSecundario,
          frac: f.frac,
          ultimoFixTs: f.ultimoFixTs,
        }));
        // Una ruta sin candidatos igual se cachea (largo 0): evita repetir la consulta.
        entrada = { largoM: filas[0]?.largoM ?? 0, candidatos };
        this.cache.set(claveCache, entrada, ahoraMs);
      }

      const { delante, detras } = seleccionarVecinos(
        mia.frac,
        entrada.candidatos,
        sesion.sesionId,
        entrada.largoM,
        ahora,
        sesion.vehiculoId,
      );
      return VecinosRutaSchema.parse({ delante, detras, calculadoEn });
    });
  }
}
