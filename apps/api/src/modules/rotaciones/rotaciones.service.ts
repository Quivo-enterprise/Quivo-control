import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, withTenantContext } from '@quivo/db';
import {
  AsignacionSchema,
  RotacionSchema,
  type ActualizarAsignacion,
  type Asignacion,
  type ConfigHorario,
  type CrearAsignacionManual,
  type GenerarRotacion,
  type Rotacion,
} from '@quivo/shared';
import { asegurarRutaVisible } from '../../common/geo/tenant-checks.js';
import { retirarFilaDeSesiones } from '../../common/sesiones/retirar-fila.js';
import { GRACIA_ACTIVIDAD_MEDIANOCHE_MS } from '../../common/sesiones/vigencia.js';
import { fechaActualBolivia, finDeJornadaBolivia, horaEnBolivia } from '../../common/tiempo/jornada.js';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

const CONFLICTO_UNICIDAD = 'P2002';
const LOTE_SESIONES_ZOMBI = 500;
/** Un turno nocturno sin señal (offline) puede seguir vivo horas después de que vence su asignación
 * (00:00 BO); el zombi solo se cierra pasadas ~04:00 BO del día siguiente. */
const VENCIMIENTO_ZOMBI_MS = 4 * 60 * 60 * 1000;
/** Sesión con recorrido en curso/en pausa sin actividad (GPS, ingesta o evento de recorrido) por más
 * de 3 h: se cierra aunque la asignación siga vigente. */
const INACTIVIDAD_CIERRE_MS = 3 * 60 * 60 * 1000;
/** Regla B: debe haber ingesta global posterior a la última actividad de la sesión + este margen; si
 * el worker de ingesta cayó, el silencio es nuestro y no del chofer. */
const MARGEN_INGESTA_SANA_MIN = 15;

export interface SinCobertura {
  vehiculoId: string;
  rutaId: string;
}

