import { z } from 'zod';
import { EstadoSancionSchema, SujetoTipoSchema } from '../enums/estados.js';
import { ParadaSalidaSchema } from '../enums/parada-salida.js';
import { TurnoSchema } from '../enums/turno.js';
import { sindicatoIdSchema, uuidSchema } from '../primitives.js';

export const SancionSchema = z.object({
  id: uuidSchema,
  sindicatoId: sindicatoIdSchema,
  reglaId: uuidSchema,
  sujetoTipo: SujetoTipoSchema,
  // Sin FK real (puede apuntar a vehiculos/conductores/socios según sujetoTipo) — mismo
  // patrón polimórfico que AuditLog.entidadId.
  sujetoId: z.string().min(1),
  motivo: z.string().min(1).max(2000),
  fechaHecho: z.coerce.date(),
  // "Evidencia auto-vinculada" (doc técnico §15.5: sesión/cumplimientos_pc/desvíos) necesita
  // tracking real (M3), que todavía no existe — por ahora es texto libre que carga quien
  // registra la sanción.
  evidenciaRef: z.string().max(2000).nullable(),
  estado: EstadoSancionSchema,
  // Sanción compensatoria (solo las nacidas de una infracción): los 4 vienen juntos o ninguno.
  fechaCumplimiento: z.coerce.date().nullable(),
  vueltas: z.number().int().nullable(),
  turno: TurnoSchema.nullable(),
  paradaSalida: ParadaSalidaSchema.nullable(),
});
export type Sancion = z.infer<typeof SancionSchema>;

export const CrearSancionSchema = z.object({
  sindicatoId: sindicatoIdSchema,
  reglaId: uuidSchema,
  sujetoTipo: SujetoTipoSchema,
  sujetoId: z.string().min(1),
  motivo: z.string().min(1).max(2000),
  fechaHecho: z.coerce.date(),
  evidenciaRef: z.string().max(2000).nullable().optional(),
});
export type CrearSancion = z.infer<typeof CrearSancionSchema>;

/** Solo mientras la sanción está `pendiente` (asunción de este equipo, ver
 * sanciones.service.ts) — el resto de los cambios de estado pasan por las transiciones
 * dedicadas (aplicar/anular/apelar/pagar), no por un PATCH genérico. */
export const ActualizarSancionSchema = z.object({
  motivo: z.string().min(1).max(2000).optional(),
  evidenciaRef: z.string().max(2000).nullable().optional(),
});
export type ActualizarSancion = z.infer<typeof ActualizarSancionSchema>;

/** Filtros de `GET /v1/sanciones` — `sindicatoId` solo lo usa `admin_quivo` (a `admin_sindicato`
 * ya lo limita RLS a su propio tenant, ver sanciones.service.ts). `skip` pagina por offset
 * sobre el resultado ordenado por `fechaHecho desc`, mismo límite fijo de 200 filas por
 * página que `AuditoriaQuerySchema`/`SyncErroresQuerySchema`. */
export const SancionesQuerySchema = z.object({
  sindicatoId: sindicatoIdSchema.optional(),
  estado: EstadoSancionSchema.optional(),
  reglaId: uuidSchema.optional(),
  skip: z.coerce.number().int().min(0).optional(),
});
export type SancionesQuery = z.infer<typeof SancionesQuerySchema>;
