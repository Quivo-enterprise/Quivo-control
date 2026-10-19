import { randomInt, randomUUID } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { Prisma, withTenantContext } from '@quivo/db';
import * as Sentry from '@sentry/node';
import {
  LineaDistintivoTipoSchema,
  TurnoSchema,
  normalizarPlacaVehiculo,
  type AuthConductorMovilRequest,
  type AuthConductorMovilResponse,
  type AuthSesionMovilRequest,
  type AuthSesionMovilResponse,
  type AuthVehiculoMovilRequest,
  type AuthVehiculoMovilResponse,
  type ContextoOperativoMovil,
  type EstablecerPinMovilRequest,
  type GenerarPinMovilResponse,
  type LogoutMovilRequest,
  type RefreshMovilRequest,
  type RefreshMovilResponse,
  type ResumenAsignacionMovil,
  type SeleccionAsignacionMovilRequest,
} from '@quivo/shared';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { fechaActualBolivia } from '../../common/tiempo/jornada.js';
import { LockoutMovilException, SesionNoVigenteException } from './auth-movil.exceptions.js';
import type { SesionMovilAutenticada } from './auth-movil.types.js';
import { emitirTokenOpaco, hashTokenOpaco } from './token-opaco.js';

const CONTEXTO_ADMIN = { rol: 'admin_quivo', sindicatoId: null } as const;
const MAX_INTENTOS_CONDUCTOR = 5;
const DUMMY_HASH_PROMISE = hashPassword('000000');
// Login de un paso (§1.f/§1.g del plan): cardinalidad máxima estructural de candidatos en
// nivel 1, garantizada por `@@unique([vehiculoId, fecha, horario])` en `Asignacion`
// (schema.prisma). El padding de tiempo siempre hace K verificaciones scrypt, reales o
// contra `DUMMY_HASH_PROMISE`, para que el tiempo de respuesta no filtre cuántos
// candidatos reales había.
const K_VERIFICACIONES_PADDING = 3;
// Tope duro de nivel 2 — scrypt es lento a propósito; comparar contra los 200-300
// choferes de un sindicato entero en un endpoint no autenticado son decenas de segundos
// de CPU. Nivel 2 nunca autentica, sólo decide si corresponde un 409 en vez de un 401.
const MAX_CANDIDATOS_NIVEL_2 = 20;
const VENTANA_NIVEL_2_DIAS_ATRAS = 30;
const VENTANA_NIVEL_2_DIAS_ADELANTE = 7;

type Tx = Prisma.TransactionClient;

type ConductorCredencial = {
  id: string;
  nombre: string;
  credencialHash: string | null;
};

type VehiculoCredencial = {
  id: string;
  sindicatoId: string;
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  numeroInterno: string | null;
  distintivo: string | null;
  cartelSuperior: string | null;
  credencialHash: string | null;
};

type AsignacionOperativa = Prisma.AsignacionGetPayload<{
  include: {
    vehiculo: true;
    conductor: true;
    rotacion: { include: { sindicato: true } };
    ruta: { include: { linea: true } };
  };
}>;

const TOPE_LOCKOUT_S = 900;
const TOPE_LOCKOUT_DISPOSITIVO_CONOCIDO_S = 60;

/** Espera tras el fallo nº `fallos` (0 si ≤ 3): min(2^(fallos-3), tope) segundos. */
function esperaLockoutSegundos(fallos: number, tope: number): number {
  return fallos > 3 ? Math.min(2 ** (fallos - 3), tope) : 0;
}

@Injectable()
export class AuthMovilService {
  private readonly logger = new Logger(AuthMovilService.name);

