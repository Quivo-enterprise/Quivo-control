import { z } from 'zod';
import { uuidSchema } from '../primitives.js';
import { EstadoSancionSchema, SujetoTipoSchema } from '../enums/estados.js';

/** RF-74..77 (QUI-246): agrupación del dashboard de cumplimiento. */
export const AgrupacionCumplimientoSchema = z.enum(['linea', 'vehiculo', 'ruta']);
export type AgrupacionCumplimiento = z.infer<typeof AgrupacionCumplimientoSchema>;

export const CumplimientoQuerySchema = z.object({
  por: AgrupacionCumplimientoSchema,
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});
export type CumplimientoQuery = z.infer<typeof CumplimientoQuerySchema>;

/** Fila de `GET /v1/reportes/cumplimiento` — % de puntos de control cumplidos (fuente de
 * verdad: `validado_por = 'worker'`, QUI-241) y recorridos completados vs asignados, para
 * una línea/vehículo/ruta. */
export const CumplimientoFilaSchema = z.object({
  id: uuidSchema,
  nombre: z.string().min(1),
  puntosCumplidos: z.number().int().nonnegative(),
  puntosTotales: z.number().int().nonnegative(),
  porcentajeCumplimiento: z.number().min(0).max(100),
  recorridosAsignados: z.number().int().nonnegative(),
  recorridosCompletados: z.number().int().nonnegative(),
});
export type CumplimientoFila = z.infer<typeof CumplimientoFilaSchema>;

/** RF-78..80 (QUI-249): filtros de los 3 reportes exportables (CSV, streaming server-side). */
export const ExportarRecorridosQuerySchema = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});
export type ExportarRecorridosQuery = z.infer<typeof ExportarRecorridosQuerySchema>;

export const ExportarSancionesQuerySchema = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  estado: EstadoSancionSchema.optional(),
  sujetoTipo: SujetoTipoSchema.optional(),
});
export type ExportarSancionesQuery = z.infer<typeof ExportarSancionesQuerySchema>;

export const AgrupacionActividadSchema = z.enum(['vehiculo', 'conductor']);
export type AgrupacionActividad = z.infer<typeof AgrupacionActividadSchema>;

export const ExportarActividadQuerySchema = z.object({
  por: AgrupacionActividadSchema,
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});
export type ExportarActividadQuery = z.infer<typeof ExportarActividadQuerySchema>;
