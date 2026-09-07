import { z } from 'zod';
import { uuidSchema } from '../primitives.js';
import { TurnoSchema } from '../enums/turno.js';
import { DocumentoIdentidadBoliviaSchema } from '../identidad-bolivia.js';
import { LineaDistintivoTipoSchema } from '../entities/linea.js';

export const PinMovilSchema = z
  .string()
  .regex(/^\d{6,12}$/, 'El PIN debe tener entre 6 y 12 dígitos');
export const DeviceIdMovilSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'deviceId inválido');

export const AuthVehiculoMovilRequestSchema = z.object({
  placa: z.string().trim().min(3).max(16),
  pin: PinMovilSchema,
  deviceId: DeviceIdMovilSchema,
});
export type AuthVehiculoMovilRequest = z.infer<typeof AuthVehiculoMovilRequestSchema>;

export const AuthVehiculoMovilResponseSchema = z.object({
  challengeToken: z.string().min(32),
  expiresAt: z.string().datetime(),
  vehiculo: z.object({
    placa: z.string().min(1),
    tipo: z.string().min(1),
    marca: z.string().min(1),
    modelo: z.string().min(1),
    numeroInterno: z.string().nullable().optional(),
    distintivo: z.string().nullable().optional(),
    cartelSuperior: z.string().nullable().optional(),
  }),
});
export type AuthVehiculoMovilResponse = z.infer<typeof AuthVehiculoMovilResponseSchema>;

export const AuthConductorMovilRequestSchema = z
  .object({
    challengeToken: z.string().min(32),
    deviceId: DeviceIdMovilSchema,
    documentoIdentidad: DocumentoIdentidadBoliviaSchema.optional(),
    pin: PinMovilSchema.optional(),
    asignacionId: uuidSchema.optional(),
  })
  .superRefine((data, context) => {
    const tieneCredenciales = Boolean(data.documentoIdentidad && data.pin);
    if (!tieneCredenciales && !data.asignacionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Se requieren las credenciales del conductor o una asignación verificada',
      });
    }
    if (Boolean(data.documentoIdentidad) !== Boolean(data.pin)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Documento y PIN deben enviarse juntos',
      });
    }
  });
export type AuthConductorMovilRequest = z.infer<typeof AuthConductorMovilRequestSchema>;

export const ResumenAsignacionMovilSchema = z.object({
  id: uuidSchema,
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horario: TurnoSchema,
  horaSalida: z.string().datetime().nullable().optional(),
  horaPresentacion: z.string().datetime().nullable().optional(),
  venceAt: z.string().datetime(),
  linea: z.object({
    codigo: z.string().min(1),
    nombre: z.string().min(1),
    color: z.string().nullable().optional(),
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
  ruta: z.object({ sentido: z.string().min(1) }),
});
export type ResumenAsignacionMovil = z.infer<typeof ResumenAsignacionMovilSchema>;

export const ContextoOperativoMovilSchema = z.object({
  sesionId: uuidSchema,
  asignacion: z.object({
    id: uuidSchema,
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    horario: TurnoSchema,
    horaSalida: z.string().datetime().nullable().optional(),
    horaPresentacion: z.string().datetime().nullable().optional(),
    venceAt: z.string().datetime(),
  }),
  vehiculo: z.object({
    id: uuidSchema,
    placa: z.string().min(1),
    tipo: z.string().min(1),
    marca: z.string().min(1),
    modelo: z.string().min(1),
    numeroInterno: z.string().nullable().optional(),
    distintivo: z.string().nullable().optional(),
    cartelSuperior: z.string().nullable().optional(),
  }),
  conductor: z.object({
    id: uuidSchema,
    nombre: z.string().min(1),
    documentoIdentidad: z.string().min(1),
  }),
  sindicato: z.object({ id: uuidSchema, nombre: z.string().min(1) }),
  linea: z.object({
    id: uuidSchema,
    codigo: z.string().min(1),
    nombre: z.string().min(1),
    color: z.string().nullable(),
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
  ruta: z.object({ id: uuidSchema, sentido: z.string().min(1) }),
});
export type ContextoOperativoMovil = z.infer<typeof ContextoOperativoMovilSchema>;

export const AuthConductorMovilResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('seleccion_requerida'),
    asignaciones: z.array(ResumenAsignacionMovilSchema).min(2),
  }),
  z.object({
    status: z.literal('autenticado'),
    accessToken: z.string().min(32),
    refreshToken: z.string().min(32),
    accessTokenExpiresAt: z.string().datetime(),
    refreshTokenExpiresAt: z.string().datetime(),
    contexto: ContextoOperativoMovilSchema,
  }),
]);
export type AuthConductorMovilResponse = z.infer<typeof AuthConductorMovilResponseSchema>;

export const RefreshMovilRequestSchema = z.object({ refreshToken: z.string().min(32) });
export type RefreshMovilRequest = z.infer<typeof RefreshMovilRequestSchema>;

export const RefreshMovilResponseSchema = z.object({
  accessToken: z.string().min(32),
  refreshToken: z.string().min(32),
  accessTokenExpiresAt: z.string().datetime(),
  refreshTokenExpiresAt: z.string().datetime(),
});
export type RefreshMovilResponse = z.infer<typeof RefreshMovilResponseSchema>;

export const LogoutMovilRequestSchema = RefreshMovilRequestSchema;
export type LogoutMovilRequest = z.infer<typeof LogoutMovilRequestSchema>;

export const EstablecerPinMovilRequestSchema = z.object({ pin: PinMovilSchema });
export type EstablecerPinMovilRequest = z.infer<typeof EstablecerPinMovilRequestSchema>;