  async autenticarVehiculo(data: AuthVehiculoMovilRequest): Promise<AuthVehiculoMovilResponse> {
    if (!legacyAuthMovilHabilitado()) {
      throw endpointLegadoApagado();
    }
    const placaNormalizada = normalizarPlacaVehiculo(data.placa);
    const candidatos = await this.buscarVehiculosActivosPorPlaca(placaNormalizada);

    const verificaciones = await Promise.all(
      candidatos.map(async (vehiculo) => ({
        vehiculo,
        valido: await verificarCredencial(data.pin, vehiculo.credencialHash),
      })),
    );
    if (candidatos.length === 0) {
      await verificarCredencial(data.pin, await DUMMY_HASH_PROMISE);
    }
    const validos = verificaciones.filter(({ valido }) => valido);
    if (validos.length !== 1) {
      throw credencialesInvalidas();
    }

    const vehiculo = validos[0]!.vehiculo;
    const token = emitirTokenOpaco('challenge');
    const expiresAt = sumarSegundos(new Date(), ttlSegundos('MOBILE_CHALLENGE_TTL_SECONDS', 300));

    await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      await tx.desafioAuthMovil.deleteMany({
        where: {
          vehiculoId: vehiculo.id,
          OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }],
        },
      });
      await tx.desafioAuthMovil.create({
        data: {
          sindicatoId: vehiculo.sindicatoId,
          vehiculoId: vehiculo.id,
          tokenHash: token.hash,
          deviceId: data.deviceId,
          expiresAt,
        },
      });
    });

    return {
      challengeToken: token.value,
      expiresAt: expiresAt.toISOString(),
      vehiculo: {
        placa: vehiculo.placa,
        tipo: vehiculo.tipo,
        marca: vehiculo.marca,
        modelo: vehiculo.modelo,
        numeroInterno: vehiculo.numeroInterno,
        distintivo: vehiculo.distintivo,
        cartelSuperior: vehiculo.cartelSuperior,
      },
    };
  }

  async autenticarConductor(data: AuthConductorMovilRequest): Promise<AuthConductorMovilResponse> {
    if (!legacyAuthMovilHabilitado()) {
      throw endpointLegadoApagado();
    }
    const ahora = new Date();
    const desafio = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.desafioAuthMovil.findUnique({ where: { tokenHash: hashTokenOpaco(data.challengeToken) } }),
    );
    if (
      !desafio ||
      desafio.consumedAt ||
      desafio.expiresAt <= ahora ||
      desafio.deviceId !== data.deviceId ||
      desafio.intentosConductor >= MAX_INTENTOS_CONDUCTOR
    ) {
      throw credencialesInvalidas();
    }

    let conductorId = desafio.conductorId;
    if (!conductorId) {
      const documentoIdentidad = data.documentoIdentidad;
      const pin = data.pin;
      if (!documentoIdentidad || !pin) {
        throw credencialesInvalidas();
      }
      const candidatos = await withTenantContext(
        { rol: 'conductor', sindicatoId: desafio.sindicatoId },
        (tx) =>
          tx.conductor.findMany({
            where: {
              sindicatoId: desafio.sindicatoId,
              estado: 'activo',
              documentoIdentidad: { equals: documentoIdentidad.trim(), mode: 'insensitive' },
            },
            select: { id: true, credencialHash: true },
          }),
      );
      if (candidatos.length === 0) {
        await verificarCredencial(pin, await DUMMY_HASH_PROMISE);
      }
      const verificaciones = await Promise.all(
        candidatos.map(async (candidato) => ({
          id: candidato.id,
          valido: await verificarCredencial(pin, candidato.credencialHash),
        })),
      );
      const validos = verificaciones.filter(({ valido }) => valido);
      if (validos.length !== 1) {
        await this.registrarIntentoFallido(desafio.id);
        throw credencialesInvalidas();
      }
      conductorId = validos[0]!.id;
      await withTenantContext(CONTEXTO_ADMIN, (tx) =>
        tx.desafioAuthMovil.update({ where: { id: desafio.id }, data: { conductorId } }),
      );
    }

    const asignaciones = await this.buscarAsignaciones(desafio, conductorId, ahora);
    if (asignaciones.length === 0) {
      throw new NotFoundException(
        'No existe una asignación publicada vigente para este vehículo y chofer',
      );
    }

    const asignacionId = data.asignacionId;
    if (!asignacionId && asignaciones.length > 1) {
      return {
        status: 'seleccion_requerida',
        asignaciones: asignaciones.map(toResumenAsignacion),
      };
    }
    const asignacion = asignacionId
      ? asignaciones.find(({ id }) => id === asignacionId)
      : asignaciones[0];
    if (!asignacion) {
      throw new NotFoundException('Asignación no disponible');
    }

    return withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      const consumido = await tx.desafioAuthMovil.updateMany({
        where: { id: desafio.id, consumedAt: null, expiresAt: { gt: ahora } },
        data: { consumedAt: ahora },
      });
      if (consumido.count !== 1) {
        throw credencialesInvalidas();
      }
      return this.crearSesionOperativa(tx, ahora, {
        sindicatoId: desafio.sindicatoId,
        vehiculoId: desafio.vehiculoId,
        deviceId: desafio.deviceId,
        conductorId: conductorId!,
        asignacion,
      });
    });
  }

  /**
   * RESUELTO EN LA BASE (docs/plan-unicidad-placa.md) — antes había acá una DEUDA CONOCIDA:
   * la migración `20260801153000_mejora_entidad_vehiculo` dejaba a propósito
   * `placaNormalizada = NULL` en duplicados históricos, así que >1 vehículo activo por placa
   * era un estado PREVISTO (posiblemente de sindicatos distintos) y `candidatosVehiculo[0]`
   * era una elección arbitraria — el conductor del vehículo perdedor no podía loguearse, y
   * sus intentos fallidos envenenaban el lockout del vehículo del OTRO sindicato. La
   * migración `20260908151800_unicidad_placa_generada` lo cierra en el esquema, no en la
   * app: `placaNormalizada` es ahora NOT NULL con un índice único parcial que garantiza cero
   * colisiones entre filas vigentes (`estado <> 'inactivo'`). `buscarVehiculosActivosPorPlaca`
   * devuelve 0 o 1 fila por construcción, así que `candidatosVehiculo[0]` ya no es una
   * elección entre varios — es el único resultado posible.
   *
   * POST /v1/mobile/auth/sesion — login de un solo paso: placa + PIN del CONDUCTOR (no del
   * vehículo). Conserva la atribución de identidad (el producto imputa cumplimientos y
   * sanciones a una persona) sin el segundo round-trip del login legado.
   *
   * Algoritmo (plan §1.d-§1.g):
   * 1. Resolver el vehículo por placa (misma query cruda que `autenticarVehiculo`).
   * 2. Lockout POR VEHÍCULO, antes de cualquier scrypt (429 si `bloqueadoHasta` es futuro).
   * 3. Nivel 1: candidatos con asignación vigente HOY y rotación publicada (cardinalidad
   *    estructural máxima 3). Verificación con padding de tiempo a K=3 scrypt siempre.
   * 4. Si el nivel 1 no resuelve nada, nivel 2 (sólo para dar un 409 útil, nunca para
   *    autenticar): candidatos con cualquier asignación en un rango de 38 días, tope duro
   *    de 20 conductores. Ese costo scrypt es visible (no tiene padding) — ver el
   *    comentario en `verificarNivel2`.
   * 5. Con el conductor resuelto, sus asignaciones vigentes de hoy deciden entre
   *    autenticado / seleccion_requerida / 409 (sin rotación publicada).
   */
  async autenticarSesion(data: AuthSesionMovilRequest): Promise<AuthSesionMovilResponse> {
    const ahora = new Date();
    const placaNormalizada = normalizarPlacaVehiculo(data.placa);
    const candidatosVehiculo = await this.buscarVehiculosActivosPorPlaca(placaNormalizada);
    const vehiculo = candidatosVehiculo[0] ?? null;

    if (!vehiculo) {
      // Padding: el tiempo de respuesta no debe distinguir "placa desconocida" de "placa
      // conocida, PIN incorrecto" — K=3 verificaciones dummy igual que si hubiera 0
      // candidatos reales.
      await this.verificarPinConPadding(data.pin, []);
      throw credencialesInvalidasSesion();
    }

    await this.verificarLockout(vehiculo.id, data.deviceId);

    const candidatosNivel1 = await this.buscarCandidatosNivel1(vehiculo, ahora);
    const resultadosNivel1 = await this.verificarPinConPadding(
      data.pin,
      candidatosNivel1.map((c) => c.credencialHash),
    );
    const validosNivel1 = candidatosNivel1.filter((_, i) => resultadosNivel1[i]);

    let conductor: ConductorCredencial;
    if (validosNivel1.length === 1) {
      conductor = validosNivel1[0]!;
      await this.resetearIntentos(vehiculo.id);
    } else if (validosNivel1.length > 1) {
      this.reportarColisionPin(vehiculo.id, validosNivel1.length);
      await this.registrarIntentoFallidoVehiculo(vehiculo.id, vehiculo.sindicatoId);
      throw credencialesInvalidasSesion();
    } else {
      const resultadoNivel2 = await this.verificarNivel2(
        vehiculo,
        data.pin,
        ahora,
        candidatosNivel1.map((c) => c.id),
      );
      if (!resultadoNivel2) {
        await this.registrarIntentoFallidoVehiculo(vehiculo.id, vehiculo.sindicatoId);
        throw credencialesInvalidasSesion();
      }
      // El PIN es correcto (nivel 2), pero hoy no hay rotación publicada para este
      // vehículo con este conductor: es el bug real que este endpoint arregla — antes
      // este caso volvía un 401 genérico y empujaba al chofer a seguir probando PINs.
      //
      // H1 (hallazgo de revisión, alto): a propósito NO se llama `resetearIntentos` acá.
      // `buscarCandidatosNivel2` no filtra por `conductor.estado` (nivel 2 sólo decide si
      // corresponde un 409, nunca autentica), así que un EX-conductor que todavía recuerda
      // su propio PIN también cae en esta rama. Si el 409 reseteara el contador, intercalar
      // 3 PINs errados + 1 PIN de un ex-conductor (o el suyo propio en un día sin rotación)
      // volvía `fallos`/`bloqueadoHasta` a cero indefinidamente y el backoff exponencial de
      // `registrarIntentoFallidoVehiculo` nunca engancharía — quedaba solo el throttle por
      // IP de 5/60s, que bajo CGNAT (Entel/Tigo) protege poco o nada.
      //
      // Tampoco se llama `registrarIntentoFallidoVehiculo` acá: un 409 de nivel 2 prueba
      // conocimiento de UN PIN real (scrypt lo verificó), no es fuerza bruta — es el chofer
      // legítimo que se loguea un día sin rotación publicada. Sumarle un "fallo" al contador
      // penalizaría a ESE chofer (lo acerca a su propio lockout) por un caso de uso válido
      // que el propio endpoint existe para resolver. La postura correcta es neutral: ni
      // resetear (perdonaría intentos previos de fuerza bruta reales) ni sumar (castigaría
      // un login legítimo) — el contador queda exactamente donde estaba.
      throw sinRotacionPublicada(resultadoNivel2.nombre, vehiculo.placa);
    }

    const asignaciones = await this.buscarAsignaciones(
      { sindicatoId: vehiculo.sindicatoId, vehiculoId: vehiculo.id },
      conductor.id,
      ahora,
    );
    if (asignaciones.length === 0) {
      throw sinRotacionPublicada(conductor.nombre, vehiculo.placa);
    }
    if (asignaciones.length === 1) {
      return withTenantContext(CONTEXTO_ADMIN, (tx) =>
        this.crearSesionOperativa(tx, ahora, {
          sindicatoId: vehiculo.sindicatoId,
          vehiculoId: vehiculo.id,
          deviceId: data.deviceId,
          conductorId: conductor.id,
          asignacion: asignaciones[0]!,
        }),
      );
    }

    // >=2 asignaciones hoy: `DesafioAuthMovil` reciclado como `seleccionToken` (schema.prisma
    // §DesafioAuthMovil) — misma tabla que el login legado, cero migración. Cambia la
    // semántica: acá se emite DESPUÉS de probar identidad, con `conductorId` ya poblado,
    // lo que lo vuelve inofensivo como oráculo (a diferencia del `challengeToken` legado,
    // que se emitía antes de probar nada).
    const token = emitirTokenOpaco('challenge');
    const expiresAt = sumarSegundos(ahora, ttlSegundos('MOBILE_CHALLENGE_TTL_SECONDS', 300));
    // H3 (hallazgo de revisión, bajo): réplica de la poda que ya hace el legado
    // `autenticarVehiculo` (`:112-118` de este archivo) antes de crear su propio
    // `DesafioAuthMovil` — acá faltaba, y nada más en el módulo borra filas de esta tabla
    // (ni un cron, ni un `DELETE` en otro lado), así que sin esto `desafios_auth_movil` crece
    // sin límite con cada login de un paso que resulta en `seleccion_requerida` (cualquier
    // conductor con ≥2 asignaciones hoy). Misma transacción que el `create` para que podar y
    // crear sean atómicos entre sí, igual que en el legado.
    await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      await tx.desafioAuthMovil.deleteMany({
        where: {
          vehiculoId: vehiculo.id,
          OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }],
        },
      });
      await tx.desafioAuthMovil.create({
        data: {
          sindicatoId: vehiculo.sindicatoId,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          tokenHash: token.hash,
          deviceId: data.deviceId,
          expiresAt,
        },
      });
    });
    return {
      status: 'seleccion_requerida',
      seleccionToken: token.value,
      asignaciones: asignaciones.map(toResumenAsignacion),
    };
  }

  /** POST /v1/mobile/auth/sesion/asignacion — segundo request cuando `autenticarSesion`
   * devolvió `seleccion_requerida`. Consume el `DesafioAuthMovil` emitido como
   * `seleccionToken` (ya con `conductorId` poblado) y crea la sesión operativa. */
  async seleccionarAsignacion(
    data: SeleccionAsignacionMovilRequest,
  ): Promise<AuthSesionMovilResponse> {
    const ahora = new Date();
    const desafio = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.desafioAuthMovil.findUnique({ where: { tokenHash: hashTokenOpaco(data.seleccionToken) } }),
    );
    if (
      !desafio ||
      desafio.consumedAt ||
      desafio.expiresAt <= ahora ||
      desafio.deviceId !== data.deviceId ||
      !desafio.conductorId
    ) {
      throw credencialesInvalidasSesion();
    }

    const asignaciones = await this.buscarAsignaciones(
      { sindicatoId: desafio.sindicatoId, vehiculoId: desafio.vehiculoId },
      desafio.conductorId,
      ahora,
    );
    const asignacion = asignaciones.find(({ id }) => id === data.asignacionId);
    if (!asignacion) {
      throw credencialesInvalidasSesion();
    }

    return withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      const consumido = await tx.desafioAuthMovil.updateMany({
        where: { id: desafio.id, consumedAt: null, expiresAt: { gt: ahora } },
        data: { consumedAt: ahora },
      });
      if (consumido.count !== 1) {
        throw credencialesInvalidasSesion();
      }
      return this.crearSesionOperativa(tx, ahora, {
        sindicatoId: desafio.sindicatoId,
        vehiculoId: desafio.vehiculoId,
        deviceId: desafio.deviceId,
        conductorId: desafio.conductorId!,
        asignacion,
      });
    });
  }

  async validarAccessToken(accessToken: string): Promise<SesionMovilAutenticada> {
    const sesion = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.findUnique({ where: { accessTokenHash: hashTokenOpaco(accessToken) } }),
    );
    if (
      !sesion ||
      sesion.estado !== 'activa' ||
      sesion.revokedAt ||
      sesion.accessExpiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }
    return {
      sesionId: sesion.id,
      sindicatoId: sesion.sindicatoId,
      asignacionId: sesion.asignacionId,
      vehiculoId: sesion.vehiculoId,
      conductorId: sesion.conductorId,
      deviceId: sesion.deviceId,
    };
  }

  async obtenerContexto(sesionActual: SesionMovilAutenticada): Promise<ContextoOperativoMovil> {
    const sesion = await withTenantContext(
      { rol: 'conductor', sindicatoId: sesionActual.sindicatoId },
      (tx) =>
        tx.sesionOperativa.findUnique({
          where: { id: sesionActual.sesionId },
          include: includeAsignacionSesion,
        }),
    );
    if (!sesion || sesion.revokedAt || sesion.estado !== 'activa') {
      throw new UnauthorizedException('Sesión móvil inválida o expirada');
    }
    return toContextoOperativo(sesion.id, sesion.asignacion);
  }

  /**
   * Entrega 28 (`docs/plan-correccion-post-piloto-2026-09-09.md`): las dos ramas que
   * rechazan este refresh (abajo, y la del `updateMany` un poco más adelante) lanzan
   * `SesionNoVigenteException` en vez del `UnauthorizedException` genérico de antes —
   * ambas significan lo mismo desde la perspectiva del cliente: ESTE `refreshToken` ya no
   * es el que el servidor reconoce como vigente para esta sesión (no existe/ya rotó, está
   * revocada/cerrada, o venció), así que no hay nada que un reintento con el MISMO token
   * pueda arreglar. Sigue siendo 401 (compatibilidad hacia atrás intacta).
   */
  async refresh({ refreshToken }: RefreshMovilRequest): Promise<RefreshMovilResponse> {
    const ahora = new Date();
    const hashAnterior = hashTokenOpaco(refreshToken);
    const sesion = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.findUnique({ where: { refreshTokenHash: hashAnterior } }),
    );
    if (
      !sesion ||
      sesion.revokedAt ||
      sesion.estado !== 'activa' ||
      sesion.refreshExpiresAt <= ahora
    ) {
      throw new SesionNoVigenteException();
    }

    const access = emitirTokenOpaco('access');
    const refreshNuevo = emitirTokenOpaco('refresh');
    const accessTokenExpiresAt = sumarSegundos(
      ahora,
      ttlSegundos('MOBILE_ACCESS_TTL_SECONDS', 15 * 60),
    );
    const rotado = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.updateMany({
        where: { id: sesion.id, refreshTokenHash: hashAnterior, revokedAt: null, estado: 'activa' },
        data: {
          accessTokenHash: access.hash,
          refreshTokenHash: refreshNuevo.hash,
          // Hallazgo 5 (code review, SEGURIDAD): se guarda el hash que ESTA rotación deja
          // atrás — es la "prueba de posesión" que el fallback de `logout()` exige más abajo.
          // Sin esto, un `logout` con `deviceId` + cualquier string inventado cerraba la
          // sesión activa de cualquiera con solo conocer el `deviceId` (no es secreto).
          refreshTokenHashAnterior: hashAnterior,
          accessExpiresAt: accessTokenExpiresAt,
        },
      }),
    );
    if (rotado.count !== 1) {
      // Carrera: el hash coincidió en el `findUnique` de arriba pero ya no coincide en el
      // `updateMany` (otra rotación concurrente ganó, o la sesión se revocó/cerró justo en
      // el medio) — mismo significado que la rama de arriba: este `refreshToken` ya no es
      // el vigente.
      throw new SesionNoVigenteException();
    }
    return {
      accessToken: access.value,
      refreshToken: refreshNuevo.value,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: sesion.refreshExpiresAt.toISOString(),
    };
  }

  /**
   * `docs/handoff.md:3382-3385`: la prueba de QA del 2026-08-23 mostró `logout` respondiendo
   * 204 sin cerrar la sesión del servidor — el `refreshToken` que el cliente sostenía ya no
   * matcheaba ningún `refreshTokenHash`. `refresh()` (arriba) ROTA el hash en cada llamada
   * exitosa; si esa rotación se completó en el servidor pero el cliente nunca confirmó
   * recibirla (timeout, app matada a mitad de respuesta — mismo patrón de ack perdido que la
   * Entrega 1 cierra para el outbox), el cliente queda con un token "fantasma": ya inválido
   * para `refresh()` PERO la sesión sigue `'activa'` en el servidor con OTRO
   * `refreshTokenHash` vigente. Con el match exacto de antes, ese logout era un no-op
   * silencioso: dejaba la sesión zombi ensuciando `/en-vivo` para siempre, porque ningún
   * request posterior de ese dispositivo iba a traer un token que matchee.
   *
   * Hallazgo 5 (code review, SEGURIDAD — `docs/plan-correccion-post-piloto-2026-09-09.md`): el
   * fix original de arriba caía al fallback usando SOLO `deviceId`, sin exigir NADA del
   * `refreshToken` recibido. `deviceId` no es secreto (`en-vivo.service.ts`/
   * `recorridos.service.ts` lo devuelven a usuarios web) pero tampoco es un secreto de un
   * solo uso: quien lo conoce podía desloguear el mismo vehículo una y otra vez mandando
   * CUALQUIER string de 32+ caracteres como `refreshToken` — su sync pasaba a dar 401 en
   * bucle y la evidencia se acumulaba sin drenar en el teléfono de un chofer en ruta.
   *
   * Fix elegido — prueba de posesión vía historial corto de un hash (no un access token
   * válido, ver por qué más abajo): el fallback por `deviceId` ahora exige ADEMÁS que el
   * `refreshToken` recibido coincida con `refreshTokenHashAnterior` — el hash que la ÚLTIMA
   * rotación exitosa de `refresh()` dejó atrás (ver ese método, arriba). Alcanza con guardar
   * uno solo (no una tabla de historial completa): tras una rotación exitosa, el hash VIEJO
   * deja de matchear ningún `refresh()` posterior (el `where` de `refresh()` exige el hash
   * VIGENTE), así que un cliente real solo puede quedar "atascado" con, como mucho, el hash
   * inmediatamente anterior al vigente — nunca uno más viejo. Cerrar así SÍ prueba que el
   * caller alguna vez tuvo un `refreshToken` real emitido por el servidor para ESTA sesión;
   * un string inventado no matchea ni el hash vigente (primera consulta) ni el anterior
   * (fallback), así que ya no cierra nada.
   *
   * Por qué NO se eligió "exigir un access token válido (`AuthMovilGuard`)" (la otra opción
   * que el encargo deja abierta): `refresh()` rota `accessTokenHash` Y `refreshTokenHash` en
   * la MISMA fila, en el mismo `updateMany` — el escenario que este método existe para
   * cerrar es exactamente el de un cliente cuyo access token TAMBIÉN quedó fantasma tras esa
   * rotación no confirmada. Exigir un access token vigente habría dejado sin arreglar el bug
   * real de QA que este método documenta arriba, además del hallazgo de seguridad.
   *
   * Compatibilidad hacia atrás intacta: un APK viejo que manda `deviceId` pero un
   * `refreshToken` que no matchea ni el hash vigente ni el anterior sigue recibiendo 204 sin
   * que el servidor cierre nada — mismo comportamiento observable que hoy, solo que ahora es
   * el camino SEGURO, no un accidente de que el string no matcheara por casualidad. Sigue
   * siendo endpoint público (sin `AuthMovilGuard`) a propósito, igual que antes — tiene que
   * poder cerrar sesión aunque el access token ya haya vencido.
   */
  async logout({ refreshToken, deviceId }: LogoutMovilRequest): Promise<void> {
    const ahora = new Date();
    const cerradaPorToken = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.updateMany({
        where: {
          refreshTokenHash: hashTokenOpaco(refreshToken),
          estado: 'activa',
          revokedAt: null,
        },
        data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
      }),
    );
    if (cerradaPorToken.count > 0 || !deviceId) return;
    await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.updateMany({
        where: {
          deviceId,
          estado: 'activa',
          revokedAt: null,
          // Hallazgo 5: prueba de posesión — ver el docblock de arriba. Sin esto, cualquiera
          // que conociera el `deviceId` (no es secreto) cerraba la sesión con un token
          // inventado.
          refreshTokenHashAnterior: hashTokenOpaco(refreshToken),
        },
        data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
      }),
    );
  }

  async establecerPinVehiculo(
    actor: AuthenticatedUser,
    id: string,
    { pin }: EstablecerPinMovilRequest,
  ): Promise<void> {
    await this.establecerPin(actor, 'vehiculo', id, pin);
  }

  async establecerPinConductor(
    actor: AuthenticatedUser,
    id: string,
    { pin }: EstablecerPinMovilRequest,
  ): Promise<void> {
    await this.establecerPin(actor, 'conductor', id, pin);
  }

  /**
   * POST /v1/mobile/credenciales/vehiculos/:id/generar — genera un PIN de 6 dígitos con
   * CSPRNG (`crypto.randomInt`, sin sesgo de módulo) en vez de dejar que un admin elija
   * `123456`. El PIN vuelve UNA sola vez en la respuesta; el backend sólo guarda su hash
   * (misma ruta que `establecerPinVehiculo`, para heredar auditoría y revocación).
   *
   * Trampa operativa: rotar el PIN de un vehículo revoca sus sesiones activas y sus
   * desafíos sin consumir (ver `establecerPin` más abajo) — hacerlo con el vehículo en el
   * depósito, nunca a mitad de recorrido, o se corta el GPS del chofer en vivo.
   */
  async generarPinVehiculo(actor: AuthenticatedUser, id: string): Promise<GenerarPinMovilResponse> {
    const pin = generarPinCsprng();
    await this.establecerPin(actor, 'vehiculo', id, pin);
    return { pin };
  }

  /**
   * POST /v1/mobile/credenciales/conductores/:id/generar — igual que
   * `generarPinVehiculo` pero para el PIN del CONDUCTOR, que con el login de un paso pasó
   * a ser el único secreto (la placa es pública). Misma trampa operativa: rotarlo revoca
   * las sesiones activas de ese conductor — no hacerlo con el chofer en ruta.
   */
  async generarPinConductor(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<GenerarPinMovilResponse> {
    const pin = generarPinCsprng();
    await this.establecerPin(actor, 'conductor', id, pin);
    return { pin };
  }

  private async establecerPin(
    actor: AuthenticatedUser,
    entidad: 'vehiculo' | 'conductor',
    id: string,
    pin: string,
  ): Promise<void> {
    const credencialHash = await hashPassword(pin);
    const contexto = { rol: actor.rol, sindicatoId: actor.sindicatoId };
    const resultado = await withTenantContext(contexto, async (tx) => {
      const ahora = new Date();
      if (entidad === 'vehiculo') {
        const actual = await tx.vehiculo.findUnique({
          where: { id },
          select: { id: true, sindicatoId: true },
        });
        if (!actual) return null;
        await tx.vehiculo.update({ where: { id }, data: { credencialHash } });
        const desafios = await tx.desafioAuthMovil.updateMany({
          where: { vehiculoId: id, consumedAt: null },
          data: { consumedAt: ahora },
        });
        const sesiones = await tx.sesionOperativa.updateMany({
          where: { vehiculoId: id, estado: 'activa', revokedAt: null },
          data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
        });
        await registrarAuditoriaCredencial(tx, actor, entidad, id, actual.sindicatoId, {
          desafiosInvalidados: desafios.count,
          sesionesRevocadas: sesiones.count,
        });
        return actual;
      }
      const actual = await tx.conductor.findUnique({
        where: { id },
        select: { id: true, sindicatoId: true },
      });
      if (!actual) return null;
      await tx.conductor.update({ where: { id }, data: { credencialHash } });
      const desafios = await tx.desafioAuthMovil.updateMany({
        where: { conductorId: id, consumedAt: null },
        data: { consumedAt: ahora },
      });
      const sesiones = await tx.sesionOperativa.updateMany({
        where: { conductorId: id, estado: 'activa', revokedAt: null },
        data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
      });
      await registrarAuditoriaCredencial(tx, actor, entidad, id, actual.sindicatoId, {
        desafiosInvalidados: desafios.count,
        sesionesRevocadas: sesiones.count,
      });
      return actual;
    });
    if (!resultado) {
      throw new NotFoundException(
        entidad === 'vehiculo' ? 'Vehículo no encontrado' : 'Conductor no encontrado',
      );
    }
  }

  private async registrarIntentoFallido(desafioId: string): Promise<void> {
    await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      const actual = await tx.desafioAuthMovil.findUnique({ where: { id: desafioId } });
      if (!actual || actual.consumedAt) return;
      const intentosConductor = actual.intentosConductor + 1;
      await tx.desafioAuthMovil.update({
        where: { id: desafioId },
        data: {
          intentosConductor,
          consumedAt: intentosConductor >= MAX_INTENTOS_CONDUCTOR ? new Date() : undefined,
        },
      });
    });
  }

  private buscarAsignaciones(
    desafio: { sindicatoId: string; vehiculoId: string },
    conductorId: string,
    ahora: Date,
  ): Promise<AsignacionOperativa[]> {
    return withTenantContext({ rol: 'conductor', sindicatoId: desafio.sindicatoId }, (tx) =>
      tx.asignacion.findMany({
        where: {
          vehiculoId: desafio.vehiculoId,
          conductorId,
          fecha: fechaActualBolivia(ahora),
          estado: 'vigente',
          venceAt: { gt: ahora },
          rotacion: { sindicatoId: desafio.sindicatoId, estado: 'publicada' },
        },
        include: includeAsignacion,
        orderBy: [{ orden: 'asc' }, { horario: 'asc' }],
      }),
    );
  }

  /** Unicidad de placa (docs/plan-unicidad-placa.md): `placaNormalizada` es ahora una
   * columna GENERATED ALWAYS por Postgres, NOT NULL, con un índice único parcial que
   * garantiza cero colisiones entre filas VIGENTES (`estado <> 'inactivo'`, ver migración
   * `20260908151800_unicidad_placa_generada`). Como `activo` es un subconjunto de "vigente",
   * `WHERE estado = 'activo' AND placaNormalizada = $1` devuelve 0 o 1 fila POR
   * CONSTRUCCIÓN — ya no hace falta el `$queryRaw` con la rama de fallback para
   * `placaNormalizada IS NULL` (ese NULL ya no puede existir) ni el `ORDER BY` de
   * desempate (no hay nada que desempatar). `autenticarVehiculo` (legado) sigue
   * necesitando el array completo para su chequeo de "exactamente 1", que ahora es
   * trivialmente cierto. Se envuelve el resultado de `findFirst` en un array de 0 o 1 para
   * no tocar la firma que consumen ambos callers. */
  private async buscarVehiculosActivosPorPlaca(
    placaNormalizada: string,
  ): Promise<VehiculoCredencial[]> {
    const vehiculo = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.vehiculo.findFirst({
        where: { estado: 'activo', placaNormalizada },
        select: {
          id: true,
          sindicatoId: true,
          placa: true,
          tipo: true,
          marca: true,
          modelo: true,
          numeroInterno: true,
          distintivo: true,
          cartelSuperior: true,
          credencialHash: true,
        },
      }),
    );
    return vehiculo ? [vehiculo] : [];
  }

  /** Nivel 1 del login de un paso (plan §1.e): conductores DISTINTOS con asignación
   * vigente hoy y rotación publicada. Cardinalidad máxima estructural 3, garantizada por
   * `@@unique([vehiculoId, fecha, horario])` en `Asignacion`. */
  private async buscarCandidatosNivel1(
    vehiculo: VehiculoCredencial,
    ahora: Date,
  ): Promise<ConductorCredencial[]> {
    const filas = await withTenantContext(
      { rol: 'conductor', sindicatoId: vehiculo.sindicatoId },
      (tx) =>
        tx.asignacion.findMany({
          where: {
            vehiculoId: vehiculo.id,
            fecha: fechaActualBolivia(ahora),
            estado: 'vigente',
            venceAt: { gt: ahora },
            conductorId: { not: null },
            rotacion: { sindicatoId: vehiculo.sindicatoId, estado: 'publicada' },
            conductor: { estado: 'activo' },
          },
          select: { conductor: { select: { id: true, nombre: true, credencialHash: true } } },
        }),
    );
    return dedupeConductores(filas.map((fila) => fila.conductor));
  }

  /** Nivel 2 (plan §1.e.2): SÓLO corre si el nivel 1 no matcheó nada, y SÓLO sirve para
   * decidir si corresponde un 409 en vez de un 401 — nunca autentica. Tope duro de 20
   * conductores distintos, excluyendo a los ya probados en el nivel 1. Sin padding de
   * tiempo: el plan documenta esta limitación explícitamente (§1.g.3) en vez de fingir
   * que no existe — su costo (hasta 20 scrypt) sólo es visible cuando el nivel 1 falló,
   * que ya es una señal más débil que "la placa existe" para un atacante. */
  private async buscarCandidatosNivel2(
    vehiculo: VehiculoCredencial,
    ahora: Date,
    excluir: string[],
  ): Promise<ConductorCredencial[]> {
    const hoy = fechaActualBolivia(ahora);
    const desde = new Date(hoy);
    desde.setUTCDate(desde.getUTCDate() - VENTANA_NIVEL_2_DIAS_ATRAS);
    const hasta = new Date(hoy);
    hasta.setUTCDate(hasta.getUTCDate() + VENTANA_NIVEL_2_DIAS_ADELANTE);

    const filas = await withTenantContext(
      { rol: 'conductor', sindicatoId: vehiculo.sindicatoId },
      (tx) =>
        tx.asignacion.findMany({
          where: {
            vehiculoId: vehiculo.id,
            fecha: { gte: desde, lte: hasta },
            conductorId: { not: null },
          },
          select: { conductor: { select: { id: true, nombre: true, credencialHash: true } } },
          orderBy: { fecha: 'desc' },
        }),
    );
    const excluidos = new Set(excluir);
    const vistos = new Map<string, ConductorCredencial>();
    for (const fila of filas) {
      const conductor = fila.conductor;
      if (!conductor || excluidos.has(conductor.id) || vistos.has(conductor.id)) continue;
      vistos.set(conductor.id, conductor);
      if (vistos.size >= MAX_CANDIDATOS_NIVEL_2) break;
    }
    return [...vistos.values()];
  }

  private async verificarNivel2(
    vehiculo: VehiculoCredencial,
    pin: string,
    ahora: Date,
    excluirIds: string[],
  ): Promise<{ id: string; nombre: string } | null> {
    const candidatos = await this.buscarCandidatosNivel2(vehiculo, ahora, excluirIds);
    const resultados = await Promise.all(
      candidatos.map((candidato) => verificarCredencial(pin, candidato.credencialHash)),
    );
    const validos = candidatos.filter((_, i) => resultados[i]);
    if (validos.length === 0) {
      return null;
    }
    if (validos.length > 1) {
      this.reportarColisionPin(vehiculo.id, validos.length);
      return null;
    }
    return validos[0]!;
  }

  /** Padding de tiempo (plan §1.g.3): siempre hace K=3 verificaciones scrypt, reales o
   * contra `DUMMY_HASH_PROMISE`, en paralelo — sin esto, el tiempo de respuesta del nivel
   * 1 filtra si el vehículo tiene 0, 1, 2 o 3 candidatos (o sea, si tiene rotación
   * publicada hoy) antes de tocar el PIN siquiera. */
  private async verificarPinConPadding(pin: string, hashes: (string | null)[]): Promise<boolean[]> {
    const dummies = Math.max(K_VERIFICACIONES_PADDING - hashes.length, 0);
    const [resultados] = await Promise.all([
      Promise.all(hashes.map((hash) => verificarCredencial(pin, hash))),
      Promise.all(Array.from({ length: dummies }, () => verificarCredencial(pin, null))),
    ]);
    return resultados;
  }

  /** Un `deviceId` que ya tuvo una sesión EXITOSA con este vehículo conserva el tope previo de
   * 60 s en vez de la espera de hasta 900 s: quien solo conoce la placa (pintada en la puerta)
   * no puede dejar afuera al chofer más de 60 s. NO queda exento: el `deviceId` lo ven los roles
   * de panel (`GET /reportes/en-vivo`, `/posiciones`, `/:sesionId/contexto`), así que un
   * operador podría copiarlo y forzar el PIN sin espera. Solo se consulta con lockout activo.
   * Usa `[vehiculoId, estado]`. */
  private async dispositivoConocido(vehiculoId: string, deviceId: string): Promise<boolean> {
    const sesion = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.sesionOperativa.findFirst({ where: { vehiculoId, deviceId }, select: { id: true } }),
    );
    return sesion !== null;
  }

  private async verificarLockout(vehiculoId: string, deviceId: string): Promise<void> {
    const intento = await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.intentoAuthMovil.findUnique({ where: { vehiculoId } }),
    );
    const ahora = new Date();
    if (intento?.bloqueadoHasta && intento.bloqueadoHasta > ahora) {
      let hasta = intento.bloqueadoHasta;
      if (await this.dispositivoConocido(vehiculoId, deviceId)) {
        // `updatedAt` = instante del último fallo; misma curva que antes, con tope 60 s.
        hasta = sumarSegundos(
          intento.updatedAt,
          esperaLockoutSegundos(intento.fallos, TOPE_LOCKOUT_DISPOSITIVO_CONOCIDO_S),
        );
        if (hasta <= ahora) return;
      }
      const retryAfterSeconds = Math.ceil((hasta.getTime() - ahora.getTime()) / 1_000);
      throw new LockoutMovilException(retryAfterSeconds);
    }
  }

  /** Retraso exponencial, no bloqueo duro (plan §1.g.2): la placa está pintada en la
   * puerta del vehículo, así que un bloqueo duro es un botón de "dejá a este trufi sin
   * GPS" que cualquiera aprieta. `retryAfterSeconds = min(2^(fallos-3), 900)` (`esperaLockoutSegundos`) desde el
   * tercer fallo — antes de eso no hay espera. */
  /**
   * H2 (hallazgo de revisión, bajo): antes esto era `tx.intentoAuthMovil.upsert(...)`.
   * Prisma NO traduce ese upsert a un `INSERT ... ON CONFLICT` atómico de un solo statement
   * — internamente hace SELECT y decide create/update en la aplicación, en dos round-trips
   * separados. Dos requests simultáneos con PIN incorrecto para el MISMO vehículo sin fila
   * previa en `intentos_auth_movil` (el caso común: el primer PIN fallido de ese vehículo)
   * pueden correr ambos la rama `create`; el segundo en llegar viola el índice único
   * `intentos_auth_movil_vehiculo_key` (P2002 de Prisma) y ese error no está mapeado a nada
   * en este módulo, así que Nest lo deja subir como 500 — justo en el endpoint de login,
   * bajo la concurrencia más probable de todas (dos requests fallidos casi simultáneos para
   * el mismo vehículo), en vez del 401 que el cliente espera.
   *
   * Fix elegido: `INSERT ... ON CONFLICT ("vehiculoId") DO UPDATE` vía `$queryRaw`, que
   * Postgres resuelve de forma atómica a nivel de fila (sin el hueco entre SELECT y
   * create/update que tiene el upsert de Prisma). Se prefiere sobre "capturar P2002 y
   * reintentar el update" porque esa alternativa sigue teniendo DOS statements con una
   * ventana entre medio (más chica, pero no cero) y necesita lógica de reintento a mano;
   * `ON CONFLICT` es una sola ida a la base y la atomicidad la garantiza el motor, no el
   * código de la app. `id` y `updatedAt` se generan acá porque la tabla no tiene default de
   * DB para ninguno de los dos (ver `migration.sql` de
   * `20260907100000_intento_auth_movil`) — el `upsert` normal de Prisma los rellena
   * client-side, pero `$queryRaw` no pasa por esa capa. `RETURNING fallos` evita una lectura
   * extra para decidir si corresponde el backoff de abajo.
   */
  private async registrarIntentoFallidoVehiculo(
    vehiculoId: string,
    sindicatoId: string,
  ): Promise<void> {
    await withTenantContext(CONTEXTO_ADMIN, async (tx) => {
      const ahora = new Date();
      const [actualizado] = await tx.$queryRaw<{ fallos: number }[]>`
        INSERT INTO intentos_auth_movil (id, "sindicatoId", "vehiculoId", fallos, "updatedAt")
        VALUES (${randomUUID()}, ${sindicatoId}, ${vehiculoId}, 1, ${ahora})
        ON CONFLICT ("vehiculoId")
        DO UPDATE SET fallos = intentos_auth_movil.fallos + 1, "updatedAt" = ${ahora}
        RETURNING fallos
      `;
      if (!actualizado || actualizado.fallos <= 3) {
        return;
      }
      const esperaSegundos = esperaLockoutSegundos(actualizado.fallos, TOPE_LOCKOUT_S);
      await tx.intentoAuthMovil.update({
        where: { vehiculoId },
        data: { bloqueadoHasta: sumarSegundos(new Date(), esperaSegundos) },
      });
    });
  }

  /** Reset del lockout en el primer éxito (plan §1.g.2/§1.d). "Éxito" acá es un PIN
   * verificado como correcto (nivel 1 con exactamente 1 candidato, o nivel 2 con
   * exactamente 1) — no depende de si además hay una asignación vigente hoy: un PIN
   * correcto sin rotación publicada (409) es una credencial legítima, no un intento de
   * fuerza bruta, y no debería seguir empujando el contador de fallos. */
  private async resetearIntentos(vehiculoId: string): Promise<void> {
    await withTenantContext(CONTEXTO_ADMIN, (tx) =>
      tx.intentoAuthMovil.updateMany({
        where: { vehiculoId },
        data: { fallos: 0, bloqueadoHasta: null },
      }),
    );
  }

  /** >1 PIN válido simultáneo (plan §1.f): con 3 candidatos estructurales y PIN de 6
   * dígitos la probabilidad es ~3×10⁻⁶ por vehículo-día — si ocurre, es señal de PINs no
   * aleatorios (o de que alguien no rotó los PINs generados por CSPRNG). No hay un
   * wrapper de Sentry en este módulo; se importa `@sentry/node` directo, igual que
   * `main.ts`/`worker.ts` — `captureMessage` es un no-op seguro si `Sentry.init` nunca
   * corrió (sin `SENTRY_DSN`), así que el `Logger` de Nest queda como respaldo que no
   * depende de esa configuración. */
  private reportarColisionPin(vehiculoId: string, coincidencias: number): void {
    this.logger.error(
      `Colisión de PIN en login móvil de un paso: vehiculoId=${vehiculoId} coincidencias=${coincidencias}`,
    );
    Sentry.captureMessage('auth-movil: colisión de PIN en login de un paso', {
      level: 'error',
      tags: { vehiculoId },
      extra: { vehiculoId, coincidencias },
    });
  }

  /** Lógica de creación de sesión compartida por las tres rutas de login (legado
   * `autenticarConductor`, `autenticarSesion` y `seleccionarAsignacion`). Debe correr
   * DENTRO de la misma transacción que consumió el desafío/challenge del llamador (si
   * corresponde) para que el cierre de sesiones previas y la creación de la nueva sean
   * atómicos con esa consumición. */
  private async crearSesionOperativa(
    tx: Tx,
    ahora: Date,
    params: {
      sindicatoId: string;
      vehiculoId: string;
      deviceId: string;
      conductorId: string;
      asignacion: AsignacionOperativa;
    },
  ): Promise<Extract<AuthSesionMovilResponse, { status: 'autenticado' }>> {
    const access = emitirTokenOpaco('access');
    const refresh = emitirTokenOpaco('refresh');
    const accessTokenExpiresAt = sumarSegundos(
      ahora,
      ttlSegundos('MOBILE_ACCESS_TTL_SECONDS', 15 * 60),
    );
    const refreshTokenExpiresAt = sumarSegundos(
      ahora,
      ttlSegundos('MOBILE_REFRESH_TTL_SECONDS', 30 * 24 * 60 * 60),
    );

    // Plan §2.4.5 ("sesiones colgadas"): cierra las sesiones ACTIVAS previas del MISMO
    // vehículo, sin importar el dispositivo — no solo las del mismo `deviceId` como antes.
    // Producción tuvo 3 sesiones activas simultáneas del mismo vehículo en DOS
    // dispositivos: el filtro por `deviceId` nunca las alcanzaba porque cada login venía
    // de un `deviceId` distinto. Se mantiene también la condición por `deviceId` (con
    // `OR`) para no perder la cobertura original — un mismo dispositivo reutilizado para
    // OTRO vehículo tampoco debe dejar una sesión huérfana.
    //
    // M1 (hallazgo de revisión, medio): `sindicatoId: params.sindicatoId` FUERA del `OR`,
    // no dentro. Esto corre bajo `CONTEXTO_ADMIN` (RLS bypasseada) — la rama `vehiculoId` es
    // segura por sí sola (UUID PK de un solo sindicato), pero `deviceId` lo controla el
    // CLIENTE y llega tal cual en el request: sin este scoping, alguien autenticado en el
    // sindicato A puede mandar el `deviceId` de un dispositivo real del sindicato B (que
    // puede observar o adivinar) y cerrarle la sesión operativa VIVA a un vehículo ajeno,
    // cortando la evidencia del turno de otro sindicato.
    //
    // Impacto a tener presente (plan §1.g, riesgo abierto): esto revoca la sesión previa
    // del vehículo, así que un PIN adivinado no sólo suplanta — deja al chofer real sin
    // sesión y sin GPS. Es la razón de las compensaciones de lockout/padding de arriba.
    await tx.sesionOperativa.updateMany({
      where: {
        estado: 'activa',
        revokedAt: null,
        sindicatoId: params.sindicatoId,
        OR: [{ vehiculoId: params.vehiculoId }, { deviceId: params.deviceId }],
      },
      data: { estado: 'cerrada', fin: ahora, revokedAt: ahora },
    });
    const sesion = await tx.sesionOperativa.create({
      data: {
        sindicatoId: params.sindicatoId,
        asignacionId: params.asignacion.id,
        vehiculoId: params.vehiculoId,
        conductorId: params.conductorId,
        deviceId: params.deviceId,
        accessTokenHash: access.hash,
        refreshTokenHash: refresh.hash,
        accessExpiresAt: accessTokenExpiresAt,
        refreshExpiresAt: refreshTokenExpiresAt,
      },
    });

    return {
      status: 'autenticado',
      accessToken: access.value,
      refreshToken: refresh.value,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
      contexto: toContextoOperativo(sesion.id, params.asignacion),
    };
  }
}

