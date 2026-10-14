import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { vueltaContable, vueltaNoVacia } from './vuelta-no-vacia.js';
import {
  MolinosResumenSchema,
  VueltaActualMovilSchema,
  VueltaResumenSchema,
  calcularSugerenciaMolinos,
  fechaActualBolivia,
  inicioDeJornadaBolivia,
  type AcuseVuelta,
  type MolinosResumen,
  type VueltaActualMovil,
  type VueltaResumen,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';

const MSG_YA_PASO_ESPERA = 'La unidad ya pasó por el punto de espera en esta vuelta';
const MSG_YA_LLEGO =
  'El vehículo ya llegó al punto de espera: la designación de esta vuelta ya no se puede cambiar';

interface VueltaFila {
  id: string;
  sindicatoId: string;
  sesionId: string;
  numero: number;
  estado: string;
  inicioTs: Date;
  finTs: Date | null;
  pasoRetornoTs: Date | null;
  varianteId: string | null;
  designadaPor: string | null;
  designadaEn: Date | null;
  acuseEn: Date | null;
  esperaLlegadaTs: Date | null;
  esperaSalidaTs: Date | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Designación de la vuelta actual a una variante (Molinos), lectura/acuse del chofer y resumen
 * por línea (docs/plan-molinos-designacion.md, F1). La designación vive en la VUELTA, no en la
 * sesión: si la vuelta cierra en la terminal antes de que el control designe, la designación cae
 * en la vuelta nueva (que siempre existe mientras hay recorrido).
 */
@Injectable()
export class VueltasService {
  /**
   * `PUT /reportes/en-vivo/:sesionId/vuelta-actual/designacion`. Solo con la vuelta `en_curso` y
   * sin llegada al punto de espera (409 si no). `varianteId: null` cancela la designación. El
   * UPDATE es condicional (`estado = en_curso AND esperaLlegadaTs IS NULL`) y el worker lee la
   * vuelta con `FOR UPDATE`, así que una llegada concurrente gana de forma atómica. Designar la
   * variante que ya tiene (o cancelar sin designación) es un no-op: no reinicia el acuse ni
   * vuelve a avisar al chofer.
   */
  async designar(
    actor: AuthenticatedUser,
    sesionId: string,
    varianteId: string | null,
  ): Promise<VueltaResumen> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      // `findUnique` PRIMERO: tenant-check por RLS (una sesión ajena es 404, igual que en /en-vivo).
      const sesion = await tx.sesionOperativa.findUnique({
        where: { id: sesionId },
        select: { id: true, sindicatoId: true, asignacion: { select: { rutaId: true } } },
      });
      if (!sesion) {
        throw new NotFoundException('Sesión operativa no encontrada');
      }
      const SIN_VUELTA =
        'El vehículo todavía no tiene una vuelta en curso: se puede designar desde que sale de la terminal';
      // Se BLOQUEA la fila de la vuelta antes de decidir nada (el EXISTS de abajo y las demás
      // reglas leen su estado). Orden de locks: el worker toma FOR SHARE sobre la sesión y luego
      // FOR UPDATE sobre la vuelta; aquí la sesión se leyó SIN lock (arriba), así que solo se
      // toma el de la vuelta: no hay orden inverso (vuelta → sesión) ni deadlock posible.
      // READ COMMITTED: si el worker tenía la fila, este SELECT espera a que su transacción
      // termine, y cada sentencia posterior toma un snapshot NUEVO: el EXISTS sobre
      // `cumplimientos_pc` ve lo que el worker/ingesta acaban de confirmar (sin el lock, un
      // cumplimiento del PC de espera confirmado entre la lectura y el UPDATE se pasaría por alto).
      // Si tras esperar el lock la candidata ya no está `en_curso` (el worker la cerró y abrió la
      // siguiente en esa transacción), se BUSCA de nuevo la vuelta en curso y se reintenta UNA vez
      // con ese lock: el 409 solo sale si de verdad no hay ninguna.
      let vuelta: Awaited<ReturnType<typeof tx.vuelta.findUnique>> = null;
      for (let intento = 0; intento < 2 && vuelta === null; intento += 1) {
        const candidata = await tx.vuelta.findFirst({
          where: { sesionId, estado: 'en_curso' },
          select: { id: true },
        });
        if (!candidata) break;
        await tx.$queryRaw`SELECT id FROM vueltas WHERE id = ${candidata.id} FOR UPDATE`;
        // Relectura tras el lock: la vuelta pudo cerrarse mientras esperábamos.
        const releida = await tx.vuelta.findUnique({ where: { id: candidata.id } });
        if (releida && releida.estado === 'en_curso') vuelta = releida;
      }
      if (!vuelta) {
        throw new ConflictException(SIN_VUELTA);
      }
      if (vuelta.esperaLlegadaTs !== null) {
        throw new ConflictException(MSG_YA_LLEGO);
      }
      if (varianteId !== null) {
        const variante = await tx.variante.findUnique({
          where: { id: varianteId },
          select: { rutaId: true, estado: true, puntoEsperaId: true },
        });
        if (!variante || variante.rutaId !== sesion.asignacion.rutaId) {
          throw new UnprocessableEntityException('La variante no pertenece a la ruta de este vehículo');
        }
        if (variante.estado !== 'activo') {
          throw new UnprocessableEntityException('La variante está inactiva');
        }
        if (!variante.puntoEsperaId) {
          throw new UnprocessableEntityException('La variante no tiene un punto de espera configurado');
        }
        const [pc] = await tx.$queryRaw<
          { rol: string | null; esperaMin: number | null; estado: string }[]
        >`
          SELECT rol, "esperaMin", estado FROM puntos_control WHERE id = ${variante.puntoEsperaId}
        `;
        if (!pc || pc.rol !== 'espera' || !pc.esperaMin) {
          throw new UnprocessableEntityException(
            'El punto de espera de la variante no está configurado (rol "espera" y minutos de espera)',
          );
        }
        if (pc.estado !== 'activo') {
          throw new UnprocessableEntityException(
            'El punto de espera de la variante está inactivo: no se puede designar a esta variante',
          );
        }
      }
      if (vuelta.varianteId === varianteId) {
        return this.resumen(tx, vuelta.id);
      }
      if (varianteId !== null) {
        // Designación retroactiva: si la unidad ya pasó por el punto de espera de la variante
        // desde que empezó la vuelta, la máquina no la tomaría como llegada (la llegada solo se
        // registra con la vuelta ya designada) y al cerrar saldría un `molinos_omitido` falso.
        const [paso] = await tx.$queryRaw<{ pasoPorEspera: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM cumplimientos_pc cp
            JOIN variantes va ON va.id = ${varianteId}
            WHERE cp."sesionId" = ${sesionId} AND cp."sindicatoId" = ${sesion.sindicatoId}
              AND cp."puntoControlId" = va."puntoEsperaId" AND cp.cumplido = true
              AND cp.ts >= ${vuelta.inicioTs}
          ) AS "pasoPorEspera"
        `;
        if (paso?.pasoPorEspera) {
          throw new ConflictException(MSG_YA_PASO_ESPERA);
        }
      }
      const { count } = await tx.vuelta.updateMany({
        where: { id: vuelta.id, estado: 'en_curso', esperaLlegadaTs: null },
        data: { varianteId, designadaPor: actor.userId, designadaEn: new Date(), acuseEn: null },
      });
      if (count === 0) {
        // Perdió la carrera contra el worker: la vuelta cerró o el vehículo acaba de llegar.
        throw new ConflictException(MSG_YA_LLEGO);
      }
      return this.resumen(tx, vuelta.id);
    });
  }

  private async resumen(tx: Prisma.TransactionClient, vueltaId: string): Promise<VueltaResumen> {
    const [fila] = await tx.$queryRaw<(VueltaFila & { varianteNombre: string | null })[]>`
      SELECT v.id, v."sindicatoId", v."sesionId", v.numero, v.estado, v."inicioTs", v."finTs",
             v."pasoRetornoTs", v."varianteId", va.nombre AS "varianteNombre", v."designadaPor",
             v."designadaEn", v."acuseEn", v."esperaLlegadaTs", v."esperaSalidaTs"
      FROM vueltas v LEFT JOIN variantes va ON va.id = v."varianteId"
      WHERE v.id = ${vueltaId}
    `;
    if (!fila) {
      throw new NotFoundException('Vuelta no encontrada');
    }
    return VueltaResumenSchema.parse({
      id: fila.id,
      sindicatoId: fila.sindicatoId,
      sesionId: fila.sesionId,
      numero: fila.numero,
      estado: fila.estado,
      inicioTs: fila.inicioTs.toISOString(),
      finTs: iso(fila.finTs),
      pasoRetornoTs: iso(fila.pasoRetornoTs),
      varianteId: fila.varianteId,
      varianteNombre: fila.varianteNombre,
      designadaPor: fila.designadaPor,
      designadaEn: iso(fila.designadaEn),
      acuseEn: iso(fila.acuseEn),
      esperaLlegadaTs: iso(fila.esperaLlegadaTs),
      esperaSalidaTs: iso(fila.esperaSalidaTs),
    });
  }

  /** `GET /mobile/vuelta-actual` — la sesión sale del token, nunca de un id del cliente. */
  async obtenerActualMovil(sesion: SesionMovilAutenticada): Promise<VueltaActualMovil> {
    return withTenantContext({ rol: 'conductor', sindicatoId: sesion.sindicatoId }, (tx) =>
      this.leerActualMovil(tx, sesion),
    );
  }

  /**
   * `POST /mobile/vuelta-actual/acuse`: idempotente. Solo marca el acuse si la vuelta es de LA
   * sesión del token y `designadaEn` coincide con la designación vigente: un acuse viejo (la web
   * cambió la designación mientras el chofer miraba el aviso anterior) se ignora sin error.
   * Devuelve siempre el estado actual para que la app se resincronice.
   */
  async acusar(sesion: SesionMovilAutenticada, body: AcuseVuelta): Promise<VueltaActualMovil> {
    return withTenantContext({ rol: 'conductor', sindicatoId: sesion.sindicatoId }, async (tx) => {
      await tx.vuelta.updateMany({
        where: {
          id: body.vueltaId,
          sesionId: sesion.sesionId,
          sindicatoId: sesion.sindicatoId,
          varianteId: { not: null },
          designadaEn: new Date(body.designadaEn),
          acuseEn: null,
        },
        data: { acuseEn: new Date() },
      });
      return this.leerActualMovil(tx, sesion);
    });
  }

  private async leerActualMovil(
    tx: Prisma.TransactionClient,
    sesion: SesionMovilAutenticada,
  ): Promise<VueltaActualMovil> {
    const vuelta = await tx.vuelta.findFirst({
      where: { sesionId: sesion.sesionId, sindicatoId: sesion.sindicatoId, estado: 'en_curso' },
    });
    if (!vuelta) {
      return VueltaActualMovilSchema.parse({ vueltaId: null, numero: null, designacion: null, enEspera: null });
    }
    let designacion: VueltaActualMovil['designacion'] = null;
    if (vuelta.varianteId && vuelta.designadaEn) {
      const [d] = await tx.$queryRaw<
        {
          nombre: string;
          tramo: string | null;
          pcId: string;
          pcCoord: string;
          esperaMin: number | null;
        }[]
      >`
        SELECT va.nombre, ST_AsGeoJSON(va.geometria) AS tramo, pc.id AS "pcId",
               ST_AsGeoJSON(pc.coord) AS "pcCoord", pc."esperaMin"
        FROM variantes va
        JOIN puntos_control pc ON pc.id = va."puntoEsperaId"
        WHERE va.id = ${vuelta.varianteId}
      `;
      if (d?.esperaMin) {
        designacion = {
          varianteId: vuelta.varianteId,
          nombre: d.nombre,
          designadaEn: vuelta.designadaEn.toISOString(),
          acuseEn: iso(vuelta.acuseEn),
          tramo: d.tramo ? JSON.parse(d.tramo) : null,
          puntoEspera: { id: d.pcId, coord: JSON.parse(d.pcCoord), esperaMin: d.esperaMin },
        };
      }
    }
    return VueltaActualMovilSchema.parse({
      vueltaId: vuelta.id,
      numero: vuelta.numero,
      designacion,
      enEspera:
        vuelta.esperaLlegadaTs && !vuelta.esperaSalidaTs
          ? { desdeTs: vuelta.esperaLlegadaTs.toISOString() }
          : null,
    });
  }

  /**
   * `GET /reportes/en-vivo/molinos` — resumen por línea para el HUD y la sugerencia. Se resuelve
   * en dos consultas agregadas (flota activa de hoy; vueltas de hoy por línea) en vez de viajar en
   * el poll de 2 s de posiciones: cambia poco y agrega por línea, no por vehículo. Solo entran las
   * líneas con alguna variante activa con punto de espera.
   *
   * Flota activa = sesiones de la jornada local sin `fin`, `activa` y con el recorrido no
   * `finalizado` (las sesiones de login no se cierran solas, ver `FrescuraEnVivoSchema`).
   */
  async resumenMolinos(actor: AuthenticatedUser, ahora: Date = new Date()): Promise<MolinosResumen> {
    const jornada = fechaActualBolivia(ahora);
    const hoyStr = jornada.toISOString().slice(0, 10);
    const desde = inicioDeJornadaBolivia(jornada);
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const flota = await tx.$queryRaw<
        { lineaId: string; lineaNombre: string; flotaActiva: number; sinMolinosHoy: number }[]
      >`
        SELECT l.id AS "lineaId", l.nombre AS "lineaNombre",
               count(*)::int AS "flotaActiva",
               count(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM vueltas vh
                 WHERE vh."vehiculoId" = so."vehiculoId" AND vh."sindicatoId" = so."sindicatoId"
                   AND vh.fecha = ${hoyStr}::date AND vh."varianteId" IS NOT NULL
                   AND ${vueltaNoVacia('vh')}
               ))::int AS "sinMolinosHoy"
        FROM sesiones_operativas so
        JOIN asignaciones a ON a.id = so."asignacionId"
        JOIN rutas ru ON ru.id = a."rutaId"
        JOIN lineas l ON l.id = ru."lineaId"
        WHERE so.fin IS NULL AND so.estado = 'activa'
          AND so."recorridoEstado" IS DISTINCT FROM 'finalizado'
          AND so.inicio >= ${desde}
          AND EXISTS (
            SELECT 1 FROM variantes va
            WHERE va."rutaId" = ru.id AND va.estado = 'activo' AND va."puntoEsperaId" IS NOT NULL
          )
        GROUP BY l.id, l.nombre
        ORDER BY l.nombre
      `;
      const vueltas = await tx.$queryRaw<
        { lineaId: string; enEspera: number; esperaDesdeTs: Date | null; ultimoEnvioTs: Date | null }[]
      >`
        SELECT v."lineaId",
               count(*) FILTER (WHERE v.estado = 'en_curso' AND v."esperaLlegadaTs" IS NOT NULL
                                 AND v."esperaSalidaTs" IS NULL)::int AS "enEspera",
               min(v."esperaLlegadaTs") FILTER (WHERE v.estado = 'en_curso'
                                 AND v."esperaSalidaTs" IS NULL) AS "esperaDesdeTs",
               max(v."designadaEn") FILTER (WHERE v."varianteId" IS NOT NULL) AS "ultimoEnvioTs"
        FROM vueltas v
        WHERE v.fecha = ${hoyStr}::date AND ${vueltaContable('v')}
        GROUP BY v."lineaId"
      `;
      const porLinea = new Map(vueltas.map((v) => [v.lineaId, v]));
      return MolinosResumenSchema.parse({
        servidorTs: ahora.toISOString(),
        lineas: flota.map((f) => {
          const v = porLinea.get(f.lineaId);
          const sugerencia = calcularSugerenciaMolinos({
            flotaActiva: f.flotaActiva,
            ultimoEnvioTs: v?.ultimoEnvioTs ?? null,
            ahora,
          });
          return {
            lineaId: f.lineaId,
            lineaNombre: f.lineaNombre,
            enEspera: v?.enEspera ?? 0,
            esperaDesdeTs: v && v.enEspera > 0 ? iso(v.esperaDesdeTs) : null,
            ultimoEnvioTs: iso(v?.ultimoEnvioTs ?? null),
            flotaActiva: f.flotaActiva,
            sinMolinosHoy: f.sinMolinosHoy,
            intervaloObjetivoMs: sugerencia.intervaloObjetivoMs,
            proximoSugeridoEn: sugerencia.proximoSugeridoEn.toISOString(),
          };
        }),
      });
    });
  }
}