@Injectable()
export class RotacionesService {
  async generar(
    actor: AuthenticatedUser,
    data: GenerarRotacion,
  ): Promise<Rotacion & { asignaciones: Asignacion[]; sinCobertura: SinCobertura[] }> {
    const sindicatoId = resolverSindicatoId(actor, data.sindicatoId);

    return withTenantContext(toTenantContext(actor), async (tx) => {
      // Cada ruta debe ser visible para este tenant (no tienen sindicatoId propio, se
      // resuelve transitivamente vía linea — mismo check que usan rutas/paradas/puntos de
      // control, ver common/geo/tenant-checks.ts).
      for (const rutaId of data.rutaIds) {
        const ruta = await asegurarRutaVisible(tx, rutaId);
        if (ruta.sindicatoId !== sindicatoId) {
          throw new NotFoundException(`Ruta ${rutaId} no encontrada`);
        }
      }

      const [vehiculos, conductores] = await Promise.all([
        tx.vehiculo.findMany({ where: { sindicatoId, estado: 'activo' }, orderBy: { placa: 'asc' } }),
        tx.conductor.findMany({ where: { sindicatoId, estado: 'activo' }, orderBy: { nombre: 'asc' } }),
      ]);
      if (vehiculos.length === 0) {
        throw new BadRequestException('El sindicato no tiene vehículos activos para repartir');
      }

      const rotacion = await tx.rotacion.create({
        data: { sindicatoId, periodo: data.periodo, estado: 'borrador' },
      });

      // Ocupación existente de estos vehículos en estas fechas/horarios (de cualquier
      // rotación, no solo esta) — se chequea en memoria ANTES de insertar. Postgres aborta
      // toda la transacción entera al primer error (25P02: "current transaction is
      // aborted"), así que no se puede usar el constraint único como control de flujo acá
      // (a diferencia de crearAsignacion/actualizarAsignacion, que corren en su propia
      // transacción y sí pueden dejar que el 23505 les llegue y traducirlo).
      const fechasOrdenadas = [...data.fechas].sort((a, b) => a.getTime() - b.getTime());
      const existentes = await tx.asignacion.findMany({
        where: {
          vehiculoId: { in: vehiculos.map((v) => v.id) },
          horario: { in: data.horarios },
          fecha: { in: fechasOrdenadas },
        },
        select: { vehiculoId: true, fecha: true, horario: true, rutaId: true },
      });
      const ocupados = new Set(existentes.map((a) => claveOcupacion(a.vehiculoId, a.fecha, a.horario)));

      let vIdx = 0;
      let cIdx = 0;
      let orden = 1;
      const asignaciones: Asignacion[] = [];

      const crear = async (
        vehiculoId: string,
        rutaId: string,
        fecha: Date,
        horario: string,
        horaSalida: Date | null,
        horaPresentacion: Date | null,
      ) => {
        const conductor = conductores.length > 0 ? conductores[cIdx % conductores.length] : null;
        const creada = await tx.asignacion.create({
          data: {
            rotacionId: rotacion.id,
            vehiculoId,
            conductorId: conductor?.id ?? null,
            rutaId,
            fecha,
            horario,
            horaSalida,
            horaPresentacion,
            orden: orden++,
            venceAt: finDeJornadaBolivia(fecha),
          },
        });
        ocupados.add(claveOcupacion(vehiculoId, fecha, horario));
        if (conductor) cIdx++;
        asignaciones.push(toAsignacion(creada));
      };

      // Cobertura ya cubierta por asignaciones existentes (de cualquier rotación previa)
      // dentro de este mismo período — cuenta para no repetir de más.
      const cobertura = new Map<string, Set<string>>(vehiculos.map((v) => [v.id, new Set<string>()]));
      for (const e of existentes) {
        if (data.rutaIds.includes(e.rutaId)) cobertura.get(e.vehiculoId)?.add(e.rutaId);
      }

      // Reparto con mejor esfuerzo (ver comentario en GenerarRotacionSchema): un sub-slot
      // recibe como máximo un vehículo, igual que antes. La única diferencia frente a un
      // round-robin ciego es la prioridad al elegir *cuál* vehículo libre se lo lleva —
      // modelo operativo Línea 120 (piloto Tiquipaya): se prefiere el que todavía no cubrió
      // esa ruta/variante de línea, para que ningún vehículo activo quede sin pisar, al
      // menos una vez en el período, cada ruta pedida. Si ya todos los vehículos libres la
      // cubrieron, cae al primero libre (comportamiento original). Con suficiente capacidad
      // de slots esto termina cubriendo todas las combinaciones vehículo×ruta sin inflar el
      // total de asignaciones — sigue siendo un sub-slot, un vehículo. `vIdx` nunca se
      // reinicia entre fechas: como los sub-slots de cada día se procesan siempre en el
      // mismo orden (por horaSalida cuando hay horario pico), el puntero round-robin sigue
      // avanzando día a día — el vehículo que salió primero hoy no vuelve a ser el primero
      // mañana, sin necesitar una regla de equidad aparte.
      for (const fecha of fechasOrdenadas) {
        for (const horario of data.horarios) {
          const subSlots = construirSubSlots(fecha, horario, data.rutaIds, data.configHorarios?.[horario]);
          for (const subSlot of subSlots) {
            let elegido: { vehiculoId: string; intento: number } | null = null;
            let elegidoLibre: { vehiculoId: string; intento: number } | null = null;
            for (let intento = 0; intento < vehiculos.length; intento++) {
              // `(vIdx + intento) % vehiculos.length` siempre cae dentro del array (ya se
              // validó `vehiculos.length > 0` más arriba) — TS no lo puede inferir solo.
              const candidato = vehiculos[(vIdx + intento) % vehiculos.length]!;
              if (ocupados.has(claveOcupacion(candidato.id, fecha, horario))) continue;
              elegidoLibre ??= { vehiculoId: candidato.id, intento };
              if (!cobertura.get(candidato.id)!.has(subSlot.rutaId)) {
                elegido = { vehiculoId: candidato.id, intento };
                break;
              }
            }
            elegido ??= elegidoLibre;
            if (!elegido) continue; // sin vehículo libre para este sub-slot — queda sin cubrir
            await crear(
              elegido.vehiculoId,
              subSlot.rutaId,
              fecha,
              horario,
              subSlot.horaSalida,
              subSlot.horaPresentacion,
            );
            cobertura.get(elegido.vehiculoId)!.add(subSlot.rutaId);
            vIdx += elegido.intento + 1;
          }
        }
      }

      const sinCobertura: SinCobertura[] = [];
      for (const vehiculo of vehiculos) {
        for (const rutaId of data.rutaIds) {
          if (!cobertura.get(vehiculo.id)!.has(rutaId)) sinCobertura.push({ vehiculoId: vehiculo.id, rutaId });
        }
      }

      return { ...toRotacion(rotacion), asignaciones, sinCobertura };
    });
  }