async function registrarAuditoriaCredencial(
  tx: Tx,
  actor: AuthenticatedUser,
  entidad: 'vehiculo' | 'conductor',
  entidadId: string,
  sindicatoId: string,
  conteos: { desafiosInvalidados: number; sesionesRevocadas: number },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      sindicatoId,
      usuarioId: actor.userId,
      entidad,
      entidadId,
      accion: 'actualizar_credencial_movil',
      diff: conteos,
    },
  });
}

const includeAsignacion = {
  vehiculo: true,
  conductor: true,
  rotacion: { include: { sindicato: true } },
  ruta: { include: { linea: true } },
} as const;

const includeAsignacionSesion = { asignacion: { include: includeAsignacion } } as const;

function toResumenAsignacion(row: AsignacionOperativa): ResumenAsignacionMovil {
  return {
    id: row.id,
    fecha: fechaISO(row.fecha),
    horario: TurnoSchema.parse(row.horario),
    horaSalida: row.horaSalida?.toISOString() ?? null,
    horaPresentacion: row.horaPresentacion?.toISOString() ?? null,
    venceAt: row.venceAt.toISOString(),
    linea: {
      codigo: row.ruta.linea.codigo,
      nombre: row.ruta.linea.nombre,
      color: row.ruta.linea.color,
      colorSecundario: row.ruta.linea.colorSecundario,
      colorTexto: row.ruta.linea.colorTexto,
      colorTerciario: row.ruta.linea.colorTerciario,
      colorFondo: row.ruta.linea.colorFondo,
      nombreCorto: row.ruta.linea.nombreCorto,
      lema: row.ruta.linea.lema,
      logoUrl: row.ruta.linea.logoUrl,
      distintivoTipo: LineaDistintivoTipoSchema.nullable().parse(row.ruta.linea.distintivoTipo),
      distintivoValor: row.ruta.linea.distintivoValor,
      cartelSuperior: row.ruta.linea.cartelSuperior,
    },
    ruta: { sentido: row.ruta.sentido },
  };
}

