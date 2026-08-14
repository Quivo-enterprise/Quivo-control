import { z } from 'zod';
import { EstadoConductorSchema } from '../enums/estados.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';
import {
  DocumentoIdentidadBoliviaSchema,
  LicenciaConducirBoliviaSchema,
  NombrePersonaSchema,
} from '../identidad-bolivia.js';

export const ConductorSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  nombre: z.string().min(1).max(200),
  documentoIdentidad: z.string().min(1).max(50),
  licenciaConducir: z.string().min(1).max(50),
  estado: EstadoConductorSchema,
});
export type Conductor = z.infer<typeof ConductorSchema>;

export const CrearConductorSchema = ConductorSchema.omit({ id: true, estado: true }).extend({
  nombre: NombrePersonaSchema,
  documentoIdentidad: DocumentoIdentidadBoliviaSchema,
  licenciaConducir: LicenciaConducirBoliviaSchema,
  estado: EstadoConductorSchema.default('activo'),
});
export type CrearConductor = z.infer<typeof CrearConductorSchema>;

export const ActualizarConductorSchema = CrearConductorSchema.omit({ sindicatoId: true }).partial();
export type ActualizarConductor = z.infer<typeof ActualizarConductorSchema>;
