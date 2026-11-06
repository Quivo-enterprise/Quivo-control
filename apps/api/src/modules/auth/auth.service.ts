import { createHmac, randomUUID } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { APIError } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { auth, prisma, resolveJwtSecret, SESSION_TTL_SECONDS, withTenantContext } from '@quivo/db';
import type {
  AdminResetPasswordRequest,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  RefreshRequest,
  RefreshResponse,
  Rol,
  UsuarioAdministrativo,
} from '@quivo/shared';
import { RolSchema } from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';

/**
 * Clave derivada de `JWT_SECRET` (HMAC-SHA256 con un separador de dominio fijo) para la
 * cadena de rotación de refresh tokens — ver `derivarTokenSiguiente` más abajo. Deliberadamente
 * *distinta* de `JWT_SECRET` en sí (no se usa el secreto crudo acá): Better-Auth ya usa
 * `JWT_SECRET` para firmar/cifrar sesiones y JWKS, y reusar la misma clave cruda en dos
 * primitivas criptográficas distintas es mala práctica — si esta clave derivada se filtrara
 * (por lo que sea), no compromete `JWT_SECRET` directamente. Se calcula una sola vez: usa
 * `resolveJwtSecret()` (el mismo guardarraíl de QUI-356, `packages/db/src/auth.ts`) en vez de
 * leer `process.env.JWT_SECRET` crudo, así la cadena nunca queda derivada de un placeholder —
 * si `JWT_SECRET` fuera inválido, `@quivo/db` ya habría fallado el arranque antes de llegar acá.
 */
const REFRESH_CHAIN_KEY = createHmac('sha256', resolveJwtSecret())
  .update('quivo:refresh-chain:v1')
  .digest();

/** Cuántas rotaciones hacia adelante tolera `resolverSesionConTolerancia` antes de rendirse
 * (ver docstring de esa función). Acotado a propósito: cada intento extra es un round-trip
 * más a `auth.api.getSession()` para un request que, en el caso más común (token vigente),
 * no lo necesita — y también acota cuánto puede amplificar un caller malicioso con un token
 * basura (`/v1/auth/logout` y `/v1/auth/refresh` no tienen `@Throttle`, a diferencia de
 * `/v1/auth/login`). 3 rotaciones de margen alcanza y sobra frente al peor caso real: con el
 * listener de `storage` en `apps/web/src/lib/auth/auth-context.tsx`, una pestaña en segundo
 * plano se resincroniza casi al instante con la rotación de otra pestaña. */
const MAX_ROTACIONES_A_TOLERAR = 3;

/** Ventana en la que reusar el token inmediatamente anterior se trata como duplicado benigno
 * (no robo): devuelve el token vigente sin rotar. */
const REFRESH_GRACE_MS = 120_000;

/**
 * Deriva determinísticamente "el token que vendría después" de `tokenAnterior` en la cadena
 * de rotación de `refresh()`. Sin esto, un `refreshToken` que quedó desactualizado por una
 * rotación posterior (hecha por otra pestaña/dispositivo, u otro request concurrente) no
 * matchea ninguna fila de `session` — ni vía `auth.api.getSession` ni vía una consulta directa
 * a Prisma, porque `refresh()` sobreescribe `token` en el lugar (no queda rastro del valor
 * viejo en la fila) — así que no había forma de resolver a qué sesión pertenecía sin guardar
 * el historial en una columna nueva. Como la derivación es una función determinística de
 * (token anterior, `REFRESH_CHAIN_KEY`), no hace falta persistir nada: dado *cualquier* token
 * que alguna vez fue el vigente de una sesión, se puede recalcular hacia adelante cuál es (o
 * fue) el siguiente, sin exponer la clave a nadie fuera del server (HMAC keyed — sin conocer
 * `REFRESH_CHAIN_KEY`, no se puede predecir la salida a partir de la entrada).
 */
function derivarTokenSiguiente(tokenAnterior: string): string {
  return createHmac('sha256', REFRESH_CHAIN_KEY).update(tokenAnterior).digest('base64url');
}

