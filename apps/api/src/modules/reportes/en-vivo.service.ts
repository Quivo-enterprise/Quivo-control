import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  ContextoEnVivoSchema,
  PosicionEnVivoSchema,
  SesionEnVivoResumenSchema,
  TrazaEnVivoSchema,
  type ContextoEnVivo,
  type EstadoFrescura,
  type FrescuraEnVivo,
  type PosicionEnVivo,
  type SesionEnVivoResumen,
  type TrazaEnVivo,
  type TrazaEnVivoQuery,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import {
  fechaActualBolivia,
  inicioDeJornadaBolivia,
  inicioDeJornadaSiguienteBolivia,
} from '../../common/tiempo/jornada.js';

interface SesionEnVivoRow {
  id: string;
  inicio: Date;
  fin: Date | null;
  estado: string;
  deviceId: string;
  vehiculoPlaca: string;
  conductorNombre: string;
  lineaNombre: string;
  ultimoFixTs: Date | null;
  ultimoIngresoTs: Date | null;
  totalPuntos: number | null;
}

/**
 * ENTREGA 10 — fila de `GET /reportes/en-vivo/posiciones`. A diferencia de
 * `SesionEnVivoRow` (que agrega con `max()`), acá el LATERAL devuelve las columnas del
 * **fix más reciente** (`lat`/`lng`/`accuracy`/`speed` de esa fila puntual), no un
 * agregado — por eso `ultimoFixTs`/`ultimoIngresoTs`/`totalPuntos` viajan junto a la
 * posición en la misma fila en vez de en una interfaz de agregados separada.
 */
interface PosicionEnVivoRow {
  id: string;
  inicio: Date;
  fin: Date | null;
  estado: string;
  deviceId: string;
  vehiculoPlaca: string;
  conductorNombre: string;
  lineaId: string;
  lineaNombre: string;
  rutaSentido: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speed: number | null;
  ultimoFixTs: Date | null;
  ultimoIngresoTs: Date | null;
  totalPuntos: number | null;
}

interface AgregadosFixRow {
  ultimoFixTs: Date | null;
  ultimoIngresoTs: Date | null;
  totalPuntos: number | null;
}

interface RutaGeomRow {
  id: string;
  geometria: string; // ST_AsGeoJSON devuelve `text`, no JSON nativo.
}

interface PuntoControlRow {
  id: string;
  orden: number;
  coord: string;
  radioToleranciaM: number;
}

interface GpsPointRow {
  ts: Date;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
}

const MINUTO_MS = 60_000;

/**
 * Umbrales **operativos** (no de presentación) para derivar `estadoFrescura`, calibrados
 * con las mediciones de la jornada del 2026-08-18 contra producción:
 *
 * - Lag captura→servidor: mediana 153-166 s, p95 684-814 s, máximo 4275 s. Un umbral de
 *   ingesta por debajo del p95 marcaría "perdido" a un teléfono que solo está atrasado,
 *   así que se usa **15 min** (≈ p95 + margen).
 * - Fixes en movimiento: mediana 17-21 s. Pero con el vehículo **detenido** los huecos
 *   llegan a **56 min** (también 22, 17 y 11 min) porque el plugin apaga la captura. Por
 *   eso un fix viejo NO significa falla: significa `detenido`, y solo cuando la ingesta
 *   también está muerta se declara `perdido`.
 *
 * Los umbrales de **color** del panel (verde/ámbar/rojo) NO viven acá: son decisión de
 * presentación y los aplica el frontend sobre `ultimoFixTs`/`ultimoIngresoTs`/`servidorTs`
 * crudos, que siempre viajan en la respuesta.
 */
export const UMBRAL_INGESTA_VIVA_MS = 15 * MINUTO_MS;
export const UMBRAL_FIX_EN_MOVIMIENTO_MS = 15 * MINUTO_MS;

