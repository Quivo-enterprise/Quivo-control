import { z } from 'zod';
import { uuidSchema } from '../primitives.js';
import { LineaGeoJsonSchema, PuntoGeoJsonSchema } from '../geo.js';

/** Tramo adicional de una variante activa de la ruta (p. ej. Vía Molinos): sirve para pegar la
 * traza GPS dibujada a la calle también en ese ramal. */
export const VarianteTramoSchema = z.object({
  id: uuidSchema,
  nombre: z.string(),
  geometria: LineaGeoJsonSchema,
});
export type VarianteTramo = z.infer<typeof VarianteTramoSchema>;

/** RNF-24 (QUI-247): fila liviana para `GET /v1/reportes/recorridos` — listado de sesiones
 * operativas para elegir cuál reconstruir. */
export const RecorridoResumenSchema = z.object({
  id: uuidSchema,
  inicio: z.string(),
  fin: z.string().nullable(),
  estado: z.string(),
  vehiculoPlaca: z.string(),
  conductorNombre: z.string(),
  lineaNombre: z.string(),
});
export type RecorridoResumen = z.infer<typeof RecorridoResumenSchema>;

export const RecorridosQuerySchema = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});
export type RecorridosQuery = z.infer<typeof RecorridosQuerySchema>;

/** Un punto de la traza GPS real reportada por el dispositivo durante el recorrido. */
export const PuntoTrazaGpsSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  ts: z.string(),
  accuracy: z.number().nullable(),
  speed: z.number().nullable(),
});
export type PuntoTrazaGps = z.infer<typeof PuntoTrazaGpsSchema>;

/** Cumplimiento de un punto de control durante ESTE recorrido — incluye tanto la
 * validación server-side (`validadoPor: 'worker'`, fuente de verdad RF-39) como el feedback
 * local del chofer (`'app'`, QUI-239), para poder comparar ambos en el mapa/timeline. */
export const CumplimientoRecorridoSchema = z.object({
  id: uuidSchema,
  puntoControlId: uuidSchema,
  ts: z.string(),
  distanciaM: z.number(),
  cumplido: z.boolean(),
  validadoPor: z.string(),
});
export type CumplimientoRecorrido = z.infer<typeof CumplimientoRecorridoSchema>;

/** Eventos genéricos del outbox móvil sin tabla propia (`inicio_recorrido`, `fin_recorrido`,
 * `observacion` — ver `eventos_operativos` en schema.prisma) para la timeline. */
export const EventoTimelineSchema = z.object({
  id: uuidSchema,
  tipo: z.string(),
  ts: z.string(),
  payload: z.unknown(),
});
export type EventoTimeline = z.infer<typeof EventoTimelineSchema>;

export const PuntoControlRecorridoSchema = z.object({
  id: uuidSchema,
  orden: z.number().int(),
  coord: PuntoGeoJsonSchema,
  radioToleranciaM: z.number().int(),
});
export type PuntoControlRecorrido = z.infer<typeof PuntoControlRecorridoSchema>;

/** `GET /v1/reportes/recorridos/:id` (RNF-24, QUI-247): reconstrucción completa de una
 * sesión operativa — traza GPS real vs. geometría de la ruta asignada, puntos de control con
 * su tolerancia, cumplimientos (app vs worker) y timeline de eventos. */
export const RecorridoDetalleSchema = z.object({
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
  variantes: z.array(VarianteTramoSchema).default([]),
  puntosControl: z.array(PuntoControlRecorridoSchema),
  trazaGps: z.array(PuntoTrazaGpsSchema),
  cumplimientos: z.array(CumplimientoRecorridoSchema),
  eventos: z.array(EventoTimelineSchema),
});
export type RecorridoDetalle = z.infer<typeof RecorridoDetalleSchema>;