  async listar(actor: AuthenticatedUser): Promise<Rotacion[]> {
    const rows = await withTenantContext(toTenantContext(actor), (tx) =>
      tx.rotacion.findMany({
        where: actor.sindicatoId ? { sindicatoId: actor.sindicatoId } : undefined,
        orderBy: { periodo: 'desc' },
      }),
    );
    return rows.map(toRotacion);
  }

  async obtener(actor: AuthenticatedUser, id: string): Promise<Rotacion & { asignaciones: Asignacion[] }> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const rotacion = await obtenerRotacionOFallar(tx, id);
      const asignaciones = await tx.asignacion.findMany({ where: { rotacionId: id }, orderBy: { orden: 'asc' } });
      return { ...toRotacion(rotacion), asignaciones: asignaciones.map(toAsignacion) };
    });
  }

  async publicar(actor: AuthenticatedUser, id: string): Promise<Rotacion> {
    // `withTenantContext` ya corre el callback dentro de un `$transaction` (packages/db/src/
    // tenant-context.ts) — la publicación es atómica porque vive en esa misma transacción,
    // no porque haga algo especial acá.
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const rotacion = await obtenerRotacionOFallar(tx, id);
      if (rotacion.estado !== 'borrador') {
        throw new BadRequestException('Solo se puede publicar una rotación en borrador');
      }
      const total = await tx.asignacion.count({ where: { rotacionId: id } });
      if (total === 0) {
        throw new BadRequestException('La rotación no tiene asignaciones para publicar');
      }
      const publicada = await tx.rotacion.update({ where: { id }, data: { estado: 'publicada' } });
      return toRotacion(publicada);
    });
  }

  /** Vuelve una rotación publicada a borrador — para corregir un error antes de que la
   * app móvil la consuma. No es un estado nuevo ("anulada"): asunción de este equipo, el
   * doc técnico no detalla qué significa "anular" más allá de mencionar que se audita. */
  async anular(actor: AuthenticatedUser, id: string): Promise<Rotacion> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      const rotacion = await obtenerRotacionOFallar(tx, id);
      if (rotacion.estado !== 'publicada') {
        throw new BadRequestException('Solo se puede anular una rotación publicada');
      }
      const anulada = await tx.rotacion.update({ where: { id }, data: { estado: 'borrador' } });
      return toRotacion(anulada);
    });
  }

  async crearAsignacion(actor: AuthenticatedUser, rotacionId: string, data: CrearAsignacionManual): Promise<Asignacion> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRotacionEditable(tx, rotacionId);
      try {
        const creada = await tx.asignacion.create({
          data: {
            rotacionId,
            vehiculoId: data.vehiculoId,
            conductorId: data.conductorId ?? null,
            rutaId: data.rutaId,
            fecha: data.fecha,
            horario: data.horario,
            orden: data.orden,
            venceAt: finDeJornadaBolivia(data.fecha),
          },
        });
        return toAsignacion(creada);
      } catch (error) {
        throw traducirConflicto(error);
      }
    });
  }

  async actualizarAsignacion(
    actor: AuthenticatedUser,
    rotacionId: string,
    asignacionId: string,
    data: ActualizarAsignacion,
  ): Promise<Asignacion> {
    return withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRotacionEditable(tx, rotacionId);
      await obtenerAsignacionOFallar(tx, rotacionId, asignacionId);
      try {
        const actualizada = await tx.asignacion.update({ where: { id: asignacionId }, data });
        return toAsignacion(actualizada);
      } catch (error) {
        throw traducirConflicto(error);
      }
    });
  }

  // Devuelve `{ id }` (no `void`): el interceptor de auditoría (QUI-230) usa el `id` de la
  // respuesta para saber qué entidad auditar — sin él, caería al `id` de la ruta, que en
  // este endpoint es el de la rotación, no el de la asignación borrada.
  async eliminarAsignacion(
    actor: AuthenticatedUser,
    rotacionId: string,
    asignacionId: string,
  ): Promise<{ id: string }> {
    await withTenantContext(toTenantContext(actor), async (tx) => {
      await asegurarRotacionEditable(tx, rotacionId);
      await obtenerAsignacionOFallar(tx, rotacionId, asignacionId);
      await tx.asignacion.delete({ where: { id: asignacionId } });
    });
    return { id: asignacionId };
  }

  /** RF-57 (QUI-234): marca `vencida` toda asignación `vigente` cuya `venceAt` ya pasó — la
   * llama el job repeatable de `vencimiento.processor.ts`, no un request de usuario, así que
   * corre cross-tenant como `admin_quivo` (no hay un "actor" real detrás de un cron). Devuelve
   * cuántas filas marcó, para que el processor lo loguee. */
  async marcarVencidas(ahora: Date = new Date()): Promise<number> {
    const { count } = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.asignacion.updateMany({
        where: { estado: 'vigente', venceAt: { lt: ahora } },
        data: { estado: 'vencida' },
      }),
    );
    return count;
  }

  /** Sesiones zombi (incidente 22/10, PID): la sesión de login (refresh 30 días) solo la cierran
   * logout, rotar PIN o un login nuevo — si el chofer no hace nada, sigue "activa" con la
   * asignación de ayer. Cierra las `activa` que cumplan una de dos:
   *  (A) su asignación venció hace más de `VENCIMIENTO_ZOMBI_MS` Y sin actividad GPS en las últimas
   *      `GRACIA_ACTIVIDAD_MEDIANOCHE_MS`;
   *  (B) con recorrido `en_curso`/`en_pausa` y sin actividad (GPS, ingesta o evento de recorrido; o
   *      `inicio`) en `INACTIVIDAD_CIERRE_MS` (aunque la asignación siga vigente), y con ingesta global
   *      sana posterior al silencio. La app solo manda GPS entre "Iniciar" y "Finalizar recorrido":
   *      el chofer en cola o entre recorridos no se cierra por B.
   * Marca `cerradaPorSistema` (en-vivo la muestra "Inactivo", no "Finalizado").
   * Misma transición que `AuthMovilService.logout` (el trigger `vueltas_cerrar_con_sesion` deja la
   * vuelta en `abierta_al_cierre`) y el mismo retiro de `fila_salida` (`retirarFilaDeSesiones`).
   * Idempotente; hasta `LOTE_SESIONES_ZOMBI` por corrida (el resto cae en la siguiente, cada 5 min). Devuelve cuántas cerró. */
  async cerrarSesionesVencidas(ahora: Date = new Date()): Promise<number> {
    const corteVencimiento = new Date(ahora.getTime() - VENCIMIENTO_ZOMBI_MS);
    const corteActividad = new Date(ahora.getTime() - GRACIA_ACTIVIDAD_MEDIANOCHE_MS);
    const corteInactividad = new Date(ahora.getTime() - INACTIVIDAD_CIERRE_MS);
    // Misma condición en el SELECT del lote y en el guard del UPDATE: un fix que entre entre ambos
    // no puede cerrar una sesión viva. Alias: `so` sesión, `a` asignación.
    const hoyBO = fechaActualBolivia(ahora);
    const jornadasStr = [hoyBO, new Date(hoyBO.getTime() - 24 * 60 * 60 * 1000)].map((d) => d.toISOString().slice(0, 10));
    const sinActividadDesde = (corte: Date) => Prisma.sql`NOT EXISTS (
      SELECT 1 FROM gps_sesion_resumen gx
      WHERE gx.sesion_id = so.id::uuid AND gx."sindicatoId" = so."sindicatoId"
        AND GREATEST(gx.ultimo_fix_ts, gx.ultimo_ingreso_ts) >= ${corte})`;
    const ultimaGps = Prisma.sql`(SELECT max(GREATEST(g.ultimo_fix_ts, g.ultimo_ingreso_ts)) FROM gps_sesion_resumen g
      WHERE g.sesion_id = so.id::uuid AND g."sindicatoId" = so."sindicatoId")`;
    // GREATEST ignora NULL: un evento de recorrido (pausa/reanudar) cuenta como actividad.
    const ultimaActividad = Prisma.sql`GREATEST(${ultimaGps}, so."recorridoEstadoTs", so.inicio)`;
    // shortcut: el lag de ingesta (p95 ~13 min) hace que un celular que reanuda justo a las 3 h aún
    // pueda cerrarse; subir INACTIVIDAD_CIERRE_MS si aparece.
    // El max de ingesta es global entre sindicatos a propósito (salud del pipeline; corre como admin_quivo).
    const reglaB = Prisma.sql`so."recorridoEstado" IN ('en_curso', 'en_pausa')
        AND ${ultimaActividad} < ${corteInactividad}
        AND (SELECT max(g2.ultimo_ingreso_ts) FROM gps_sesion_resumen g2
             WHERE g2.jornada IN (${jornadasStr[0]}::date, ${jornadasStr[1]}::date))
            > ${ultimaActividad} + ${Prisma.raw(`interval '${MARGEN_INGESTA_SANA_MIN} minutes'`)}`;
    const condicion = Prisma.sql`so.estado = 'activa' AND so.fin IS NULL AND so."revokedAt" IS NULL
      AND ((a."venceAt" < ${corteVencimiento} AND ${sinActividadDesde(corteActividad)}) OR (${reglaB}))`;
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      // `fin` = fin real (última actividad GPS; sin GPS, el último evento de recorrido o el venceAt acotado a ahora), nunca antes de
      // `inicio` ni en el futuro; `revokedAt` = ahora.
      // shortcut: turno nocturno offline >2 h pasadas ~04:00 BO se cierra y su evidencia encolada se
      // rechaza (igual un celular apagado >3 h con asignación vigente); subir los umbrales si el
      // servicio nocturno pasa de las 04:00 o aparecen huecos offline.
      const cerradas = await tx.$queryRaw<{ id: string }[]>`
        WITH lote AS (
          SELECT so.id FROM sesiones_operativas so
          JOIN asignaciones a ON a.id = so."asignacionId"
          WHERE ${condicion}
          LIMIT ${LOTE_SESIONES_ZOMBI}
        )
        UPDATE sesiones_operativas so
        SET estado = 'cerrada', "revokedAt" = ${ahora}, "cerradaPorSistema" = true,
            fin = GREATEST(so.inicio, COALESCE(${ultimaGps}, so."recorridoEstadoTs", LEAST(a."venceAt", ${ahora}::timestamptz)))
        FROM asignaciones a
        WHERE a.id = so."asignacionId" AND so.id IN (SELECT id FROM lote)
          AND ${condicion}
        RETURNING so.id
      `;
      await retirarFilaDeSesiones(tx, cerradas.map((c) => c.id));
      return cerradas.length;
    });
  }
}

