import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from './client.js';
import { withTenantContext } from './tenant-context.js';

/** Fila cruda de la guardia de conexión — ver `beforeAll` más abajo. */
interface ConexionRol {
  current_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/**
 * Test cross-tenant de RLS (QUI-218, doc técnico §12 riesgo #2): un sindicato jamás debe
 * poder leer ni escribir filas de otro, sin importar si la query de la app "olvida" el
 * filtro por `sindicatoId` — la barrera real vive en Postgres, no en el código de arriba.
 * Corre contra el Postgres real (services de CI / docker-compose local, ver
 * `RUNTIME_DATABASE_URL` en apps/api/.env) con el rol `quivo_app` sin BYPASSRLS, creado
 * por la migración `20260730152500_rls_multi_tenant`.
 */
describe('RLS multi-tenant', () => {
  const sindicatoAId = randomUUID();
  const sindicatoBId = randomUUID();
  let reglaAId: string;
  let reglaBId: string;

  beforeAll(async () => {
    // Guardia de conexión: si `prisma` terminó conectado con un rol superusuario o con
    // BYPASSRLS (p. ej. porque `RUNTIME_DATABASE_URL` no estaba seteada y `client.ts` cayó
    // a `DATABASE_URL`, el rol de migraciones), Postgres ignora todas las políticas RLS sin
    // importar qué tan bien estén escritas. En ese escenario, cada `it()` de este archivo
    // "pasaría" (o fallaría) por la razón equivocada: no estarían probando aislamiento
    // multi-tenant, sino ejecutando queries sin ninguna barrera. Abortamos acá, ruidoso y
    // temprano, en vez de dejar que 12 asserts fallen más abajo con un mensaje que apunta a
    // "las políticas están mal" cuando el problema real es la conexión.
    const filasConexion = await prisma.$queryRaw<ConexionRol[]>`
      SELECT
        current_user,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls
    `;
    const conexion = filasConexion[0];

    if (!conexion) {
      throw new Error(
        'La guardia de conexión de RLS no devolvió ninguna fila — no se pudo verificar el rol.',
      );
    }

    const {
      current_user: currentUser,
      rolsuper: esSuperusuario,
      rolbypassrls: tieneBypassRls,
    } = conexion;

    if (esSuperusuario || tieneBypassRls) {
      throw new Error(
        `Esta suite corre conectada como "${currentUser}" (rolsuper=${String(esSuperusuario)}, ` +
          `rolbypassrls=${String(tieneBypassRls)}) — Postgres ignora RLS para ese rol sin importar ` +
          'FORCE ROW LEVEL SECURITY. El problema NO son las políticas de aislamiento multi-tenant: ' +
          'es la conexión. Probablemente RUNTIME_DATABASE_URL no está seteada (o apunta al rol de ' +
          'migraciones) y packages/db/src/client.ts cayó al fallback equivocado — conectá con el ' +
          'rol "quivo_app" (sin BYPASSRLS) antes de correr esta suite, o los resultados de abajo no ' +
          'significan nada.',
      );
    }

    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      await tx.sindicato.create({ data: { id: sindicatoAId, nombre: 'RLS Test A', estado: 'activo' } });
      await tx.sindicato.create({ data: { id: sindicatoBId, nombre: 'RLS Test B', estado: 'activo' } });

      await tx.socio.create({
        data: { sindicatoId: sindicatoAId, nombre: 'Socio A', documentoIdentidad: 'DOC-A', estado: 'activo' },
      });
      await tx.socio.create({
        data: { sindicatoId: sindicatoBId, nombre: 'Socio B', documentoIdentidad: 'DOC-B', estado: 'activo' },
      });

      await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoAId,
          placa: 'RLSA01',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });
      await tx.vehiculo.create({
        data: {
          sindicatoId: sindicatoBId,
          placa: 'RLSB01',
          tipo: 'bus',
          marca: 'x',
          modelo: 'x',
          color: 'x',
          capacidad: 10,
          estado: 'activo',
        },
      });

      await tx.conductor.create({
        data: {
          sindicatoId: sindicatoAId,
          nombre: 'Conductor A',
          documentoIdentidad: 'CD-A',
          licenciaConducir: 'LIC-A',
          estado: 'activo',
        },
      });
      await tx.conductor.create({
        data: {
          sindicatoId: sindicatoBId,
          nombre: 'Conductor B',
          documentoIdentidad: 'CD-B',
          licenciaConducir: 'LIC-B',
          estado: 'activo',
        },
      });

      await tx.linea.create({ data: { sindicatoId: sindicatoAId, codigo: 'RLSL1', nombre: 'Línea A' } });
      await tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'RLSL1', nombre: 'Línea B' } });

      // M2 (rotaciones) y M4 (reglas/sanciones) llegaron después de este archivo (QUI-218)
      // y nunca se sumaron acá — QUI-251 lo corrige, mismo criterio que las tablas de M1.
      await tx.rotacion.create({ data: { sindicatoId: sindicatoAId, periodo: 'RLS-A', estado: 'borrador' } });
      await tx.rotacion.create({ data: { sindicatoId: sindicatoBId, periodo: 'RLS-B', estado: 'borrador' } });

      const reglaA = await tx.regla.create({
        data: {
          sindicatoId: sindicatoAId,
          nombre: 'Regla A',
          tipo: 'x',
          gravedad: 'leve',
          aplicaA: 'vehiculo',
          estado: 'activo',
        },
      });
      const reglaB = await tx.regla.create({
        data: {
          sindicatoId: sindicatoBId,
          nombre: 'Regla B',
          tipo: 'x',
          gravedad: 'leve',
          aplicaA: 'vehiculo',
          estado: 'activo',
        },
      });
      reglaAId = reglaA.id;
      reglaBId = reglaB.id;

      await tx.sancion.create({
        data: {
          sindicatoId: sindicatoAId,
          reglaId: reglaAId,
          sujetoTipo: 'vehiculo',
          sujetoId: randomUUID(),
          motivo: 'x',
          fechaHecho: new Date('2026-01-01'),
          estado: 'pendiente',
        },
      });
      await tx.sancion.create({
        data: {
          sindicatoId: sindicatoBId,
          reglaId: reglaBId,
          sujetoTipo: 'vehiculo',
          sujetoId: randomUUID(),
          motivo: 'x',
          fechaHecho: new Date('2026-01-01'),
          estado: 'pendiente',
        },
      });
    });
  });

  afterAll(async () => {
    await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
      const sindicatoIds = { in: [sindicatoAId, sindicatoBId] };
      await tx.sancion.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.regla.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.rotacion.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.linea.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.conductor.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.vehiculo.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.socio.deleteMany({ where: { sindicatoId: sindicatoIds } });
      await tx.sindicato.deleteMany({ where: { id: sindicatoIds } });
    });
    await prisma.$disconnect();
  });

  it('sindicato A no ve el registro de sindicato B en sindicatos', async () => {
    const row = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.sindicato.findUnique({ where: { id: sindicatoBId } }),
    );
    expect(row).toBeNull();
  });

  it('sindicato A no ve socios de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.socio.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no ve vehículos de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.vehiculo.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no ve conductores de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.conductor.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no ve líneas de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.linea.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no puede modificar (UPDATE) líneas de sindicato B', async () => {
    const result = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.linea.updateMany({ where: { sindicatoId: sindicatoBId }, data: { nombre: 'hackeado' } }),
    );
    expect(result.count).toBe(0);
  });

  it('sindicato A no puede crear (INSERT) filas a nombre de sindicato B', async () => {
    await expect(
      withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
        tx.linea.create({ data: { sindicatoId: sindicatoBId, codigo: 'HACK', nombre: 'hack' } }),
      ),
    ).rejects.toThrow();
  });

  it('admin_quivo ve filas de ambos sindicatos (bypass explícito)', async () => {
    const rows = await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, (tx) =>
      tx.sindicato.findMany({ where: { id: { in: [sindicatoAId, sindicatoBId] } } }),
    );
    expect(rows).toHaveLength(2);
  });

  it('sindicato A sí ve sus propias filas', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.socio.findMany({ where: { sindicatoId: sindicatoAId } }),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('sindicato A no ve rotaciones de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.rotacion.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no ve reglas de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.regla.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no ve sanciones de sindicato B', async () => {
    const rows = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.sancion.findMany({ where: { sindicatoId: sindicatoBId } }),
    );
    expect(rows).toHaveLength(0);
  });

  it('sindicato A no puede modificar (UPDATE) reglas de sindicato B', async () => {
    const result = await withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
      tx.regla.updateMany({ where: { sindicatoId: sindicatoBId }, data: { nombre: 'hackeado' } }),
    );
    expect(result.count).toBe(0);
  });

  it('sindicato A no puede crear (INSERT) una rotación a nombre de sindicato B', async () => {
    await expect(
      withTenantContext({ rol: 'admin_sindicato', sindicatoId: sindicatoAId }, (tx) =>
        tx.rotacion.create({ data: { sindicatoId: sindicatoBId, periodo: 'HACK', estado: 'borrador' } }),
      ),
    ).rejects.toThrow();
  });
});
