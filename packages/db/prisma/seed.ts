import 'dotenv/config';
import { APIError } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
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
const SEED_PIN_VEHICULO = process.env.MOBILE_SEED_VEHICLE_PIN ?? '246810';
const SEED_PIN_CONDUCTOR = process.env.MOBILE_SEED_DRIVER_PIN ?? '135790';

/** IDs fijos (no aleatorios) para que el seed sea idempotente y para que el test
 * cross-tenant de RLS (QUI-218) pueda referenciarlos sin tener que leerlos primero. */
const SINDICATO_A_ID = '11111111-1111-4111-8111-111111111111';
const SINDICATO_B_ID = '22222222-2222-4222-8222-222222222222';

const SINDICATOS = [
  { id: SINDICATO_A_ID, nombre: 'Sindicato 1º de Mayo', estado: 'activo' },
  { id: SINDICATO_B_ID, nombre: 'Sindicato Unificado del Norte', estado: 'activo' },
] as const;

const PLACA_POR_SINDICATO = {
  [SINDICATO_A_ID]: '1001ABC',
  [SINDICATO_B_ID]: '2002DEF',
} as const;

const CI_SOCIO_POR_SINDICATO = {
  [SINDICATO_A_ID]: '1000001 LP',
  [SINDICATO_B_ID]: '2000002 SC',
} as const;