/**
 * Traduce `auth.api.*` de Better-Auth (sesión opaca + JWT firmado con JWKS, ver
 * `packages/db/src/auth.ts`) al contrato ya fijado que espera `apps/web`
 * (`accessToken`/`refreshToken`/`user`). Better-Auth sigue siendo quien hashea passwords,
 * valida sesiones y firma tokens — acá solo se reempaquetan nombres de campos.
 */
@Injectable()
export class AuthService {
  async login({ email, password }: LoginRequest): Promise<LoginResponse> {
    try {
      const { token: sessionToken, user } = await auth.api.signInEmail({
        body: { email, password },
      });

      return this.toLoginResponse(sessionToken, user);
    } catch (error) {
      if (error instanceof APIError) {
        throw new UnauthorizedException('Credenciales inválidas');
      }
      throw error;
    }
  }

  /** POST /v1/auth/refresh — QUI-359: rota el refresh token en cada uso, mismo patrón que
   * `AuthMovilService.refresh` (auth-movil.service.ts:271-311): compare-and-swap atómico
   * condicionado al token anterior, así que si un token robado se usa antes que el
   * legítimo, el legítimo (o cualquier segundo intento con el mismo token viejo, legítimo
   * o no) deja de encontrar coincidencia y falla — detectando el reuso en vez de dejar el
   * token robado servir hasta su vencimiento. Excepción: ventana de gracia de 120 s para el
   * duplicado benigno (ver `REFRESH_GRACE_MS`). El reuso revoca solo la sesión afectada.
   *
   * A diferencia de `sesionOperativa` (tabla propia de auth-movil, donde solo se persiste
   * el SHA-256 del token — `token-opaco.ts`), la tabla `session` es de Better-Auth: su
   * propio lookup (`auth.api.getSession`/`getToken`, plugin `bearer`) espera encontrar el
   * valor crudo en la columna `token`, así que acá no se puede hashear sin romper esa
   * validación nativa — el compare-and-swap corre igual, sobre el valor en claro.
   */
  async refresh({ refreshToken }: RefreshRequest): Promise<RefreshResponse> {
    const resuelto = await this.resolverSesionConTolerancia(refreshToken);
    if (!resuelto) {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }
    const { session, rotacionesAtras } = resuelto;
    const sesionId = session.session.id;

    if (rotacionesAtras > 0) {
      // Token ya rotado. Si es la rotación inmediatamente anterior y la sesión rotó hace
      // poco, casi seguro es un duplicado benigno (dos pestañas, o una respuesta perdida en
      // una red móvil mala): se devuelve el token vigente sin rotar de nuevo.
      if (rotacionesAtras === 1 && this.rotoDentroDeGracia(session.session.updatedAt)) {
        return this.respuestaConTokenVigente(derivarTokenSiguiente(refreshToken));
      }
      // Reuso fuera de la ventana (o de una rotación más vieja): posible token copiado.
      // Se revoca SOLO esta sesión — las demás sesiones del usuario tienen tokens distintos
      // y no están comprometidas, así que no hace falta expulsar a todos los que comparten
      // la cuenta. El token vigente de esta sesión también muere, forzando un login limpio.
      await prisma.session.deleteMany({ where: { id: sesionId } });
      throw new UnauthorizedException('Sesión inválida o expirada');
    }

    const refreshTokenNuevo = derivarTokenSiguiente(refreshToken);
    const ahora = new Date();
    // Compare-and-swap por `id` (identidad estable de la sesión) *y* `token` (valor
    // vigente) — el `id` no alcanza solo porque dos requests concurrentes con el mismo
    // token viejo deben seguir compitiendo por el mismo swap; el `token` no alcanza solo
    // porque es lo que cambia en cada rotación (ver `logout()` más abajo, que ya no puede
    // asumir que un token recibido siga siendo el vigente). `updatedAt` es la marca de la
    // última rotación (la ventana de gracia la lee) y `expiresAt` se renueva: ventana
    // deslizante, una sesión activa no vence a los TTL días de haberse creado.
    const rotado = await prisma.session.updateMany({
      where: { id: sesionId, token: refreshToken },
      data: {
        token: refreshTokenNuevo,
        updatedAt: ahora,
        expiresAt: new Date(ahora.getTime() + SESSION_TTL_SECONDS * 1000),
      },
    });
    if (rotado.count !== 1) {
      // Perdió la carrera del CAS contra otro request con este mismo token. Se relee la
      // sesión: si el ganador acaba de rotar (dentro de la ventana) y el token vigente es
      // el siguiente de este, es un duplicado benigno; si no, se revoca solo esta sesión.
      const actual = await prisma.session.findUnique({ where: { id: sesionId } });
      if (
        actual &&
        actual.token === refreshTokenNuevo &&
        this.rotoDentroDeGracia(actual.updatedAt)
      ) {
        return this.respuestaConTokenVigente(actual.token);
      }
      await prisma.session.deleteMany({ where: { id: sesionId } });
      throw new UnauthorizedException('Sesión inválida o expirada');
    }

    return this.respuestaConTokenVigente(refreshTokenNuevo);
  }

