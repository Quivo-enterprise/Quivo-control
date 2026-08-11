import { z } from 'zod';

// Estados núcleo (doc técnico §4.2). Se amplían si el modelo de datos lo requiere.

export const EstadoSindicatoSchema = z.enum(['activo', 'inactivo']);
export type EstadoSindicato = z.infer<typeof EstadoSindicatoSchema>;

export const EstadoVehiculoSchema = z.enum([
  'pendiente',
  'activo',
  'inactivo',
  'suspendido',
  'mantenimiento',
]);
export type EstadoVehiculo = z.infer<typeof EstadoVehiculoSchema>;

export const EstadoSocioSchema = z.enum(['activo', 'inactivo']);
export type EstadoSocio = z.infer<typeof EstadoSocioSchema>;

export const EstadoConductorSchema = z.enum(['activo', 'inactivo']);
export type EstadoConductor = z.infer<typeof EstadoConductorSchema>;

export const EstadoRutaSchema = z.enum(['activo', 'inactivo']);
export type EstadoRuta = z.infer<typeof EstadoRutaSchema>;

export const EstadoSancionSchema = z.enum([
  'pendiente',
  'aplicada',
  'anulada',
  'apelada',
  'pagada',
]);
export type EstadoSancion = z.infer<typeof EstadoSancionSchema>;

export const EstadoRotacionSchema = z.enum(['borrador', 'publicada']);
export type EstadoRotacion = z.infer<typeof EstadoRotacionSchema>;

export const EstadoAsignacionSchema = z.enum(['vigente', 'vencida']);
export type EstadoAsignacion = z.infer<typeof EstadoAsignacionSchema>;

export const EstadoReglaSchema = z.enum(['activo', 'inactivo']);
export type EstadoRegla = z.infer<typeof EstadoReglaSchema>;

// Paradas/puntos de control/variantes no tenían estado — solo crear/actualizar, sin forma
// de sacar de circulación un punto duplicado o mal ubicado (mismo criterio de soft-delete
// que el resto del dominio: nunca DELETE real, porque `CumplimientoPc.puntoControlId` lo
// referencia sin FK — un hard delete dejaría ese historial apuntando a un id inexistente).
export const EstadoParadaSchema = z.enum(['activo', 'inactivo']);
export type EstadoParada = z.infer<typeof EstadoParadaSchema>;

export const EstadoPuntoControlSchema = z.enum(['activo', 'inactivo']);
export type EstadoPuntoControl = z.infer<typeof EstadoPuntoControlSchema>;

export const EstadoVarianteSchema = z.enum(['activo', 'inactivo']);
export type EstadoVariante = z.infer<typeof EstadoVarianteSchema>;

// Ninguno de los dos está detallado en el doc técnico más allá de mencionar "gravedad" y
// "sujeto" — asunción de este equipo (RF-40..50, QUI-244).
export const GravedadReglaSchema = z.enum(['leve', 'grave', 'gravisima']);
export type GravedadRegla = z.infer<typeof GravedadReglaSchema>;

export const SujetoTipoSchema = z.enum(['vehiculo', 'conductor', 'socio']);
export type SujetoTipo = z.infer<typeof SujetoTipoSchema>;
