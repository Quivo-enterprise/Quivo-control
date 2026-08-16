import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer } from 'better-auth/plugins/bearer';
import { jwt } from 'better-auth/plugins/jwt';
import { prisma } from './client.js';

/**
 * QUI-356: `secret` de Better-Auth sin guardarraíl de arranque. El default publicado
 * (`change-me-in-production`, ver `CREDENCIALES.md`/`.env.example` antes de este cambio) es
 * el hallazgo más grave de cara al piloto — un solo sindicato no lo atenúa: RLS confía en
 * los claims del JWT (`sindicatoId`, `rol`) para decidir qué filas ve cada quien, y si el
 * secreto es el default y está publicado, cualquiera puede forjar un token de admin. Ahí RLS
 * deja de ser una barrera y pasa a ser cómplice, porque hace exactamente lo que el token le
 * dice. El momento de exposición es el próximo: el primer deploy a una IP pública.
 *
 * Mismo patrón que `RUNTIME_DATABASE_URL` en `client.ts:56-64` — fail-closed fuera de
 * `development`, con un mensaje que explica qué falta, por qué importa y qué consecuencia
 * tiene. En `development` nunca bloquea el arranque (a lo sumo un `console.warn`): los
 * `.env` locales de desarrollo pueden seguir usando un secreto de juguete sin fricción.
 */
const DEFAULT_JWT_SECRET_PUBLICADO = 'change-me-in-production';
const JWT_SECRET_MIN_LENGTH = 32;

/**
 * QUI-356 (hallazgo de security review, `.env.example:24-28`): el chequeo original solo
 * rechazaba una igualdad *exacta* contra `DEFAULT_JWT_SECRET_PUBLICADO`. Pero `.env.example`
 * publica OTRO valor de relleno —el placeholder de "generá el tuyo con `openssl rand`"— que
 * tiene 59 caracteres y no es igual a ese default, así que pasaba las tres comprobaciones
 * originales sin problema: un operador podía copiar `.env.example` tal cual a Cloud Run y el
 * arranque no daba ninguna señal, pese a que `.env.example`/`CREDENCIALES.md` prometen que sí.
 *
 * En vez de una igualdad exacta contra un único string, esto rechaza cualquier secreto que
 * *contenga* un marcador razonable de "esto es un placeholder, no un secreto real" —
 * insensible a mayúsculas, así deja de poder desincronizarse silenciosamente de lo que
 * `.env.example` publica: cualquier variante futura del mismo estilo de placeholder también
 * cae acá. `auth.test.ts` lee el valor real de `.env.example` y falla si algún día deja de
 * estar cubierto por esta lista.
 */
const JWT_SECRET_PLACEHOLDER_MARKERS = [
  'change-me',
  'changeme',
  'generar_con',
  'generar-con',
  'no_usar',
  'no-usar',
  'example',
  'ejemplo',
  'placeholder',
  'your-secret',
  'your_secret',
  'replace-me',
  'replace_me',
  'insert-secret',
  'insert_secret',
  'secret-here',
  'secret_here',
  'todo-secret',
  'todo_secret',
] as const;

function esSecretoPlaceholder(secret: string): boolean {
  const normalizado = secret.trim().toLowerCase();
  return JWT_SECRET_PLACEHOLDER_MARKERS.some((marcador) => normalizado.includes(marcador));
}

export function resolveJwtSecret(): string {
  const jwtSecret = process.env.JWT_SECRET;
  const nodeEnv = process.env.NODE_ENV;
  const isDevelopment = nodeEnv === 'development';

  if (!jwtSecret) {
    if (isDevelopment) {
      console.warn(
        '[@quivo/db] JWT_SECRET no está seteada: Better-Auth arranca igual porque ' +
          'NODE_ENV=development, pero cualquier token firmado así no sirve fuera de este ' +
          'entorno. Generá uno real con `openssl rand -base64 32` antes de desplegar.',
      );
      return DEFAULT_JWT_SECRET_PUBLICADO;
    }
    throw new Error(
      `JWT_SECRET no está seteada (NODE_ENV=${nodeEnv ?? 'sin definir'}). Better-Auth la usa ` +
        'para firmar/cifrar sesiones y JWKS (auth.ts) — RLS confía en los claims del JWT ' +
        '(sindicatoId, rol) para decidir qué filas ve cada quien, así que sin un secreto real ' +
        'cualquiera podría forjar un token de admin. Seteá JWT_SECRET (openssl rand -base64 ' +
        '32) antes de arrancar, o corré con NODE_ENV=development si es un entorno local.',
    );
  }

  if (esSecretoPlaceholder(jwtSecret)) {
    if (isDevelopment) {
      console.warn(
        `[@quivo/db] JWT_SECRET tiene forma de valor de ejemplo ("${jwtSecret}") — sólo ` +
          'aceptado porque NODE_ENV=development. Generá uno real con `openssl rand -base64 32` ' +
          'antes de desplegar.',
      );
      return jwtSecret;
    }
    throw new Error(
      `JWT_SECRET tiene forma de valor de ejemplo ("${jwtSecret}", ver CREDENCIALES.md/` +
        `.env.example) fuera de development (NODE_ENV=${nodeEnv ?? 'sin definir'}). Coincide con ` +
        'un marcador conocido de placeholder (p. ej. "change-me", "generar_con", "no_usar", ' +
        '"example", "placeholder") — el tipo de valor que .env.example/CREDENCIALES.md publican ' +
        'para que lo reemplaces, no un secreto real, y pudo haber quedado versionado en el ' +
        'historial de git. Que esté seteada no significa que sea segura: generá un secreto real ' +
        'con `openssl rand -base64 32` y usalo acá — RLS confía en los claims del JWT ' +
        '(sindicatoId, rol) para decidir qué filas ve cada quien.',
    );
  }

  if (jwtSecret.length < JWT_SECRET_MIN_LENGTH) {
    if (isDevelopment) {
      console.warn(
        `[@quivo/db] JWT_SECRET tiene ${jwtSecret.length} caracteres (recomendado ≥` +
          `${JWT_SECRET_MIN_LENGTH}) — sólo aceptado porque NODE_ENV=development. Generá uno ` +
          'más largo con `openssl rand -base64 32` antes de desplegar.',
      );
      return jwtSecret;
    }
    throw new Error(
      `JWT_SECRET tiene ${jwtSecret.length} caracteres (mínimo ${JWT_SECRET_MIN_LENGTH}) fuera ` +
        `de development (NODE_ENV=${nodeEnv ?? 'sin definir'}). Un secreto corto es forzable por ` +
        'fuerza bruta y compromete la firma de sesiones/JWKS de Better-Auth. Generá uno con ' +
        '`openssl rand -base64 32` y usalo acá.',
    );
  }

  return jwtSecret;
}

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
  secret: resolveJwtSecret(),
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
    // QUI-356: bajado de 30d a 7d — un refresh token robado servía un mes entero.
    expiresIn: parseDurationToSeconds(process.env.JWT_REFRESH_TTL ?? '7d'),
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
