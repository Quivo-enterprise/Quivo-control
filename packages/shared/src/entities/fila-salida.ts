import { z } from 'zod';
import { uuidSchema } from '../primitives.js';

// Fila de salida con frecuencias en la terminal (plan "fila de salida", PR 1).

export const FRECUENCIA_MIN_MINUTOS = 1;
export const FRECUENCIA_MAX_MINUTOS = 120;
const MINUTOS_DEL_DIA = 1440;

const minutosSchema = z.number().int().min(FRECUENCIA_MIN_MINUTOS).max(FRECUENCIA_MAX_MINUTOS);
const minutoDelDiaSchema = z.number().int().min(0).max(MINUTOS_DEL_DIA);

export const EstadoGrupoVehiculoSchema = z.enum(['activo', 'inactivo']);
export type EstadoGrupoVehiculo = z.infer<typeof EstadoGrupoVehiculoSchema>;

export const GrupoVehiculoSchema = z.object({
  id: uuidSchema,
  nombre: z.string().trim().min(1).max(80),
  estado: EstadoGrupoVehiculoSchema,
  /** Un trufi pertenece a un solo grupo (unique en BD). */
  vehiculoIds: z.array(uuidSchema),
});
export type GrupoVehiculo = z.infer<typeof GrupoVehiculoSchema>;

export const CrearGrupoVehiculoSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  vehiculoIds: z.array(uuidSchema).default([]),
});
export type CrearGrupoVehiculo = z.infer<typeof CrearGrupoVehiculoSchema>;

export const AlcanceFrecuenciaSchema = z.enum(['todos', 'grupo', 'vehiculo']);
export type AlcanceFrecuencia = z.infer<typeof AlcanceFrecuenciaSchema>;

/** Campos de la regla que el panel envía; las refinaciones replican los CHECK de la migración. */
const camposReglaSchema = z.object({
  alcance: AlcanceFrecuenciaSchema,
  grupoId: uuidSchema.nullable().default(null),
  vehiculoId: uuidSchema.nullable().default(null),
  minutos: minutosSchema,
  /** Franja en minutos del día local de Bolivia; ambos o ninguno. */
  desdeMin: minutoDelDiaSchema.nullable().default(null),
  hastaMin: minutoDelDiaSchema.nullable().default(null),
});

function validarCoherenciaRegla(r: z.infer<typeof camposReglaSchema>, ctx: z.RefinementCtx): void {
  const ids =
    r.alcance === 'todos'
      ? r.grupoId === null && r.vehiculoId === null
      : r.alcance === 'grupo'
        ? r.grupoId !== null && r.vehiculoId === null
        : r.vehiculoId !== null && r.grupoId === null;
  if (!ids) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['alcance'],
      message: 'grupoId/vehiculoId no coinciden con el alcance',
    });
  }
  if ((r.desdeMin === null) !== (r.hastaMin === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['hastaMin'],
      message: 'La franja requiere desdeMin y hastaMin, o ninguno',
    });
  } else if (r.desdeMin !== null && r.hastaMin !== null && r.desdeMin >= r.hastaMin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['hastaMin'],
      message: 'desdeMin debe ser menor que hastaMin',
    });
  }
}

export const CrearFrecuenciaReglaSchema = camposReglaSchema.superRefine(validarCoherenciaRegla);
export type CrearFrecuenciaRegla = z.infer<typeof CrearFrecuenciaReglaSchema>;

export const FrecuenciaReglaSchema = camposReglaSchema
  .extend({
    id: uuidSchema,
    puntoControlId: uuidSchema,
    /** Día local de Bolivia, `YYYY-MM-DD`. */
    fecha: z.string(),
    creadaPor: z.string(),
    creadaEn: z.string(),
    anuladaEn: z.string().nullable(),
    anuladaPor: z.string().nullable(),
  })
  .superRefine(validarCoherenciaRegla);
export type FrecuenciaRegla = z.infer<typeof FrecuenciaReglaSchema>;

export const EstadoFilaSchema = z.enum(['en_fila', 'salio', 'retirado']);
export type EstadoFila = z.infer<typeof EstadoFilaSchema>;

export const OrigenSalidaSchema = z.enum(['boton', 'geocerca', 'deteccion', 'panel']);
export type OrigenSalida = z.infer<typeof OrigenSalidaSchema>;

export const FilaSalidaSchema = z
  .object({
    id: uuidSchema,
    puntoControlId: uuidSchema,
    sesionId: uuidSchema,
    vehiculoId: uuidSchema,
    llegadaTs: z.string(),
    ordenTs: z.string(),
    salidaTs: z.string().nullable(),
    salidaOrigen: OrigenSalidaSchema.nullable(),
    anticipada: z.boolean(),
    estado: EstadoFilaSchema,
  })
  .refine((f) => (f.estado === 'salio') === (f.salidaTs !== null && f.salidaOrigen !== null), {
    message: 'estado "salio" si y solo si hay salidaTs y salidaOrigen',
    path: ['estado'],
  });
export type FilaSalida = z.infer<typeof FilaSalidaSchema>;

/**
 * Campo `fila` de `GET /mobile/vuelta-actual`: `null` cuando el trufi no está en la fila. El móvil
 * calcula la cuenta regresiva con `servidorTs` (el reloj del teléfono no es confiable).
 */
