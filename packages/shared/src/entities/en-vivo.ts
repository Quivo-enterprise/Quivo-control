import { z } from 'zod';
import { uuidSchema } from '../primitives.js';
import { LineaGeoJsonSchema } from '../geo.js';
import {
  CumplimientoRecorridoSchema,
  PuntoControlRecorridoSchema,
  PuntoTrazaGpsSchema,
  RecorridoResumenSchema,
} from './recorrido.js';

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
 *
 * Es un campo **adicional**: la respuesta siempre trae también `ultimoFixTs`,
 * `ultimoIngresoTs` y `servidorTs` crudos. Los umbrales de **color** (verde/ámbar/rojo)
 * son decisión de presentación y los aplica el frontend sobre esos timestamps; el server
 * no los calcula.
 */
export const EstadoFrescuraSchema = z.enum(['reportando', 'detenido', 'perdido', 'sin_datos']);
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
  conductor: z.object({ id: uuidSchema, nombre: z.string() }),
  linea: z.object({ id: uuidSchema, nombre: z.string(), color: z.string() }),
  ruta: z.object({ id: uuidSchema, geometria: LineaGeoJsonSchema }),
  puntosControl: z.array(PuntoControlRecorridoSchema),
  servidorTs: z.string(),
});
export type ContextoEnVivo = z.infer<typeof ContextoEnVivoSchema>;

/** Tope duro de puntos por request: la jornada completa de la Z12 ronda 4.300 puntos
 * (~250 KB); en régimen el delta son 1-2 puntos. */
export const TRAZA_EN_VIVO_LIMITE_MAX = 5_000;
export const TRAZA_EN_VIVO_LIMITE_DEFAULT = 2_000;

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