function toContextoOperativo(sesionId: string, row: AsignacionOperativa): ContextoOperativoMovil {
  if (!row.conductor) {
    throw new NotFoundException('La asignación no tiene un conductor');
  }
  return {
    sesionId,
    asignacion: {
      id: row.id,
      fecha: fechaISO(row.fecha),
      horario: TurnoSchema.parse(row.horario),
      horaSalida: row.horaSalida?.toISOString() ?? null,
      horaPresentacion: row.horaPresentacion?.toISOString() ?? null,
      venceAt: row.venceAt.toISOString(),
    },
    vehiculo: {
      id: row.vehiculo.id,
      placa: row.vehiculo.placa,
      tipo: row.vehiculo.tipo,
      marca: row.vehiculo.marca,
      modelo: row.vehiculo.modelo,
      numeroInterno: row.vehiculo.numeroInterno,
      distintivo: row.vehiculo.distintivo,
      cartelSuperior: row.vehiculo.cartelSuperior,
    },
    conductor: {
      id: row.conductor.id,
      nombre: row.conductor.nombre,
      documentoIdentidad: row.conductor.documentoIdentidad,
    },
    sindicato: { id: row.rotacion.sindicato.id, nombre: row.rotacion.sindicato.nombre },
    linea: {
      id: row.ruta.linea.id,
      codigo: row.ruta.linea.codigo,
      nombre: row.ruta.linea.nombre,
      color: row.ruta.linea.color,
      colorSecundario: row.ruta.linea.colorSecundario,
      colorTexto: row.ruta.linea.colorTexto,
      colorTerciario: row.ruta.linea.colorTerciario,
      colorFondo: row.ruta.linea.colorFondo,
      nombreCorto: row.ruta.linea.nombreCorto,
      lema: row.ruta.linea.lema,
      logoUrl: row.ruta.linea.logoUrl,
      distintivoTipo: LineaDistintivoTipoSchema.nullable().parse(row.ruta.linea.distintivoTipo),
      distintivoValor: row.ruta.linea.distintivoValor,
      cartelSuperior: row.ruta.linea.cartelSuperior,
    },
    ruta: { id: row.ruta.id, sentido: row.ruta.sentido },
  };
}