export const EstadoFilaSalidaSchema = z.object({
  /** 1 = el próximo en salir. */
  posicion: z.number().int().positive(),
  total: z.number().int().positive(),
  /** Placa del trufi de adelante; `null` si es el primero. */
  delantePlaca: z.string().nullable(),
  /** ISO de la hora de salida estimada. */
  etaTs: z.string(),
  esperaMs: z.number().int().nonnegative(),
  /** Solo el primero y solo desde su hora: habilita el botón SALIR. */
  habilitado: z.boolean(),
  /** Es el primero y ya pasó su hora sin salir. */
  demorado: z.boolean(),
  servidorTs: z.string(),
});
export type EstadoFilaSalida = z.infer<typeof EstadoFilaSalidaSchema>;

/** Una fila de la tabla en vivo del panel. */
export const FilaSalidaPanelItemSchema = z.object({
  id: uuidSchema,
  vehiculoId: uuidSchema,
  placa: z.string(),
  posicion: z.number().int().positive(),
  llegadaTs: z.string(),
  etaTs: z.string(),
  esperaMs: z.number().int().nonnegative(),
  estado: EstadoFilaSchema,
  habilitado: z.boolean(),
  demorado: z.boolean(),
  anticipada: z.boolean(),
});
export type FilaSalidaPanelItem = z.infer<typeof FilaSalidaPanelItemSchema>;

/** Salida reciente del día (solo informativa en el panel). */
export const SalidaRecientePanelSchema = z.object({
  id: uuidSchema,
  vehiculoId: uuidSchema,
  placa: z.string(),
  llegadaTs: z.string(),
  salidaTs: z.string(),
  salidaOrigen: OrigenSalidaSchema,
  anticipada: z.boolean(),
});
export type SalidaRecientePanel = z.infer<typeof SalidaRecientePanelSchema>;

export const EstadoFilaSalidaPanelSchema = z.object({
  puntoControlId: uuidSchema,
  /** Frecuencia base de la parada; `null` = sin configurar. */
  baseMin: minutosSchema.nullable(),
  servidorTs: z.string(),
  items: z.array(FilaSalidaPanelItemSchema),
  /** Últimas salidas del día en la parada (más reciente primero). */
  salidasRecientes: z.array(SalidaRecientePanelSchema).default([]),
});
export type EstadoFilaSalidaPanel = z.infer<typeof EstadoFilaSalidaPanelSchema>;

// --- Requests y respuestas de la API (PR 2) ---------------------------------------------------

/**
 * `POST /mobile/fila/llegada`. El servidor valida la distancia con `ST_DWithin` y registra la
 * llegada con SU hora: `tsFix` es informativo (el reloj del teléfono no es confiable).
 */
export const LlegadaFilaSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative(),
  tsFix: z.string().datetime({ offset: true }),
});
export type LlegadaFila = z.infer<typeof LlegadaFilaSchema>;

/** `POST /mobile/fila/salida`. El origen `deteccion`/`panel` solo lo escribe el servidor. */
export const SalidaFilaMovilSchema = z.object({
  origen: z.enum(['boton', 'geocerca']),
});
export type SalidaFilaMovil = z.infer<typeof SalidaFilaMovilSchema>;

/** Respuesta de llegada/salida: la fila actual (`null` si ya no está en la fila). */
export const RespuestaFilaMovilSchema = z.object({
  fila: EstadoFilaSalidaSchema.nullable(),
  /** Solo en la salida que acaba de registrarse; `null` si no hubo salida en esta llamada. */
  anticipada: z.boolean().nullable(),
});
export type RespuestaFilaMovil = z.infer<typeof RespuestaFilaMovilSchema>;

/** `PUT /salidas/:puntoControlId/base`. */
export const BaseFrecuenciaSchema = z.object({
  frecuenciaSalidaMin: minutosSchema.nullable(),
});
export type BaseFrecuencia = z.infer<typeof BaseFrecuenciaSchema>;

/** `GET /salidas/:puntoControlId/reglas`: reglas no anuladas del día + base. */
export const ReglasFrecuenciaPanelSchema = z.object({
  puntoControlId: uuidSchema,
  /** Día local de Bolivia, `YYYY-MM-DD`. */
  fecha: z.string(),
  baseMin: minutosSchema.nullable(),
  reglas: z.array(FrecuenciaReglaSchema),
});
export type ReglasFrecuenciaPanel = z.infer<typeof ReglasFrecuenciaPanelSchema>;

export const ActualizarGrupoVehiculoSchema = z
  .object({
    nombre: z.string().trim().min(1).max(80).optional(),
    estado: EstadoGrupoVehiculoSchema.optional(),
  })
  .refine((g) => g.nombre !== undefined || g.estado !== undefined, {
    message: 'Indicá nombre o estado',
  });
export type ActualizarGrupoVehiculo = z.infer<typeof ActualizarGrupoVehiculoSchema>;

export const AgregarMiembroGrupoSchema = z.object({ vehiculoId: uuidSchema });
export type AgregarMiembroGrupo = z.infer<typeof AgregarMiembroGrupoSchema>;
