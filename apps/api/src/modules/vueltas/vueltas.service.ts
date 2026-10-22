import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import { bloquearVueltasSesion } from '../ingesta-worker/deteccion-vueltas.js';
import { vueltaContable, vueltaNoVacia } from './vuelta-no-vacia.js';
import { sesionesVisiblesSql } from '../../common/sesiones/vigencia.js';
import {
  MOLINOS_ESPERA_PENDIENTE_MAX_H,
  MolinosResumenSchema,
  UMBRAL_VECINO_FRESCO_MS,
  VueltaActualMovilSchema,
  VueltaResumenSchema,
  calcularSugerenciaMolinos,
  fechaActualBolivia,
  type AcuseVuelta,
  type DesignarVueltaRespuesta,
  type MolinosResumen,
  type VueltaActualMovil,
  type VueltaResumen,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';

const MSG_YA_PASO_ESPERA = 'La unidad ya pasó por el punto de espera en esta vuelta';
const MSG_YA_LLEGO =
  'El vehículo ya llegó al punto de espera: la designación de esta vuelta ya no se puede cambiar';
const MSG_YA_FUE_HOY = 'Ya fue a Molinos hoy.';

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
   * UPDATE es condicional (`estado = en_curso AND esperaLlegadaTs IS NULL`) y el worker y esta
   * función se serializan con el mismo lock de asesoría de la sesión, así que una llegada concurrente gana de forma atómica. Designar la
   * variante que ya tiene (o cancelar sin designación) es un no-op: no reinicia el acuse ni
   * vuelve a avisar al chofer.
   *
   * Tope por día: no se designa a un vehículo que ya llegó a Molinos hoy en otra vuelta (409).
   * Si la designación llega DESPUÉS de pasar la bifurcación en el regreso, queda diferida en
   * `molinosProxima*` y el worker la copia a la vuelta siguiente (`aplica: 'proxima_vuelta'`).
   */
  async designar(
    actor: AuthenticatedUser,
    sesionId: string,
    varianteId: string | null,
  ): Promise<DesignarVueltaRespuesta> {
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
      // PRIMERO el lock de asesoría de la sesión, el MISMO que toma el worker de vueltas (ver
      // `bloquearVueltasSesion`): mientras lo tenemos el worker no puede estar a mitad de una
      // transición (cerrar N / abrir N+1), así que no hace falta reintentar. Orden de locks:
      // advisory → fila de la vuelta, igual que el worker (que además toma FOR SHARE sobre la
      // sesión antes; aquí NO se bloquea la fila de la sesión). READ COMMITTED: si el worker tenía
      // el lock, esta sentencia espera a que su transacción termine y cada sentencia POSTERIOR toma
      // un snapshot NUEVO: la vuelta en curso que se busca a continuación es la vigente y el EXISTS
      // sobre `cumplimientos_pc` ve lo que el worker/ingesta acaban de confirmar.
      await bloquearVueltasSesion(tx, sesionId);
      const candidata = await tx.vuelta.findFirst({
        where: { sesionId, estado: 'en_curso' },
        select: { id: true },
      });
      let vuelta: Awaited<ReturnType<typeof tx.vuelta.findUnique>> = null;
      if (candidata) {
        // FOR UPDATE inocuo (ya serializados por el advisory): protege frente a quien toque la fila
        // sin él (p. ej. el trigger de cierre de sesión); la relectura ve su estado final.
        await tx.$queryRaw`SELECT id FROM vueltas WHERE id = ${candidata.id} FOR UPDATE`;
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
        if (!pc || pc.rol !== 'espera') {
          throw new UnprocessableEntityException(
            'El punto de espera de la variante no está configurado (rol "espera")',
          );
        }
        if (pc.estado !== 'activo') {
          throw new UnprocessableEntityException(
            'El punto de espera de la variante está inactivo: no se puede designar a esta variante',
          );
        }
      }
      // Cancelar con una diferida pendiente NO es un no-op: hay que limpiarla.
      if (
        vuelta.varianteId === varianteId &&
        (varianteId !== null || vuelta.molinosProximaVarianteId === null)
      ) {
        return { ...(await this.resumen(tx, vuelta.id)), aplica: 'vuelta_actual' };
      }
      // Tardía: ya pasó la bifurcación en el regreso, la vuelta actual no puede ir a Molinos.
      // Solo se difiere si la actual NO está designada: si no, iría a Molinos dos veces en el día
      // y la diferida no se podría cancelar.
      const tardia =
        varianteId !== null &&
        vuelta.varianteId === null &&
        vuelta.pasoRetornoTs !== null &&
        (await this.pasoBifurcacionEnRegreso(tx, sesion, vuelta.pasoRetornoTs, varianteId));
      if (varianteId !== null) {
        const [yaFue] = await tx.$queryRaw<{ yaFue: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM vueltas
            WHERE "vehiculoId" = ${vuelta.vehiculoId} AND "sindicatoId" = ${sesion.sindicatoId}
              AND fecha = ${vuelta.fecha.toISOString().slice(0, 10)}::date AND id <> ${vuelta.id} AND "esperaLlegadaTs" IS NOT NULL
          ) AS "yaFue"
        `;
        if (yaFue?.yaFue) {
          throw new ConflictException(MSG_YA_FUE_HOY);
        }
        // Designación retroactiva (solo vuelta actual; una diferida no la toca): si la unidad ya pasó por el punto de espera de la variante
        // desde que empezó la vuelta, la máquina no la tomaría como llegada (la llegada solo se
        // registra con la vuelta ya designada) y al cerrar saldría un `molinos_omitido` falso.
        const [paso] = tardia
          ? []
          : await tx.$queryRaw<{ pasoPorEspera: boolean }[]>`
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
      if (tardia && vuelta.molinosProximaVarianteId === varianteId) {
        // Ya está diferida a esa variante: no reescribir `molinosProximaEn`.
        return { ...(await this.resumen(tx, vuelta.id)), aplica: 'proxima_vuelta' };
      }
      const ahora = new Date();
      const { count } = await tx.vuelta.updateMany({
        where: { id: vuelta.id, estado: 'en_curso', esperaLlegadaTs: null },
        data: tardia
          ? { molinosProximaVarianteId: varianteId, molinosProximaPor: actor.userId, molinosProximaEn: ahora }
          : {
              varianteId,
              designadaPor: actor.userId,
              designadaEn: ahora,
              acuseEn: null,
              molinosProximaVarianteId: null,
              molinosProximaPor: null,
              molinosProximaEn: null,
            },
      });
      if (count === 0) {
        // Perdió la carrera contra el worker: la vuelta cerró o el vehículo acaba de llegar.
        throw new ConflictException(MSG_YA_LLEGO);
      }
      return { ...(await this.resumen(tx, vuelta.id)), aplica: tardia ? 'proxima_vuelta' : 'vuelta_actual' };
    });
  }

  /**
   * ¿La unidad ya cumplió, en el regreso, un PC en o después de la bifurcación de la variante?
   * Bifurcación = el PC común (`rol IS NULL`) posterior al retorno más cercano al inicio del
   * tramo de la variante. Sin ese PC (o sin geometría) nunca es tardía. `ts >= pasoRetornoTs`
   * deja fuera el paso por la ida.
   */
  private async pasoBifurcacionEnRegreso(
    tx: Prisma.TransactionClient,
    sesion: { id: string; sindicatoId: string; asignacion: { rutaId: string } },
    pasoRetornoTs: Date,
    varianteId: string,
  ): Promise<boolean> {
    const [fila] = await tx.$queryRaw<{ tardia: boolean }[]>`
      WITH bif AS (
        SELECT pc.orden
        FROM puntos_control pc
        JOIN variantes va ON va.id = ${varianteId}
        WHERE pc."rutaId" = ${sesion.asignacion.rutaId} AND pc.estado = 'activo' AND pc.rol IS NULL
          AND va.geometria IS NOT NULL
          AND pc.orden > (
            SELECT orden FROM puntos_control
            WHERE "rutaId" = ${sesion.asignacion.rutaId} AND estado = 'activo' AND rol = 'retorno'
            LIMIT 1
          )
        ORDER BY ST_Distance(pc.coord, ST_StartPoint(va.geometria::geometry)::geography)
        LIMIT 1
      )
      SELECT EXISTS (
        SELECT 1 FROM cumplimientos_pc cp
        JOIN puntos_control p ON p.id = cp."puntoControlId"
        JOIN bif ON p.orden >= bif.orden
        WHERE cp."sesionId" = ${sesion.id} AND cp."sindicatoId" = ${sesion.sindicatoId}
          AND p."rutaId" = ${sesion.asignacion.rutaId} AND cp.cumplido = true
          AND cp.ts >= ${pasoRetornoTs}
      ) AS tardia
    `;
    return fila?.tardia ?? false;
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
  async obtenerActualMovil(sesion: SesionMovilAutenticada, ahora: Date = new Date()): Promise<VueltaActualMovil> {
    return withTenantContext({ rol: 'conductor', sindicatoId: sesion.sindicatoId }, (tx) =>
      this.leerActualMovil(tx, sesion, ahora),
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
    ahora: Date = new Date(),
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
        WHERE va.id = ${vuelta.varianteId} AND pc.rol = 'espera' AND pc.estado = 'activo'
      `;
      if (d) {
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
    let enEspera: { desdeTs: string; posicion?: number } | null = null;
    if (vuelta.esperaLlegadaTs && !vuelta.esperaSalidaTs && vuelta.varianteId) {
      // Cola de Molinos = orden de llegada: 1 + las vueltas en curso del mismo punto de espera que
      // llegaron antes y todavía no salieron (empate: por id). Informativo, no bloquea nada.
      // Solo cuentan las que el worker todavía puede cerrar (llegada dentro de la ventana de espera
      // pendiente) y cuya sesión sigue activa con un fix reciente: un teléfono muerto o sin GPS no
      // traba a los de atrás.
      const llegadaMinima = new Date(ahora.getTime() - MOLINOS_ESPERA_PENDIENTE_MAX_H * 3_600_000);
      const fixDesde = new Date(ahora.getTime() - UMBRAL_VECINO_FRESCO_MS);
      const [cola] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM vueltas o
        JOIN variantes ov ON ov.id = o."varianteId"
        JOIN sesiones_operativas os ON os.id = o."sesionId" AND os.estado = 'activa' AND os.fin IS NULL
        WHERE ov."puntoEsperaId" = (SELECT "puntoEsperaId" FROM variantes WHERE id = ${vuelta.varianteId})
          AND o."sindicatoId" = ${sesion.sindicatoId}
          AND o.estado = 'en_curso'
          AND o."esperaSalidaTs" IS NULL
          AND o."esperaLlegadaTs" >= ${llegadaMinima}
          AND EXISTS (
            SELECT 1 FROM gps_sesion_resumen gr
            WHERE gr.sesion_id = o."sesionId"::uuid AND gr."sindicatoId" = o."sindicatoId"
              AND gr.ultimo_fix_ts >= ${fixDesde}
          )
          AND (o."esperaLlegadaTs" < ${vuelta.esperaLlegadaTs}
               OR (o."esperaLlegadaTs" = ${vuelta.esperaLlegadaTs} AND o.id < ${vuelta.id}))
      `;
      enEspera = { desdeTs: vuelta.esperaLlegadaTs.toISOString(), posicion: (cola?.n ?? 0) + 1 };
    } else if (vuelta.esperaLlegadaTs && !vuelta.esperaSalidaTs) {
      enEspera = { desdeTs: vuelta.esperaLlegadaTs.toISOString() };
    }
    return VueltaActualMovilSchema.parse({
      vueltaId: vuelta.id,
      numero: vuelta.numero,
      designacion,
      enEspera,
    });
  }

  /**
   * `GET /reportes/en-vivo/molinos` — resumen por línea para el HUD y la sugerencia. Se resuelve
   * en dos consultas agregadas (flota activa de hoy; vueltas de hoy por línea) en vez de viajar en
   * el poll de 2 s de posiciones: cambia poco y agrega por línea, no por vehículo. Solo entran las
   * líneas con alguna variante activa con punto de espera.
   *
   * Flota activa = sesiones vigentes hoy (`sesionesVisiblesSql`) sin `fin`, `activa` y con el recorrido
   * no `finalizado` (las sesiones de login no se cierran solas, ver `FrescuraEnVivoSchema`).
   */
  async resumenMolinos(actor: AuthenticatedUser, ahora: Date = new Date()): Promise<MolinosResumen> {
    const jornada = fechaActualBolivia(ahora);
    const hoyStr = jornada.toISOString().slice(0, 10);
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const flota = await tx.$queryRaw<
        { lineaId: string; lineaNombre: string; flotaActiva: number; sinMolinosHoy: number }[]
      >`
        SELECT l.id AS "lineaId", l.nombre AS "lineaNombre",
               count(*)::int AS "flotaActiva",
               count(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM vueltas vh
                 WHERE vh."vehiculoId" = so."vehiculoId" AND vh."sindicatoId" = so."sindicatoId"
                   AND vh.fecha = ${hoyStr}::date AND vh."esperaLlegadaTs" IS NOT NULL
                   AND ${vueltaNoVacia('vh')}
               ))::int AS "sinMolinosHoy"
        FROM sesiones_operativas so
        JOIN asignaciones a ON a.id = so."asignacionId"
        JOIN rutas ru ON ru.id = a."rutaId"
        JOIN lineas l ON l.id = ru."lineaId"
        WHERE so.fin IS NULL AND so.estado = 'activa'
          AND so."recorridoEstado" IS DISTINCT FROM 'finalizado'
          AND ${sesionesVisiblesSql(ahora, jornada)}
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
