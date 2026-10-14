import { z } from 'zod';
import { EstadoVehiculoSchema } from '../enums/estados.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';

export const TipoVehiculoSchema = z.enum([
  'taxi_trufi',
  'trufi',
  'minibus',
  'micro',
  'bus_urbano',
  'omnibus',
  'otro',
]);
export type TipoVehiculo = z.infer<typeof TipoVehiculoSchema>;

export const ColorVehiculoSchema = z.enum([
  'blanco',
  'negro',
  'gris',
  'plateado',
  'rojo',
  'azul',
  'verde',
  'amarillo',
  'naranja',
  'cafe',
  'beige',
  'celeste',
  'morado',
  'multicolor',
  'otro',
]);
export type ColorVehiculo = z.infer<typeof ColorVehiculoSchema>;

/**
 * Formato ordinario vigente consultado por RUAT para la placa PTA.
 * Conviven series de 3 y 4 dígitos, siempre seguidas por 3 letras.
 * Los separadores se toleran al capturar, pero no forman parte del valor normalizado.
 */
export const PATRON_PLACA_ACTUAL_BOLIVIA = /^\d{3,4}[A-Z]{3}$/;
const PATRON_PLACA_ANTERIOR_BOLIVIA = /^[A-Z]{3}\d{3}$/;

export const PlacaVehiculoSchema = z
  .string()
  .trim()
  .min(1, 'Ingresa la placa.')
  .max(20, 'La placa parece demasiado larga.')
  // SEGURIDAD, no cosmético — NO ampliar este alfabeto sin entender qué rompe: restringir la
  // placa a ASCII es lo único que garantiza que `toUpperCase()` de JavaScript y `upper()` de
  // Postgres (dependiente de locale/collation) coincidan SIEMPRE, y es lo que impide un
  // ataque de homóglifos. Ejemplo: una `А` cirílica en `АBC123` sobrevive este regex si se
  // permitiera Unicode general, pero el `regexp_replace(..., '[^A-Z0-9]', ...)` que genera
  // `placaNormalizada` en Postgres (schema.prisma) la stripea por no ser `A-Z` ASCII,
  // produciendo `BC123` — una `placaNormalizada` distinta que escapa al índice único
  // (`vehiculos_placa_norm_vigente_key`) mientras la placa se ve idéntica a la vista.
  .regex(/^[A-Za-z0-9 -]+$/, 'La placa contiene caracteres no permitidos.')
  .superRefine((placa, context) => {
    const placaNormalizada = normalizarPlacaVehiculo(placa);
    if (PATRON_PLACA_ACTUAL_BOLIVIA.test(placaNormalizada)) return;

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: PATRON_PLACA_ANTERIOR_BOLIVIA.test(placaNormalizada)
        ? 'Ese es el formato anterior al reemplaque (ABC123). Ingresa la placa PTA actual.'
        : 'Usa una placa boliviana actual: 3 o 4 números seguidos de 3 letras (ej. 123ABC o 1234ABC).',
    });
  });

export const MarcaVehiculoSchema = z
  .string()
  .trim()
  .min(2, 'Ingresa una marca de al menos 2 caracteres.')
  .max(50, 'La marca no puede superar 50 caracteres.')
  .regex(/^[\p{L}\p{N} .&-]+$/u, 'La marca contiene caracteres no permitidos.');

export const ModeloVehiculoSchema = z
  .string()
  .trim()
  .min(1, 'Ingresa el modelo del vehículo.')
  .max(50, 'El modelo no puede superar 50 caracteres.')
  .regex(/^[\p{L}\p{N} .\-/]+$/u, 'El modelo contiene caracteres no permitidos.');

const nullableVehiculoTextSchema = (max: number) =>
  z.preprocess((value) => (value === '' ? null : value), z.string().trim().max(max).nullable());