  private rotoDentroDeGracia(ultimaRotacion: Date): boolean {
    return Date.now() - ultimaRotacion.getTime() < REFRESH_GRACE_MS;
  }

  private async respuestaConTokenVigente(refreshToken: string): Promise<RefreshResponse> {
    return { accessToken: await this.mintAccessToken(refreshToken), refreshToken };
  }

  /** POST /v1/auth/logout (QUI-251) — revoca la sesión de verdad en la DB, no solo un
   * borrado del lado del cliente. Sin esto, un `refreshToken` robado seguía siendo válido
   * hasta su expiración natural (hasta 30 días) aunque el usuario ya hubiera "cerrado
   * sesión" en su browser.
   *
   * QUI-359 regresión (hallazgo de security review): `refresh()` rota `session.token` en
   * cada uso, así que revocar por *valor de token* como antes (`auth.api.signOut` con el
   * token recibido acá) era un no-op en cuanto ese token ya fue rotado por otra
   * pestaña/dispositivo — el `refreshToken` que llega acá puede estar desactualizado y no
   * matchear ninguna fila, dejando la sesión (ya con un token nuevo) viva pese al logout
   * explícito. `resolverSesionConTolerancia` reconstruye a qué sesión pertenece el token
   * recibido aunque ya no sea el vigente (ver esa función), y el borrado usa
   * `session.session.id` — la identidad estable de la sesión, no el valor de token que
   * cambia en cada rotación. */
  async logout({ refreshToken }: LogoutRequest): Promise<void> {
    const resuelto = await this.resolverSesionConTolerancia(refreshToken);
    if (!resuelto) {
      // Ninguna rotación reconstruible a partir de este token lleva a una sesión viva (ya
      // expiró, ya se cerró sesión antes, o quedó demasiadas rotaciones atrás) — no hay
      // nada que revocar.
      return;
    }
    await prisma.session.deleteMany({ where: { id: resuelto.session.session.id } });
  }

  /**
   * Resuelve a qué sesión de Better-Auth pertenece `tokenPresentado`, tolerando que ya no
   * sea el token vigente de esa sesión — hasta `MAX_ROTACIONES_A_TOLERAR` rotaciones atrás
   * (ver docstring de `derivarTokenSiguiente`). Prueba el token tal cual primero (el caso
   * común: sigue siendo el vigente, sin costo extra); si no matchea, deriva hacia adelante
   * y reintenta, hasta encontrar una sesión viva o agotar el margen.
   *
   * `rotacionesAtras` le dice al caller cuántas rotaciones atrás estaba el token recibido
   * (0 = era el vigente; `refresh()` lo usa para distinguir una rotación normal, un duplicado
   * benigno dentro de la ventana de gracia y un reuso).
   */
  private async resolverSesionConTolerancia(tokenPresentado: string) {
    let candidato = tokenPresentado;
    for (let intento = 0; intento <= MAX_ROTACIONES_A_TOLERAR; intento++) {
      // `disableRefresh`: sin él, Better Auth sube `updatedAt`/`expiresAt` de una sesión ociosa al
      // leerla, y `updatedAt` es lo que lee la ventana de gracia de `refresh()`: un token una
      // rotación atrás, reenviado tras un día inactivo, pasaría por "recién rotado".
      const session = await auth.api.getSession({
        headers: this.bearerHeaders(candidato),
        query: { disableRefresh: true },
      });
      if (session) {
        return { session, rotacionesAtras: intento };
      }
      candidato = derivarTokenSiguiente(candidato);
    }
    return null;
  }