async function verificarCredencial(pin: string, hash: string | null): Promise<boolean> {
  const hashVerificable = hash ?? (await DUMMY_HASH_PROMISE);
  try {
    const valido = await verifyPassword({ password: pin, hash: hashVerificable });
    return hash ? valido : false;
  } catch {
    return false;
  }
}

function credencialesInvalidas(): UnauthorizedException {
  return new UnauthorizedException('Credenciales inválidas');
}

/** Mensaje genérico del login de un paso (plan §1.d): cubre placa desconocida, ningún PIN
 * coincide, y más de un PIN coincide — nunca distingue cuál de los tres pasó. */
function credencialesInvalidasSesion(): UnauthorizedException {
  return new UnauthorizedException('Placa o PIN incorrectos');
}

/** 409 — PIN correcto, sin asignación vigente hoy (plan §1.d/§1.e.2). Es el bug real que
 * el login de un paso arregla: antes esto volvía un 401 genérico y el chofer se ponía a
 * probar PINs. Mensaje unificado entre el "sin asignación tras nivel 1" y el "nivel 2
 * matcheó, pero sin rotación publicada". */
function sinRotacionPublicada(nombreConductor: string, placa: string): ConflictException {
  return new ConflictException(
    `${nombreConductor}, hoy no tenés una rotación publicada para ${placa}`,
  );
}

