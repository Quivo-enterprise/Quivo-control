import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '@quivo/db';
import type { Prisma as PrismaTypes } from '@quivo/db';
import { UMBRAL_VECINO_FRESCO_MS } from '@quivo/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fechaActualBolivia } from '../../common/tiempo/jornada.js';
import type { SesionMovilAutenticada } from '../auth-movil/auth-movil.types.js';
import { VecinosRutaService } from './vecinos-ruta.service.js';

const MINUTO = 60_000;

/** Mediodía UTC de hoy: reloj determinista, y su jornada boliviana es la de hoy. */
const AHORA = (() => {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 12));
})();
const JORNADA = fechaActualBolivia(AHORA).toISOString().slice(0, 10);

/** Ruta recta oeste→este (~916 m): el sentido de avance es lng creciente. */
const LAT = -34.6;
const LNG_INICIO = -58.4;
const LNG_FIN = -58.39;
const RECTA = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [LNG_INICIO, LAT],
    [LNG_FIN, LAT],
  ],
});
/**
 * Ruta CIRCULAR: un anillo cuyo último vértice coincide con el primero (inicio ≈ fin).
 * Cuadrado de ~0.002° de lado, ~890 m de perímetro.
 */
const CIRCULAR = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.398, -34.6],
    [-58.398, -34.602],
    [-58.4, -34.602],
    [-58.4, -34.6],
  ],
});