  /** GET /v1/auth/admin/users — directorio mínimo para preparar el reset asistido. La
   * autorización vive en el controller; esta consulta no devuelve hashes, cuentas ni
   * sesiones de Better Auth. */
  async listarUsuarios(): Promise<UsuarioAdministrativo[]> {
    return prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        rol: true,
        sindicatoId: true,
      },
      orderBy: [{ rol: 'asc' }, { email: 'asc' }],
    }) as Promise<UsuarioAdministrativo[]>;
  }

  /** POST /v1/auth/admin/reset-password — reset asistido por `admin_quivo` (ver RolesGuard
   * en el controller), sin flujo de email: el proyecto no tiene proveedor de email
   * configurado, así que Better-Auth's forgetPassword/resetPassword (que sí soporta esto de
   * forma nativa) no tiene forma de entregar el link. La contraseña nueva se comunica fuera
   * de banda; acá solo se re-hashea (`better-auth/crypto`, el mismo hasher que usa
   * Better-Auth internamente) y se revocan las sesiones existentes para forzar a que el
   * usuario vuelva a autenticarse con la nueva.
   *
   * No lleva `@Auditable`: ese interceptor guarda el body de la request tal cual en
   * `audit_log.diff` — con la contraseña nueva en texto plano en el body, eso filtraría la
   * contraseña a cualquiera con acceso a Auditoría. Acá se audita a mano, solo con el email
   * del usuario afectado. */
  async resetPasswordComoAdmin(
    actor: AuthenticatedUser,
    { email, newPassword }: AdminResetPasswordRequest,
  ): Promise<void> {
    const usuario = await prisma.user.findUnique({ where: { email } });
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const hashed = await hashPassword(newPassword);
    const cuenta = await prisma.account.findFirst({
      where: { userId: usuario.id, providerId: 'credential' },
    });
    if (cuenta) {
      await prisma.account.update({ where: { id: cuenta.id }, data: { password: hashed } });
    } else {
      await prisma.account.create({
        data: {
          id: randomUUID(),
          accountId: usuario.id,
          providerId: 'credential',
          userId: usuario.id,
          password: hashed,
        },
      });
    }

    await prisma.session.deleteMany({ where: { userId: usuario.id } });

    // `audit_log` tiene RLS (QUI-218) — a diferencia de `user`/`account`/`session` (sin
    // política propia, de ahí que las llamadas de arriba usen `prisma` a secas), el insert
    // necesita el contexto de tenant seteado o la política lo rechaza.
    await withTenantContext({ rol: actor.rol, sindicatoId: actor.sindicatoId }, (tx) =>
      tx.auditLog.create({
        data: {
          sindicatoId: usuario.sindicatoId,
          usuarioId: actor.userId,
          entidad: 'usuario',
          entidadId: usuario.id,
          accion: 'reset_password',
          diff: { email: usuario.email },
        },
      }),
    );
  }

  /** El token corto (`jwt` plugin) requiere una sesión válida — se la pasamos vía Bearer (plugin `bearer`, no hay cookies server-to-server). */
  private async mintAccessToken(sessionToken: string): Promise<string> {
    const { token } = await auth.api.getToken({ headers: this.bearerHeaders(sessionToken) });
    return token;
  }

  private async toLoginResponse(
    sessionToken: string,
    user: { id: string; email: string; rol: unknown; sindicatoId?: unknown },
  ): Promise<LoginResponse> {
    const rol = RolSchema.parse(user.rol) as Rol;
    return {
      accessToken: await this.mintAccessToken(sessionToken),
      refreshToken: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        rol,
        sindicatoId: (user.sindicatoId as string | null | undefined) ?? null,
      },
    };
  }

  private bearerHeaders(sessionToken: string): Headers {
    return new Headers({ authorization: `Bearer ${sessionToken}` });
  }
}