/**
 * Ventana de traza anclada a `sesion.inicio` (no al día calendario, para no cortar una
 * sesión que cruza medianoche): `[inicio - 60 s, min((fin ?? ahora) + 2 h, inicio + 36 h))`.
 *
 * El piso de 60 s absorbe el skew de reloj del dispositivo; el techo de +2 h sobre el fin
 * absorbe el lag de ingesta (máximo medido: 4275 s ≈ 71 min).
 *
 * El tope duro de 36 h es lo que acota cuántas particiones diarias puede tocar la query.
 * Consecuencia asumida: una sesión que quedó colgada hace más de 36 h (`fin` NULL para
 * siempre, defecto conocido de la app) se reporta con `estadoFrescura: 'sin_datos'` e
 * `inactivaDesdeMs` alto aunque el teléfono siguiera mandando puntos sobre ese mismo
 * `sesionId`. Es el comportamiento deseado para el panel — un zombi de más de un día y
 * medio no es "el trufi en vivo" — y es justo la señal con la que el cliente corta el poll.
 */
const PISO_ANTES_DEL_INICIO_MS = 60_000;
const TECHO_DESPUES_DEL_FIN_MS = 2 * 60 * MINUTO_MS;
const TECHO_MAXIMO_DESDE_INICIO_MS = 36 * 60 * MINUTO_MS;

/**
 * ENTREGA 10 — ventana y tope de `obtenerPosiciones`. `listarHoy` filtra por
 * `so.inicio` dentro de la jornada boliviana exacta (`trazaDesde`/`trazaHasta`) con
 * `LIMIT 100`; con sesiones colgadas de días previos (`fin IS NULL` para siempre, la
 * app no cierra sesión al "Finalizar recorrido") ese límite puede esconder a las vivas
 * detrás de zombies. Acá el filtro es una ventana **rodante** de 24 h sobre `so.inicio`
 * (no la jornada calendario) con un tope más alto: cubre un turno completo aunque cruce
 * medianoche boliviana, y 500 sesiones es más margen del que cualquier sindicato real
 * tiene hoy en simultáneo.
 */
const VENTANA_SESIONES_POSICIONES_MS = 24 * 60 * MINUTO_MS;
const LIMITE_SESIONES_POSICIONES = 500;

function diferenciaMs(ahora: Date, ts: Date | null): number | null {
  if (!ts) return null;
  // Clamp a >= 0: `received_at` lo pone el reloj de Postgres y `ahora` el del proceso Node;
  // un skew de milisegundos no debe producir una antigüedad negativa en el contrato.
  return Math.max(0, ahora.getTime() - ts.getTime());
}

function clasificarFrescura(
  antiguedadFixMs: number | null,
  antiguedadIngestaMs: number | null,
): EstadoFrescura {
  if (antiguedadFixMs === null && antiguedadIngestaMs === null) return 'sin_datos';
  if (antiguedadIngestaMs === null || antiguedadIngestaMs > UMBRAL_INGESTA_VIVA_MS) {
    return 'perdido';
  }
  // Ingesta viva. Si además el último fix es reciente, el vehículo se está moviendo;
  // si no, el teléfono sincroniza pero el vehículo está quieto (terminal).
  if (antiguedadFixMs !== null && antiguedadFixMs <= UMBRAL_FIX_EN_MOVIMIENTO_MS) {
    return 'reportando';
  }
  return 'detenido';
}

/**
 * Deriva el bloque de frescura. `inicio` es el fallback de `inactivaDesdeMs` para sesiones
 * que nunca recibieron un punto: sin él, una sesión colgada sin datos tendría inactividad
 * `null` y el cliente no sabría cuándo cortar el poll.
 */
export function derivarFrescura(
  ahora: Date,
  inicio: Date,
  ultimoFixTs: Date | null,
  ultimoIngresoTs: Date | null,
): FrescuraEnVivo {
  const antiguedadFixMs = diferenciaMs(ahora, ultimoFixTs);
  const antiguedadIngestaMs = diferenciaMs(ahora, ultimoIngresoTs);
  return {
    ultimoFixTs: ultimoFixTs?.toISOString() ?? null,
    ultimoIngresoTs: ultimoIngresoTs?.toISOString() ?? null,
    servidorTs: ahora.toISOString(),
    antiguedadFixMs,
    antiguedadIngestaMs,
    inactivaDesdeMs: antiguedadIngestaMs ?? Math.max(0, ahora.getTime() - inicio.getTime()),
    estadoFrescura: clasificarFrescura(antiguedadFixMs, antiguedadIngestaMs),
  };
}

