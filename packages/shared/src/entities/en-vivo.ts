import { z } from 'zod';
import { GravedadReglaSchema } from '../enums/estados.js';
import { uuidSchema } from '../primitives.js';
import { LineaGeoJsonSchema } from '../geo.js';
import {
  CumplimientoRecorridoSchema,
  PuntoControlRecorridoSchema,
  PuntoTrazaGpsSchema,
  RecorridoResumenSchema,
} from './recorrido.js';
import { VueltaPosicionSchema } from './vuelta.js';

/**
 * ENTREGA 3 (mapa en vivo, `/en-vivo`). Contratos NUEVOS: `RecorridoDetalleSchema` y
 * `RecorridosService.obtener` los consume la página del histórico (y 6 aserciones de su
 * test), así que acá no se toca nada de eso — solo se reusan las piezas comunes
 * (`PuntoTrazaGpsSchema`, `CumplimientoRecorridoSchema`, `PuntoControlRecorridoSchema`,
 * `RecorridoResumenSchema` de `entities/recorrido.ts`).
 */

/**
 * Los tres estados que la jornada del 2026-08-18 obligó a distinguir, medidos contra
 * producción:
 *
 * - Intervalo entre fixes **en movimiento**: mediana 17-21 s.
 * - Huecos con el vehículo **detenido en terminal**: hasta **56 min** (también 22, 17 y
 *   11 min). Es comportamiento normal del stack: el plugin de geolocalización apaga la
 *   captura cuando el vehículo se queda quieto.
 * - Lag entre captura (`ts`) y llegada al servidor (`received_at`): mediana 153-166 s,
 *   p95 684-814 s, máximo **4275 s**.
 *
 * Con esos números, "sincroniza / no sincroniza" (dos estados) es insuficiente: un
 * vehículo parado 40 min en la terminal se vería idéntico a un teléfono muerto. La
 * distinción sale de **cruzar** `ultimoFixTs` (=`max(ts)`, cuándo se capturó) con
 * `ultimoIngresoTs` (=`max(received_at)`, cuándo llegó al servidor):
 *
 * - `reportando`  — ingesta fresca **y** fixes frescos: el trufi se mueve y reporta.
 * - `detenido`    — ingesta fresca pero **último fix viejo**: el teléfono está vivo y
 *                   sincronizando; simplemente no hay fixes nuevos porque el vehículo no
 *                   se mueve. Es el caso normal en terminal, NO una falla.
 * - `perdido`     — ni fixes ni ingesta: el teléfono no llega al servidor.
 * - `sin_datos`   — la sesión existe pero nunca entró un punto en la ventana consultada.
 * - `finalizado`  — Fase A (docs/plan-ubicacion-fluida.md): el conductor tocó "Finalizar"
 *                   en la app (evento `fin_recorrido`) y no llegó ningún fix posterior (con
 *                   5 s de tolerancia) — `SesionOperativa.recorridoEstado` derivado, NO
 *                   `fin`/`estado` de la sesión de login (esos siguen sin cerrarse). Es un
 *                   cierre correcto, no una falla: antes de esta entrega un recorrido
 *                   finalizado se veía "Reportando" → "Detenido" → "Sin señal" (rojo).
 *
 * Es un campo **adicional**: la respuesta siempre trae también `ultimoFixTs`,
 * `ultimoIngresoTs` y `servidorTs` crudos. Los umbrales de **color** (verde/ámbar/rojo)
 * son decisión de presentación y los aplica el frontend sobre esos timestamps; el server
 * no los calcula.
 */
export const EstadoFrescuraSchema = z.enum([
  'reportando',
  'detenido',
  'perdido',
  'sin_datos',
  'finalizado',
]);
export type EstadoFrescura = z.infer<typeof EstadoFrescuraSchema>;

/**
 * Bloque de frescura compartido por el listado y por el poll de posiciones. Todo lo
 * derivado (`antiguedad*Ms`, `inactivaDesdeMs`, `estadoFrescura`) se calcula en el server
 * contra `servidorTs`, nunca contra el reloj del navegador: un panel con el reloj corrido
 * mostraría "sin datos hace 3 h" con el trufi andando.
 */