async function obtenerRotacionOFallar(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ id: string; sindicatoId: string; periodo: string; estado: string }> {
  const rotacion = await tx.rotacion.findUnique({ where: { id } });
  if (!rotacion) {
    throw new NotFoundException('Rotación no encontrada');
  }
  return rotacion;
}

async function obtenerAsignacionOFallar(
  tx: Prisma.TransactionClient,
  rotacionId: string,
  asignacionId: string,
): Promise<void> {
  const asignacion = await tx.asignacion.findUnique({ where: { id: asignacionId } });
  if (!asignacion || asignacion.rotacionId !== rotacionId) {
    throw new NotFoundException('Asignación no encontrada');
  }
}

async function asegurarRotacionEditable(tx: Prisma.TransactionClient, rotacionId: string): Promise<void> {
  const rotacion = await obtenerRotacionOFallar(tx, rotacionId);
  if (rotacion.estado !== 'borrador') {
    throw new BadRequestException('Solo se pueden editar asignaciones de una rotación en borrador');
  }
}

function claveOcupacion(vehiculoId: string, fecha: Date, horario: string): string {
  return `${vehiculoId}|${fecha.toISOString().slice(0, 10)}|${horario}`;
}

interface SubSlot {
  rutaId: string;
  horaSalida: Date | null;
  horaPresentacion: Date | null;
}