export const TIPOS_VEHICULO = [
  {
    codigo: 'taxi_trufi',
    nombre: 'Taxi trufi',
    descripcion: 'Automóvil para servicio compartido.',
    capacidadMinReferencial: 3,
    capacidadMaxReferencial: 6,
  },
  {
    codigo: 'trufi',
    nombre: 'Trufi',
    descripcion: 'Vagoneta o vehículo pequeño de ruta fija.',
    capacidadMinReferencial: 5,
    capacidadMaxReferencial: 12,
  },
  {
    codigo: 'minibus',
    nombre: 'Minibús',
    descripcion: 'Vehículo de transporte urbano mediano.',
    capacidadMinReferencial: 12,
    capacidadMaxReferencial: 30,
  },
  {
    codigo: 'micro',
    nombre: 'Micro',
    descripcion: 'Micro urbano de capacidad intermedia.',
    capacidadMinReferencial: 20,
    capacidadMaxReferencial: 45,
  },
  {
    codigo: 'bus_urbano',
    nombre: 'Bus urbano',
    descripcion: 'Bus urbano de mayor capacidad.',
    capacidadMinReferencial: 30,
    capacidadMaxReferencial: 80,
  },
  {
    codigo: 'omnibus',
    nombre: 'Ómnibus',
    descripcion: 'Bus de gran capacidad.',
    capacidadMinReferencial: 40,
    capacidadMaxReferencial: 100,
  },
  {
    codigo: 'otro',
    nombre: 'Otro autorizado',
    descripcion: 'Tipo excepcional autorizado por QUIVO.',
    capacidadMinReferencial: null,
    capacidadMaxReferencial: null,
  },
] as const satisfies ReadonlyArray<{
  codigo: TipoVehiculo;
  nombre: string;
  descripcion: string;
  capacidadMinReferencial: number | null;
  capacidadMaxReferencial: number | null;
}>;

export const COLORES_VEHICULO = [
  { codigo: 'blanco', nombre: 'Blanco', muestra: '#F7F7F8' },
  { codigo: 'negro', nombre: 'Negro', muestra: '#17171A' },
  { codigo: 'gris', nombre: 'Gris', muestra: '#7A7A82' },
  { codigo: 'plateado', nombre: 'Plateado', muestra: '#BFC3C9' },
  { codigo: 'rojo', nombre: 'Rojo', muestra: '#D62F3A' },
  { codigo: 'azul', nombre: 'Azul', muestra: '#2864DC' },
  { codigo: 'verde', nombre: 'Verde', muestra: '#26935C' },
  { codigo: 'amarillo', nombre: 'Amarillo', muestra: '#F5C842' },
  { codigo: 'naranja', nombre: 'Naranja', muestra: '#EA7A2A' },
  { codigo: 'cafe', nombre: 'Café', muestra: '#795548' },
  { codigo: 'beige', nombre: 'Beige', muestra: '#D8C7A3' },
  { codigo: 'celeste', nombre: 'Celeste', muestra: '#65BDE4' },
  { codigo: 'morado', nombre: 'Morado', muestra: '#7355B7' },
  {
    codigo: 'multicolor',
    nombre: 'Multicolor',
    muestra: 'linear-gradient(135deg,#D62F3A,#F5C842,#26935C,#2864DC)',
  },
  { codigo: 'otro', nombre: 'Otro', muestra: '#E8E6ED' },
] as const satisfies ReadonlyArray<{ codigo: ColorVehiculo; nombre: string; muestra: string }>;

export const MARCAS_VEHICULO_INICIALES = [
  'Toyota',
  'Nissan',
  'Suzuki',
  'Mercedes-Benz',
  'King Long',
  'JAC',
  'Mitsubishi',
  'Hyundai',
  'Kia',
  'Hino',
] as const;

export const VehiculoSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  socioId: uuidSchema.nullable(),
  placa: PlacaVehiculoSchema,
  placaNormalizada: z.string().min(3).max(20),
  tipo: TipoVehiculoSchema,
  marca: MarcaVehiculoSchema,
  modelo: ModeloVehiculoSchema,
  color: ColorVehiculoSchema,
  colorSecundario: ColorVehiculoSchema.nullable(),
  numeroInterno: nullableVehiculoTextSchema(30).optional(),
  distintivo: nullableVehiculoTextSchema(80).optional(),
  cartelSuperior: nullableVehiculoTextSchema(120).optional(),
  capacidad: z
    .number()
    .int('La capacidad debe ser un número entero.')
    .positive('La capacidad debe ser mayor que cero.')
    .max(200, 'La capacidad no puede superar 200 pasajeros.'),
  estado: EstadoVehiculoSchema,
  // Foto de la unidad (PR C). Solo lectura: se sube desde la app móvil y se quita con
  // `DELETE /vehiculos/:id/foto`, por eso Crear/Actualizar la omiten abajo.
  fotoUrl: z.string().nullable().optional(),
  fotoActualizadaEn: z.string().datetime().nullable().optional(),
  fotoSubidaPor: z.object({ id: uuidSchema, nombre: z.string() }).nullable().optional(),
});
export type Vehiculo = z.infer<typeof VehiculoSchema>;

/** Tope de la foto de la unidad ya decodificada (`POST /mobile/vehiculo/foto`). */
export const FOTO_VEHICULO_MAX_BYTES = 2 * 1024 * 1024;