export const FrescuraEnVivoSchema = z.object({
  /** `max(gps_points.ts)` — cuándo el dispositivo **capturó** el último fix. */
  ultimoFixTs: z.string().nullable(),
  /** `max(gps_points.received_at)` — cuándo ese lote **llegó** al servidor. */
  ultimoIngresoTs: z.string().nullable(),
  /** Reloj del servidor al responder. El cliente mide antigüedad contra esto. */
  servidorTs: z.string(),
  /** `servidorTs - ultimoFixTs`, ya clampeado a >= 0. `null` si no hay ningún fix. */
  antiguedadFixMs: z.number().int().nonnegative().nullable(),
  /** `servidorTs - ultimoIngresoTs`, ya clampeado a >= 0. `null` si no hubo ingesta. */
  antiguedadIngestaMs: z.number().int().nonnegative().nullable(),
  /**
   * Milisegundos desde la última **señal de vida en el servidor** (`ultimoIngresoTs`); si
   * la sesión nunca recibió un punto, se mide desde `sesion.inicio`.
   *
   * Existe porque el corte del polling NO puede depender de `fin`: el botón "Finalizar
   * recorrido" de la app registra un evento pero **no cierra la `sesion_operativa`**, así
   * que `fin` queda NULL indefinidamente (había 2 sesiones colgadas el 2026-08-18). Una
   * regla del tipo "sesión con `fin` +5 min ⇒ dejar de pollear" no se dispararía nunca.
   * Con este campo el cliente corta por **inactividad real** medida en el server.
   */
  inactivaDesdeMs: z.number().int().nonnegative(),
  estadoFrescura: EstadoFrescuraSchema,
  /** `SesionOperativa.recorridoEstadoTs` cuando `estadoFrescura === 'finalizado'`; `null` en
   * cualquier otro estado (Fase A, docs/plan-ubicacion-fluida.md). El cliente lo usa para
   * mostrar "Finalizó hace X" con la misma lógica de reloj-de-servidor que ya usa para
   * `ultimoFixTs`/`ultimoIngresoTs` (`antiguedadViva`, `apps/web/src/lib/en-vivo/traza.ts`). */
  recorridoFinTs: z.string().nullable(),
});
export type FrescuraEnVivo = z.infer<typeof FrescuraEnVivoSchema>;

/**
 * `GET /v1/reportes/en-vivo` — sesiones de la jornada + las que quedaron abiertas.
 *
 * No asume "la sesión activa" en singular: el 2026-08-18 hubo **3 sesiones activas
 * simultáneas del mismo vehículo en dos dispositivos**. Por eso viene `deviceId` (para
 * distinguir los teléfonos) y el orden por defecto pone primero la de **último fix**, no
 * la más reciente por `inicio`.
 */
export const SesionEnVivoResumenSchema = RecorridoResumenSchema.extend({
  deviceId: z.string(),
  /** `fin IS NULL AND estado = 'activa'`. Ojo: NO implica que el teléfono esté reportando
   * — para eso está `estadoFrescura` (las sesiones no se cierran solas). */
  activa: z.boolean(),
  /** Puntos de la sesión dentro de la ventana de la jornada consultada. */
  totalPuntos: z.number().int().nonnegative(),
}).merge(FrescuraEnVivoSchema);
export type SesionEnVivoResumen = z.infer<typeof SesionEnVivoResumenSchema>;

/**
 * `GET /v1/reportes/en-vivo/:sesionId/contexto` — todo lo que NO cambia durante el
 * recorrido. Se pide una sola vez (`staleTime: Infinity` en el cliente): la geometría de
 * la Z12 son cientos de vértices y reenviarla cada 10 s es ~90 % del payload y 0 % de
 * información nueva.
 */
export const ContextoEnVivoSchema = z.object({
  sesion: z.object({
    id: uuidSchema,
    inicio: z.string(),
    fin: z.string().nullable(),
    estado: z.string(),
    deviceId: z.string(),
  }),
  vehiculo: z.object({ id: uuidSchema, placa: z.string() }),
  conductor: z.object({
    id: uuidSchema,
    nombre: z.string(),
    // PII: solo en el contexto (endpoint de administración), nunca en el poll de posiciones.
    telefono: z.string().nullable(),
  }),
  linea: z.object({ id: uuidSchema, nombre: z.string(), color: z.string() }),
  ruta: z.object({ id: uuidSchema, geometria: LineaGeoJsonSchema }),
  puntosControl: z.array(PuntoControlRecorridoSchema),
  servidorTs: z.string(),
});
export type ContextoEnVivo = z.infer<typeof ContextoEnVivoSchema>;

