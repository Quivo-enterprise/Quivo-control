import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import type { Prisma } from '@quivo/db';
import {
  fechaActualBolivia,
  type EstadoFilaSalida,
  type EstadoFilaSalidaPanel,
  type LlegadaFila,
  type RespuestaFilaMovil,
  type SalidaFilaMovil,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { bloquearTerminal, calcularFilaPc, diaStr, resolverTerminal, salidasRecientes } from './fila-datos.js';
import {
  ACCURACY_MAX_LLEGADA_M,
  MSG_FILA_NO_ENCONTRADA,
  SALIDAS_RECIENTES_MAX,
  armarEstadoMovil,
  armarItemsPanel,
  armarSalidasRecientes,
  esAnticipada,
  noEncontrado,
  yaNoEstaEnFila,
} from './salidas.logic.js';

type Tx = Prisma.TransactionClient;

const contextoMovil = (s: SesionMovilAutenticada) => ({ rol: 'conductor', sindicatoId: s.sindicatoId });
const contextoPanel = (a: AuthenticatedUser) => ({ rol: a.rol, sindicatoId: a.sindicatoId });

/** Resultado de la mutación de una fila desde el panel: lleva `id`/`sindicatoId` para `@Auditable`. */
export type ResultadoAccionPanel = EstadoFilaSalidaPanel & { id: string; sindicatoId: string };

/**
 * Fila de salida de la terminal (plan "fila de salida"): llegada y salida del chofer, estado para
 * `vuelta-actual` y acciones del panel. Toda hora de la fila es la del SERVIDOR (el reloj del
 * teléfono no es confiable); la concurrencia la resuelven el unique parcial de `fila_salida`
 * (llegada) y los `UPDATE ... WHERE estado = 'en_fila'` (salida/despacho).
 */
@Injectable()
export class FilaService {
  // ---------------------------------------------------------------- móvil

  /**
   * `POST /mobile/fila/llegada`. Sindicato, vehículo y sesión salen del token. Idempotente: si el
   * trufi ya está en la fila (`ON CONFLICT DO NOTHING`) devuelve su estado sin mover su lugar.
   */
  async registrarLlegada(sesion: SesionMovilAutenticada, body: LlegadaFila): Promise<RespuestaFilaMovil> {
    const ahora = new Date();
    const fecha = fechaActualBolivia(ahora);
    return withTenantContext(contextoMovil(sesion), async (tx) => {
      const [ctx] = await tx.$queryRaw<{ rutaId: string; recorridoEstado: string | null }[]>`
        SELECT a."rutaId", so."recorridoEstado"
        FROM sesiones_operativas so JOIN asignaciones a ON a.id = so."asignacionId"
        WHERE so.id = ${sesion.sesionId} AND so."sindicatoId" = ${sesion.sindicatoId} AND so.estado = 'activa'
      `;
      if (!ctx) throw new ConflictException('La sesión ya no está activa');
      if (ctx.recorridoEstado === 'finalizado') {
        throw new ConflictException('El recorrido está finalizado: no se puede entrar a la fila');
      }
      if (ctx.recorridoEstado === 'en_pausa') {
        throw new ConflictException('El recorrido está en pausa: reanudalo para entrar a la fila');
      }
      // `puntos_control` no tiene RLS: se filtra por la línea del sindicato del token.
      const [terminal] = await tx.$queryRaw<{ id: string; dentro: boolean }[]>`
        SELECT pc.id,
               ST_DWithin(pc.coord, ST_SetSRID(ST_MakePoint(${body.lng}::float8, ${body.lat}::float8), 4326)::geography,
                          pc."radioToleranciaM") AS dentro
        FROM puntos_control pc
        JOIN rutas r ON r.id = pc."rutaId"
        JOIN lineas l ON l.id = r."lineaId"
        WHERE pc."rutaId" = ${ctx.rutaId} AND pc.rol = 'terminal' AND pc.estado = 'activo'
          AND l."sindicatoId" = ${sesion.sindicatoId}
        ORDER BY pc.orden
        LIMIT 1
      `;
      if (!terminal) throw new ConflictException('La ruta no tiene una terminal activa');
      if (body.accuracy > ACCURACY_MAX_LLEGADA_M) {
        throw new UnprocessableEntityException('La precisión del GPS es insuficiente para registrar la llegada');
      }
      if (!terminal.dentro) throw new UnprocessableEntityException('Estás fuera de la zona de la terminal');

      await bloquearTerminal(tx, terminal.id);
      // Re-login mientras espera: misma terminal y día con otra sesión ⇒ la fila pasa a la sesión
      // actual y conserva su lugar (llegadaTs/ordenTs).
      await tx.$executeRaw`
        UPDATE fila_salida SET "sesionId" = ${sesion.sesionId}
        WHERE "vehiculoId" = ${sesion.vehiculoId} AND estado = 'en_fila'
          AND "puntoControlId" = ${terminal.id} AND fecha = ${diaStr(fecha)}::date AND "sesionId" <> ${sesion.sesionId}
      `;
      // Lo que queda abierto y no corresponde (otra terminal, o de otro día con otra sesión) se
      // retira: si no, el unique parcial dejaría al trufi atascado y el INSERT sería un no-op silencioso.
      // La misma sesión en la misma terminal conserva su fila aunque cruce la medianoche.
      await tx.$executeRaw`
        UPDATE fila_salida SET estado = 'retirado'
        WHERE "vehiculoId" = ${sesion.vehiculoId} AND estado = 'en_fila'
          AND ("puntoControlId" <> ${terminal.id}
               OR ("sesionId" <> ${sesion.sesionId} AND fecha <> ${diaStr(fecha)}::date))
      `;
      await tx.$executeRaw`
        INSERT INTO fila_salida (id, "sindicatoId", "puntoControlId", fecha, "sesionId", "vehiculoId", "llegadaTs", "ordenTs", estado, anticipada)
        VALUES (${randomUUID()}, ${sesion.sindicatoId}, ${terminal.id}, ${diaStr(fecha)}::date, ${sesion.sesionId},
                ${sesion.vehiculoId}, ${ahora}, ${ahora}, 'en_fila', false)
        ON CONFLICT ("vehiculoId") WHERE estado = 'en_fila' DO NOTHING
      `;
      return { fila: await this.estadoMovilTx(tx, sesion, ahora), anticipada: null };
    });
  }

  /**
   * `POST /mobile/fila/salida`. `UPDATE` condicional sobre la fila abierta del vehículo del token;
   * sin fila abierta es un no-op (200 con `fila: null`), así un reintento no falla.
   */
  async registrarSalida(sesion: SesionMovilAutenticada, body: SalidaFilaMovil): Promise<RespuestaFilaMovil> {
    const ahora = new Date();
    const fecha = fechaActualBolivia(ahora);
    return withTenantContext(contextoMovil(sesion), async (tx) => {
      const mia = await this.filaAbiertaDe(tx, sesion);
      if (!mia) return { fila: null, anticipada: null };
      // La terminal se conoce recién al leer la fila; el UPDATE condicional cubre que cambie en el medio.
      await bloquearTerminal(tx, mia.puntoControlId);
      const { posiciones } = await calcularFilaPc(tx, mia.puntoControlId, fecha, ahora, null, sesion.sesionId);
      const anticipada = esAnticipada(posiciones, mia.id, ahora);
      const n = await tx.$executeRaw`
        UPDATE fila_salida
        SET estado = 'salio', "salidaTs" = ${ahora}, "salidaOrigen" = ${body.origen}, anticipada = ${anticipada}
        WHERE id = ${mia.id} AND "vehiculoId" = ${sesion.vehiculoId} AND estado = 'en_fila'
      `;
      return { fila: null, anticipada: n > 0 ? anticipada : null };
    });
  }

  /** Campo `fila` de `GET /mobile/vuelta-actual`: `null` si el trufi no está en la fila. */
  async estadoMovil(sesion: SesionMovilAutenticada, ahora: Date = new Date()): Promise<EstadoFilaSalida | null> {
    return withTenantContext(contextoMovil(sesion), (tx) => this.estadoMovilTx(tx, sesion, ahora));
  }

  /** Fila abierta de la SESIÓN del token (no solo del vehículo); sin filtro de día: no vence a medianoche. */
  private async filaAbiertaDe(tx: Tx, sesion: SesionMovilAutenticada) {
    const [fila] = await tx.$queryRaw<{ id: string; puntoControlId: string }[]>`
      SELECT id, "puntoControlId" FROM fila_salida
      WHERE "vehiculoId" = ${sesion.vehiculoId} AND "sesionId" = ${sesion.sesionId} AND estado = 'en_fila'
    `;
    return fila ?? null;
  }

  private async estadoMovilTx(tx: Tx, sesion: SesionMovilAutenticada, ahora: Date): Promise<EstadoFilaSalida | null> {
    const fecha = fechaActualBolivia(ahora);
    const mia = await this.filaAbiertaDe(tx, sesion);
    if (!mia) return null;
    const { filas, posiciones } = await calcularFilaPc(tx, mia.puntoControlId, fecha, ahora, null, sesion.sesionId);
    return armarEstadoMovil(posiciones, filas, mia.id, ahora);
  }

  // ---------------------------------------------------------------- panel

  /** `GET /salidas/:puntoControlId/fila`. */
  async estadoPanel(actor: AuthenticatedUser, puntoControlId: string): Promise<EstadoFilaSalidaPanel> {
    return withTenantContext(contextoPanel(actor), async (tx) => {
      await resolverTerminal(tx, puntoControlId);
      return this.armarPanel(tx, puntoControlId, new Date());
    });
  }

  /** Panel de una terminal ya validada (la terminal se resuelve una sola vez por request). */
  private async armarPanel(tx: Tx, puntoControlId: string, ahora: Date): Promise<EstadoFilaSalidaPanel> {
    const fecha = fechaActualBolivia(ahora);
    const { baseMin, filas, posiciones } = await calcularFilaPc(tx, puntoControlId, fecha, ahora);
    const recientes = await salidasRecientes(tx, puntoControlId, fecha, SALIDAS_RECIENTES_MAX);
    return {
      puntoControlId,
      baseMin,
      servidorTs: ahora.toISOString(),
      items: armarItemsPanel(posiciones, filas),
      salidasRecientes: armarSalidasRecientes(recientes),
    };
  }

  despachar(actor: AuthenticatedUser, puntoControlId: string, filaId: string) {
    return this.accionPanel(actor, puntoControlId, filaId, async (tx, ahora, anticipada) => tx.$executeRaw`
      UPDATE fila_salida
      SET estado = 'salio', "salidaTs" = ${ahora}, "salidaOrigen" = 'panel', anticipada = ${await anticipada()}
      WHERE id = ${filaId} AND "puntoControlId" = ${puntoControlId} AND estado = 'en_fila'
    `);
  }

  moverAlFinal(actor: AuthenticatedUser, puntoControlId: string, filaId: string) {
    return this.accionPanel(actor, puntoControlId, filaId, (tx, ahora) => tx.$executeRaw`
      UPDATE fila_salida SET "ordenTs" = ${ahora}
      WHERE id = ${filaId} AND "puntoControlId" = ${puntoControlId} AND estado = 'en_fila'
    `);
  }

  retirar(actor: AuthenticatedUser, puntoControlId: string, filaId: string) {
    return this.accionPanel(actor, puntoControlId, filaId, (tx) => tx.$executeRaw`
      UPDATE fila_salida SET estado = 'retirado'
      WHERE id = ${filaId} AND "puntoControlId" = ${puntoControlId} AND estado = 'en_fila'
    `);
  }

  /**
   * Valida terminal y fila (404 si no existen o son de otro sindicato, por RLS/línea), toma el lock
   * de la terminal, deja que `aplicar` calcule `anticipada` (solo despachar) con la fila ANTES del
   * cambio y aplica el `UPDATE` condicional (409 si otro ya la movió/despachó). Devuelve la fila
   * actualizada; la terminal se resuelve una vez y la fila se recalcula solo tras el cambio.
   */
  private async accionPanel(
    actor: AuthenticatedUser,
    puntoControlId: string,
    filaId: string,
    aplicar: (tx: Tx, ahora: Date, anticipada: () => Promise<boolean>) => Promise<number>,
  ): Promise<ResultadoAccionPanel> {
    const ahora = new Date();
    return withTenantContext(contextoPanel(actor), async (tx) => {
      const pc = await resolverTerminal(tx, puntoControlId);
      await bloquearTerminal(tx, puntoControlId);
      const existe = await tx.filaSalida.findFirst({
        where: { id: filaId, puntoControlId },
        select: { id: true },
      });
      if (!existe) throw noEncontrado(MSG_FILA_NO_ENCONTRADA);
      const anticipada = async () => {
        const { posiciones } = await calcularFilaPc(tx, puntoControlId, fechaActualBolivia(ahora), ahora);
        return esAnticipada(posiciones, filaId, ahora);
      };
      if ((await aplicar(tx, ahora, anticipada)) === 0) throw yaNoEstaEnFila();
      const estado = await this.armarPanel(tx, puntoControlId, ahora);
      return { ...estado, id: filaId, sindicatoId: pc.sindicatoId };
    });
  }
}
