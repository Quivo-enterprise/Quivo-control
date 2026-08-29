import { z } from 'zod';
import { TipoParadaSchema } from '../entities/parada.js';
import { LineaDistintivoTipoSchema } from '../entities/linea.js';
import { TurnoSchema } from '../enums/turno.js';
import { LineaGeoJsonSchema, PuntoGeoJsonSchema } from '../geo.js';
import { uuidSchema } from '../primitives.js';

/**
 * Punto de control tal como viaja en el paquete del día (RF-68, QUI-236) — mismo shape que
 * `PuntoControlSchema` de `entities/punto-control.ts` pero sin `rutaId` (ya está implícito:
 * todo el paquete es de una sola ruta).
 */
export const PuntoControlPaqueteSchema = z.object({
  id: uuidSchema,
  orden: z.number().int(),
  coord: PuntoGeoJsonSchema,
  radioToleranciaM: z.number().positive(),
  obligatorio: z.boolean(),
});
export type PuntoControlPaquete = z.infer<typeof PuntoControlPaqueteSchema>;

export const ParadaPaqueteSchema = z.object({
  id: uuidSchema,
  tipo: TipoParadaSchema,
  orden: z.number().int().nonnegative(),
  coord: PuntoGeoJsonSchema,
});
export type ParadaPaquete = z.infer<typeof ParadaPaqueteSchema>;

/**
 * `GET /v1/mobile/asignacion-del-dia` (RF-68/73, QUI-236): todo lo que el chofer necesita
 * para completar el recorrido sin red — asignación vigente, geometría de la ruta, paradas y
 * puntos de control. `venceAt` es el mismo de la asignación (RF-57, QUI-234); la app debe
 * avisar si expiró y no permitir iniciar un recorrido nuevo con un paquete vencido (RF-73).
 */
export const PaqueteDiaSchema = z.object({
  asignacion: z.object({
    id: uuidSchema,
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horario: TurnoSchema,
    horaSalida: z.string().datetime().nullable().optional(),
    horaPresentacion: z.string().datetime().nullable().optional(),
    venceAt: z.string().datetime(),
  }),
  ruta: z.object({
    id: uuidSchema,
    sentido: z.string().min(1),
    geometria: LineaGeoJsonSchema,
  }),
  linea: z.object({
    id: uuidSchema,
    codigo: z.string().min(1),
    nombre: z.string().min(1),
    color: z.string().min(1),
    colorSecundario: z.string().nullable().optional(),
    colorTexto: z.string().nullable().optional(),
    colorTerciario: z.string().nullable().optional(),
    colorFondo: z.string().nullable().optional(),
    nombreCorto: z.string().nullable().optional(),
    lema: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
    distintivoTipo: LineaDistintivoTipoSchema.nullable().optional(),
    distintivoValor: z.string().nullable().optional(),
    cartelSuperior: z.string().nullable().optional(),
  }),
  paradas: z.array(ParadaPaqueteSchema),
  puntosControl: z.array(PuntoControlPaqueteSchema),
});
export type PaqueteDia = z.infer<typeof PaqueteDiaSchema>;