/**
 * Topes de puntos por request. Recalibrados cuando el `distanceFilter` del GPS del móvil
 * bajó de 50 m a ~15 m **sin elasticidad** (ver `apps/mobile`): una jornada de la Z12 que
 * antes rondaba 4.300 puntos (~250 KB) con eso pasa a un estimado de 30.000-43.000 puntos.
 *
 * `TRAZA_EN_VIVO_LIMITE_MAX` es lo que pide la recarga completa (auto-heal, `debeRecargar`
 * en `traza.ts`) para poder terminar de cubrir la sesión entera de una sola vez
 * (`recargada.completa = puntos.length >= totalPuntos`). Con el 5.000 viejo, una jornada de
 * ~40.000 puntos habría dejado la recarga completa SIEMPRE incompleta — `hayMas: true` para
 * siempre, el panel polleando a `INTERVALO_POLL_RAPIDO_MS` (1 s) sin alcanzar nunca `completa:
 * true`, exactamente la regresión que este tope busca evitar. 50.000 cubre el estimado
 * (30-43k) con ~15-65 % de margen. El costo de ese request no es gratis (`LIMIT 50.001` sobre
 * `gps_points`, indexado por `(sesion_id, ts)` y podado por partición diaria — sigue siendo
 * una query barata; la respuesta ronda 4-5 MB de JSON) pero es un caso RARO y acotado por
 * `COOLDOWN_RECARGA_MS` (60 s como mucho una vez cada 60 s) y por las guardas de déficit de
 * `debeRecargar` — no es el poll normal de cada 10 s, que sigue pidiendo solo el delta. Un
 * único request de unos MB cada tanto, solo mientras hay un hueco real que rellenar, es un
 * costo aceptable frente a la alternativa (paginar la recarga completa en varios requests
 * encadenados) que complica el cliente para un caso que ya de por sí es infrecuente.
 *
 * `TRAZA_EN_VIVO_LIMITE_DEFAULT` gobierna el poll normal (delta con `desde`, sin `limite`
 * explícito — ver `use-en-vivo.ts`) y el primer request de una sesión en curso (antes de que
 * el auto-heal complete). Con `SOLAPE_CURSOR_MS` de 15 min (`traza.ts`) y un reconexión larga
 * (pestaña en background, teléfono saliendo de un hueco de Doze), la ventana de un solo delta
 * puede cubrir 25-40 min de movimiento continuo — a la densidad nueva (~1 fix cada 1.5-3 s en
 * movimiento) eso son ~1.000-1.800 puntos. 8.000 deja margen holgado (~4-8x) sobre ese caso sin
 * acercarse al costo de `LIMITE_MAX`; si igual se excede, el `hayMas: true` existente sigue
 * activando el catch-up a `INTERVALO_POLL_RAPIDO_MS` sin que haga falta ningún cambio acá.
 */
export const TRAZA_EN_VIVO_LIMITE_MAX = 50_000;
export const TRAZA_EN_VIVO_LIMITE_DEFAULT = 8_000;

/**
 * `GET /v1/reportes/en-vivo/posiciones` (ENTREGA 10) — última posición conocida de
 * TODOS los vehículos con sesión activa, en una sola fila por sesión. Reemplaza para el
 * mapa el patrón "una traza por sesión" (`TrazaEnVivoSchema` de arriba), descartado por
 * costo: con 5 sesiones en poll rápido de 1 s ese patrón implica 300 req/min, el techo
 * exacto del throttle de `en-vivo.controller.ts`; con 20 vehículos revienta. Acá el
 * costo NO escala con N: es siempre una query.
 */
