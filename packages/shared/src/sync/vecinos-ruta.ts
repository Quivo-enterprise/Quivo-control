import { z } from 'zod';

/** Un vecino cuyo último fix es más viejo que esto no se muestra (se considera sin señal). */
export const UMBRAL_VECINO_FRESCO_MS = 10 * 60 * 1000;

/**
 * Coordenada opcional que llega como query string. `z.coerce.number()` convertiría `''` en 0
 * (`Number('')`), una coordenada válida pero falsa: se rechaza el string vacío antes de coercionar.
 */
const coordenadaQuery = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Valor vacío')
    .pipe(z.coerce.number().finite().min(min).max(max))
    .optional();

/**
 * Query de vecinos de ruta: posición actual del solicitante, opcional. `lat` y `lng` van
 * juntas o ninguna.
 */
export const VecinosRutaQuerySchema = z
  .object({
    lat: coordenadaQuery(-90, 90),
    lng: coordenadaQuery(-180, 180),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: 'lat y lng deben enviarse juntas o ninguna',
    path: ['lat'],
  });
export type VecinosRutaQuery = z.infer<typeof VecinosRutaQuerySchema>;

/**
 * Vehículo vecino en la misma ruta (delante o detrás). PRIVACIDAD: identifica solo al
 * vehículo — NO incluye lat/lng ni el nombre del conductor; la posición se expresa como
 * `distanciaM` y antigüedad del fix (`edadFixS`).
 */
export const VecinoRutaSchema = z.object({
  // Tipos planos a propósito (no `VehiculoSchema.pick`): los schemas de `entities/vehiculo.ts`
  // validan el formato de ENTRADA (placa PTA actual, enums de tipo/color, regex de marca) y
  // los datos ya guardados pueden no cumplirlo (placas anteriores al reemplaque, valores
  // históricos). Una RESPUESTA nunca debe romper su parseo por eso.
  placa: z.string().min(1),
  numeroInterno: z.string().nullable(),
  tipo: z.string(),
  marca: z.string(),
  modelo: z.string(),
  color: z.string(),
  colorSecundario: z.string().nullable(),
  distanciaM: z.number().nonnegative(),
  edadFixS: z.number().int().nonnegative(),
});
export type VecinoRuta = z.infer<typeof VecinoRutaSchema>;

export const VecinosRutaSchema = z.object({
  delante: VecinoRutaSchema.nullable(),
  detras: VecinoRutaSchema.nullable(),
  calculadoEn: z.string().datetime({ offset: true }),
});
export type VecinosRuta = z.infer<typeof VecinosRutaSchema>;