/**
 * ENTREGA 3 — mapa en vivo `/en-vivo`. Endpoints **nuevos**, sin params sobre los
 * existentes: `RecorridoDetalleSchema` y `RecorridosService.obtener` los consumen la
 * página del histórico y 6 aserciones de su test.
 *
 * Aislamiento (mismo criterio que `RecorridosService`): `gps_points` tiene RLS propia en la
 * tabla padre **y en cada partición** (`20260815120000_gps_points_sindicato_rls`) — por eso
 * acá se consulta **siempre `gps_points`**, nunca una partición `gps_points_YYYYMMDD`.
 * `rutas`/`puntos_control` no tienen RLS: se leen solo con el `rutaId` derivado de una fila
 * ya filtrada, y el tenant-check real es el `findUnique` de `sesionOperativa` al principio
 * (cross-tenant ⇒ 404, no 403).
 *
 * Estos GET son de **poll** (~8 req/min por pestaña): no llevan `@Auditable`, así que el
 * interceptor de auditoría no los toca — si escribieran en `audit_log` serían ~500 filas
 * basura por hora.
 */
@Injectable()
export class EnVivoService {
  /**
   * Sesiones de la jornada boliviana en curso **más** las que quedaron abiertas de días
   * anteriores (`fin IS NULL AND estado = 'activa'`): la app no cierra la sesión al
   * "Finalizar recorrido" — solo registra un evento —, así que hay sesiones colgadas
   * indefinidamente y omitirlas escondería vehículos que sí están reportando.
   */
  async listarHoy(
    actor: AuthenticatedUser,
    ahora: Date = new Date(),
  ): Promise<SesionEnVivoResumen[]> {
    // Cotas **constantes** (no correlacionadas con `so.inicio`) para que el planner pueda
    // podar particiones de `gps_points`: la ventana abarca 2 particiones diarias como
    // mucho (jornada Bolivia = 04:00 UTC → 04:00 UTC del día siguiente).
    const jornada = fechaActualBolivia(ahora);
    const trazaDesde = inicioDeJornadaBolivia(jornada);
    const trazaHasta = inicioDeJornadaSiguienteBolivia(jornada);

    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const filas = await tx.$queryRaw<SesionEnVivoRow[]>`
        SELECT so.id, so.inicio, so.fin, so.estado, so."deviceId",
          v.placa as "vehiculoPlaca", c.nombre as "conductorNombre", l.nombre as "lineaNombre",
          fix."ultimoFixTs", fix."ultimoIngresoTs", fix."totalPuntos"
        FROM sesiones_operativas so
        JOIN vehiculos v ON v.id = so."vehiculoId"
        JOIN conductores c ON c.id = so."conductorId"
        JOIN asignaciones a ON a.id = so."asignacionId"
        JOIN rutas r ON r.id = a."rutaId"
        JOIN lineas l ON l.id = r."lineaId"
        LEFT JOIN LATERAL (
          SELECT max(gp.ts) AS "ultimoFixTs",
                 max(gp.received_at) AS "ultimoIngresoTs",
                 count(*)::int AS "totalPuntos"
          FROM gps_points gp
          WHERE gp.sesion_id = so.id::uuid
            AND gp.ts >= ${trazaDesde} AND gp.ts < ${trazaHasta}
        ) fix ON true
        WHERE (so.inicio >= ${trazaDesde} AND so.inicio < ${trazaHasta})
           OR (so.fin IS NULL AND so.estado = 'activa')
        ORDER BY (so.fin IS NULL) DESC, fix."ultimoFixTs" DESC NULLS LAST, so.inicio DESC
        LIMIT 100
      `;

      return filas.map((f) =>
        SesionEnVivoResumenSchema.parse({
          id: f.id,
          inicio: f.inicio.toISOString(),
          fin: f.fin?.toISOString() ?? null,
          estado: f.estado,
          deviceId: f.deviceId,
          activa: f.fin === null && f.estado === 'activa',
          vehiculoPlaca: f.vehiculoPlaca,
          conductorNombre: f.conductorNombre,
          lineaNombre: f.lineaNombre,
          totalPuntos: f.totalPuntos ?? 0,
          ...derivarFrescura(ahora, f.inicio, f.ultimoFixTs, f.ultimoIngresoTs),
        }),
      );
    });
  }

  /**
   * ENTREGA 10 — `GET /reportes/en-vivo/posiciones`. Última posición conocida de TODOS
   * los vehículos con sesión activa, en **una sola query** que no escala con N: es la
   * alternativa al patrón "una traza por sesión" (`obtenerTraza`, descartado en el plan
   * de corrección post-piloto por costo — con 5 sesiones en poll rápido de 1 s son
   * 300 req/min, el techo exacto del throttle del controller).
   *
   * Extiende el `LATERAL` de `listarHoy` con dos cambios de fondo:
   *
   * 1. En vez de `max()` sobre `gps_points`, trae la **fila completa** del fix más
   *    reciente (`ORDER BY ts DESC LIMIT 1`) para tener `lat`/`lng`/`accuracy`/`speed`
   *    de esa posición puntual — un `max(lat)` no tendría sentido. `ultimoIngresoTs` y
   *    `totalPuntos` siguen siendo agregados de la ventana completa, calculados con
   *    funciones de ventana (`OVER ()`, sin `PARTITION BY`) sobre el mismo conjunto de
   *    filas que ya filtró el `WHERE`: Postgres las evalúa **antes** de aplicar
   *    `ORDER BY`/`LIMIT`, así que quedan correctas aunque la fila devuelta sea solo 1.
   *    Alcanza con un único acceso a `gps_points` por sesión (mismo costo que el
   *    `max()` de `listarHoy`), no dos subqueries.
   * 2. `l.id AS "lineaId"` y `r.sentido AS "rutaSentido"`: ambos joins (`rutas`,
   *    `lineas`) ya estaban para resolver `lineaNombre`, así que salen gratis.
   *
   * La ventana de partición (`trazaDesde`/`trazaHasta`, jornada boliviana) se conserva
   * intacta para que el planner siga podando particiones de `gps_points` — es una cota
   * **constante**, no correlacionada con `so.inicio`, igual que en `listarHoy`.
   */
  async obtenerPosiciones(
    actor: AuthenticatedUser,
    ahora: Date = new Date(),
  ): Promise<PosicionEnVivo[]> {
    const jornada = fechaActualBolivia(ahora);
    const trazaDesde = inicioDeJornadaBolivia(jornada);
    const trazaHasta = inicioDeJornadaSiguienteBolivia(jornada);
    const sesionesDesde = new Date(ahora.getTime() - VENTANA_SESIONES_POSICIONES_MS);

    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const filas = await tx.$queryRaw<PosicionEnVivoRow[]>`
        SELECT so.id, so.inicio, so.fin, so.estado, so."deviceId",
          v.placa as "vehiculoPlaca", c.nombre as "conductorNombre",
          l.id as "lineaId", l.nombre as "lineaNombre", r.sentido as "rutaSentido",
          fix.lat, fix.lng, fix.accuracy, fix.speed,
          fix."ultimoFixTs", fix."ultimoIngresoTs", fix."totalPuntos"
        FROM sesiones_operativas so
        JOIN vehiculos v ON v.id = so."vehiculoId"
        JOIN conductores c ON c.id = so."conductorId"
        JOIN asignaciones a ON a.id = so."asignacionId"
        JOIN rutas r ON r.id = a."rutaId"
        JOIN lineas l ON l.id = r."lineaId"
        LEFT JOIN LATERAL (
          SELECT gp.lat, gp.lng, gp.accuracy, gp.speed, gp.ts AS "ultimoFixTs",
                 max(gp.received_at) OVER () AS "ultimoIngresoTs",
                 count(*) OVER ()::int AS "totalPuntos"
          FROM gps_points gp
          WHERE gp.sesion_id = so.id::uuid
            AND gp.ts >= ${trazaDesde} AND gp.ts < ${trazaHasta}
          ORDER BY gp.ts DESC
          LIMIT 1
        ) fix ON true
        WHERE (so.inicio >= ${sesionesDesde})
           OR (so.fin IS NULL AND so.estado = 'activa')
        ORDER BY (so.fin IS NULL) DESC, fix."ultimoFixTs" DESC NULLS LAST, so.inicio DESC
        LIMIT ${LIMITE_SESIONES_POSICIONES}
      `;

      return filas.map((f) =>
        PosicionEnVivoSchema.parse({
          id: f.id,
          deviceId: f.deviceId,
          activa: f.fin === null && f.estado === 'activa',
          vehiculoPlaca: f.vehiculoPlaca,
          conductorNombre: f.conductorNombre,
          lineaId: f.lineaId,
          lineaNombre: f.lineaNombre,
          rutaSentido: f.rutaSentido,
          lat: f.lat,
          lng: f.lng,
          accuracy: f.accuracy,
          speed: f.speed,
          totalPuntos: f.totalPuntos ?? 0,
          ...derivarFrescura(ahora, f.inicio, f.ultimoFixTs, f.ultimoIngresoTs),
        }),
      );
    });
  }

  /** Todo lo que no cambia durante el recorrido — se pide una sola vez por sesión. */
  async obtenerContexto(
    actor: AuthenticatedUser,
    sesionId: string,
    ahora: Date = new Date(),
  ): Promise<ContextoEnVivo> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      // `findUnique` PRIMERO: es el tenant-check real (RLS). Si la sesión no es visible
      // para el actor, 404 antes de tocar `rutas`/`puntos_control`, que no tienen RLS.
      const sesion = await tx.sesionOperativa.findUnique({
        where: { id: sesionId },
        include: {
          vehiculo: true,
          conductor: true,
          asignacion: { include: { ruta: { include: { linea: true } } } },
        },
      });
      if (!sesion) {
        throw new NotFoundException('Sesión operativa no encontrada');
      }
      const rutaId = sesion.asignacion.rutaId;

      const [rutaRow] = await tx.$queryRaw<RutaGeomRow[]>`
        SELECT id, ST_AsGeoJSON(geometria) as geometria FROM rutas WHERE id = ${rutaId}
      `;
      if (!rutaRow) {
        throw new NotFoundException('Ruta de la asignación no encontrada');
      }
      // `estado = 'activo'`: `puntos_control` es soft-delete y un PC dado de baja
      // desorienta el mapa en vivo — mismo filtro que `tracking/paquete-dia.service.ts`.
      const puntoControlRows = await tx.$queryRaw<PuntoControlRow[]>`
        SELECT id, orden, ST_AsGeoJSON(coord) as coord, "radioToleranciaM"
        FROM puntos_control WHERE "rutaId" = ${rutaId} AND estado = 'activo' ORDER BY orden ASC
      `;

      return ContextoEnVivoSchema.parse({
        sesion: {
          id: sesion.id,
          inicio: sesion.inicio.toISOString(),
          fin: sesion.fin?.toISOString() ?? null,
          estado: sesion.estado,
          deviceId: sesion.deviceId,
        },
        vehiculo: { id: sesion.vehiculo.id, placa: sesion.vehiculo.placa },
        conductor: { id: sesion.conductor.id, nombre: sesion.conductor.nombre },
        linea: {
          id: sesion.asignacion.ruta.linea.id,
          nombre: sesion.asignacion.ruta.linea.nombre,
          color: sesion.asignacion.ruta.linea.color ?? '#3226B4',
        },
        ruta: { id: rutaRow.id, geometria: JSON.parse(rutaRow.geometria) },
        puntosControl: puntoControlRows.map((p) => ({
          id: p.id,
          orden: p.orden,
          coord: JSON.parse(p.coord),
          radioToleranciaM: p.radioToleranciaM,
        })),
        servidorTs: ahora.toISOString(),
      });
    });
  }

  /**
   * Delta de traza + agregados de frescura. La ventana está anclada a `sesion.inicio`
   * (no al día calendario) para no cortar una sesión que cruza medianoche, y el `desde`
   * del cliente solo puede **recortarla**: un cursor manipulado no puede hacer que la
   * query barra particiones fuera de la sesión.
   */
  async obtenerTraza(
    actor: AuthenticatedUser,
    sesionId: string,
    query: TrazaEnVivoQuery,
    ahora: Date = new Date(),
  ): Promise<TrazaEnVivo> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const sesion = await tx.sesionOperativa.findUnique({ where: { id: sesionId } });
      if (!sesion) {
        throw new NotFoundException('Sesión operativa no encontrada');
      }

      const inicioMs = sesion.inicio.getTime();
      const piso = new Date(inicioMs - PISO_ANTES_DEL_INICIO_MS);
      const techo = new Date(
        Math.min(
          (sesion.fin?.getTime() ?? ahora.getTime()) + TECHO_DESPUES_DEL_FIN_MS,
          inicioMs + TECHO_MAXIMO_DESDE_INICIO_MS,
        ),
      );
      // El cursor solo recorta: nunca puede bajar del piso ni pasar del techo.
      const desdePedido = query.desde?.getTime() ?? piso.getTime();
      const desde = new Date(Math.min(Math.max(desdePedido, piso.getTime()), techo.getTime()));
      const limite = query.limite;

      // `LIMIT limite + 1` para saber si quedaron puntos sin devolver sin pagar un
      // `count` extra sobre el delta.
      const gpsRows = await tx.$queryRaw<GpsPointRow[]>`
        SELECT ts, lat, lng, accuracy, speed FROM gps_points
        WHERE sesion_id = ${sesionId}::uuid AND ts >= ${desde} AND ts < ${techo}
        ORDER BY ts ASC
        LIMIT ${limite + 1}
      `;
      const hayMas = gpsRows.length > limite;
      const puntos = hayMas ? gpsRows.slice(0, limite) : gpsRows;

      // Agregados sobre la ventana COMPLETA de la sesión (piso..techo), no sobre el
      // delta: `totalPuntos` es el denominador del auto-heal del cliente, y la frescura
      // no puede depender de dónde quedó el cursor.
      // `count(*)::int`: sin el cast Postgres devuelve `bigint` y Fastify tira
      // "Do not know how to serialize a BigInt" al serializar la respuesta.
      const [agregados] = await tx.$queryRaw<AgregadosFixRow[]>`
        SELECT max(ts) AS "ultimoFixTs",
               max(received_at) AS "ultimoIngresoTs",
               count(*)::int AS "totalPuntos"
        FROM gps_points
        WHERE sesion_id = ${sesionId}::uuid AND ts >= ${piso} AND ts < ${techo}
      `;

      const cumplimientos = await tx.cumplimientoPc.findMany({
        where: { sesionId },
        orderBy: { ts: 'asc' },
      });

      const ultimoPunto = puntos.at(-1);

      return TrazaEnVivoSchema.parse({
        puntos: puntos.map((g) => ({
          lat: g.lat,
          lng: g.lng,
          ts: g.ts.toISOString(),
          accuracy: g.accuracy,
          speed: g.speed,
        })),
        cursor: ultimoPunto?.ts.toISOString() ?? null,
        hayMas,
        totalPuntos: agregados?.totalPuntos ?? 0,
        // Los cumplimientos de una sesión son decenas: se devuelven completos y el
        // cliente reemplaza, en vez de arriesgar un merge incremental por unos pocos KB.
        cumplimientos: cumplimientos.map((c) => ({
          id: c.id,
          puntoControlId: c.puntoControlId,
          ts: c.ts.toISOString(),
          distanciaM: c.distanciaM,
          cumplido: c.cumplido,
          validadoPor: c.validadoPor,
        })),
        sesionFin: sesion.fin?.toISOString() ?? null,
        sesionEstado: sesion.estado,
        ...derivarFrescura(
          ahora,
          sesion.inicio,
          agregados?.ultimoFixTs ?? null,
          agregados?.ultimoIngresoTs ?? null,
        ),
      });
    });
  }
}