export const PosicionEnVivoSchema = z
  .object({
    /** `sesionOperativa.id`. */
    id: uuidSchema,
    deviceId: z.string(),
    /** `fin IS NULL AND estado = 'activa'` — igual criterio que `SesionEnVivoResumenSchema`. */
    activa: z.boolean(),
    vehiculoPlaca: z.string(),
    conductorNombre: z.string(),
    /** Habilita el filtro por línea en el cliente sin round-trip extra: el join a
     * `lineas` ya lo hace la query para `lineaNombre`, este campo sale gratis. */
    lineaId: uuidSchema,
    lineaNombre: z.string(),
    /** `Ruta.sentido` (texto libre, sin detección automática — ver diagnóstico del
     * piloto 2026-09-09). Mostrarlo de un vistazo es lo que permite detectar una
     * rotación cargada con el sentido invertido antes de que el chofer salga a la calle. */
    rutaSentido: z.string(),
    /** Última posición conocida. `null` cuando la sesión todavía no mandó ningún fix
     * ("esperando el primer punto GPS", mismo caso que en el listado). */
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    accuracy: z.number().nullable(),
    speed: z.number().nullable(),
    /** Puntos de la sesión dentro de la ventana de la jornada consultada. */
    totalPuntos: z.number().int().nonnegative(),
    /** docs/plan-en-vivo-alertas.md PR A — ids para acciones del panel (infracciones,
     * sanción). Opcionales/nullables: compatibles con respuestas viejas en cache. */
    vehiculoId: uuidSchema.nullable().optional(),
    conductorId: uuidSchema.nullable().optional(),
    /** Gravedad máxima entre las infracciones `abierta` y `atendida` de la sesión (`null` si no hay). */
    infraccionNivel: GravedadReglaSchema.nullable().optional(),
    /** Cantidad de infracciones `abierta` de la sesión. */
    infraccionesAbiertas: z.number().int().nonnegative().optional(),
    /** Cantidad de infracciones `atendida`: sin ellas pendientes el marcador deja de parpadear
     * pero conserva el ícono de severidad. `infraccionNivel` es el máximo entre abiertas Y
     * atendidas (pendiente E #1, docs/plan-molinos-designacion.md). */
    infraccionesAtendidas: z.number().int().nonnegative().optional(),
    /** PR C — foto de la unidad (URL pública) para el marcador y el panel; `null` si no tiene. */
    fotoUrl: z.string().nullable().optional(),
    /** Vuelta en curso de la sesión (docs/plan-molinos-designacion.md); `null` si no hay. */
    vuelta: VueltaPosicionSchema.nullable().optional(),
    /** El vehículo ya tiene hoy (día local de Bolivia) alguna vuelta designada a una variante. */
    molinosHoy: z.boolean().optional(),
  })
  .merge(FrescuraEnVivoSchema);
export type PosicionEnVivo = z.infer<typeof PosicionEnVivoSchema>;

export const TrazaEnVivoQuerySchema = z.object({
  /** Cursor del cliente. Solo puede **recortar**: el server lo clampea al piso de la
   * ventana de la sesión (ver `obtenerTraza`). */
  desde: z.coerce.date().optional(),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(TRAZA_EN_VIVO_LIMITE_MAX)
    .default(TRAZA_EN_VIVO_LIMITE_DEFAULT),
});
export type TrazaEnVivoQuery = z.infer<typeof TrazaEnVivoQuerySchema>;

/**
 * `GET /v1/reportes/en-vivo/:sesionId/posiciones` — el endpoint del poll (~cada 10 s).
 * Trae el delta de traza + los agregados de frescura, para que el cliente no tenga que
 * pedir el listado entero solo para saber si la sesión sigue viva.
 */
export const TrazaEnVivoSchema = z
  .object({
    puntos: z.array(PuntoTrazaGpsSchema),
    /** `ts` del último punto devuelto — el cliente lo reusa como `desde` (con solape).
     * `null` cuando el delta vino vacío. */
    cursor: z.string().nullable(),
    /** Quedaron puntos por encima de `limite`: el cliente debe volver a pedir enseguida. */
    hayMas: z.boolean(),
    /** Total de puntos de la sesión en su ventana completa (no del delta). Sirve de
     * denominador para el auto-heal: si lo acumulado en la cache queda por debajo, hubo
     * un hueco y conviene recargar entero. */
    totalPuntos: z.number().int().nonnegative(),
    cumplimientos: z.array(CumplimientoRecorridoSchema),
    /** Estado de la sesión al momento de responder — `contexto` se cachea para siempre,
     * así que el cierre de la sesión tiene que viajar por acá. */
    sesionFin: z.string().nullable(),
    sesionEstado: z.string(),
  })
  .merge(FrescuraEnVivoSchema);
export type TrazaEnVivo = z.infer<typeof TrazaEnVivoSchema>;
