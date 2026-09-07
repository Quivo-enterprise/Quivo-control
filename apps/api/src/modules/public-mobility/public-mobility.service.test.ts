import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { prisma, withTenantContext } from '@quivo/db';
import type { LineaGeoJson } from '@quivo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../common/auth/jwt-auth.guard.js';
import { ParadasService } from '../rutas/paradas.service.js';
import { RutasService } from '../rutas/rutas.service.js';
import { MobilityPublicationService } from './mobility-publication.service.js';
import { parseCityId, parseLimite, PublicMobilityService } from './public-mobility.service.js';

const GEOMETRIA: LineaGeoJson = {
  type: 'LineString',
  coordinates: [
    [-68.15, -16.5],
    [-68.14, -16.49],
  ],
};

const GEOMETRIA_OCULTA: LineaGeoJson = {
  type: 'LineString',
  coordinates: [
    [-63.18, -17.78],
    [-63.17, -17.77],
  ],
};

const actor: AuthenticatedUser = {
  userId: 'public-mobility-lines-test',
  rol: 'admin_quivo',
  sindicatoId: null,
};

async function publicar(
  publications: MobilityPublicationService,
  resource: 'lineas' | 'rutas' | 'variantes' | 'paradas',
  id: string,
): Promise<void> {
  await publications.actualizar(actor, resource, id, 'validado');
  await publications.actualizar(actor, resource, id, 'publicado');
}

