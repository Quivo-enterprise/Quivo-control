import { z } from 'zod';
import { RolSchema } from '../enums/roles.js';
import { sindicatoIdSchema } from '../primitives.js';

/**
 * Contrato de POST /v1/auth/login (doc técnico §5, QUI-219). `admin_quivo` no tiene
 * sindicato_id (super-admin) — de ahí el `.nullable()`.
 */
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  rol: RolSchema,
  sindicatoId: sindicatoIdSchema.nullable(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/**
 * Vista mínima del directorio de usuarios para el administrador de QUIVO. No expone
 * credenciales, sesiones ni datos de cuentas de Better Auth; sirve para seleccionar con
 * precisión a quién se le hará un restablecimiento asistido de contraseña.
 */
export const UsuarioAdministrativoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  rol: RolSchema,
  sindicatoId: sindicatoIdSchema.nullable(),
});
export type UsuarioAdministrativo = z.infer<typeof UsuarioAdministrativoSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: AuthUserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/** Contrato de POST /v1/auth/refresh (doc técnico §5, QUI-219). */
export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

/** Contrato de POST /v1/auth/logout (QUI-251) — revoca la sesión server-side. Antes de
 * esto, "cerrar sesión" solo borraba el token del browser; el `refreshToken` robado
 * seguía siendo válido hasta su expiración (hasta 30 días, `JWT_REFRESH_TTL`). */
export const LogoutRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

/** Contrato de POST /v1/auth/admin/reset-password — reset asistido, sin flujo de email
 * (el proyecto no tiene proveedor de email configurado). Solo `admin_quivo` puede llamarlo
 * (ver RolesGuard en el controller); la contraseña nueva se comunica fuera de banda al
 * usuario. 8 caracteres mínimo, igual que el default de Better-Auth. */
export const AdminResetPasswordRequestSchema = z.object({
  email: z.string().email(),
  newPassword: z.string().min(8).max(128),
});
export type AdminResetPasswordRequest = z.infer<typeof AdminResetPasswordRequestSchema>;