function endpointLegadoApagado(): GoneException {
  return new GoneException(
    'Este endpoint fue reemplazado por POST /v1/mobile/auth/sesion (login de un paso).',
  );
}

/** Default apagado: solo se habilita con `MOBILE_LEGACY_AUTH_ENABLED=true` explícito (los
 * teléfonos en la calle usan `/sesion`; las sesiones viejas se restauran por refresh token). */
function legacyAuthMovilHabilitado(): boolean {
  return process.env.MOBILE_LEGACY_AUTH_ENABLED === 'true';
}

/** PIN de 6 dígitos con CSPRNG (plan §1.f/ítem 3): `crypto.randomInt` hace rechazo interno
 * de muestras fuera de rango, así que no hay sesgo de módulo como con
 * `Math.random() % 10`. Reemplaza al PIN elegido a mano por un admin (hoy puede ser
 * '123456' o '000000'), del que depende el cálculo de colisión de PIN de nivel 1. */
function generarPinCsprng(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function dedupeConductores(conductores: (ConductorCredencial | null)[]): ConductorCredencial[] {
  const vistos = new Map<string, ConductorCredencial>();
  for (const conductor of conductores) {
    if (conductor && !vistos.has(conductor.id)) {
      vistos.set(conductor.id, conductor);
    }
  }
  return [...vistos.values()];
}

function ttlSegundos(nombre: string, valorPorDefecto: number): number {
  const valor = Number(process.env[nombre] ?? valorPorDefecto);
  return Number.isSafeInteger(valor) && valor > 0 ? valor : valorPorDefecto;
}

function sumarSegundos(fecha: Date, segundos: number): Date {
  return new Date(fecha.getTime() + segundos * 1_000);
}

function fechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