describe('PublicMobilityService.listarLineas', () => {
  const mobility = new PublicMobilityService();
  const publications = new MobilityPublicationService();
  const rutas = new RutasService();
  const paradas = new ParadasService();

  describe('proyección y filtrado por publicStatus en cada nivel', () => {
    const sindicatoId = randomUUID();
    let lineaPublicadaId: string;
    let lineaBorradorId: string;
    let rutaVisibleId: string;
    let rutaOcultaId: string;
    let varianteVisibleId: string;
    let varianteOcultaId: string;
    let paradaVisibleId: string;
    let paradaOcultaId: string;

    beforeAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.sindicato.create({
          data: { id: sindicatoId, nombre: 'Sindicato Sync Test', estado: 'activo' },
        });
        const lineaPublicada = await tx.linea.create({
          data: {
            sindicatoId,
            codigo: `SY-${sindicatoId.slice(0, 6)}`,
            nombre: 'Línea de sincronización',
            color: '#3226B4',
            cityId: 'la-paz-el-alto',
          },
        });
        lineaPublicadaId = lineaPublicada.id;
        const lineaBorrador = await tx.linea.create({
          data: {
            sindicatoId,
            codigo: `SB-${sindicatoId.slice(0, 6)}`,
            nombre: 'Línea que nunca se publica',
            cityId: 'la-paz-el-alto',
          },
        });
        lineaBorradorId = lineaBorrador.id;
      });

      const rutaVisible = await rutas.crear(actor, lineaPublicadaId, {
        sentido: 'ida',
        geometria: GEOMETRIA,
        estado: 'activo',
      });
      rutaVisibleId = rutaVisible.id;
      const rutaOculta = await rutas.crear(actor, lineaPublicadaId, {
        sentido: 'vuelta',
        geometria: GEOMETRIA_OCULTA,
        estado: 'activo',
      });
      rutaOcultaId = rutaOculta.id;

      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        const varianteVisible = await tx.variante.create({
          data: { rutaId: rutaVisibleId, nombre: 'Directo', estado: 'activo' },
        });
        varianteVisibleId = varianteVisible.id;
        const varianteOculta = await tx.variante.create({
          data: { rutaId: rutaVisibleId, nombre: 'Sin publicar', estado: 'activo' },
        });
        varianteOcultaId = varianteOculta.id;
      });

      const paradaVisible = await paradas.crear(actor, rutaVisibleId, {
        tipo: 'origen',
        orden: 0,
        coord: { type: 'Point', coordinates: [-68.15, -16.5] },
        estado: 'activo',
        nombre: 'Plaza Sync',
      });
      paradaVisibleId = paradaVisible.id;
      const paradaOculta = await paradas.crear(actor, rutaVisibleId, {
        tipo: 'destino',
        orden: 1,
        coord: { type: 'Point', coordinates: [-68.14, -16.49] },
        estado: 'activo',
        nombre: 'Sin publicar',
      });
      paradaOcultaId = paradaOculta.id;

      // `lineaBorradorId`, `rutaOcultaId`, `varianteOcultaId` y `paradaOcultaId` quedan en
      // 'borrador' a propósito — son el control de que cada nivel filtra por su cuenta.
      await publicar(publications, 'lineas', lineaPublicadaId);
      await publicar(publications, 'rutas', rutaVisibleId);
      await publicar(publications, 'variantes', varianteVisibleId);
      await publicar(publications, 'paradas', paradaVisibleId);
    });

    afterAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.parada.deleteMany({ where: { id: { in: [paradaVisibleId, paradaOcultaId] } } });
        await tx.variante.deleteMany({ where: { id: { in: [varianteVisibleId, varianteOcultaId] } } });
        await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaVisibleId}, ${rutaOcultaId})`;
        await tx.auditLog.deleteMany({ where: { sindicatoId } });
        await tx.linea.deleteMany({ where: { id: { in: [lineaPublicadaId, lineaBorradorId] } } });
        await tx.sindicato.deleteMany({ where: { id: sindicatoId } });
      });
    });

    it('sólo expone la línea publicada, con su árbol filtrado por publicStatus en cada nivel', async () => {
      const lineas = await mobility.listarLineas({ cityId: 'la-paz-el-alto' });
      expect(lineas.map((l) => l.id)).toEqual([lineaPublicadaId]);

      const linea = lineas[0]!;
      expect(linea.routes.map((r) => r.id)).toEqual([rutaVisibleId]);

      const ruta = linea.routes[0]!;
      expect(ruta.variants).toEqual([{ id: varianteVisibleId, name: 'Directo' }]);
      expect(ruta.stops.map((s) => s.id)).toEqual([paradaVisibleId]);
      expect(ruta.stops[0]).toMatchObject({ name: 'Plaza Sync' });
    });

    it('«since» detecta un cambio ocurrido sólo en una parada, no en la línea (trampa 1)', async () => {
      const primeraVuelta = await mobility.listarLineas({ cityId: 'la-paz-el-alto' });
      const sinceCursor = primeraVuelta[0]!.updatedAt;

      // Repetir la misma consulta con ese cursor no debe traer nada: nada cambió todavía.
      const sinCambios = await mobility.listarLineas({
        cityId: 'la-paz-el-alto',
        since: new Date(sinceCursor),
      });
      expect(sinCambios).toEqual([]);

      // Tocar SÓLO la parada — ni la línea, ni la ruta, ni la variante se actualizan.
      await paradas.actualizar(actor, paradaVisibleId, { referencia: 'Esquina renovada' });

      const conCambios = await mobility.listarLineas({
        cityId: 'la-paz-el-alto',
        since: new Date(sinceCursor),
      });
      expect(conCambios.map((l) => l.id)).toEqual([lineaPublicadaId]);
      expect(conCambios[0]!.routes[0]!.stops[0]).toMatchObject({ reference: 'Esquina renovada' });
      // El cursor efectivo avanzó: es estrictamente mayor al de la primera vuelta.
      expect(Date.parse(conCambios[0]!.updatedAt)).toBeGreaterThan(Date.parse(sinceCursor));
    });
  });

  describe('paginación estable con afterId cuando varias líneas comparten updatedAt', () => {
    const sindicatoId = randomUUID();
    let lineaAId: string;
    let lineaBId: string;

    beforeAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.sindicato.create({
          data: { id: sindicatoId, nombre: 'Sindicato Paginación Test', estado: 'activo' },
        });
        const lineaA = await tx.linea.create({
          data: {
            sindicatoId,
            codigo: `PA-${sindicatoId.slice(0, 6)}`,
            nombre: 'Línea A de paginación',
            cityId: 'santa-cruz',
          },
        });
        lineaAId = lineaA.id;
        const lineaB = await tx.linea.create({
          data: {
            sindicatoId,
            codigo: `PB-${sindicatoId.slice(0, 6)}`,
            nombre: 'Línea B de paginación',
            cityId: 'santa-cruz',
          },
        });
        lineaBId = lineaB.id;
      });

      await publicar(publications, 'lineas', lineaAId);
      await publicar(publications, 'lineas', lineaBId);

      // Fuerza el empate exacto que dispara la trampa: sin esto, `publicar` ya deja
      // timestamps naturalmente distintos porque son dos llamadas secuenciales.
      const empate = new Date('2026-01-01T00:00:00.000Z');
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.$executeRaw`UPDATE lineas SET "updatedAt" = ${empate} WHERE id IN (${lineaAId}, ${lineaBId})`,
      );
    });

    afterAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.auditLog.deleteMany({ where: { sindicatoId } });
        await tx.linea.deleteMany({ where: { id: { in: [lineaAId, lineaBId] } } });
        await tx.sindicato.deleteMany({ where: { id: sindicatoId } });
      });
    });

    it('no saltea ni repite filas empatadas en updatedAt al paginar con afterId', async () => {
      const primeraPagina = await mobility.listarLineas({ cityId: 'santa-cruz', limit: 1 });
      expect(primeraPagina).toHaveLength(1);
      const primera = primeraPagina[0]!;
      expect([lineaAId, lineaBId]).toContain(primera.id);

      const segundaPagina = await mobility.listarLineas({
        cityId: 'santa-cruz',
        limit: 1,
        since: new Date(primera.updatedAt),
        afterId: primera.id,
      });
      expect(segundaPagina).toHaveLength(1);
      const segunda = segundaPagina[0]!;
      // La segunda página trae la OTRA línea — ni repite la primera ni la saltea.
      expect(segunda.id).not.toBe(primera.id);
      expect([lineaAId, lineaBId]).toContain(segunda.id);

      const terceraPagina = await mobility.listarLineas({
        cityId: 'santa-cruz',
        limit: 1,
        since: new Date(segunda.updatedAt),
        afterId: segunda.id,
      });
      expect(terceraPagina).toEqual([]);
    });
  });

  // Fija el comportamiento del refactor a queries fijas (una por línea/ruta/variante/parada
  // en vez de una por entidad, ver el docstring de la clase): con varias líneas y varias
  // rutas por línea, el contenido y el orden anidado tienen que seguir siendo exactamente
  // los que daba la versión N+1 — nada de esto puede depender de en qué orden llegan las
  // filas de las queries batch, sólo del `ORDER BY` de cada una.
  describe('contenido y orden con varias líneas, cada una con varias rutas/variantes/paradas', () => {
    const sindicatoId = randomUUID();
    let lineaXId: string;
    let lineaYId: string;
    let rutaX1Id: string;
    let rutaX2Id: string;
    let rutaY1Id: string;

    beforeAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.sindicato.create({
          data: { id: sindicatoId, nombre: 'Sindicato Batch Test', estado: 'activo' },
        });
        const lineaX = await tx.linea.create({
          data: {
            sindicatoId,
            codigo: `BX-${sindicatoId.slice(0, 6)}`,
            nombre: 'Línea X de batch',
            cityId: 'oruro',
          },
        });
        lineaXId = lineaX.id;
        const lineaY = await tx.linea.create({
          data: {
            sindicatoId,
            codigo: `BY-${sindicatoId.slice(0, 6)}`,
            nombre: 'Línea Y de batch',
            cityId: 'oruro',
          },
        });
        lineaYId = lineaY.id;
      });

      // Dos rutas por línea, creadas en un orden tal que si el agrupado en memoria no
      // respetara el `ORDER BY "createdAt"` de la query batch, este test lo notaría.
      const rutaX1 = await rutas.crear(actor, lineaXId, {
        sentido: 'ida',
        geometria: { type: 'LineString', coordinates: [[-67.15, -17.97], [-67.14, -17.96]] },
        estado: 'activo',
      });
      rutaX1Id = rutaX1.id;
      const rutaX2 = await rutas.crear(actor, lineaXId, {
        sentido: 'vuelta',
        geometria: { type: 'LineString', coordinates: [[-67.13, -17.95], [-67.12, -17.94]] },
        estado: 'activo',
      });
      rutaX2Id = rutaX2.id;
      const rutaY1 = await rutas.crear(actor, lineaYId, {
        sentido: 'ida',
        geometria: { type: 'LineString', coordinates: [[-67.11, -17.93], [-67.10, -17.92]] },
        estado: 'activo',
      });
      rutaY1Id = rutaY1.id;

      // rutaX1: dos variantes en orden Z→A y dos paradas con `orden` invertido respecto a su
      // creación — si el agrupado en memoria usara orden de inserción en vez del `ORDER BY`
      // de la query batch, estas aserciones fallarían.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.variante.create({ data: { rutaId: rutaX1Id, nombre: 'Zeta', estado: 'activo' } });
        await tx.variante.create({ data: { rutaId: rutaX1Id, nombre: 'Alfa', estado: 'activo' } });
      });
      await paradas.crear(actor, rutaX1Id, {
        tipo: 'destino',
        orden: 1,
        coord: { type: 'Point', coordinates: [-67.14, -17.96] },
        estado: 'activo',
        nombre: 'Segunda parada',
      });
      await paradas.crear(actor, rutaX1Id, {
        tipo: 'origen',
        orden: 0,
        coord: { type: 'Point', coordinates: [-67.15, -17.97] },
        estado: 'activo',
        nombre: 'Primera parada',
      });

      // rutaX2: una sola variante/parada — prueba que el agrupado por `rutaId` no mezcla el
      // contenido de una ruta con el de la otra dentro de la misma línea.
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
        tx.variante.create({ data: { rutaId: rutaX2Id, nombre: 'Única', estado: 'activo' } }),
      );
      await paradas.crear(actor, rutaX2Id, {
        tipo: 'origen',
        orden: 0,
        coord: { type: 'Point', coordinates: [-67.13, -17.95] },
        estado: 'activo',
        nombre: 'Parada de vuelta',
      });

      await publicar(publications, 'lineas', lineaXId);
      await publicar(publications, 'rutas', rutaX1Id);
      await publicar(publications, 'rutas', rutaX2Id);
      await publicar(publications, 'variantes', await obtenerVarianteIdPorNombre(rutaX1Id, 'Zeta'));
      await publicar(publications, 'variantes', await obtenerVarianteIdPorNombre(rutaX1Id, 'Alfa'));
      await publicar(publications, 'variantes', await obtenerVarianteIdPorNombre(rutaX2Id, 'Única'));
      await publicar(publications, 'paradas', await obtenerParadaIdPorNombre(rutaX1Id, 'Segunda parada'));
      await publicar(publications, 'paradas', await obtenerParadaIdPorNombre(rutaX1Id, 'Primera parada'));
      await publicar(publications, 'paradas', await obtenerParadaIdPorNombre(rutaX2Id, 'Parada de vuelta'));
      await publicar(publications, 'lineas', lineaYId);
      await publicar(publications, 'rutas', rutaY1Id);
      // rutaY1 queda sin variantes ni paradas: prueba que una ruta sin descendencia no rompe
      // el batch (el `Map.get(...) ?? []` tiene que devolver un array vacío, no `undefined`).
    });

    afterAll(async () => {
      await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        await tx.parada.deleteMany({ where: { rutaId: { in: [rutaX1Id, rutaX2Id] } } });
        await tx.variante.deleteMany({ where: { rutaId: { in: [rutaX1Id, rutaX2Id] } } });
        await tx.$executeRaw`DELETE FROM rutas WHERE id IN (${rutaX1Id}, ${rutaX2Id}, ${rutaY1Id})`;
        await tx.auditLog.deleteMany({ where: { sindicatoId } });
        await tx.linea.deleteMany({ where: { id: { in: [lineaXId, lineaYId] } } });
        await tx.sindicato.deleteMany({ where: { id: sindicatoId } });
      });
    });

    it('mantiene el mismo contenido y el mismo orden anidado que la versión sin batch', async () => {
      const lineas = await mobility.listarLineas({ cityId: 'oruro', limit: 10 });

      // Orden entre líneas: lineaX se publicó antes que lineaY, así que su efectiveUpdatedAt
      // es menor — el mismo orden que daba la versión N+1.
      expect(lineas.map((l) => l.id)).toEqual([lineaXId, lineaYId]);

      const lineaX = lineas.find((l) => l.id === lineaXId)!;
      // Dos rutas, en orden de creación (rutaX1 antes que rutaX2) — el `ORDER BY "createdAt"`
      // de la query batch, no el orden en que llegan agrupadas en el `Map`.
      expect(lineaX.routes.map((r) => r.id)).toEqual([rutaX1Id, rutaX2Id]);

      const rutaX1 = lineaX.routes[0]!;
      // Variantes ordenadas por nombre (Alfa, Zeta), no por orden de creación (Zeta, Alfa).
      expect(rutaX1.variants.map((v) => v.name)).toEqual(['Alfa', 'Zeta']);
      // Paradas ordenadas por "orden" (0, 1), no por orden de creación (1, 0).
      expect(rutaX1.stops.map((s) => s.name)).toEqual(['Primera parada', 'Segunda parada']);

      const rutaX2 = lineaX.routes[1]!;
      // El contenido de rutaX2 no se mezcló con el de rutaX1 al agrupar en memoria.
      expect(rutaX2.variants.map((v) => v.name)).toEqual(['Única']);
      expect(rutaX2.stops.map((s) => s.name)).toEqual(['Parada de vuelta']);

      const lineaY = lineas.find((l) => l.id === lineaYId)!;
      expect(lineaY.routes.map((r) => r.id)).toEqual([rutaY1Id]);
      // rutaY1 no tiene variantes ni paradas publicadas: arrays vacíos, no `undefined`.
      expect(lineaY.routes[0]!.variants).toEqual([]);
      expect(lineaY.routes[0]!.stops).toEqual([]);
    });

    async function obtenerVarianteIdPorNombre(rutaId: string, nombre: string): Promise<string> {
      return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        const variante = await tx.variante.findFirstOrThrow({ where: { rutaId, nombre } });
        return variante.id;
      });
    }

    async function obtenerParadaIdPorNombre(rutaId: string, nombre: string): Promise<string> {
      return withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
        const parada = await tx.parada.findFirstOrThrow({ where: { rutaId, nombre } });
        return parada.id;
      });
    }
  });

  // No agrego una aserción de "cantidad de queries emitidas": el cliente Prisma compartido
  // (`packages/db/src/client.ts`) se instancia sin `log: [{emit: 'event', level: 'query'}]`,
  // y no hay en el proyecto ningún spy/contador de queries ya armado para reusar. Instrumentar
  // eso implicaría cambiar la construcción del singleton de Prisma para toda la app sólo para
  // este test — exactamente el tipo de infraestructura nueva que no corresponde meter acá. La
  // cobertura de que "no crece con la cantidad de líneas" queda en la lectura del código: son
  // cuatro funciones (`obtenerLineasFilas`, `listarRutasDeLineas`, `listarVariantesDeRutas`,
  // `listarParadasDeRutas`), cada una una sola sentencia `$queryRaw`, ninguna en un loop.

  it('rechaza un afterId que no corresponde a ninguna línea pública visible', async () => {
    await expect(
      mobility.listarLineas({ afterId: randomUUID() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});

describe('parseCityId', () => {
  it('acepta un id de ciudad válido y lo devuelve tal cual', () => {
    expect(parseCityId('la-paz-el-alto')).toBe('la-paz-el-alto');
  });

  it('rechaza un cityId con formato inválido', () => {
    expect(() => parseCityId('La Paz')).toThrow(BadRequestException);
    expect(() => parseCityId('MAYUSCULAS')).toThrow(BadRequestException);
  });
});

describe('parseLimite', () => {
  it('usa 100 por defecto cuando no se pasa límite', () => {
    expect(parseLimite(undefined)).toBe(100);
  });

  it('respeta un límite dentro de rango', () => {
    expect(parseLimite(5)).toBe(5);
  });

  it('topea en 500 un límite mayor', () => {
    expect(parseLimite(10_000)).toBe(500);
    expect(parseLimite(501)).toBe(500);
    expect(parseLimite(500)).toBe(500);
  });

  it('rechaza un límite menor a 1 o no entero', () => {
    expect(() => parseLimite(0)).toThrow(BadRequestException);
    expect(() => parseLimite(-3)).toThrow(BadRequestException);
    expect(() => parseLimite(1.5)).toThrow(BadRequestException);
  });
});
