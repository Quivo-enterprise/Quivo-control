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
const PUNTO_CONTROL_1_ID = 'aaaaaaaa-0000-4000-8000-000000000010';
const PUNTO_CONTROL_2_ID = 'aaaaaaaa-0000-4000-8000-000000000011';
// Ruta real en Cochabamba (Plaza Colón → La Cancha), generada con OSRM local siguiendo
// calles reales — antes esto apuntaba a coordenadas de Buenos Aires (placeholder de
// scaffolding inicial), lo que hacía imposible probar geofencing/ruteo en un dispositivo
// físico en Bolivia (la app siempre reportaba miles de km de distancia).
const GEOMETRIA_DEMO = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-66.157283, -17.385423], [-66.157584, -17.385017], [-66.157653, -17.384924],
    [-66.157675, -17.384894], [-66.157692, -17.38487], [-66.157737, -17.384856],
    [-66.15778, -17.384853], [-66.15783, -17.384867], [-66.157888, -17.384899],
    [-66.157941, -17.384942], [-66.157965, -17.384985], [-66.157974, -17.385026],
    [-66.157971, -17.385072], [-66.15796, -17.385086], [-66.157936, -17.385118],
    [-66.157861, -17.385215], [-66.157761, -17.385339], [-66.157508, -17.385663],
    [-66.156861, -17.38651], [-66.156791, -17.386605], [-66.156745, -17.386658],
    [-66.156462, -17.38703], [-66.156066, -17.387551], [-66.156053, -17.387598],
    [-66.15605, -17.387649], [-66.156049, -17.38771], [-66.156298, -17.387754],
    [-66.156277, -17.387878], [-66.156214, -17.388445], [-66.156169, -17.388719],
    [-66.156157, -17.388816], [-66.156146, -17.388882], [-66.155989, -17.389806],
    [-66.155978, -17.389865], [-66.155974, -17.389891], [-66.155971, -17.389909],
    [-66.1558, -17.390905], [-66.155613, -17.391912], [-66.155607, -17.391979],
    [-66.155589, -17.392068], [-66.155571, -17.392144], [-66.155511, -17.392419],
    [-66.155395, -17.392975], [-66.155383, -17.39301], [-66.155373, -17.393045],
    [-66.155272, -17.393581], [-66.155193, -17.394003], [-66.155185, -17.394046],
    [-66.15519, -17.39411], [-66.155102, -17.394555], [-66.155099, -17.394569],
    [-66.155095, -17.394591], [-66.155047, -17.394856], [-66.155014, -17.395035],
    [-66.155006, -17.395068], [-66.154837, -17.39592], [-66.15481, -17.396053],
    [-66.154794, -17.396134], [-66.15467, -17.396758], [-66.15458, -17.397192],
    [-66.154417, -17.398099], [-66.154389, -17.398223], [-66.154228, -17.398993],
    [-66.154206, -17.399084], [-66.154149, -17.39907], [-66.153193, -17.398846],
    [-66.153125, -17.398831], [-66.152748, -17.398736], [-66.15272, -17.398727],
    [-66.152659, -17.398707], [-66.152219, -17.398546], [-66.152079, -17.398506],
    [-66.151998, -17.398495], [-66.151842, -17.398499], [-66.151085, -17.39854],
    [-66.150657, -17.398596], [-66.150467, -17.398591], [-66.149941, -17.398553],
    [-66.149907, -17.399004], [-66.149849, -17.399867], [-66.149846, -17.399962],
    [-66.149783, -17.400029], [-66.149705, -17.400128], [-66.149377, -17.400468],
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
    ON CONFLICT (id) DO UPDATE SET geometria = EXCLUDED.geometria
  `;

  // Puntos de control sobre el tramo 1/3 y 2/3 de GEOMETRIA_DEMO (misma ruta real) — sin
  // esto el paquete del día móvil no tiene ningún punto al que trazarle el camino ni
  // detectar cumplimiento (RF-64..66), y la UI del conductor no puede demostrarse
  // end-to-end.
  await tx.$executeRaw`
    INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
    VALUES
      (${PUNTO_CONTROL_1_ID}, ${RUTA_A_ID}, 0, ST_SetSRID(ST_MakePoint(-66.156214, -17.388445), 4326)::geography, 100, true, now(), now()),
      (${PUNTO_CONTROL_2_ID}, ${RUTA_A_ID}, 1, ST_SetSRID(ST_MakePoint(-66.15481, -17.396053), 4326)::geography, 100, true, now(), now())
    ON CONFLICT (id) DO UPDATE SET coord = EXCLUDED.coord, orden = EXCLUDED.orden
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
