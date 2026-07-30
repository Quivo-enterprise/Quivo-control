import 'dotenv/config';
import { APIError } from 'better-auth';
import type { Prisma } from '@prisma/client';
import { auth } from '../src/auth.js';
import { withTenantContext } from '../src/tenant-context.js';

/**
 * Usuarios demo para probar login/refresh reales (QUI-219) sin depender de un backoffice
 * de altas todavía inexistente. Password fija documentada en apps/api/README.md — mismo
 * nivel de exposición que el resto de datos demo del repo (ver también
 * apps/web/src/lib/demo-data.ts). Se crean vía `auth.api.signUpEmail` (no insertando filas
 * a mano) para que Better-Auth siga siendo quien hashea la contraseña.
 */
const SEED_PASSWORD = 'Quivo123!';

/** IDs fijos (no aleatorios) para que el seed sea idempotente y para que el test
 * cross-tenant de RLS (QUI-218) pueda referenciarlos sin tener que leerlos primero. */
const SINDICATO_A_ID = '11111111-1111-4111-8111-111111111111';
const SINDICATO_B_ID = '22222222-2222-4222-8222-222222222222';

const SINDICATOS = [
  { id: SINDICATO_A_ID, nombre: 'Sindicato 1º de Mayo', estado: 'activo' },
  { id: SINDICATO_B_ID, nombre: 'Sindicato Unificado del Norte', estado: 'activo' },
] as const;

const USERS = [
  { email: 'admin@quivo.local', name: 'Admin QUIVO', rol: 'admin_quivo', sindicatoId: null },
  {
    email: 'admin@sindicato.local',
    name: 'Admin Sindicato 1º de Mayo',
    rol: 'admin_sindicato',
    sindicatoId: SINDICATO_A_ID,
  },
] as const;

async function seedSindicatos(tx: Prisma.TransactionClient): Promise<void> {
  for (const sindicato of SINDICATOS) {
    await tx.sindicato.upsert({
      where: { id: sindicato.id },
      update: {},
      create: sindicato,
    });
    console.log(`Sindicato listo: ${sindicato.nombre}`);
  }
}

async function seedUsuarios(): Promise<void> {
  for (const user of USERS) {
    try {
      await auth.api.signUpEmail({
        body: {
          email: user.email,
          password: SEED_PASSWORD,
          name: user.name,
          rol: user.rol,
          sindicatoId: user.sindicatoId,
        },
      });
      console.log(`Creado: ${user.email} (${user.rol})`);
    } catch (error) {
      if (error instanceof APIError && error.status === 'UNPROCESSABLE_ENTITY') {
        console.log(`Ya existía, se omite: ${user.email}`);
        continue;
      }
      throw error;
    }
  }
}

/** Un vehículo, un conductor y una línea de prueba por sindicato — solo para tener datos
 * reales sobre los que probar CRUD y RLS, no representan un catálogo completo. */
async function seedDatosDePrueba(tx: Prisma.TransactionClient): Promise<void> {
  for (const sindicato of SINDICATOS) {
    const socio = await tx.socio.upsert({
      where: { id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000001` },
      update: {},
      create: {
        id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000001`,
        sindicatoId: sindicato.id,
        nombre: `Socio de prueba (${sindicato.nombre})`,
        documentoIdentidad: `DOC-${sindicato.id.slice(0, 8)}`,
        estado: 'activo',
      },
    });

    await tx.vehiculo.upsert({
      where: { sindicatoId_placa: { sindicatoId: sindicato.id, placa: `AB${sindicato.id.slice(0, 3)}` } },
      update: {},
      create: {
        sindicatoId: sindicato.id,
        socioId: socio.id,
        placa: `AB${sindicato.id.slice(0, 3)}`,
        tipo: 'bus',
        marca: 'Mercedes-Benz',
        modelo: 'OF-1721',
        color: 'blanco',
        capacidad: 40,
        estado: 'activo',
      },
    });

    await tx.conductor.upsert({
      where: { id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000002` },
      update: {},
      create: {
        id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000002`,
        sindicatoId: sindicato.id,
        nombre: `Conductor de prueba (${sindicato.nombre})`,
        documentoIdentidad: `LIC-${sindicato.id.slice(0, 8)}`,
        licenciaConducir: `LIC-${sindicato.id.slice(0, 8)}`,
        estado: 'activo',
      },
    });

    await tx.linea.upsert({
      where: { sindicatoId_codigo: { sindicatoId: sindicato.id, codigo: 'L1' } },
      update: {},
      create: {
        sindicatoId: sindicato.id,
        codigo: 'L1',
        nombre: `Línea 1 (${sindicato.nombre})`,
        color: '#5B4DFF',
      },
    });

    console.log(`Datos de prueba listos para ${sindicato.nombre}`);
  }
}

async function seed(): Promise<void> {
  // admin_quivo: única forma de bypassear RLS (QUI-218) sin depender de qué rol de
  // Postgres esté conectado — ver packages/db/src/tenant-context.ts.
  await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
    await seedSindicatos(tx);
    await seedDatosDePrueba(tx);
  });
  // Better-Auth usa su propio adapter Prisma (no pasa por `tx`) pero sus tablas no tienen
  // RLS (ver comentario en la migración `rls_multi_tenant`), así que corre bien afuera.
  await seedUsuarios();
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Error corriendo el seed', error);
    process.exit(1);
  });
