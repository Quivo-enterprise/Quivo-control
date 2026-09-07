// El script `prisma:seed` (package.json) es `prisma generate && tsx prisma/seed.ts`, no
// solo `tsx prisma/seed.ts` — no lo simplifiques aunque parezca redundante. La garantía
// real de que el cliente de Prisma existe en disco es el `postinstall` de
// `packages/db/package.json` (corre `prisma generate` en todo `pnpm install`, incluso
// `--frozen-lockfile`, incluso en CI), así que en teoría este `prisma generate` de acá ya
// no hace falta. Se deja de todos modos como red de seguridad barata: protege a quien
// corra `prisma:seed` sin haber pasado por un `pnpm install` fresco desde el último cambio
// de schema (p. ej. tras un `git checkout` a una rama con otro `schema.prisma`, con
// `node_modules` ya instalado). El motivo por el que hace falta *alguna* garantía es
// Turbo: si `@quivo/db:build` (`prisma generate && tsc`, ver turbo.json) resulta *cache
// hit* (los inputs no cambiaron desde una corrida anterior), Turbo restaura sus `outputs`
// declarados (`dist/**`) y NO reejecuta el comando — o sea, ese `prisma generate` no corre
// y no se puede confiar en él. El cliente generado vive en
// `node_modules/.pnpm/@prisma+client@.../node_modules/.prisma`, una ruta con hash de pnpm
// que no es (ni conviene declarar como) un output de Turbo, así que la caché de Turbo no
// la restaura ni la protege. Sin alguna fuente de verdad que corra `prisma generate`, este
// seed —y cualquiera que lo corra tras un cache hit sin `postinstall`, en CI o en local—
// revienta al importar `PrismaClient` de '@prisma/client' con
// "does not provide an export named 'PrismaClient'".
import 'dotenv/config';
import { randomInt } from 'node:crypto';
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
const HORARIO_MOVIL_DEMO = 'tarde' as const;
const HORA_SALIDA_MOVIL_DEMO = '15:00';
const HORA_PRESENTACION_MOVIL_DEMO = '14:45';

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

const NOMBRE_SOCIO_POR_SINDICATO = {
  [SINDICATO_A_ID]: 'María Quispe Mamani',
  [SINDICATO_B_ID]: 'José Choque Mamani',
} as const;

const NOMBRE_CONDUCTOR_POR_SINDICATO = {
  [SINDICATO_A_ID]: 'Pedro Quispe Mamani',
  [SINDICATO_B_ID]: 'Lucía Choque Mamani',
} as const;

// QUI-366: sindicato del piloto real (arranca el lunes) + segundo tenant SOLO para las
// pruebas de aislamiento que exige `docs/piloto/checklist-aceptacion-e2e.md` ("Usuario de
// otro sindicato no puede leer ni modificar estos datos" — aparece dos veces ahí). Ninguno
// de los dos se mezcla con `SINDICATO_A_ID`/`SINDICATO_B_ID` de arriba (esos son datos demo
// genéricos usados por CREDENCIALES.md, tests de aceptación y RLS ad hoc desde antes; no
// son el piloto). IDs fijos, mismo criterio de idempotencia que el resto del archivo.
const SINDICATO_PILOTO_ID = '33333333-3333-4333-8333-333333333333';
const SINDICATO_AISLAMIENTO_ID = '44444444-4444-4444-8444-444444444444';

const LINEA_PILOTO_ID = '33333333-3333-4333-8333-000000000010';
const RUTA_PILOTO_ID = '33333333-3333-4333-8333-000000000011';
const PC_PILOTO_1_ID = '33333333-3333-4333-8333-000000000012';
const PC_PILOTO_2_ID = '33333333-3333-4333-8333-000000000013';
const VEHICULO_PILOTO_ID = '33333333-3333-4333-8333-000000000014';
const CONDUCTOR_PILOTO_ID = '33333333-3333-4333-8333-000000000015';

