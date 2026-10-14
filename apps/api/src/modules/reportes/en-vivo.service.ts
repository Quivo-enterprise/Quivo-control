import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenantContext } from '@quivo/db';
import {
  ContextoEnVivoSchema,
  PosicionEnVivoSchema,
  SesionEnVivoResumenSchema,
  TrazaEnVivoSchema,
  GRAVEDAD_ORDEN,
  type ContextoEnVivo,
  type EstadoFrescura,
  type FrescuraEnVivo,
  type GravedadRegla,
  type Infraccion,
  type PosicionEnVivo,
  type SesionEnVivoResumen,
  type TrazaEnVivo,
  type TrazaEnVivoQuery,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { toInfraccion } from '../infracciones/infracciones.mapper.js';
import { vueltaNoVacia } from '../vueltas/vuelta-no-vacia.js';
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
  // Fase A (docs/plan-ubicacion-fluida.md) — estado DERIVADO del recorrido, mantenido por
  // `insertarEventoOperativoEnTx` (ingesta-worker.service.ts). Distinto de `fin`/`estado` de
  // arriba, que son de la sesión de LOGIN.
  recorridoEstado: string | null;
  recorridoEstadoTs: Date | null;
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
  vehiculoId: string;
  conductorId: string;
  // docs/plan-en-vivo-alertas.md PR A — agregado de las `infracciones` abiertas y atendidas de
  // la sesión (el nivel es el máximo entre ambas; ver el LATERAL de `obtenerPosiciones`).
  infraccionesAbiertas: number | null;
  infraccionesAtendidas: number | null;
  infraccionNivelOrden: number | null;
  infraccionNivelAtendidaOrden: number | null;
  // docs/plan-molinos-designacion.md — vuelta en curso (LATERAL a `vueltas`) y "ya fue a Molinos hoy".
  vueltaNumero: number | null;
  vueltaVarianteId: string | null;
  vueltaVarianteNombre: string | null;
  vueltaDesignadaEn: Date | null;
  vueltaAcuseEn: Date | null;
  vueltaEsperaLlegadaTs: Date | null;
  vueltaEsperaSalidaTs: Date | null;
  molinosHoy: boolean | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  speed: number | null;
  ultimoFixTs: Date | null;
  ultimoIngresoTs: Date | null;
  totalPuntos: number | null;
  // Fase A — igual que en `SesionEnVivoRow`, sale directo de `so`, no del LATERAL a
  // `gps_sesion_resumen` (el estado del recorrido vive en la sesión, no en el resumen GPS).
  recorridoEstado: string | null;
  recorridoEstadoTs: Date | null;
  // PR C — `vehiculos.fotoUrl` (JOIN directo, sin costo extra de query).
  fotoUrl: string | null;
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
const LIMITE_INFRACCIONES_SESION = 200;

/**
 * Inverso de `GRAVEDAD_ORDEN` (shared, fuente única del orden leve < grave < gravisima).
 * `obtenerPosiciones` replica ese orden en un `CASE` SQL (no puede importar la constante):
 * `en-vivo.gravedad-orden.test.ts` verifica que ambos coinciden.
 */
export function nivelDeOrden(orden: number | null | undefined): GravedadRegla | null {
  if (orden === null || orden === undefined) return null;
  const par = (Object.entries(GRAVEDAD_ORDEN) as [GravedadRegla, number][]).find(([, o]) => o === orden);
  return par ? par[0] : null;
}

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
 * Fase A (docs/plan-ubicacion-fluida.md) — tolerancia entre `recorridoEstadoTs` (el `ts` del
 * evento `fin_recorrido`, del reloj del DISPOSITIVO) y `ultimoFixTs` (`gps_points.ts`, mismo
 * reloj) para seguir clasificando la sesión como `finalizado`. Existe porque el último fix
 * de evidencia puede capturarse unos instantes ANTES o DESPUÉS del toque de "Finalizar" sin
 * que eso signifique que el vehículo sigue en movimiento — no es tolerancia de red/ingesta
 * (eso ya lo cubren `UMBRAL_INGESTA_VIVA_MS`/`ultimoIngresoTs`), es margen de reloj del mismo
 * dispositivo entre dos eventos casi simultáneos.
 */
export const TOLERANCIA_FIN_RECORRIDO_MS = 5_000;

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
 * detrás de zombies. Acá el filtro de SESIONES (`so.inicio`) es una ventana **rodante**
 * de 24 h (no la jornada calendario) con un tope más alto: cubre un turno completo
 * aunque cruce medianoche boliviana, y 500 sesiones es más margen del que cualquier
 * sindicato real tiene hoy en simultáneo.
 *
 * CORRECCIÓN (code-review, hallazgo detectado en producción ~00:40 Bolivia): esta
 * garantía de "cubre un turno completo aunque cruce medianoche" es sobre qué SESIONES
 * entran, no sobre qué POSICIONES se les encuentran. Hasta este fix, el `LATERAL` de
 * `obtenerPosiciones` seguía acotado a `trazaDesde` (arranque de la jornada calendario,
 * no de esta ventana rodante) — un vehículo que arrancó anoche y sigue reportando sin
 * parar SÍ entraba por este `WHERE` (`so.inicio >= sesionesDesde` o sesión abierta), pero
 * sus fixes de antes de medianoche quedaban fuera del `LATERAL`, y si todavía no había
 * un fix nuevo posterior a medianoche, la posición salía `NULL`/`sin_datos`: el vehículo
 * desaparecía del mapa justo cuando más se lo necesitaba. Ver `posicionesDesde` en
 * `obtenerPosiciones` — ahora el `LATERAL` comparte el mismo piso rodante que este
 * `WHERE`, así que la garantía de "cubre un turno completo" aplica a AMBOS.
 */
const VENTANA_SESIONES_POSICIONES_MS = 24 * 60 * MINUTO_MS;
const LIMITE_SESIONES_POSICIONES = 500;

function diferenciaMs(ahora: Date, ts: Date | null): number | null {
  if (!ts) return null;
  // Clamp a >= 0: `received_at` lo pone el reloj de Postgres y `ahora` el del proceso Node;
  // un skew de milisegundos no debe producir una antigüedad negativa en el contrato.
  return Math.max(0, ahora.getTime() - ts.getTime());
}

/**
 * Fase A — `recorridoEstado`/`recorridoEstadoTs` (`SesionEnVivoRow`/`PosicionEnVivoRow`, o
 * `SesionOperativa.recorridoEstado`/`recorridoEstadoTs` vía Prisma en `obtenerTraza`) pesan
 * MÁS que la heurística de fix/ingesta de abajo: si el conductor tocó "Finalizar" y ningún
 * fix llegó después (con `TOLERANCIA_FIN_RECORRIDO_MS` de margen), es un cierre correcto, no
 * "sin señal". Si SÍ hay un fix posterior al fin, algo sigue grabando (reinicio manual del
 * tracking, evento de reintento fuera de orden, etc.) — se cae, a propósito, a la
 * clasificación normal de abajo en vez de forzar `finalizado` contra la evidencia.
 *
 * Un `inicio_recorrido` POSTERIOR ya deja `recorridoEstado = 'en_curso'` (el guard de
 * `insertarEventoOperativoEnTx` lo garantiza), así que ese caso ni siquiera entra a esta
 * rama — vuelve solo a la clasificación normal.
 */
function clasificarFrescura(
  antiguedadFixMs: number | null,
  antiguedadIngestaMs: number | null,
  recorridoEstado: string | null,
  recorridoEstadoTs: Date | null,
  ultimoFixTs: Date | null,
): EstadoFrescura {
  if (recorridoEstado === 'finalizado' && recorridoEstadoTs) {
    const finMs = recorridoEstadoTs.getTime() + TOLERANCIA_FIN_RECORRIDO_MS;
    const fixEsPosteriorAlFin = ultimoFixTs !== null && ultimoFixTs.getTime() > finMs;
    if (!fixEsPosteriorAlFin) return 'finalizado';
  }
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
 *
 * `recorridoEstado`/`recorridoEstadoTs` son OPCIONALES (default `null`) a propósito: son
 * nuevos en Fase A y varios callers de este archivo (tests existentes, código que todavía no
 * se tocó) siguen llamando con la firma vieja de 4 argumentos — sin default, esta sería una
 * ruptura innecesaria en vez de una extensión aditiva.
 */
export function derivarFrescura(
  ahora: Date,
  inicio: Date,
  ultimoFixTs: Date | null,
  ultimoIngresoTs: Date | null,
  recorridoEstado: string | null = null,
  recorridoEstadoTs: Date | null = null,
): FrescuraEnVivo {
  const antiguedadFixMs = diferenciaMs(ahora, ultimoFixTs);
  const antiguedadIngestaMs = diferenciaMs(ahora, ultimoIngresoTs);
  const estadoFrescura = clasificarFrescura(
    antiguedadFixMs,
    antiguedadIngestaMs,
    recorridoEstado,
    recorridoEstadoTs,
    ultimoFixTs,
  );
  return {
    ultimoFixTs: ultimoFixTs?.toISOString() ?? null,
    ultimoIngresoTs: ultimoIngresoTs?.toISOString() ?? null,
    servidorTs: ahora.toISOString(),
    antiguedadFixMs,
    antiguedadIngestaMs,
    inactivaDesdeMs: antiguedadIngestaMs ?? Math.max(0, ahora.getTime() - inicio.getTime()),
    estadoFrescura,
    // Solo no-null cuando el estado ganó "finalizado" (plan §Fase A) — un `recorridoEstadoTs`
    // de un `en_curso` (o de un `finalizado` descartado por un fix posterior) no es una hora
    // de fin válida para mostrarle al cliente.
    recorridoFinTs: estadoFrescura === 'finalizado' ? (recorridoEstadoTs?.toISOString() ?? null) : null,
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
   * anteriores (`fin IS NULL AND estado = 'activa'`): la app no cierra la sesión de LOGIN al
   * "Finalizar" — sigue siendo así después de Fase A, y sigue siendo intencional (el
   * conductor puede iniciar un recorrido nuevo sin volver a loguearse) —, así que hay
   * sesiones colgadas indefinidamente y omitirlas escondería vehículos que sí están
   * reportando. Lo que Fase A SÍ agrega es que ahora se sabe, por sesión, si el RECORRIDO
   * (no la sesión de login) terminó: ver `recorridoEstado`/`estadoFrescura: 'finalizado'`
   * más abajo.
   *
   * docs/plan-en-vivo-resumen-sesion.md — el `LEFT JOIN LATERAL` que agregaba sobre TODOS
   * los puntos de la jornada de cada sesión (O(puntos del día de la flota), 10,65 s medidos
   * con 1.000 sesiones/6,7M filas) se reemplaza por un `LEFT JOIN LATERAL` a
   * `gps_sesion_resumen`: una fila por `(sesion_id, jornada)` ya agregada por
   * `insertarGpsPoints` (ingesta-worker.service.ts) en el momento de la escritura, no en
   * cada lectura. O(sesiones), sin tocar `gps_points` para nada en este endpoint.
   *
   * Sigue siendo `LATERAL` (no un `LEFT JOIN` liso) por un hallazgo de EXPLAIN, no por
   * estética: con `LEFT JOIN gps_sesion_resumen res ON res.sesion_id = so.id::uuid AND
   * res.jornada = $1`, el planner — con la tabla de resumen todavía chica (1.000 filas,
   * 1.000 sesiones × 1 jornada en el benchmark) — elegía un `Seq Scan` de
   * `gps_sesion_resumen` repetido por cada sesión candidata (`Nested Loop Left Join` +
   * `Join Filter`, NO `Index Cond`) en vez del índice de la PK: ~1.000×1.000 comparaciones,
   * 1,96 s medidos con `EXPLAIN (ANALYZE, BUFFERS)` contra un container Postgres efímero
   * sembrado con 1.000 sesiones/6,7M `gps_points` (mismo escenario que §1, ver el handoff
   * de esta rama para los números completos). El `LATERAL` con `LIMIT 1` fuerza un acceso
   * correlacionado por sesión — el mismo patrón que ya usaba `obtenerPosiciones` — y el
   * planner pasa a un `Index Scan` sobre `gps_sesion_resumen_pkey` por sesión: ~62 ms
   * medidos con los mismos datos, la ganancia completa que buscaba esta migración.
   * `LIMIT 1` es redundante en los datos (la PK ya garantiza como máximo 1 fila por
   * `(sesion_id, jornada)`) pero se deja explícito para que el planner nunca tenga excusa
   * de recorrer más de una fila del lateral.
   */
  async listarHoy(
    actor: AuthenticatedUser,
    ahora: Date = new Date(),
  ): Promise<SesionEnVivoResumen[]> {
    // Misma jornada boliviana que antes (04:00 UTC → 04:00 UTC del día siguiente), pero acá
    // solo sirve para fijar la PK `(sesion_id, jornada, sindicatoId)` del resumen a leer —
    // ya no acota un rango de partición de `gps_points`.
    const jornada = fechaActualBolivia(ahora);
    const trazaDesde = inicioDeJornadaBolivia(jornada);
    const trazaHasta = inicioDeJornadaSiguienteBolivia(jornada);
    // `YYYY-MM-DD` en vez de pasar el `Date` (medianoche UTC) directo al placeholder
    // (code-review MEDIUM): Prisma tipa un parámetro `Date` como `timestamptz`, así que
    // `${jornada}::date` haría a Postgres convertir ese instante al TimeZone de la SESIÓN
    // antes de extraer la fecha (mismo problema que `(ts - interval '4h')::date`, ver el
    // comentario de la migración y de `insertarGpsPoints`) — podría no coincidir con la
    // jornada que calculó `fechaActualBolivia` si la conexión trae un TimeZone distinto de
    // UTC. Un string `'YYYY-MM-DD'` casteado a `date` es un literal de fecha, sin ninguna
    // interpretación de zona horaria de por medio.
    const jornadaStr = jornada.toISOString().slice(0, 10);

    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const filas = await tx.$queryRaw<SesionEnVivoRow[]>`
        SELECT so.id, so.inicio, so.fin, so.estado, so."deviceId",
          v.placa as "vehiculoPlaca", c.nombre as "conductorNombre", l.nombre as "lineaNombre",
          res.ultimo_fix_ts AS "ultimoFixTs", res.ultimo_ingreso_ts AS "ultimoIngresoTs",
          res.total_puntos AS "totalPuntos",
          so."recorridoEstado" AS "recorridoEstado", so."recorridoEstadoTs" AS "recorridoEstadoTs"
        FROM sesiones_operativas so
        JOIN vehiculos v ON v.id = so."vehiculoId"
        JOIN conductores c ON c.id = so."conductorId"
        JOIN asignaciones a ON a.id = so."asignacionId"
        JOIN rutas ru ON ru.id = a."rutaId"
        JOIN lineas l ON l.id = ru."lineaId"
        LEFT JOIN LATERAL (
          SELECT ultimo_fix_ts, ultimo_ingreso_ts, total_puntos
          FROM gps_sesion_resumen gr
          WHERE gr.sesion_id = so.id::uuid AND gr.jornada = ${jornadaStr}::date
            -- Cierre explícito por tenant (code-review MEDIUM, cross-tenant poisoning): no
            -- alcanza con confiar solo en la PK de 3 columnas / RLS de gps_sesion_resumen
            -- — si por algún motivo existiera una fila con este sesion_id/jornada de OTRO
            -- tenant (que RLS ya le esconde a so, pero que admin_quivo SÍ vería en este
            -- mismo LATERAL sin este filtro), este join explícito por so.sindicatoId
            -- asegura que solo se le atribuye a la sesión el resumen de SU PROPIO tenant,
            -- incluso corriendo como admin_quivo.
            AND gr."sindicatoId" = so."sindicatoId"
          LIMIT 1
        ) res ON true
        WHERE (so.inicio >= ${trazaDesde} AND so.inicio < ${trazaHasta})
           OR (so.fin IS NULL AND so.estado = 'activa')
        ORDER BY (so.fin IS NULL) DESC, res.ultimo_fix_ts DESC NULLS LAST, so.inicio DESC
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
          ...derivarFrescura(
            ahora,
            f.inicio,
            f.ultimoFixTs,
            f.ultimoIngresoTs,
            f.recorridoEstado,
            f.recorridoEstadoTs,
          ),
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
   * docs/plan-en-vivo-resumen-sesion.md — igual que `listarHoy`, el `LEFT JOIN LATERAL`
   * sobre `gps_points` (10,49 s medidos con 1.000 sesiones/6,7M filas) se reemplaza por un
   * `LEFT JOIN LATERAL` sobre `gps_sesion_resumen`: a lo sumo 2 filas por sesión (jornada de
   * HOY y de AYER — ver `posicionesDesde`/`VENTANA_SESIONES_POSICIONES_MS` abajo, nunca hace
   * falta mirar más atrás), resuelto por índice (PK `(sesion_id, jornada)`), no un escaneo
   * de los puntos crudos de la sesión.
   *
   * `l.id AS "lineaId"` y `ru.sentido AS "rutaSentido"`: ambos joins (`rutas`, `lineas`) ya
   * estaban para resolver `lineaNombre`, así que salen gratis.
   *
   * **Cambio de semántica documentado (plan §3):** `totalPuntos` deja de ser "puntos en la
   * ventana rodante de 24 h" (lo que hacía el `count(*) OVER ()` de la versión vieja,
   * sumando fixes de HOY y de AYER si el `LATERAL` cruzaba medianoche) y pasa a ser "puntos
   * de la jornada boliviana DEL ÚLTIMO FIX" — el `total_puntos` de la fila de
   * `gps_sesion_resumen` que gana el `ORDER BY ... LIMIT 1` de abajo, no una suma entre las
   * 2 jornadas candidatas. Hoy (grep sobre `apps/web`) ningún consumidor lee este campo de
   * `obtenerPosiciones`, así que no hay UI que corregir por este cambio.
   *
   * El resto de la garantía "cubre un turno completo aunque cruce medianoche" (código de
   * abajo, hallazgo 2 del code-review QUI-240/en-vivo) se preserva igual: el `LATERAL`
   * sigue mirando la jornada de HOY y la de AYER, con el mismo piso `posicionesDesde` que
   * antes tenían las filas de `gps_points` — ahora es un filtro sobre `ultimo_fix_ts` de
   * `gps_sesion_resumen`, no sobre `ts` de puntos individuales.
   *
   * **`ultimoIngresoTs` — hallazgo adicional del code-review (LOW, "dispositivo activo
   * parece perdido justo después de medianoche"):** `lat`/`lng`/`accuracy`/`speed`/
   * `ultimoFixTs`/`totalPuntos` SÍ tienen que venir de UNA sola fila (la del fix más
   * reciente — es LA posición) pero `ultimoIngresoTs` NO puede acotarse a esa misma fila.
   * Escenario real: una sesión cruza medianoche boliviana, su jornada de HOY ya tiene un fix
   * (algo estancado, hace rato) y justo en este momento llega — tarde, del outbox — un lote
   * con puntos de ANTES de medianoche: por `ts`, esos puntos actualizan la fila de AYER, no
   * la de HOY (`insertarGpsPoints` escribe cada punto en la jornada de SU PROPIO `ts`). El
   * dispositivo SÍ está sincronizando ahora mismo, pero si `ultimoIngresoTs` sale solo de la
   * fila de HOY (la que gana por `ultimo_fix_ts` más nuevo), ese ingreso reciente queda
   * invisible y `antiguedadIngestaMs` marca al vehículo como `perdido` estando activo. Por
   * eso `"ultimoIngresoTs"` se calcula con `max(...) OVER ()` — una función de ventana sobre
   * TODAS las filas que matchean el `WHERE` (hoy Y ayer, misma sesión, mismo tenant), no
   * solo la que gana el `ORDER BY ... LIMIT 1` de abajo: Postgres evalúa las funciones de
   * ventana ANTES de aplicar `ORDER BY`/`LIMIT` a la fila final, así que el valor SÍ ve
   * ambas filas candidatas aunque el `LIMIT 1` solo devuelva una.
   */
  async obtenerPosiciones(
    actor: AuthenticatedUser,
    ahora: Date = new Date(),
  ): Promise<PosicionEnVivo[]> {
    const jornada = fechaActualBolivia(ahora);
    // Un día calendario exacto atrás — `jornada` es siempre medianoche UTC de un día
    // boliviano, así que restarle 24 h da la fecha del día anterior sin drift.
    const jornadaAyer = new Date(jornada.getTime() - 24 * 60 * MINUTO_MS);
    const trazaDesde = inicioDeJornadaBolivia(jornada);
    const sesionesDesde = new Date(ahora.getTime() - VENTANA_SESIONES_POSICIONES_MS);
    const posicionesDesde =
      trazaDesde.getTime() < sesionesDesde.getTime() ? trazaDesde : sesionesDesde;
    // `YYYY-MM-DD`, no el `Date` directo (code-review MEDIUM — mismo motivo que
    // `listarHoy`): evita que Postgres reinterprete el instante según el TimeZone de la
    // sesión al castear a `date`.
    const jornadaStr = jornada.toISOString().slice(0, 10);
    const jornadaAyerStr = jornadaAyer.toISOString().slice(0, 10);

    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const filas = await tx.$queryRaw<PosicionEnVivoRow[]>`
        SELECT so.id, so.inicio, so.fin, so.estado, so."deviceId",
          so."vehiculoId" AS "vehiculoId", so."conductorId" AS "conductorId",
          v.placa as "vehiculoPlaca", v."fotoUrl" as "fotoUrl", c.nombre as "conductorNombre",
          l.id as "lineaId", l.nombre as "lineaNombre", ru.sentido as "rutaSentido",
          inf."infraccionesAbiertas", inf."infraccionesAtendidas", inf."infraccionNivelOrden",
          inf."infraccionNivelAtendidaOrden",
          vu.numero AS "vueltaNumero", vu."varianteId" AS "vueltaVarianteId",
          vu."varianteNombre" AS "vueltaVarianteNombre", vu."designadaEn" AS "vueltaDesignadaEn",
          vu."acuseEn" AS "vueltaAcuseEn", vu."esperaLlegadaTs" AS "vueltaEsperaLlegadaTs",
          vu."esperaSalidaTs" AS "vueltaEsperaSalidaTs",
          EXISTS (
            SELECT 1 FROM vueltas vh
            WHERE vh."vehiculoId" = so."vehiculoId" AND vh."sindicatoId" = so."sindicatoId"
              AND vh.fecha = ${jornadaStr}::date AND vh."varianteId" IS NOT NULL
              AND ${vueltaNoVacia('vh')}
          ) AS "molinosHoy",
          fix.lat, fix.lng, fix.accuracy, fix.speed,
          fix."ultimoFixTs", fix."ultimoIngresoTs", fix."totalPuntos",
          so."recorridoEstado" AS "recorridoEstado", so."recorridoEstadoTs" AS "recorridoEstadoTs"
        FROM sesiones_operativas so
        JOIN vehiculos v ON v.id = so."vehiculoId"
        JOIN conductores c ON c.id = so."conductorId"
        JOIN asignaciones a ON a.id = so."asignacionId"
        JOIN rutas ru ON ru.id = a."rutaId"
        JOIN lineas l ON l.id = ru."lineaId"
        LEFT JOIN LATERAL (
          SELECT gr.lat, gr.lng, gr.accuracy, gr.speed,
                 gr.ultimo_fix_ts AS "ultimoFixTs",
                 -- max(...) OVER (), no gr.ultimo_ingreso_ts liso: ver el docblock de arriba
                 -- ("ultimoIngresoTs — hallazgo adicional del code-review"). Se evalúa sobre
                 -- TODAS las filas hoy+ayer que pasan el WHERE, antes del ORDER BY/LIMIT de
                 -- más abajo.
                 max(gr.ultimo_ingreso_ts) OVER () AS "ultimoIngresoTs",
                 gr.total_puntos AS "totalPuntos"
          FROM gps_sesion_resumen gr
          WHERE gr.sesion_id = so.id::uuid
            -- Cierre explícito por tenant (code-review MEDIUM, cross-tenant poisoning —
            -- mismo motivo que listarHoy): además de la PK de 3 columnas y la RLS de
            -- gps_sesion_resumen, este join asegura que una fila de OTRO tenant con el mismo
            -- sesion_id/jornada nunca se le atribuye a esta sesión, ni siquiera corriendo
            -- como admin_quivo (que sí puede ver filas de cualquier tenant).
            AND gr."sindicatoId" = so."sindicatoId"
            AND gr.jornada IN (${jornadaStr}::date, ${jornadaAyerStr}::date)
            AND gr.ultimo_fix_ts >= ${posicionesDesde}
          ORDER BY gr.ultimo_fix_ts DESC
          LIMIT 1
        ) fix ON true
        -- docs/plan-en-vivo-alertas.md PR A: infracciones ABIERTAS y ATENDIDAS de la sesión. Un
        -- agregado por sesión resuelto por el índice (sesionId, estado); count(*) sin GROUP BY
        -- siempre devuelve una fila (0 si no hay), por eso el LATERAL es seguro con ON true.
        -- infraccionNivelOrden = máximo entre las ABIERTAS (lo que lee la web como nivel de la
        -- alerta: parpadeo, filtros, orden); infraccionNivelAtendidaOrden = máximo entre las
        -- ATENDIDAS, para el ícono estático de severidad al "atender" (pendiente E #1). Orden de
        -- gravedad: leve(1) < grave(2) < gravisima(3) = GRAVEDAD_ORDEN (@quivo/shared); el test
        -- en-vivo.gravedad-orden.test.ts verifica que este CASE y la constante coinciden.
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE i.estado = 'abierta')::int AS "infraccionesAbiertas",
                 count(*) FILTER (WHERE i.estado = 'atendida')::int AS "infraccionesAtendidas",
                 max(CASE i.gravedad WHEN 'gravisima' THEN 3 WHEN 'grave' THEN 2 ELSE 1 END)
                   FILTER (WHERE i.estado = 'abierta') AS "infraccionNivelOrden",
                 max(CASE i.gravedad WHEN 'gravisima' THEN 3 WHEN 'grave' THEN 2 ELSE 1 END)
                   FILTER (WHERE i.estado = 'atendida') AS "infraccionNivelAtendidaOrden"
          FROM infracciones i
          WHERE i."sesionId" = so.id
            AND i.estado IN ('abierta', 'atendida')
            AND i."sindicatoId" = so."sindicatoId"
        ) inf ON true
        -- docs/plan-molinos-designacion.md: la vuelta EN CURSO de la sesión (a lo sumo una: índice
        -- parcial único vueltas_sesionId_en_curso_key) con el nombre de la variante designada. Una
        -- en_curso siempre cuenta (recién abierta está vacía); las abierta_al_cierre vacías que
        -- deja un logout sin lote tardío no son en_curso, así que nunca entran aquí.
        LEFT JOIN LATERAL (
          SELECT v.numero, v."varianteId", va.nombre AS "varianteNombre", v."designadaEn",
                 v."acuseEn", v."esperaLlegadaTs", v."esperaSalidaTs"
          FROM vueltas v
          LEFT JOIN variantes va ON va.id = v."varianteId"
          WHERE v."sesionId" = so.id AND v.estado = 'en_curso' AND v."sindicatoId" = so."sindicatoId"
          LIMIT 1
        ) vu ON true
        WHERE (so.inicio >= ${sesionesDesde})
           OR (so.fin IS NULL AND so.estado = 'activa')
        ORDER BY (so.fin IS NULL) DESC, fix."ultimoFixTs" DESC NULLS LAST, so.inicio DESC
        LIMIT ${LIMITE_SESIONES_POSICIONES}
      `;

      return filas.map((f) =>
        PosicionEnVivoSchema.parse({
          id: f.id,
          deviceId: f.deviceId,
          vehiculoId: f.vehiculoId,
          conductorId: f.conductorId,
          infraccionesAbiertas: f.infraccionesAbiertas ?? 0,
          infraccionesAtendidas: f.infraccionesAtendidas ?? 0,
          infraccionNivel: nivelDeOrden(f.infraccionNivelOrden),
          infraccionNivelAtendida: nivelDeOrden(f.infraccionNivelAtendidaOrden),
          fotoUrl: f.fotoUrl ?? null,
          molinosHoy: f.molinosHoy ?? false,
          vuelta:
            f.vueltaNumero === null || f.vueltaNumero === undefined
              ? null
              : {
                  numero: f.vueltaNumero,
                  varianteId: f.vueltaVarianteId,
                  varianteNombre: f.vueltaVarianteNombre,
                  designadaEn: f.vueltaDesignadaEn?.toISOString() ?? null,
                  acuseEn: f.vueltaAcuseEn?.toISOString() ?? null,
                  enEspera: f.vueltaEsperaLlegadaTs != null && f.vueltaEsperaSalidaTs == null,
                  esperaDesdeTs:
                    f.vueltaEsperaLlegadaTs != null && f.vueltaEsperaSalidaTs == null
                      ? f.vueltaEsperaLlegadaTs.toISOString()
                      : null,
                },
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
          ...derivarFrescura(
            ahora,
            f.inicio,
            f.ultimoFixTs,
            f.ultimoIngresoTs,
            f.recorridoEstado,
            f.recorridoEstadoTs,
          ),
        }),
      );
    });
  }

  /**
   * docs/plan-en-vivo-alertas.md PR A — infracciones de una sesión, `abierta` primero y luego
   * por `inicioTs` descendente (ordenado en SQL, antes del tope). `findUnique` de la sesión PRIMERO es el tenant-check (RLS): una
   * sesión ajena o inexistente es 404. Tope fijo de filas: una sesión no acumula miles.
   */
  async listarInfraccionesSesion(actor: AuthenticatedUser, sesionId: string): Promise<Infraccion[]> {
    return withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, async (tx) => {
      const sesion = await tx.sesionOperativa.findUnique({ where: { id: sesionId }, select: { id: true } });
      if (!sesion) {
        throw new NotFoundException('Sesión no encontrada');
      }
      // El orden va en SQL ANTES del LIMIT: si hay más de LIMITE filas, las abiertas más viejas
      // no deben quedar fuera del tope por culpa de cerradas más recientes.
      const filas = await tx.$queryRaw<Parameters<typeof toInfraccion>[0][]>`
        SELECT * FROM infracciones
        WHERE "sesionId" = ${sesionId}
        ORDER BY (estado = 'abierta') DESC, "inicioTs" DESC
        LIMIT ${LIMITE_INFRACCIONES_SESION}
      `;
      return filas.map(toInfraccion);
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
          conductor: { select: { id: true, nombre: true, telefono: true } },
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
        conductor: {
          id: sesion.conductor.id,
          nombre: sesion.conductor.nombre,
          telefono: sesion.conductor.telefono,
        },
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
          sesion.recorridoEstado,
          sesion.recorridoEstadoTs,
        ),
      });
    });
  }
}
