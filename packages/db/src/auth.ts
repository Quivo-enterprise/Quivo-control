import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer } from 'better-auth/plugins/bearer';
import { jwt } from 'better-auth/plugins/jwt';
import { prisma } from './client.js';

/**
 * Instancia única de Better-Auth (doc técnico §5, QUI-219: "no construir auth a mano").
 * Vive acá (no en apps/api) porque tanto el seed (`prisma/seed.ts`, en este mismo
 * paquete) como `@better-auth/cli generate` (que produce `prisma/schema.prisma` a partir
 * de esta config) necesitan importarla, y `packages/db` no puede depender de `apps/api`.
 * `apps/api/src/modules/auth` solo consume `auth.api.*` — nunca reconstruye esta config.
 *
 * - `bearer()`: permite validar sesión vía header `Authorization: Bearer <token>` (no hay
 *   browser/cookies acá — Nest llama a `auth.api.*` server-to-server).
 * - `jwt()`: emite el access token de corta duración con claims custom (`rol`,
 *   `sindicatoId`) firmado con un par de claves asimétrico (JWKS) que Better-Auth genera
 *   y guarda cifrado en la tabla `jwks` (cifrado con `secret` de abajo) — no es un HMAC
 *   con `JWT_SECRET` directo.
 * - `emailAndPassword.disableSignUp` queda en `false`: no hay ninguna ruta pública de
 *   sign-up expuesta (ver `apps/api/src/modules/auth/auth.controller.ts`, que solo
 *   registra `login`/`refresh`) — el control de acceso real es "no existe la ruta", no
 *   este flag. Dejarlo en `true` también bloquearía el `signUpEmail` que usa el seed.
 */
export const auth = betterAuth({
  secret: process.env.JWT_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      rol: { type: 'string', required: true },
      sindicatoId: { type: 'string', required: false },
    },
  },
  session: {
    expiresIn: parseDurationToSeconds(process.env.JWT_REFRESH_TTL ?? '30d'),
  },
  plugins: [
    bearer(),
    jwt({
      jwt: {
        expirationTime: process.env.JWT_ACCESS_TTL ?? '15m',
        definePayload: ({ user }) => ({
          rol: user.rol as string,
          sindicatoId: (user.sindicatoId as string | null | undefined) ?? null,
        }),
      },
    }),
  ],
});

/** `"30d"` / `"15m"` → segundos (formato que espera `session.expiresIn`, a diferencia del plugin `jwt`, que acepta el string directamente). */
function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Duración inválida: "${duration}" (formato esperado: "30d", "15m", etc.)`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const secondsPerUnit = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return value * secondsPerUnit[unit];
}
