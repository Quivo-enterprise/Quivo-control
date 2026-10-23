import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { AuthMovilService } from './auth-movil.service.js';
import type { SesionMovilAutenticada } from './auth-movil.types.js';
import { hashTokenOpaco } from './token-opaco.js';

// TTL amplio a propósito: un access token inválido/expirado/revocado NUNCA vuelve a ser
// válido (el tiempo no retrocede, una sesión revocada no se reactiva sola), así que no hace
// falta un TTL corto por corrección — es puramente higiene de memoria. 5 min alcanza para
// absorber el peor bucle de reintentos documentado (`docs/handoff.md`: teléfono reintentando
// un 401 durante 42 min, 29 intentos — con la caché, solo el PRIMER intento con ese token le
// cuesta algo a la API; los otros 28 se cortan gratis).
const TTL_TOKEN_INVALIDO_MS = 5 * 60_000;
// Tope duro de tamaño para que la caché no sea ella misma un vector de memoria si un
// atacante manda un token distinto por request (ver el caveat de "rotación de tokens" en el
// docblock de `canActivate`). Con hashes de 64 chars hex + un number de expiración, 10k
// entradas son unos pocos cientos de KB — irrelevante para el heap de un proceso Node de API.
const MAX_TOKENS_INVALIDOS_CACHEADOS = 10_000;

type RequestConSesionMovil = FastifyRequest & { sesionMovil?: SesionMovilAutenticada };

@Injectable()
export class AuthMovilGuard implements CanActivate {
  // Caché negativa propia, en memoria, por instancia del guard (singleton en el DI de Nest,
  // así que vive todo el proceso). Ver el docblock de `canActivate` para el historial
  // completo (QUI-240, tres vueltas de code-review) de por qué NO es un guard/throttler por
  // IP como en los primeros dos intentos de este fix.
  private readonly tokensInvalidosConocidos = new Map<string, number>();

  constructor(
    @Inject(AuthMovilService) private readonly authMovilService: AuthMovilService,
    // Opcional: módulos de test sin LoggerModule siguen resolviendo el guard.
    @Optional() @Inject(PinoLogger) private readonly logger?: PinoLogger,
  ) {}

  /**
   * Historia completa (QUI-240 code-review, para que nadie repita los mismos dos intentos
   * fallidos):
   *
   * 1er intento: `POST /sync/batches` apagaba el `ThrottlerGuard` global con
   * `@SkipThrottle()` (necesario para no reventar por CGNAT — ver
   * `dispositivo-throttler.guard.ts`) y `DispositivoThrottlerGuard` corre DESPUÉS de este
   * guard, así que un Bearer ausente/inválido nunca llegaba a él. Tráfico sin sesión válida
   * quedaba SIN ningún rate limit, pagando un SHA-256 + una consulta a Postgres en
   * `validarAccessToken` por request.
   *
   * 2do intento: throttler por FALLOS de auth, keyed por IP (`ThrottlerStorage`). Bloqueaba
   * bien al atacante, pero el bloqueo se leía ANTES de intentar validar el Bearer de la
   * request actual — así que una vez que una IP agotaba el cupo, TODO chofer detrás de esa
   * IP quedaba con 429 durante la ventana, tuviera o no una sesión válida. Documentado en
   * `docs/handoff.md` que un teléfono puede quedar en bucle de refresh 401 (42 min, 29
   * intentos, 0 éxitos) sin avisarle al chofer — ese único teléfono agotaba el cupo de la IP
   * y tumbaba a TODOS los demás choferes del mismo operador/CGNAT. Inaceptable: una
   * credencial válida tiene que pasar siempre, sin importar qué hizo otro dispositivo en su
   * misma IP.
   *
   * Diseño final: caché negativa por TOKEN (no por IP, no bloqueo). Cuando
   * `validarAccessToken` confirma que un token es inválido/expirado/revocado
   * (`UnauthorizedException`), se cachea su hash. La próxima vez que llegue ESE MISMO token
   * se rechaza al toque, sin tocar Postgres. Como la clave es el token y no la IP, un chofer
   * con OTRA credencial (válida o inválida) en la misma IP nunca pisa esta caché — el bucle
   * de reintentos de un teléfono no le cuesta nada a los demás.
   *
   * Caveat aceptado y documentado (no es un bug, es el trade-off elegido): un atacante que
   * rota un token distinto en cada request nunca repite hash, así que nunca cachea y paga el
   * costo real (SHA-256 + Postgres) en cada intento — igual que ANTES de este fix. Eso es
   * aceptable: el problema que este fix ataca es el patrón real observado (reintentos con el
   * MISMO token vencido), no un atacante sofisticado con tokens ilimitados, y ese patrón
   * queda resuelto sin castigar a nadie legítimo. Un límite duro por IP para el caso de
   * rotación queda fuera de este fix a propósito — ver el 2do intento arriba.
   *
   * Solo se cachean fallos de CREDENCIAL (`UnauthorizedException` del `catch` de abajo). Un
   * error de infraestructura (Postgres caído, timeout de red) NO es culpa del token: si se
   * cacheara, un incidente breve de base bloquearía reintentos legítimos apenas el sistema
   * se recupere. Esos errores se propagan tal cual, sin tocar la caché.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestConSesionMovil>();

    const token = extraerBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }

    const hash = hashTokenOpaco(token);
    if (this.esTokenInvalidoConocido(hash)) {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }

    try {
      request.sesionMovil = await this.authMovilService.validarAccessToken(token);
      this.ligarSesionAlLog(request.sesionMovil);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.registrarTokenInvalido(hash);
      }
      throw error;
    }

    return true;
  }

  /** Solo ids opacos (sin token ni deviceId) para correlacionar los logs de la request. */
  private ligarSesionAlLog({ sesionId, vehiculoId }: SesionMovilAutenticada): void {
    try {
      this.logger?.assign({ sesionId, vehiculoId });
    } catch {
      // Fuera de contexto de request (tests/jobs): el log es best-effort.
    }
  }

  private esTokenInvalidoConocido(hash: string): boolean {
    const expiraEn = this.tokensInvalidosConocidos.get(hash);
    if (expiraEn === undefined) {
      return false;
    }
    if (Date.now() >= expiraEn) {
      // TTL vencido: no era necesario por corrección (ver comentario de
      // `TTL_TOKEN_INVALIDO_MS`), pero lo limpiamos igual para no acumular basura.
      this.tokensInvalidosConocidos.delete(hash);
      return false;
    }
    return true;
  }

  private registrarTokenInvalido(hash: string): void {
    if (
      this.tokensInvalidosConocidos.size >= MAX_TOKENS_INVALIDOS_CACHEADOS &&
      !this.tokensInvalidosConocidos.has(hash)
    ) {
      // Eviction FIFO barata: `Map` conserva orden de inserción, así que la primera clave
      // iterada es la más vieja. No es LRU estricto (no distingue "visto de nuevo" de
      // "insertado una vez"), pero para una caché defensiva de tamaño acotado alcanza — el
      // objetivo es no crecer sin límite, no una política de reemplazo óptima.
      const masAntiguo = this.tokensInvalidosConocidos.keys().next().value;
      if (masAntiguo !== undefined) {
        this.tokensInvalidosConocidos.delete(masAntiguo);
      }
    }
    this.tokensInvalidosConocidos.set(hash, Date.now() + TTL_TOKEN_INVALIDO_MS);
  }
}

function extraerBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