const CI_CONDUCTOR_POR_SINDICATO = {
  [SINDICATO_A_ID]: '1000101 LP',
  [SINDICATO_B_ID]: '2000202 SC',
} as const;

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
async function seedDatosDePrueba(
  tx: Prisma.TransactionClient,
  credenciales: { vehiculoHash: string; conductorHash: string },
): Promise<void> {
  for (const sindicato of SINDICATOS) {
    const placa = PLACA_POR_SINDICATO[sindicato.id];
    const ciSocio = CI_SOCIO_POR_SINDICATO[sindicato.id];
    const ciConductor = CI_CONDUCTOR_POR_SINDICATO[sindicato.id];
    const placaDemoAnterior = `AB${sindicato.id.slice(0, 3)}`;
    const socio = await tx.socio.upsert({
      where: { id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000001` },
      update: { documentoIdentidad: ciSocio },
      create: {
        id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000001`,
        sindicatoId: sindicato.id,
        nombre: `Socio de prueba (${sindicato.nombre})`,
        documentoIdentidad: ciSocio,
        estado: 'activo',
      },
    });

    const vehiculoDemo = await tx.vehiculo.findFirst({
      where: { sindicatoId: sindicato.id, placa: { in: [placa, placaDemoAnterior] } },
    });
    if (vehiculoDemo) {
      await tx.vehiculo.update({
        where: { id: vehiculoDemo.id },
        data: {
          placa,
          placaNormalizada: placa,
          credencialHash: credenciales.vehiculoHash,
        },
      });
    } else {
      await tx.vehiculo.create({
        data: {
          sindicatoId: sindicato.id,
          socioId: socio.id,
          placa,
          placaNormalizada: placa,
          tipo: 'bus_urbano',
          marca: 'Mercedes-Benz',
          modelo: 'OF-1721',
          color: 'blanco',
          capacidad: 40,
          estado: 'activo',
          credencialHash: credenciales.vehiculoHash,
        },
      });
    }

    await tx.conductor.upsert({
      where: { id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000002` },
      update: {
        documentoIdentidad: ciConductor,
        licenciaConducir: ciConductor,
        credencialHash: credenciales.conductorHash,
      },
      create: {
        id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000002`,
        sindicatoId: sindicato.id,
        nombre: `Conductor de prueba (${sindicato.nombre})`,
        documentoIdentidad: ciConductor,
        licenciaConducir: ciConductor,
        estado: 'activo',
        credencialHash: credenciales.conductorHash,
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
const RUTA_A_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ROTACION_A_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const ROTACION_MOVIL_ID = 'aaaaaaaa-0000-4000-8000-000000000005';
const GEOMETRIA_DEMO = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-58.4, -34.6],
    [-58.39, -34.6],
    [-58.38, -34.61],
  ],
});

/** Una ruta + rotación + 2 asignaciones de ejemplo para el sindicato A — solo para tener
 * algo real que mostrar en la UI de rotaciones (QUI-233) sin depender de altas manuales.
 * `geometria` es raw SQL porque Prisma no tipa GEOGRAPHY (ver comentario en schema.prisma). */
async function seedRotaciones(tx: Prisma.TransactionClient): Promise<void> {
  const linea = await tx.linea.findUniqueOrThrow({
    where: { sindicatoId_codigo: { sindicatoId: SINDICATO_A_ID, codigo: 'L1' } },
  });
  const vehiculo = await tx.vehiculo.findUniqueOrThrow({
    where: {
      sindicatoId_placa: {
        sindicatoId: SINDICATO_A_ID,
        placa: PLACA_POR_SINDICATO[SINDICATO_A_ID],
      },
    },
  });
  const conductor = await tx.conductor.findUniqueOrThrow({
    where: { id: `${SINDICATO_A_ID.slice(0, 8)}-0000-4000-8000-000000000002` },
  });

  await tx.$executeRaw`
    INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
    VALUES (${RUTA_A_ID}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_DEMO}), 4326)::geography, 'activo', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;

  await tx.rotacion.upsert({
    where: { id: ROTACION_A_ID },
    update: {},
    create: {
      id: ROTACION_A_ID,
      sindicatoId: SINDICATO_A_ID,
      periodo: '2026-08',
      estado: 'borrador',
    },
  });

  const ASIGNACIONES_DEMO = [
    { horario: 'manana' as const, orden: 1 },
    { horario: 'tarde' as const, orden: 2 },
  ];
  for (const asignacion of ASIGNACIONES_DEMO) {
    await tx.asignacion.upsert({
      where: {
        vehiculoId_fecha_horario: {
          vehiculoId: vehiculo.id,
          fecha: new Date('2026-08-03'),
          horario: asignacion.horario,
        },
      },
      update: {},
      create: {
        rotacionId: ROTACION_A_ID,
        vehiculoId: vehiculo.id,
        conductorId: conductor.id,
        rutaId: RUTA_A_ID,
        fecha: new Date('2026-08-03'),
        horario: asignacion.horario,
        orden: asignacion.orden,
        venceAt: new Date('2026-08-04T03:59:59Z'),
      },
    });
  }

  const fechaMovil = fechaActualBolivia();
  await tx.rotacion.upsert({
    where: { id: ROTACION_MOVIL_ID },
    update: { estado: 'publicada' },
    create: {
      id: ROTACION_MOVIL_ID,
      sindicatoId: SINDICATO_A_ID,
      periodo: 'prueba-movil',
      estado: 'publicada',
    },
  });
  await tx.asignacion.upsert({
    where: {
      vehiculoId_fecha_horario: {
        vehiculoId: vehiculo.id,
        fecha: fechaMovil,
        horario: 'manana',
      },
    },
    update: {
      rotacionId: ROTACION_MOVIL_ID,
      conductorId: conductor.id,
      rutaId: RUTA_A_ID,
      orden: 1,
      venceAt: finDeJornadaBolivia(fechaMovil),
      estado: 'vigente',
    },
    create: {
      rotacionId: ROTACION_MOVIL_ID,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      rutaId: RUTA_A_ID,
      fecha: fechaMovil,
      horario: 'manana',
      orden: 1,
      venceAt: finDeJornadaBolivia(fechaMovil),
      estado: 'vigente',
    },
  });

  console.log('Rotaciones web/móvil de prueba listas para Sindicato 1º de Mayo');
}

const REGLA_A_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const SANCION_A_ID = 'aaaaaaaa-0000-4000-8000-000000000004';

/** Una regla + una sanción de ejemplo (RF-40..50, QUI-244) — mismo motivo que
 * seedRotaciones: tener algo real que mostrar en `/reglas` sin depender de altas manuales. */
async function seedReglas(tx: Prisma.TransactionClient): Promise<void> {
  const vehiculo = await tx.vehiculo.findUniqueOrThrow({
    where: {
      sindicatoId_placa: {
        sindicatoId: SINDICATO_A_ID,
        placa: PLACA_POR_SINDICATO[SINDICATO_A_ID],
      },
    },
  });

  await tx.regla.upsert({
    where: { id: REGLA_A_ID },
    update: {},
    create: {
      id: REGLA_A_ID,
      sindicatoId: SINDICATO_A_ID,
      nombre: 'Retraso injustificado',
      tipo: 'puntualidad',
      gravedad: 'leve',
      aplicaA: 'vehiculo',
      estado: 'activo',
    },
  });

  await tx.sancion.upsert({
    where: { id: SANCION_A_ID },
    update: {},
    create: {
      id: SANCION_A_ID,
      sindicatoId: SINDICATO_A_ID,
      reglaId: REGLA_A_ID,
      sujetoTipo: 'vehiculo',
      sujetoId: vehiculo.id,
      motivo: 'Llegó 25 minutos tarde al inicio del turno',
      fechaHecho: new Date('2026-08-01'),
      estado: 'pendiente',
    },
  });

  console.log('Regla + sanción de prueba listas para Sindicato 1º de Mayo');
}

async function seed(): Promise<void> {
  const [vehiculoHash, conductorHash] = await Promise.all([
    hashPassword(SEED_PIN_VEHICULO),
    hashPassword(SEED_PIN_CONDUCTOR),
  ]);
  // admin_quivo: única forma de bypassear RLS (QUI-218) sin depender de qué rol de
  // Postgres esté conectado — ver packages/db/src/tenant-context.ts.
  await withTenantContext({ rol: 'admin_quivo', sindicatoId: null }, async (tx) => {
    await seedSindicatos(tx);
    await seedDatosDePrueba(tx, { vehiculoHash, conductorHash });
    await seedRotaciones(tx);
    await seedReglas(tx);
  });
  // Better-Auth usa su propio adapter Prisma (no pasa por `tx`) pero sus tablas no tienen
  // RLS (ver comentario en la migración `rls_multi_tenant`), así que corre bien afuera.
  await seedUsuarios();
}

function fechaActualBolivia(ahora: Date = new Date()): Date {
  const bolivia = new Date(ahora.getTime() - 4 * 3_600_000);
  return new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
}

function finDeJornadaBolivia(fecha: Date): Date {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + 1, 3, 59, 59),
  );
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Error corriendo el seed', error);
    process.exit(1);
  });