/** Sin `config` (horario sin horario pico configurado): un sub-slot por ruta, sin hora
 * exacta — comportamiento previo, sin cambios. Con `config`: una salida cada
 * `headwayMinutos` entre `horaInicio` y `horaFin` (inclusive), cicladas entre `rutaIds` en
 * orden — "modo frecuencia combinada de línea" del modelo Línea 120 — cada una con su
 * `horaPresentacion` (`horaSalida` menos el buffer). Más salidas = más vehículos distintos
 * necesarios para cubrirlas (la unicidad `[vehiculoId, fecha, horario]` sigue permitiendo
 * un solo sub-slot por vehículo en ese horario). */
function construirSubSlots(
  fecha: Date,
  horario: string,
  rutaIds: string[],
  config: ConfigHorario | undefined,
): SubSlot[] {
  if (!config) {
    return rutaIds.map((rutaId) => ({ rutaId, horaSalida: null, horaPresentacion: null }));
  }
  const [horaInicioH, horaInicioM] = config.horaInicio.split(':').map(Number);
  const [horaFinH, horaFinM] = config.horaFin.split(':').map(Number);
  const inicioMin = horaInicioH! * 60 + horaInicioM!;
  const finMin = horaFinH! * 60 + horaFinM!;

  const subSlots: SubSlot[] = [];
  let i = 0;
  for (let minuto = inicioMin; minuto <= finMin; minuto += config.headwayMinutos) {
    const horaHHmm = `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`;
    const horaSalida = horaEnBolivia(fecha, horaHHmm);
    const horaPresentacion = new Date(horaSalida.getTime() - config.bufferPresentacionMinutos * 60_000);
    subSlots.push({ rutaId: rutaIds[i % rutaIds.length]!, horaSalida, horaPresentacion });
    i++;
  }
  return subSlots;
}