describe('VecinosRutaService (contra Postgres + PostGIS)', () => {
  const service = new VecinosRutaService();
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let rotacionAId: string;
  let rotacionBId: string;
  let lineaAId: string;
  let rutaId: string;
  let rutaOpuestaId: string;
  let rutaCircularId: string;
  const sesionesCreadas: string[] = [];
  let seq = 0;

  interface SpecSesion {
    sindicatoId?: string;
    rutaId?: string;
    placa: string;
    recorridoEstado?: string | null;
    /** Sesión de login cerrada/revocada (logout): deja `recorridoEstado` en 'en_curso'. */
    cerrada?: boolean;
    /** `null` ⇒ sin fila de resumen (sin posición). */
    pos?: { lng: number; lat: number } | null;
    edadFixMs?: number;
  }

  /** Crea vehículo+conductor+asignación+sesión (+resumen GPS) y devuelve la sesión móvil. */
  async function crearSesion(spec: SpecSesion): Promise<SesionMovilAutenticada> {
    const sindicatoId = spec.sindicatoId ?? sindicatoAId;
    const ruta = spec.rutaId ?? rutaId;
    const n = ++seq;
    return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const vehiculo = await tx.vehiculo.create({
        data: {
          sindicatoId,
          placa: spec.placa,
          numeroInterno: `#${n}`,
          tipo: 'bus',
          marca: 'Toyota',
          modelo: 'Coaster',
          color: 'blanco',
          colorSecundario: 'azul',
          capacidad: 20,
          estado: 'activo',
        },
      });
      const conductor = await tx.conductor.create({
        data: {
          sindicatoId,
          nombre: `Conductor Secreto ${n}`,
          documentoIdentidad: `VR-${randomUUID()}`,
          licenciaConducir: 'LIC',
        },
      });
      const asignacion = await tx.asignacion.create({
        data: {
          rotacionId: sindicatoId === sindicatoAId ? rotacionAId : rotacionBId,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          rutaId: ruta,
          fecha: AHORA,
          horario: 'manana',
          orden: n,
          venceAt: new Date(AHORA.getTime() + 60 * MINUTO),
          estado: 'vigente',
        },
      });
      const sesion = await tx.sesionOperativa.create({
        data: {
          sindicatoId,
          asignacionId: asignacion.id,
          vehiculoId: vehiculo.id,
          conductorId: conductor.id,
          deviceId: `dev-vr-${n}`,
          inicio: new Date(AHORA.getTime() - 60 * MINUTO),
          estado: spec.cerrada ? 'cerrada' : 'activa',
          fin: spec.cerrada ? AHORA : null,
          revokedAt: spec.cerrada ? AHORA : null,
          recorridoEstado: spec.recorridoEstado === undefined ? 'en_curso' : spec.recorridoEstado,
          accessTokenHash: randomUUID(),
          refreshTokenHash: randomUUID(),
          accessExpiresAt: new Date(AHORA.getTime() + 60 * MINUTO),
          refreshExpiresAt: new Date(AHORA.getTime() + 60 * MINUTO),
        },
      });
      sesionesCreadas.push(sesion.id);
      if (spec.pos !== null) {
        const pos = spec.pos ?? { lng: LNG_INICIO, lat: LAT };
        const ts = new Date(AHORA.getTime() - (spec.edadFixMs ?? 30_000));
        await insertarResumen(tx, sesion.id, sindicatoId, pos, ts);
      }
      return {
        sesionId: sesion.id,
        sindicatoId,
        asignacionId: asignacion.id,
        vehiculoId: vehiculo.id,
        conductorId: conductor.id,
        deviceId: `dev-vr-${n}`,
      };
    });
  }

  async function insertarResumen(
    tx: PrismaTypes.TransactionClient,
    sesionId: string,
    sindicatoId: string,
    pos: { lng: number; lat: number },
    ts: Date,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO gps_sesion_resumen
        (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
      VALUES (${sesionId}::uuid, ${JORNADA}::date, ${sindicatoId}, 1, ${ts}::timestamptz, ${ts}::timestamptz, ${pos.lat}, ${pos.lng}, 5, 8, now())
      ON CONFLICT (sesion_id, jornada, "sindicatoId") DO UPDATE SET
        ultimo_fix_ts = EXCLUDED.ultimo_fix_ts, lat = EXCLUDED.lat, lng = EXCLUDED.lng
    `;
  }

  async function crearRuta(lineaId: string, sentido: string, geojson: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
        VALUES (${id}, ${lineaId}, ${sentido}, ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)::geography, 'activo', now(), now())
      `;
    });
    return id;
  }

  beforeAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({
        data: { id: sindicatoAId, nombre: 'VR Test A', estado: 'activo' },
      });
      await tx.sindicato.create({
        data: { id: sindicatoBId, nombre: 'VR Test B', estado: 'activo' },
      });
      const linea = await tx.linea.create({
        data: { sindicatoId: sindicatoAId, codigo: 'VR1', nombre: 'Línea VR', color: '#FD9E15' },
      });
      lineaAId = linea.id;
      rotacionAId = (
        await tx.rotacion.create({
          data: { sindicatoId: sindicatoAId, periodo: '2026-10', estado: 'publicada' },
        })
      ).id;
      rotacionBId = (
        await tx.rotacion.create({
          data: { sindicatoId: sindicatoBId, periodo: '2026-10', estado: 'publicada' },
        })
      ).id;
    });
    rutaId = await crearRuta(lineaAId, 'ida', RECTA);
    rutaOpuestaId = await crearRuta(lineaAId, 'vuelta', RECTA);
    rutaCircularId = await crearRuta(lineaAId, 'circular', CIRCULAR);
  });

  beforeEach(() => {
    service.limpiarCache();
  });

  // Aislamiento: cada test siembra sus propios vehículos sobre la MISMA ruta, así que se
  // borran al terminar (si no, las aserciones "nadie delante/detrás" verían a los de antes).
  afterEach(async () => {
    await limpiarFixtures();
  });

  async function limpiarFixtures(): Promise<void> {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.$executeRaw`DELETE FROM gps_sesion_resumen WHERE "sindicatoId" IN (${sindicatoAId}, ${sindicatoBId})`;
      await tx.sesionOperativa.deleteMany({
        where: { sindicatoId: { in: [sindicatoAId, sindicatoBId] } },
      });
      await tx.asignacion.deleteMany({
        where: { rutaId: { in: [rutaId, rutaOpuestaId, rutaCircularId] } },
      });
      await tx.vehiculo.deleteMany({
        where: { sindicatoId: { in: [sindicatoAId, sindicatoBId] } },
      });
      await tx.conductor.deleteMany({
        where: { sindicatoId: { in: [sindicatoAId, sindicatoBId] } },
      });
    });
  }

  afterAll(async () => {
    await limpiarFixtures();
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.rotacion.deleteMany({
        where: { sindicatoId: { in: [sindicatoAId, sindicatoBId] } },
      });
      await tx.vehiculo.deleteMany({
        where: { sindicatoId: { in: [sindicatoAId, sindicatoBId] } },
      });
      await tx.conductor.deleteMany({
        where: { sindicatoId: { in: [sindicatoAId, sindicatoBId] } },
      });
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaId}, ${rutaOpuestaId}, ${rutaCircularId})`;
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoAId } });
      await tx.sindicato.deleteMany({ where: { id: { in: [sindicatoAId, sindicatoBId] } } });
    });
    await prisma.$disconnect();
  });

  // Posiciones sobre la recta (frac ≈ (lng - LNG_INICIO) / 0.01).
  const LNG_ATRAS = -58.397; // frac 0.3
  const LNG_YO = -58.395; // frac 0.5
  const LNG_ADELANTE = -58.392; // frac 0.8

  it('ruta recta con 3 vehículos, yo en el medio: delante y detrás correctos, con distancia y edad', async () => {
    const atras = await crearSesion({
      placa: 'VRATRAS',
      pos: { lng: LNG_ATRAS, lat: LAT },
      edadFixMs: 120_000,
    });
    const yo = await crearSesion({ placa: 'VRYO', pos: { lng: LNG_YO, lat: LAT } });
    const adelante = await crearSesion({
      placa: 'VRADEL',
      pos: { lng: LNG_ADELANTE, lat: LAT },
      edadFixMs: 45_000,
    });
    expect(atras.sesionId).not.toBe(yo.sesionId);
    expect(adelante.sesionId).not.toBe(yo.sesionId);

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante?.placa).toBe('VRADEL');
    expect(r.detras?.placa).toBe('VRATRAS');
    expect(r.delante?.numeroInterno).toMatch(/^#/);
    expect(r.delante?.marca).toBe('Toyota');
    expect(r.delante?.colorSecundario).toBe('azul');
    // 0.3 × ~916 m ≈ 275 m (la geometría real: 0.01° de lng a lat -34.6 ≈ 916 m).
    expect(r.delante?.distanciaM).toBeGreaterThan(250);
    expect(r.delante?.distanciaM).toBeLessThan(300);
    expect(r.detras?.distanciaM).toBeGreaterThan(160);
    expect(r.detras?.distanciaM).toBeLessThan(200);
    expect(r.delante?.edadFixS).toBe(45);
    expect(r.detras?.edadFixS).toBe(120);
    expect(r.calculadoEn).toBe(AHORA.toISOString());
  });

  it('la respuesta no expone lat/lng, conductor ni sesionId (ni en claves ni en valores)', async () => {
    await crearSesion({ placa: 'VRP1', pos: { lng: LNG_ATRAS, lat: LAT } });
    const yo = await crearSesion({ placa: 'VRP2', pos: { lng: LNG_YO, lat: LAT } });
    await crearSesion({ placa: 'VRP3', pos: { lng: LNG_ADELANTE, lat: LAT } });

    const r = await service.obtener(yo, {}, AHORA);
    const json = JSON.stringify(r);

    for (const v of [r.delante, r.detras]) {
      expect(Object.keys(v!).sort()).toEqual(
        [
          'color',
          'colorSecundario',
          'distanciaM',
          'edadFixS',
          'marca',
          'modelo',
          'numeroInterno',
          'placa',
          'tipo',
        ].sort(),
      );
    }
    expect(json).not.toMatch(/"(lat|lng|conductor|sesionId|conductorNombre)/i);
    expect(json).not.toContain('Conductor Secreto');
  });

  it('excluye a un par en otro rutaId (sentido opuesto)', async () => {
    await crearSesion({
      placa: 'VROPU',
      rutaId: rutaOpuestaId,
      pos: { lng: LNG_ADELANTE, lat: LAT },
    });
    const yo = await crearSesion({ placa: 'VROPY', pos: { lng: LNG_YO, lat: LAT } });

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante).toBeNull();
    expect(r.detras).toBeNull();
  });

  it('excluye a un par de otro tenant aunque su asignación apunte a la misma ruta', async () => {
    await crearSesion({
      placa: 'VRTENB',
      sindicatoId: sindicatoBId,
      rutaId, // misma ruta física, otro sindicato
      pos: { lng: LNG_ADELANTE, lat: LAT },
    });
    const yo = await crearSesion({ placa: 'VRTENA', pos: { lng: LNG_YO, lat: LAT } });

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante).toBeNull();
    expect(r.detras).toBeNull();
  });

  it('excluye a un par con recorridoEstado distinto de en_curso (finalizado o nunca iniciado)', async () => {
    await crearSesion({
      placa: 'VRFIN',
      recorridoEstado: 'finalizado',
      pos: { lng: LNG_ADELANTE, lat: LAT },
    });
    await crearSesion({
      placa: 'VRNULL',
      recorridoEstado: null,
      pos: { lng: LNG_ATRAS, lat: LAT },
    });
    const yo = await crearSesion({ placa: 'VREST', pos: { lng: LNG_YO, lat: LAT } });

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante).toBeNull();
    expect(r.detras).toBeNull();
  });

  it('excluye a un par con fix más viejo que el umbral (10 min) y admite a uno justo por debajo', async () => {
    await crearSesion({
      placa: 'VRVIEJO',
      pos: { lng: LNG_ADELANTE, lat: LAT },
      edadFixMs: UMBRAL_VECINO_FRESCO_MS + 60_000,
    });
    await crearSesion({
      placa: 'VRFRESCO',
      pos: { lng: LNG_ATRAS, lat: LAT },
      edadFixMs: UMBRAL_VECINO_FRESCO_MS - 60_000,
    });
    const yo = await crearSesion({ placa: 'VRVYO', pos: { lng: LNG_YO, lat: LAT } });

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante).toBeNull();
    expect(r.detras?.placa).toBe('VRFRESCO');
  });

  it('excluye a un par con sesión cerrada/revocada (logout) aunque su recorrido siga en_curso', async () => {
    await crearSesion({ placa: 'VRCER', cerrada: true, pos: { lng: LNG_ADELANTE, lat: LAT } });
    const yo = await crearSesion({ placa: 'VRCEY', pos: { lng: LNG_YO, lat: LAT } });

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante).toBeNull();
    expect(r.detras).toBeNull();
  });

  it('excluye mi propia sesión (no soy mi propio vecino)', async () => {
    const yo = await crearSesion({ placa: 'VRSOLO', pos: { lng: LNG_YO, lat: LAT } });

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante).toBeNull();
    expect(r.detras).toBeNull();
  });

  it('sin posición mía (ni lat/lng ni resumen): delante y detrás null, sin error', async () => {
    await crearSesion({ placa: 'VRSPA', pos: { lng: LNG_ADELANTE, lat: LAT } });
    const yo = await crearSesion({ placa: 'VRSPY', pos: null });

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante).toBeNull();
    expect(r.detras).toBeNull();
    expect(r.calculadoEn).toBe(AHORA.toISOString());
  });

  it('lat/lng del request pisan a mi resumen (incluso si no tengo resumen)', async () => {
    await crearSesion({ placa: 'VROVA', pos: { lng: LNG_ATRAS, lat: LAT } });
    await crearSesion({ placa: 'VROVB', pos: { lng: LNG_ADELANTE, lat: LAT } });
    // Mi resumen dice que estoy al inicio (frac 0): con eso ambos estarían delante.
    const yo = await crearSesion({ placa: 'VROVY', pos: { lng: LNG_INICIO, lat: LAT } });

    const sinOverride = await service.obtener(yo, {}, AHORA);
    expect(sinOverride.detras).toBeNull();
    expect(sinOverride.delante?.placa).toBe('VROVA');

    service.limpiarCache();
    const conOverride = await service.obtener(yo, { lat: LAT, lng: LNG_YO }, AHORA);
    expect(conOverride.delante?.placa).toBe('VROVB');
    expect(conOverride.detras?.placa).toBe('VROVA');

    const sinResumen = await crearSesion({ placa: 'VROVZ', pos: null });
    const r = await service.obtener(sinResumen, { lat: LAT, lng: LNG_YO }, AHORA);
    expect(r.delante?.placa).toBe('VROVB');
  });

  it('segundo request dentro del TTL usa el caché (aunque cambie la BD) y recalcula mi posición', async () => {
    const atras = await crearSesion({ placa: 'VRCA', pos: { lng: LNG_ATRAS, lat: LAT } });
    const yo = await crearSesion({ placa: 'VRCY', pos: { lng: LNG_YO, lat: LAT } });

    const primera = await service.obtener(yo, {}, AHORA);
    expect(primera.detras?.placa).toBe('VRCA');

    // Cambio en BD: el par pasa a finalizado. Dentro del TTL el caché sigue mostrándolo...
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sesionOperativa.update({
        where: { id: atras.sesionId },
        data: { recorridoEstado: 'finalizado' },
      });
    });
    const dentro = await service.obtener(yo, {}, new Date(AHORA.getTime() + 5_000));
    expect(dentro.detras?.placa).toBe('VRCA');
    expect(dentro.detras?.edadFixS).toBe(35); // la edad sí se recalcula contra el nuevo `ahora`

    // ...pero mi posición NO se cachea: con lat/lng pasados al frente, ya no tengo a nadie atrás.
    const movido = await service.obtener(
      yo,
      { lat: LAT, lng: LNG_INICIO },
      new Date(AHORA.getTime() + 6_000),
    );
    expect(movido.detras).toBeNull();
    expect(movido.delante?.placa).toBe('VRCA');

    // Pasado el TTL se re-consulta y el par finalizado desaparece.
    const despues = await service.obtener(yo, {}, new Date(AHORA.getTime() + 16_000));
    expect(despues.detras).toBeNull();
  });

  it('un par que envejece dentro del TTL del caché deja de mostrarse', async () => {
    // Fix de hace 590 s (< 600 s): fresco al cachear; 14 s después (< TTL de 15 s, mismo
    // caché) tiene 604 s y ya pasó el umbral.
    await crearSesion({
      placa: 'VRENV',
      pos: { lng: LNG_ADELANTE, lat: LAT },
      edadFixMs: UMBRAL_VECINO_FRESCO_MS - 10_000,
    });
    const yo = await crearSesion({ placa: 'VRENY', pos: { lng: LNG_YO, lat: LAT } });

    const t0 = await service.obtener(yo, {}, AHORA);
    expect(t0.delante?.placa).toBe('VRENV');
    const t1 = await service.obtener(yo, {}, new Date(AHORA.getTime() + 14_000));
    expect(t1.delante).toBeNull();
  });

  it('LIMITACIÓN CONOCIDA — ruta circular (inicio ≈ fin): un vehículo pegado al mío puede salir a ~una vuelta entera', async () => {
    // Yo estoy en el primer vértice (frac 0). Otro vehículo está físicamente a pocos metros,
    // pero justo ANTES del cierre del anillo: ST_LineLocatePoint lo proyecta al final de la
    // línea (frac ≈ 1). Resultado: lo reporta "delante" a ~el perímetro completo (no a metros).
    // No se corrige acá (v2: desempatar con el último punto de control cumplido).
    const yo = await crearSesion({
      placa: 'VRCIRY',
      rutaId: rutaCircularId,
      pos: { lng: -58.4, lat: -34.6 },
    });
    await crearSesion({
      placa: 'VRCIRV',
      rutaId: rutaCircularId,
      pos: { lng: -58.40001, lat: -34.60001 }, // ≈ 1,5 m del vértice de cierre, lado del final
    });
    const perimetroM = await withTenantContext(
      { rol: 'admin_quivo', sindicatoId: null },
      async (tx) => {
        const [fila] = await tx.$queryRaw<{ largo: number }[]>`
        SELECT ST_Length(geometria) AS largo FROM rutas WHERE id = ${rutaCircularId}
      `;
        return fila!.largo;
      },
    );

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.delante?.placa).toBe('VRCIRV');
    expect(r.delante!.distanciaM).toBeGreaterThan(perimetroM * 0.9);
  });
});
