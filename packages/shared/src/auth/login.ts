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