function esConflictoUnicidad(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === CONFLICTO_UNICIDAD;
}

/** El `@@unique([vehiculoId, fecha, horario])` del schema (QUI-231) es la barrera real —
 * esto solo traduce el P2002 de Postgres a un 409 legible en vez de un 500 genérico. */
function traducirConflicto(error: unknown): unknown {
  if (esConflictoUnicidad(error)) {
    return new ConflictException('Ese vehículo ya tiene una asignación en esa fecha y horario');
  }
  return error;
}

function toTenantContext(actor: AuthenticatedUser): { rol: string; sindicatoId: string | null } {
  return { rol: actor.rol, sindicatoId: actor.sindicatoId };
}

function resolverSindicatoId(actor: AuthenticatedUser, sindicatoIdDelBody: string | undefined): string {
  if (actor.sindicatoId) {
    return actor.sindicatoId;
  }
  if (!sindicatoIdDelBody) {
    throw new BadRequestException('sindicatoId es obligatorio para admin_quivo');
  }
  return sindicatoIdDelBody;
}

function toRotacion(row: { id: string; sindicatoId: string; periodo: string; estado: string }): Rotacion {
  return RotacionSchema.parse(row);
}

function toAsignacion(row: {
  id: string;
  rotacionId: string;
  vehiculoId: string;
  conductorId: string | null;
  rutaId: string;
  fecha: Date;
  horario: string;
  horaSalida: Date | null;
  horaPresentacion: Date | null;
  orden: number;
  venceAt: Date;
  estado: string;
}): Asignacion {
  return AsignacionSchema.parse(row);
}