const USERS = [
  { email: 'admin@quivo.local', name: 'Admin QUIVO', rol: 'admin_quivo', sindicatoId: null },
  {
    email: 'admin@sindicato.local',
    name: 'Admin Sindicato 1º de Mayo',
    rol: 'admin_sindicato',
    sindicatoId: SINDICATO_A_ID,
  },
  // Único propósito: intentar leer/modificar datos del sindicato piloto desde OTRO tenant
  // durante el checklist de aceptación E2E (QUI-366) — no representa un sindicato real.
  {
    email: 'admin@aislamiento.local',
    name: 'Admin Sindicato de Aislamiento (solo pruebas E2E)',
    rol: 'admin_sindicato',
    sindicatoId: SINDICATO_AISLAMIENTO_ID,
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
    const nombreSocio = NOMBRE_SOCIO_POR_SINDICATO[sindicato.id];
    const nombreConductor = NOMBRE_CONDUCTOR_POR_SINDICATO[sindicato.id];
    const placaDemoAnterior = `AB${sindicato.id.slice(0, 3)}`;
    const socio = await tx.socio.upsert({
      where: { id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000001` },
      update: { nombre: nombreSocio, documentoIdentidad: ciSocio },
      create: {
        id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000001`,
        sindicatoId: sindicato.id,
        nombre: nombreSocio,
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
          numeroInterno: '120-01',
          distintivo: 'Banderita Roja',
          cartelSuperior: 'PLAZA COLÓN · LA CANCHA',
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
          numeroInterno: '120-01',
          distintivo: 'Banderita Roja',
          cartelSuperior: 'PLAZA COLÓN · LA CANCHA',
          capacidad: 40,
          estado: 'activo',
          credencialHash: credenciales.vehiculoHash,
        },
      });
    }

    await tx.conductor.upsert({
      where: { id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000002` },
      update: {
        nombre: nombreConductor,
        documentoIdentidad: ciConductor,
        licenciaConducir: ciConductor,
        credencialHash: credenciales.conductorHash,
      },
      create: {
        id: `${sindicato.id.slice(0, 8)}-0000-4000-8000-000000000002`,
        sindicatoId: sindicato.id,
        nombre: nombreConductor,
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

// Datos de presentación de la Línea 120 (Cochabamba): Plaza Colón ↔ La Cancha.
// Se mantienen IDs fijos para que el seed sea idempotente y la asignación móvil pueda
// apuntar siempre a la ruta de la prueba sin depender de lecturas previas.
const LINEA_120_ID = '12000000-1200-4200-8200-120000000001';
const RUTA_120_IDA_ID = '12000000-1200-4200-8200-120000000010';
const RUTA_120_VUELTA_ID = '12000000-1200-4200-8200-120000000011';
const VARIANTE_120_IDA_ID = '12000000-1200-4200-8200-120000000020';
const VARIANTE_120_VUELTA_ID = '12000000-1200-4200-8200-120000000021';
const LOGO_LINEA_120_URL = `${process.env.API_PUBLIC_URL ?? 'http://localhost:3001'}/v1/media/lineas/linea-120-universitaria.png`;

function geometria120Ida(): string {
  return GEOMETRIA_DEMO;
}

function geometria120Vuelta(): string {
  const geometry = JSON.parse(GEOMETRIA_DEMO) as {
    type: 'LineString';
    coordinates: Array<[number, number]>;
  };
  return JSON.stringify({ ...geometry, coordinates: [...geometry.coordinates].reverse() });
}

const PUNTOS_120_IDA = [
  {
    id: '12000000-1200-4200-8200-120000000101',
    tipo: 'origen',
    orden: 0,
    longitude: -66.157283,
    latitude: -17.385423,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000105',
    tipo: 'intermedia',
    orden: 1,
    longitude: -66.157888,
    latitude: -17.384899,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000106',
    tipo: 'intermedia',
    orden: 2,
    longitude: -66.157761,
    latitude: -17.385339,
    radioToleranciaM: 100,
    esControl: false,
  },
  {
    id: '12000000-1200-4200-8200-120000000107',
    tipo: 'intermedia',
    orden: 3,
    longitude: -66.15605,
    latitude: -17.387649,
    radioToleranciaM: 100,
    esControl: false,
  },
  {
    id: '12000000-1200-4200-8200-120000000102',
    tipo: 'intermedia',
    orden: 4,
    longitude: -66.156214,
    latitude: -17.388445,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000108',
    tipo: 'intermedia',
    orden: 5,
    longitude: -66.1558,
    latitude: -17.390905,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000109',
    tipo: 'intermedia',
    orden: 6,
    longitude: -66.155373,
    latitude: -17.393045,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000110',
    tipo: 'intermedia',
    orden: 7,
    longitude: -66.155047,
    latitude: -17.394856,
    radioToleranciaM: 100,
    esControl: false,
  },
  {
    id: '12000000-1200-4200-8200-120000000103',
    tipo: 'intermedia',
    orden: 8,
    longitude: -66.15481,
    latitude: -17.396053,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000111',
    tipo: 'intermedia',
    orden: 9,
    longitude: -66.154149,
    latitude: -17.39907,
    radioToleranciaM: 100,
    esControl: false,
  },
  {
    id: '12000000-1200-4200-8200-120000000112',
    tipo: 'intermedia',
    orden: 10,
    longitude: -66.151998,
    latitude: -17.398495,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000104',
    tipo: 'destino',
    orden: 11,
    longitude: -66.149377,
    latitude: -17.400468,
    radioToleranciaM: 100,
    esControl: true,
  },
] as const;

const PUNTOS_120_VUELTA = [
  {
    id: '12000000-1200-4200-8200-120000000201',
    tipo: 'origen',
    orden: 0,
    longitude: -66.149377,
    latitude: -17.400468,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000202',
    tipo: 'intermedia',
    orden: 1,
    longitude: -66.151998,
    latitude: -17.398495,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000203',
    tipo: 'intermedia',
    orden: 2,
    longitude: -66.154149,
    latitude: -17.39907,
    radioToleranciaM: 100,
    esControl: false,
  },
  {
    id: '12000000-1200-4200-8200-120000000204',
    tipo: 'intermedia',
    orden: 3,
    longitude: -66.15481,
    latitude: -17.396053,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000205',
    tipo: 'intermedia',
    orden: 4,
    longitude: -66.155047,
    latitude: -17.394856,
    radioToleranciaM: 100,
    esControl: false,
  },
  {
    id: '12000000-1200-4200-8200-120000000206',
    tipo: 'intermedia',
    orden: 5,
    longitude: -66.155373,
    latitude: -17.393045,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000207',
    tipo: 'intermedia',
    orden: 6,
    longitude: -66.1558,
    latitude: -17.390905,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000208',
    tipo: 'intermedia',
    orden: 7,
    longitude: -66.156214,
    latitude: -17.388445,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000209',
    tipo: 'intermedia',
    orden: 8,
    longitude: -66.15605,
    latitude: -17.387649,
    radioToleranciaM: 100,
    esControl: false,
  },
  {
    id: '12000000-1200-4200-8200-120000000210',
    tipo: 'intermedia',
    orden: 9,
    longitude: -66.157761,
    latitude: -17.385339,
    radioToleranciaM: 100,
    esControl: false,
  },
  {
    id: '12000000-1200-4200-8200-120000000211',
    tipo: 'intermedia',
    orden: 10,
    longitude: -66.157888,
    latitude: -17.384899,
    radioToleranciaM: 100,
    esControl: true,
  },
  {
    id: '12000000-1200-4200-8200-120000000212',
    tipo: 'destino',
    orden: 11,
    longitude: -66.157283,
    latitude: -17.385423,
    radioToleranciaM: 100,
    esControl: true,
  },
] as const;

async function seedLinea120(tx: Prisma.TransactionClient): Promise<void> {
  await tx.linea.upsert({
    where: { id: LINEA_120_ID },
    update: {
      codigo: '120',
      nombre: 'Línea 120',
      color: '#0f766e',
      colorSecundario: '#f59e0b',
      colorTexto: '#ffffff',
      colorTerciario: '#0ea5a4',
      colorFondo: '#f0fdfa',
      nombreCorto: '120',
      lema: 'Conectando Plaza Colón con La Cancha',
      descripcion: 'Plaza Colón ↔ La Cancha · Cochabamba',
      logoUrl: LOGO_LINEA_120_URL,
      distintivoTipo: 'banderita',
      distintivoValor: 'Banderita Roja',
      cartelSuperior: 'PLAZA COLÓN · LA CANCHA',
      cartelFormato: 'doble_clasico',
      cartelTitulo: 'TIQUIPAYA',
      cartelDetalle: 'UNIVALLE',
      cartelNumeroPosicion: 'izquierda',
      cartelLogoPosicion: 'ninguno',
      cartelColorTitulo: '#b91c1c',
      cartelColorDetalle: '#1d4ed8',
      cartelColorNumero: '#b91c1c',
      cartelColorBorde: '#64748b',
    },
    create: {
      id: LINEA_120_ID,
      sindicatoId: SINDICATO_A_ID,
      codigo: '120',
      nombre: 'Línea 120',
      color: '#0f766e',
      colorSecundario: '#f59e0b',
      colorTexto: '#ffffff',
      colorTerciario: '#0ea5a4',
      colorFondo: '#f0fdfa',
      nombreCorto: '120',
      lema: 'Conectando Plaza Colón con La Cancha',
      descripcion: 'Plaza Colón ↔ La Cancha · Cochabamba',
      logoUrl: LOGO_LINEA_120_URL,
      distintivoTipo: 'banderita',
      distintivoValor: 'Banderita Roja',
      cartelSuperior: 'PLAZA COLÓN · LA CANCHA',
      cartelFormato: 'doble_clasico',
      cartelTitulo: 'TIQUIPAYA',
      cartelDetalle: 'UNIVALLE',
      cartelNumeroPosicion: 'izquierda',
      cartelLogoPosicion: 'ninguno',
      cartelColorTitulo: '#b91c1c',
      cartelColorDetalle: '#1d4ed8',
      cartelColorNumero: '#b91c1c',
      cartelColorBorde: '#64748b',
    },
  });

  // En versiones anteriores de la demo la vuelta usaba los IDs 111–122. Se limpian
  // únicamente esos registros antiguos para que la ampliación de la ruta no deje
  // puntos duplicados ni robe IDs a la ida.
  await tx.$executeRaw`
    DELETE FROM puntos_control
    WHERE "rutaId" = ${RUTA_120_VUELTA_ID}
      AND id IN (
        '12000000-1200-4200-8200-120000000111',
        '12000000-1200-4200-8200-120000000112',
        '12000000-1200-4200-8200-120000000113',
        '12000000-1200-4200-8200-120000000114',
        '12000000-1200-4200-8200-120000000115',
        '12000000-1200-4200-8200-120000000116',
        '12000000-1200-4200-8200-120000000117',
        '12000000-1200-4200-8200-120000000118',
        '12000000-1200-4200-8200-120000000119',
        '12000000-1200-4200-8200-120000000120',
        '12000000-1200-4200-8200-120000000121',
        '12000000-1200-4200-8200-120000000122'
      )
  `;
  await tx.$executeRaw`
    DELETE FROM paradas
    WHERE "rutaId" = ${RUTA_120_VUELTA_ID}
      AND id IN (
        '12000000-1200-4200-8200-120000000111',
        '12000000-1200-4200-8200-120000000112',
        '12000000-1200-4200-8200-120000000113',
        '12000000-1200-4200-8200-120000000114',
        '12000000-1200-4200-8200-120000000115',
        '12000000-1200-4200-8200-120000000116',
        '12000000-1200-4200-8200-120000000117',
        '12000000-1200-4200-8200-120000000118',
        '12000000-1200-4200-8200-120000000119',
        '12000000-1200-4200-8200-120000000120',
        '12000000-1200-4200-8200-120000000121',
        '12000000-1200-4200-8200-120000000122'
      )
  `;

  const sentidos = [
    {
      id: RUTA_120_IDA_ID,
      sentido: 'ida',
      varianteId: VARIANTE_120_IDA_ID,
      geometria: geometria120Ida(),
      puntos: PUNTOS_120_IDA,
    },
    {
      id: RUTA_120_VUELTA_ID,
      sentido: 'vuelta',
      varianteId: VARIANTE_120_VUELTA_ID,
      geometria: geometria120Vuelta(),
      puntos: PUNTOS_120_VUELTA,
    },
  ] as const;

  for (const ruta of sentidos) {
    await tx.$executeRaw`
      INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
      VALUES (
        ${ruta.id}, ${LINEA_120_ID}, ${ruta.sentido},
        ST_SetSRID(ST_GeomFromGeoJSON(${ruta.geometria}), 4326)::geography,
        'activo', now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        "lineaId" = EXCLUDED."lineaId",
        sentido = EXCLUDED.sentido,
        geometria = EXCLUDED.geometria,
        estado = 'activo',
        "updatedAt" = now()
    `;

    await tx.variante.upsert({
      where: { id: ruta.varianteId },
      update: { rutaId: ruta.id, nombre: 'Ramal Central', estado: 'activo' },
      create: {
        id: ruta.varianteId,
        rutaId: ruta.id,
        nombre: 'Ramal Central',
        estado: 'activo',
      },
    });

    for (const punto of ruta.puntos) {
      const coord = JSON.stringify({
        type: 'Point',
        coordinates: [punto.longitude, punto.latitude],
      });

      await tx.$executeRaw`
        INSERT INTO paradas (id, "rutaId", tipo, orden, coord, estado, "createdAt", "updatedAt")
        VALUES (
          ${punto.id}, ${ruta.id}, ${punto.tipo}, ${punto.orden},
          ST_SetSRID(ST_GeomFromGeoJSON(${coord}), 4326)::geography,
          'activo', now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          "rutaId" = EXCLUDED."rutaId",
          tipo = EXCLUDED.tipo,
          orden = EXCLUDED.orden,
          coord = EXCLUDED.coord,
          estado = 'activo',
          "updatedAt" = now()
      `;

      if (!punto.esControl) continue;

      await tx.$executeRaw`
        INSERT INTO puntos_control (
          id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado,
          "createdAt", "updatedAt"
        )
        VALUES (
          ${punto.id}, ${ruta.id}, ${punto.orden},
          ST_SetSRID(ST_GeomFromGeoJSON(${coord}), 4326)::geography,
          ${punto.radioToleranciaM}, true, 'activo', now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          "rutaId" = EXCLUDED."rutaId",
          orden = EXCLUDED.orden,
          coord = EXCLUDED.coord,
          "radioToleranciaM" = EXCLUDED."radioToleranciaM",
          obligatorio = true,
          estado = 'activo',
          "updatedAt" = now()
      `;
    }
  }

  console.log('Línea 120 lista: ida/vuelta, Ramal Central, paradas y puntos de control');
}

// Ruta real en Cochabamba (Plaza Colón → La Cancha), generada con OSRM local siguiendo
// calles reales — antes esto apuntaba a coordenadas de Buenos Aires (placeholder de
// scaffolding inicial), lo que hacía imposible probar geofencing/ruteo en un dispositivo
// físico en Bolivia (la app siempre reportaba miles de km de distancia).
const GEOMETRIA_DEMO = JSON.stringify({
  type: 'LineString',
  coordinates: [
    [-66.157283, -17.385423],
    [-66.157584, -17.385017],
    [-66.157653, -17.384924],
    [-66.157675, -17.384894],
    [-66.157692, -17.38487],
    [-66.157737, -17.384856],
    [-66.15778, -17.384853],
    [-66.15783, -17.384867],
    [-66.157888, -17.384899],
    [-66.157941, -17.384942],
    [-66.157965, -17.384985],
    [-66.157974, -17.385026],
    [-66.157971, -17.385072],
    [-66.15796, -17.385086],
    [-66.157936, -17.385118],
    [-66.157861, -17.385215],
    [-66.157761, -17.385339],
    [-66.157508, -17.385663],
    [-66.156861, -17.38651],
    [-66.156791, -17.386605],
    [-66.156745, -17.386658],
    [-66.156462, -17.38703],
    [-66.156066, -17.387551],
    [-66.156053, -17.387598],
    [-66.15605, -17.387649],
    [-66.156049, -17.38771],
    [-66.156298, -17.387754],
    [-66.156277, -17.387878],
    [-66.156214, -17.388445],
    [-66.156169, -17.388719],
    [-66.156157, -17.388816],
    [-66.156146, -17.388882],
    [-66.155989, -17.389806],
    [-66.155978, -17.389865],
    [-66.155974, -17.389891],
    [-66.155971, -17.389909],
    [-66.1558, -17.390905],
    [-66.155613, -17.391912],
    [-66.155607, -17.391979],
    [-66.155589, -17.392068],
    [-66.155571, -17.392144],
    [-66.155511, -17.392419],
    [-66.155395, -17.392975],
    [-66.155383, -17.39301],
    [-66.155373, -17.393045],
    [-66.155272, -17.393581],
    [-66.155193, -17.394003],
    [-66.155185, -17.394046],
    [-66.15519, -17.39411],
    [-66.155102, -17.394555],
    [-66.155099, -17.394569],
    [-66.155095, -17.394591],
    [-66.155047, -17.394856],
    [-66.155014, -17.395035],
    [-66.155006, -17.395068],
    [-66.154837, -17.39592],
    [-66.15481, -17.396053],
    [-66.154794, -17.396134],
    [-66.15467, -17.396758],
    [-66.15458, -17.397192],
    [-66.154417, -17.398099],
    [-66.154389, -17.398223],
    [-66.154228, -17.398993],
    [-66.154206, -17.399084],
    [-66.154149, -17.39907],
    [-66.153193, -17.398846],
    [-66.153125, -17.398831],
    [-66.152748, -17.398736],
    [-66.15272, -17.398727],
    [-66.152659, -17.398707],
    [-66.152219, -17.398546],
    [-66.152079, -17.398506],
    [-66.151998, -17.398495],
    [-66.151842, -17.398499],
    [-66.151085, -17.39854],
    [-66.150657, -17.398596],
    [-66.150467, -17.398591],
    [-66.149941, -17.398553],
    [-66.149907, -17.399004],
    [-66.149849, -17.399867],
    [-66.149846, -17.399962],
    [-66.149783, -17.400029],
    [-66.149705, -17.400128],
    [-66.149377, -17.400468],
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

  // La demo móvil se prueba a las 15:00. Si quedó una asignación móvil de un seed
  // anterior con otro turno, se marca vencida antes de crear/reutilizar la de la tarde;
  // así el login no obliga a elegir entre dos rutas demo del mismo día.
  await tx.asignacion.updateMany({
    where: {
      rotacionId: ROTACION_MOVIL_ID,
      vehiculoId: vehiculo.id,
      fecha: fechaMovil,
      horario: { not: HORARIO_MOVIL_DEMO },
    },
    data: { estado: 'vencida', venceAt: new Date() },
  });
  await tx.asignacion.upsert({
    where: {
      vehiculoId_fecha_horario: {
        vehiculoId: vehiculo.id,
        fecha: fechaMovil,
        horario: HORARIO_MOVIL_DEMO,
      },
    },
    update: {
      rotacionId: ROTACION_MOVIL_ID,
      conductorId: conductor.id,
      rutaId: RUTA_120_IDA_ID,
      orden: 1,
      horaSalida: horaEnBoliviaDemo(fechaMovil, HORA_SALIDA_MOVIL_DEMO),
      horaPresentacion: horaEnBoliviaDemo(fechaMovil, HORA_PRESENTACION_MOVIL_DEMO),
      venceAt: finDeJornadaBolivia(fechaMovil),
      estado: 'vigente',
    },
    create: {
      rotacionId: ROTACION_MOVIL_ID,
      vehiculoId: vehiculo.id,
      conductorId: conductor.id,
      rutaId: RUTA_120_IDA_ID,
      fecha: fechaMovil,
      horario: HORARIO_MOVIL_DEMO,
      orden: 1,
      horaSalida: horaEnBoliviaDemo(fechaMovil, HORA_SALIDA_MOVIL_DEMO),
      horaPresentacion: horaEnBoliviaDemo(fechaMovil, HORA_PRESENTACION_MOVIL_DEMO),
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

/** PIN numérico aleatorio (8 dígitos, cumple `PinMovilSchema` de `@quivo/shared`: 6-12
 * dígitos) para la credencial INICIAL del vehículo/conductor del piloto real. A propósito
 * NUNCA es `SEED_PIN_VEHICULO`/`SEED_PIN_CONDUCTOR` (los PINs demo publicados en
 * CREDENCIALES.md): esos alcanzan para autenticar contra la placa/CI real del piloto una
 * vez asignados el lunes, lo que contaminaría evidencia legal de sanciones. */
function generarPinPiloto(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, '0');
}

/** Credencial inicial de una entidad del piloto (vehículo o conductor): usa el PIN de
 * `envVar` si el CTO ya lo fijó, si no genera uno aleatorio con `generarPinPiloto`. Se
 * calcula SIEMPRE (aunque la fila ya exista y termine sin usarse) para que el `create` del
 * `upsert` llamador nunca reciba un hash vacío/nulo por una carrera entre el chequeo de
 * existencia y el upsert — el peor caso posible ahí es "generamos un PIN de más", nunca
 * "la fila queda sin credencial". Quien decide si se imprime es el llamador, según si la
 * fila ya existía. */
async function generarCredencialInicialPiloto(
  envVar: 'PILOTO_PIN_VEHICULO' | 'PILOTO_PIN_CONDUCTOR',
): Promise<{ pin: string; hash: string; desdeEnv: boolean }> {
  const pinDesdeEnv = process.env[envVar];
  const pin = pinDesdeEnv ?? generarPinPiloto();
  const hash = await hashPassword(pin);
  return { pin, hash, desdeEnv: Boolean(pinDesdeEnv) };
}

/** Sindicato del piloto real que arranca el lunes (QUI-366): 1 línea, su ruta con
 * geometría PostGIS, sus puntos de control, 1 vehículo y 1 conductor — el piloto arranca
 * con UN solo auto, no con la muestra de 8-15 que pedía el ticket original (decisión
 * explícita del CTO dado el timing: esto se siembra el sábado para un piloto del lunes).
 * Todos los valores de identidad (nombre, placa, CI, geometría reutilizada de la ruta demo)
 * son placeholder DELIBERADAMENTE reconocibles como tales — el CTO carga los datos reales
 * del sindicato antes de que arranque el piloto.
 *
 * Seguridad (hallazgo de /security-review, High, confianza 9/10, 2026-08-15): este
 * sindicato NO recibe las credenciales demo (`SEED_PIN_VEHICULO`/`SEED_PIN_CONDUCTOR`,
 * publicadas en CREDENCIALES.md) — antes las reusaba vía el parámetro `credenciales` que
 * compartía con `seedDatosDePrueba`, lo que le daba a cualquiera con lectura del repo un
 * camino de auth-móvil completo (placa/CI hardcodeadas acá abajo + PIN publicado) hacia una
 * sesión operativa real una vez asignado el vehículo el lunes — evidencia legal de sanciones
 * a un conductor real. Ahora genera su propia credencial random (`generarCredencialInicialPiloto`)
 * y, punto crítico, los dos `upsert` de abajo tienen `update: {}`: si la fila ya existe, la
 * corrida NO toca `credencialHash` — así una corrida repetida del seed (pasa en cada build de
 * CI, y ya corrió contra Cloud SQL productivo) no puede revertir un PIN que el CTO ya rotó a
 * mano con `establecerPinVehiculo`/`establecerPinConductor`. */
async function seedSindicatoPiloto(tx: Prisma.TransactionClient): Promise<void> {
  await tx.sindicato.upsert({
    where: { id: SINDICATO_PILOTO_ID },
    update: {},
    create: {
      id: SINDICATO_PILOTO_ID,
      nombre: 'Sindicato Piloto — PLACEHOLDER (datos reales los carga el CTO)',
      estado: 'activo',
    },
  });

  const linea = await tx.linea.upsert({
    where: { id: LINEA_PILOTO_ID },
    update: {},
    create: {
      id: LINEA_PILOTO_ID,
      sindicatoId: SINDICATO_PILOTO_ID,
      codigo: 'L1-PILOTO',
      nombre: 'Línea 1 — PLACEHOLDER piloto',
      color: '#FF5B4D',
    },
  });

  // Geometría reutilizada de `GEOMETRIA_DEMO` (Cochabamba, calles reales) a propósito: es
  // solo para que el piloto tenga algo real sobre lo que probar ruteo/geofencing antes de
  // que el CTO cargue la ruta real del sindicato — no se genera una segunda geometría
  // grande solo para diferenciarla visualmente de la de `RUTA_A_ID`.
  await tx.$executeRaw`
    INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "createdAt", "updatedAt")
    VALUES (${RUTA_PILOTO_ID}, ${linea.id}, 'ida', ST_SetSRID(ST_GeomFromGeoJSON(${GEOMETRIA_DEMO}), 4326)::geography, 'activo', now(), now())
    ON CONFLICT (id) DO UPDATE SET geometria = EXCLUDED.geometria
  `;

  await tx.$executeRaw`
    INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, "createdAt", "updatedAt")
    VALUES
      (${PC_PILOTO_1_ID}, ${RUTA_PILOTO_ID}, 0, ST_SetSRID(ST_MakePoint(-66.156214, -17.388445), 4326)::geography, 100, true, now(), now()),
      (${PC_PILOTO_2_ID}, ${RUTA_PILOTO_ID}, 1, ST_SetSRID(ST_MakePoint(-66.15481, -17.396053), 4326)::geography, 100, true, now(), now())
    ON CONFLICT (id) DO UPDATE SET coord = EXCLUDED.coord, orden = EXCLUDED.orden
  `;

  const vehiculoPilotoExistente = await tx.vehiculo.findUnique({
    where: { id: VEHICULO_PILOTO_ID },
    select: { id: true },
  });
  const conductorPilotoExistente = await tx.conductor.findUnique({
    where: { id: CONDUCTOR_PILOTO_ID },
    select: { id: true },
  });
  const [credencialVehiculo, credencialConductor] = await Promise.all([
    generarCredencialInicialPiloto('PILOTO_PIN_VEHICULO'),
    generarCredencialInicialPiloto('PILOTO_PIN_CONDUCTOR'),
  ]);

  // `update: {}`: a propósito no toca `credencialHash` en corridas siguientes (ver
  // comentario de seguridad arriba de esta función) — el `create` solo corre la primera
  // vez que la fila no existe, así que el PIN generado/impreso abajo únicamente aplica
  // cuando `*PilotoExistente` es null.
  await tx.vehiculo.upsert({
    where: { id: VEHICULO_PILOTO_ID },
    update: {},
    create: {
      id: VEHICULO_PILOTO_ID,
      sindicatoId: SINDICATO_PILOTO_ID,
      placa: 'PILOTO001',
      placaNormalizada: 'PILOTO001',
      tipo: 'bus_urbano',
      marca: 'PLACEHOLDER',
      modelo: 'PLACEHOLDER',
      color: 'PLACEHOLDER',
      capacidad: 40,
      estado: 'activo',
      credencialHash: credencialVehiculo.hash,
    },
  });

  await tx.conductor.upsert({
    where: { id: CONDUCTOR_PILOTO_ID },
    update: {},
    create: {
      id: CONDUCTOR_PILOTO_ID,
      sindicatoId: SINDICATO_PILOTO_ID,
      nombre: 'PLACEHOLDER — conductor piloto',
      documentoIdentidad: 'PILOTO-CI-001',
      licenciaConducir: 'PILOTO-LIC-001',
      estado: 'activo',
      credencialHash: credencialConductor.hash,
    },
  });

  if (!vehiculoPilotoExistente) {
    if (credencialVehiculo.desdeEnv) {
      console.log('Vehículo piloto: credencial creada con el PIN de PILOTO_PIN_VEHICULO.');
    } else {
      console.log(
        `Vehículo piloto: PIN generado = ${credencialVehiculo.pin} — ANOTALO AHORA, no ` +
          'se vuelve a mostrar. Para rotarlo más adelante usá el endpoint de credenciales ' +
          '(establecerPinVehiculo), no re-corras el seed: no lo va a cambiar.',
      );
    }
  }
  if (!conductorPilotoExistente) {
    if (credencialConductor.desdeEnv) {
      console.log('Conductor piloto: credencial creada con el PIN de PILOTO_PIN_CONDUCTOR.');
    } else {
      console.log(
        `Conductor piloto: PIN generado = ${credencialConductor.pin} — ANOTALO AHORA, no ` +
          'se vuelve a mostrar. Para rotarlo más adelante usá el endpoint de credenciales ' +
          '(establecerPinConductor), no re-corras el seed: no lo va a cambiar.',
      );
    }
  }

  console.log(
    'Sindicato piloto (placeholder) listo: 1 línea, 1 ruta, 2 puntos de control, 1 vehículo, 1 conductor',
  );
}

/** Segundo tenant, exclusivamente para las pruebas de aislamiento que exige
 * `docs/piloto/checklist-aceptacion-e2e.md` ("Usuario de otro sindicato no puede leer ni
 * modificar estos datos" — dos veces en ese checklist). Sin este sindicato (y el usuario
 * `admin@aislamiento.local` de `USERS`) esa verificación es imposible de ejecutar contra
 * el sindicato piloto real: no existía ningún tenant separado del piloto en ningún lado. */
async function seedSindicatoAislamiento(tx: Prisma.TransactionClient): Promise<void> {
  await tx.sindicato.upsert({
    where: { id: SINDICATO_AISLAMIENTO_ID },
    update: {},
    create: {
      id: SINDICATO_AISLAMIENTO_ID,
      nombre: 'Sindicato de Aislamiento — solo pruebas E2E (no es el piloto)',
      estado: 'activo',
    },
  });
  console.log('Sindicato de aislamiento listo (tenant separado para probar que no filtra datos del piloto)');
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
    await seedLinea120(tx);
    await seedRotaciones(tx);
    await seedReglas(tx);
    await seedSindicatoPiloto(tx);
    await seedSindicatoAislamiento(tx);
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

function horaEnBoliviaDemo(fecha: Date, horaHHmm: string): Date {
  const [horas, minutos] = horaHHmm.split(':').map(Number) as [number, number];
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), horas + 4, minutos),
  );
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Error corriendo el seed', error);
    process.exit(1);
  });
