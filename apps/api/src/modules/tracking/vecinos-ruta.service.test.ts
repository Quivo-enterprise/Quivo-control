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

/**
 * Circuito CERRADO con ida y regreso por la misma calle (11 m de separación entre carriles), como
 * la L16: ida hacia el este por y=-34.6, retorno en el extremo este y regreso hacia el oeste por
 * y=-34.6001. Largo ≈ 3,7 km; ida ≈ 1,84 km.
 */
const LAT_REGRESO = -34.6001;
const CERRADA = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, LAT],
    [-58.39, LAT],
    [-58.38, LAT],
    [-58.38, LAT_REGRESO],
    [-58.39, LAT_REGRESO],
    [-58.4, LAT_REGRESO],
    [-58.4, LAT],
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
  let rutaCerradaId: string;
  let pcTerminalId: string;
  let pcRetornoId: string;
  let pcComunId: string;
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
    /** Precisión (m) del último fix del resumen; por defecto 5. */
    accuracy?: number;
    /** Vuelta en curso de la sesión: 'regreso' ⇒ ya pasó por el retorno. Sin esto no hay vuelta. */
    fase?: 'ida' | 'regreso';
    /** Fixes en `gps_points` (ya ingestados), p. ej. el último fix bueno tras uno impreciso. */
    puntosGps?: { lng: number; lat: number; accuracy: number | null; edadMs: number }[];
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
        await insertarResumen(tx, sesion.id, sindicatoId, pos, ts, spec.accuracy ?? 5);
      }
      if (spec.fase) {
        await tx.vuelta.create({
          data: {
            sindicatoId,
            sesionId: sesion.id,
            vehiculoId: vehiculo.id,
            conductorId: conductor.id,
            lineaId: lineaAId,
            rutaId: ruta,
            fecha: AHORA,
            numero: 1,
            inicioTs: new Date(AHORA.getTime() - 30 * MINUTO),
            estado: 'en_curso',
            pasoRetornoTs: spec.fase === 'regreso' ? new Date(AHORA.getTime() - 10 * MINUTO) : null,
          },
        });
      }
      for (const g of spec.puntosGps ?? []) {
        await tx.$executeRaw`
          INSERT INTO gps_points (event_id, sesion_id, device_id, ts, lat, lng, accuracy, speed, received_at, "sindicatoId")
          VALUES (${randomUUID()}::uuid, ${sesion.id}::uuid, ${`dev-vr-${n}`}, ${new Date(AHORA.getTime() - g.edadMs)}::timestamptz, ${g.lat}, ${g.lng}, ${g.accuracy}, 8, now(), ${sindicatoId})
        `;
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
    accuracy: number,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO gps_sesion_resumen
        (sesion_id, jornada, "sindicatoId", total_puntos, ultimo_fix_ts, ultimo_ingreso_ts, lat, lng, accuracy, speed, updated_at)
      VALUES (${sesionId}::uuid, ${JORNADA}::date, ${sindicatoId}, 1, ${ts}::timestamptz, ${ts}::timestamptz, ${pos.lat}, ${pos.lng}, ${accuracy}, 8, now())
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
    rutaCerradaId = await crearRuta(lineaAId, 'cerrada', CERRADA);
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      // PCs de la ruta cerrada: terminal (orden 0), retorno en el extremo este, entre ambos
      // carriles (orden 1), y un PC común posterior al retorno (orden 2).
      pcTerminalId = randomUUID();
      pcRetornoId = randomUUID();
      pcComunId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, rol, estado, "createdAt", "updatedAt")
        VALUES (${pcTerminalId}, ${rutaCerradaId}, 0, ST_SetSRID(ST_MakePoint(-58.4, ${LAT}::float8), 4326)::geography, 150, false, 'terminal', 'activo', now(), now()),
               (${pcRetornoId}, ${rutaCerradaId}, 1, ST_SetSRID(ST_MakePoint(-58.38, -34.60005), 4326)::geography, 150, false, 'retorno', 'activo', now(), now()),
               (${pcComunId}, ${rutaCerradaId}, 2, ST_SetSRID(ST_MakePoint(-58.39, ${LAT_REGRESO}::float8), 4326)::geography, 150, false, NULL, 'activo', now(), now())
      `;
      await tx.$executeRaw`SELECT crear_particion_gps_points(${JORNADA}::date)`;
    });
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
      await tx.$executeRaw`DELETE FROM gps_points WHERE "sindicatoId" IN (${sindicatoAId}, ${sindicatoBId})`;
      await tx.sesionOperativa.deleteMany({
        where: { sindicatoId: { in: [sindicatoAId, sindicatoBId] } },
      });
      await tx.asignacion.deleteMany({
        where: { rutaId: { in: [rutaId, rutaOpuestaId, rutaCircularId, rutaCerradaId] } },
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
      await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaId}, ${rutaOpuestaId}, ${rutaCircularId}, ${rutaCerradaId})`;
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

  it('ruta circular sin retorno: el vecino pegado al cierre queda a metros (lado más corto), no a una vuelta', async () => {
    // Yo estoy en el primer vértice. Otro vehículo está a ~1,5 m, justo ANTES del cierre del
    // anillo: la proyección lo pone al final de la línea (progreso ≈ perímetro). Con distancia
    // circular queda DETRÁS a metros; antes salía "delante" a casi el perímetro completo.
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

    const r = await service.obtener(yo, {}, AHORA);

    expect(r.detras?.placa).toBe('VRCIRV');
    expect(r.detras!.distanciaM).toBeLessThan(10);
    expect(r.delante).toBeNull();
  });

  describe('circuito cerrado con ida y regreso por la misma calle (fase desde `vueltas`)', () => {
    // Yo voy de REGRESO por el carril sur pero mi GPS cae a 3 m del carril norte (la ida): la
    // proyección global me pondría en la ida, a 183 m del otro. Con mi fase (`pasoRetornoTs`)
    // estoy ~2,76 km de recorrido, y el otro (ida, ~1,10 km) queda DETRÁS por el lado corto (~1,66 km).
    const MIA_REGRESO = { lng: -58.39, lat: -34.60003 };
    const OTRO_IDA = { lng: -58.388, lat: LAT };

    it('la fase de `vueltas` ubica a cada uno en su mitad y la fila es única y simétrica', async () => {
      const yo = await crearSesion({
        placa: 'VRCEY',
        rutaId: rutaCerradaId,
        pos: MIA_REGRESO,
        fase: 'regreso',
      });
      const otro = await crearSesion({
        placa: 'VRCEO',
        rutaId: rutaCerradaId,
        pos: OTRO_IDA,
        fase: 'ida',
      });

      const mio = await service.obtener(yo, {}, AHORA);
      expect(mio.delante).toBeNull();
      expect(mio.detras?.placa).toBe('VRCEO');
      expect(mio.detras!.distanciaM).toBeGreaterThan(1_600);
      expect(mio.detras!.distanciaM).toBeLessThan(1_720);

      // Simetría: el otro me ve DELANTE a la misma distancia, en una sola fila.
      const suyo = await service.obtener(otro, {}, AHORA);
      expect(suyo.detras).toBeNull();
      expect(suyo.delante?.placa).toBe('VRCEY');
      expect(suyo.delante!.distanciaM).toBeCloseTo(mio.detras!.distanciaM, 0);
    });

    it('`fase` del request manda sobre la derivada de `vueltas` (y sin vuelta se usa la del request)', async () => {
      const yo = await crearSesion({ placa: 'VRCFY', rutaId: rutaCerradaId, pos: MIA_REGRESO });
      await crearSesion({ placa: 'VRCFO', rutaId: rutaCerradaId, pos: OTRO_IDA, fase: 'ida' });

      // Sin vuelta ni fase: proyección global (me pone en la ida) ⇒ el otro queda DELANTE a ~183 m.
      const sinFase = await service.obtener(yo, {}, AHORA);
      expect(sinFase.delante?.placa).toBe('VRCFO');
      expect(sinFase.delante!.distanciaM).toBeLessThan(250);

      service.limpiarCache();
      const conFase = await service.obtener(yo, { fase: 'regreso' }, AHORA);
      expect(conFase.delante).toBeNull();
      expect(conFase.detras?.placa).toBe('VRCFO');
      expect(conFase.detras!.distanciaM).toBeGreaterThan(1_600);
    });

    it('un fix impreciso se ignora a favor del último fix bueno de gps_points', async () => {
      const yo = await crearSesion({
        placa: 'VRACY',
        rutaId: rutaCerradaId,
        pos: MIA_REGRESO,
        fase: 'regreso',
      });
      // El resumen del otro es un salto impreciso (120 m, lejos de la ruta); su último fix bueno
      // (hace 90 s) está sobre la ida. Debe verse en el fix bueno, no en el malo.
      await crearSesion({
        placa: 'VRACO',
        rutaId: rutaCerradaId,
        pos: { lng: -58.3, lat: -34.5 },
        accuracy: 120,
        fase: 'ida',
        puntosGps: [
          { lng: -58.388, lat: LAT, accuracy: 8, edadMs: 90_000 },
          { lng: -58.37, lat: -34.59, accuracy: 120, edadMs: 20_000 },
        ],
      });

      const r = await service.obtener(yo, {}, AHORA);

      expect(r.detras?.placa).toBe('VRACO');
      expect(r.detras!.distanciaM).toBeGreaterThan(1_600);
      expect(r.detras!.edadFixS).toBe(90); // la edad es la del fix bueno, no la del resumen
    });

    it('un par con fix impreciso y sin ningún fix bueno reciente no se ubica en ningún lado', async () => {
      const yo = await crearSesion({
        placa: 'VRSBY',
        rutaId: rutaCerradaId,
        pos: MIA_REGRESO,
        fase: 'regreso',
      });
      await crearSesion({
        placa: 'VRSBO',
        rutaId: rutaCerradaId,
        pos: OTRO_IDA,
        accuracy: 120,
        fase: 'ida',
        // Fix bueno, pero más viejo que la ventana de frescura.
        puntosGps: [
          { lng: -58.388, lat: LAT, accuracy: 8, edadMs: UMBRAL_VECINO_FRESCO_MS + 60_000 },
        ],
      });

      const r = await service.obtener(yo, {}, AHORA);

      expect(r.delante).toBeNull();
      expect(r.detras).toBeNull();
    });

    it('un par a ~3 km de su mitad del trazado (fix errado) se descarta', async () => {
      const yo = await crearSesion({
        placa: 'VRLEY',
        rutaId: rutaCerradaId,
        pos: MIA_REGRESO,
        fase: 'regreso',
      });
      await crearSesion({
        placa: 'VRLEO',
        rutaId: rutaCerradaId,
        pos: { lng: -58.388, lat: LAT + 0.027 }, // ≈ 3 km al norte, precisión "buena"
        fase: 'ida',
      });

      const r = await service.obtener(yo, {}, AHORA);

      expect(r.delante).toBeNull();
      expect(r.detras).toBeNull();
    });

    it('mi fix impreciso del resumen se reemplaza por mi último fix bueno de gps_points', async () => {
      const yo = await crearSesion({
        placa: 'VRMIY',
        rutaId: rutaCerradaId,
        pos: { lng: -58.3, lat: -34.5 },
        accuracy: 120,
        fase: 'regreso',
        puntosGps: [{ ...MIA_REGRESO, accuracy: 6, edadMs: 60_000 }],
      });
      await crearSesion({ placa: 'VRMIO', rutaId: rutaCerradaId, pos: OTRO_IDA, fase: 'ida' });

      const r = await service.obtener(yo, {}, AHORA);

      expect(r.detras?.placa).toBe('VRMIO');
      expect(r.detras!.distanciaM).toBeGreaterThan(1_600);
    });
  });

  describe('fase deducida del último cumplimiento (sesión sin vuelta en curso)', () => {
    // Mismo GPS ambiguo (3 m de la ida) que arriba: sin fase cae en la ida (~183 m DETRÁS del otro);
    // en regreso queda ~1,66 km por delante del otro (que va por la ida, ~1,10 km).
    const AMBIGUA = { lng: -58.39, lat: -34.60003 };
    const OTRO_IDA = { lng: -58.388, lat: LAT };

    async function cumplir(
      sesion: SesionMovilAutenticada,
      puntoControlId: string,
      minAtras: number,
      cumplido = true,
    ): Promise<void> {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.cumplimientoPc.create({
          data: {
            eventId: randomUUID(),
            sindicatoId: sesion.sindicatoId,
            sesionId: sesion.sesionId,
            puntoControlId,
            ts: new Date(AHORA.getTime() - minAtras * MINUTO),
            distanciaM: 10,
            cumplido,
            validadoPor: 'worker',
          },
        });
      });
    }

    /** Veo al candidato (sin vuelta) desde un vecino en la ida; devuelve a qué distancia lo ubico. */
    async function distanciaAlCandidato(
      cumplimientos: (c: SesionMovilAutenticada) => Promise<void>,
    ): Promise<{ delante: number | null; detras: number | null }> {
      const yo = await crearSesion({
        placa: 'VRFDY',
        rutaId: rutaCerradaId,
        pos: OTRO_IDA,
        fase: 'ida',
      });
      const cand = await crearSesion({ placa: 'VRFDC', rutaId: rutaCerradaId, pos: AMBIGUA });
      await cumplimientos(cand);
      const r = await service.obtener(yo, {}, AHORA);
      return { delante: r.delante?.distanciaM ?? null, detras: r.detras?.distanciaM ?? null };
    }

    it('último cumplimiento en el PC de retorno ⇒ regreso', async () => {
      const r = await distanciaAlCandidato(async (c) => {
        await cumplir(c, pcTerminalId, 30);
        await cumplir(c, pcRetornoId, 10);
      });
      expect(r.delante).toBeGreaterThan(1_600);
      expect(r.delante).toBeLessThan(1_720);
    });

    it('último cumplimiento en el terminal ⇒ ida (aunque antes pasó por el retorno)', async () => {
      const r = await distanciaAlCandidato(async (c) => {
        await cumplir(c, pcRetornoId, 30);
        await cumplir(c, pcTerminalId, 10);
      });
      expect(r.detras).toBeLessThan(250);
    });

    it('último cumplimiento en un PC común posterior al retorno ⇒ regreso', async () => {
      const r = await distanciaAlCandidato((c) => cumplir(c, pcComunId, 10));
      expect(r.delante).toBeGreaterThan(1_600);
    });

    it('sin cumplimientos (o con cumplido=false) ⇒ sin fase: proyección global como antes', async () => {
      const sin = await distanciaAlCandidato(async () => {});
      expect(sin.detras).toBeLessThan(250);

      service.limpiarCache();
      await limpiarFixtures();
      const fallido = await distanciaAlCandidato((c) => cumplir(c, pcRetornoId, 10, false));
      expect(fallido.detras).toBeLessThan(250);
    });
  });
});