export const SubirFotoVehiculoMovilSchema = z.object({
  // Base64 de 2 MB ≈ 2,8 M caracteres; el tope real se valida sobre los bytes decodificados.
  imagenBase64: z.string().min(1).max(2_900_000),
  contentType: z.enum(['image/jpeg', 'image/webp']),
});
export type SubirFotoVehiculoMovil = z.infer<typeof SubirFotoVehiculoMovilSchema>;

export const FotoVehiculoSchema = z.object({
  fotoUrl: z.string(),
  fotoActualizadaEn: z.string().datetime(),
});
export type FotoVehiculo = z.infer<typeof FotoVehiculoSchema>;

export const CrearVehiculoSchema = VehiculoSchema.omit({
  id: true,
  placaNormalizada: true,
  estado: true,
  fotoUrl: true,
  fotoActualizadaEn: true,
  fotoSubidaPor: true,
  numeroInterno: true,
  distintivo: true,
  cartelSuperior: true,
}).extend({
  estado: z.literal('pendiente').default('pendiente'),
  numeroInterno: nullableVehiculoTextSchema(30).optional(),
  distintivo: nullableVehiculoTextSchema(80).optional(),
  cartelSuperior: nullableVehiculoTextSchema(120).optional(),
});
export type CrearVehiculo = z.infer<typeof CrearVehiculoSchema>;

// El tenant y el estado tienen flujos propios; un PATCH general nunca puede modificarlos.
export const ActualizarVehiculoSchema = VehiculoSchema.omit({
  id: true,
  sindicatoId: true,
  placaNormalizada: true,
  estado: true,
  fotoUrl: true,
  fotoActualizadaEn: true,
  fotoSubidaPor: true,
}).partial();
export type ActualizarVehiculo = z.infer<typeof ActualizarVehiculoSchema>;

export const CambiarEstadoVehiculoSchema = z
  .object({
    estado: EstadoVehiculoSchema.exclude(['pendiente']),
    motivo: z
      .string()
      .trim()
      .max(200, 'El motivo no puede superar 200 caracteres.')
      .nullable()
      .optional(),
    observacion: z
      .string()
      .trim()
      .max(500, 'La observación no puede superar 500 caracteres.')
      .nullable()
      .optional(),
    retornoEstimado: z.string().datetime().nullable().optional(),
  })
  .superRefine((data, context) => {
    if (['inactivo', 'suspendido', 'mantenimiento'].includes(data.estado) && !data.motivo) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['motivo'],
        message: 'Ingresa el motivo del cambio de estado.',
      });
    }
  });
export type CambiarEstadoVehiculo = z.infer<typeof CambiarEstadoVehiculoSchema>;

export const VerificacionPlacaVehiculoSchema = z.object({
  placaNormalizada: z.string().min(3).max(20),
  disponible: z.boolean(),
  coincidencia: z
    .object({
      vehiculoId: uuidSchema,
      placa: z.string(),
      sindicatoId: sindicatoIdSchema,
      sindicatoNombre: z.string(),
    })
    .nullable(),
});
export type VerificacionPlacaVehiculo = z.infer<typeof VerificacionPlacaVehiculoSchema>;

export const HistorialEstadoVehiculoSchema = z.object({
  id: uuidSchema,
  vehiculoId: uuidSchema,
  estadoDesde: EstadoVehiculoSchema.nullable(),
  estadoHasta: EstadoVehiculoSchema,
  motivo: z.string().nullable(),
  observacion: z.string().nullable(),
  retornoEstimado: z.string().datetime().nullable(),
  actorId: z.string().min(1),
  origen: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type HistorialEstadoVehiculo = z.infer<typeof HistorialEstadoVehiculoSchema>;

// Alineado con la expresión que usa la base (migración de unicidad de placa,
// `packages/db/prisma/schema.prisma`, columna `placaNormalizada` GENERATED ALWAYS AS
// `regexp_replace(upper(btrim(placa)), '[^A-Z0-9]', '', 'g')`) y con `normalizarPlaca` de
// `apps/api/src/modules/auth-movil/auth-movil.service.ts`. Antes borraba sólo espacios y
// guiones (`[ -]+`); sobre input ya validado por `PlacaVehiculoSchema` (que sólo permite
// `[A-Za-z0-9 -]`) el resultado era idéntico, pero sobre input crudo NO — con `[^A-Z0-9]`
// las tres definiciones de "normalizar placa" del repo coinciden siempre, no sólo cuando
// Zod ya filtró el input.
export function normalizarPlacaVehiculo(placa: string): string {
  return placa.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
