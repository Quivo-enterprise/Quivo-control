#!/usr/bin/env node
// Seed del experimento de carga (paso B, docs/plan-experimento-puntos-gps.md). Crea el
// árbol mínimo real (sindicato -> linea -> ruta -> puntos_control, + N vehiculos/
// conductores/asignaciones/sesiones_operativas) para que:
//   1. `generador.mjs` pueda insertar en gps_points con un sindicatoId real (FK
//      gps_points_sindicatoid_fkey) y un sesion_id que las 3 queries de en-vivo.service.ts
//      puedan encontrar de verdad (join sesiones_operativas -> asignacion -> ruta -> linea).
//   2. `lecturas.mjs` (listarHoy/obtenerPosiciones/obtenerTraza) tenga sesiones reales para
//      listar, no sesiones fantasma.
//
// Corre como el rol ADMIN (dueño de las tablas, bypassa RLS) — igual que cualquier seed de
// datos de prueba, nunca la ruta que se mide (esa es 100% `generador.mjs`/`lecturas.mjs`
// contra el rol `quivo_app`).
//
// Modo remoto (docs/plan-experimento-puntos-gps.md §10): con QUIVO_CARGA_DATABASE_URL
// seteada, `adminClient()` (lib/pg.mjs) apunta a Cloud SQL — sin cambios acá. Correr
// `cloudsql/migrar.sh` ANTES de este script (necesita el esquema real ya migrado).
//
// Uso: node seed.mjs <numSesiones>
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { adminClient, logObjetivo } from './lib/pg.mjs';

const N = Number(process.argv[2] ?? process.env.QUIVO_CARGA_N ?? 2000);
const SALIDA = process.argv[3] ?? new URL('./seed-estado.json', import.meta.url).pathname;

async function main() {
  logObjetivo('seed.mjs');
  const client = adminClient();
  await client.connect();
  try {
    // Hallazgo 9 de revisión (2026-09-22): en LOCAL, el rol admin (`quivo`/dueño de las
    // tablas) tiene BYPASSRLS, así que estos INSERT nunca pasan por las policies de RLS —
    // `app.rol` no hace falta. En REMOTO (Cloud SQL, `cloudsql/crear.sh`), el rol admin NO
    // tiene BYPASSRLS y las tablas de este seed (sindicatos, sesiones_operativas, etc.)
    // tienen `FORCE ROW LEVEL SECURITY` — sin `app.rol='admin_quivo'` seteado, estos INSERT
    // fallarían (o, peor, silenciosamente insertarían 0 filas si alguna policy usa
    // `WITH CHECK` permisivo) contra RLS real. `false` (no `true`/`SET LOCAL`) porque este
    // valor tiene que sobrevivir MÁS ALLÁ de la única transacción de `BEGIN`/`COMMIT` de
    // abajo — si algún día este script se parte en varias transacciones, sigue seteado.
    // Sin costo en local (BYPASSRLS ignora `app.rol` de todos modos).
    await client.query(`SELECT set_config('app.rol', 'admin_quivo', false)`);
    await client.query('BEGIN');

    const sindicatoId = randomUUID();
    await client.query(
      `INSERT INTO sindicatos (id, nombre, estado, "createdAt", "updatedAt")
       VALUES ($1, 'Sindicato Experimento Carga GPS', 'activo', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [sindicatoId],
    );

    const lineaId = randomUUID();
    await client.query(
      `INSERT INTO lineas (id, "sindicatoId", "cityId", codigo, nombre, "publicStatus", "createdAt", "updatedAt")
       VALUES ($1, $2, 'cochabamba', 'EXP-CARGA', 'Linea experimento carga GPS', 'borrador', now(), now())`,
      [lineaId, sindicatoId],
    );

    const rutaId = randomUUID();
    // Recorrido sintético recto de ~8km en Cochabamba (no importa la geometría real para
    // esta prueba: gps_points no depende de `rutas.geometria`, y puntos_control.coord es lo
    // único que usan las lecturas/cumplimientos).
    await client.query(
      `INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "publicStatus", "createdAt", "updatedAt")
       VALUES ($1, $2, 'ida',
         ST_SetSRID(ST_MakeLine(ST_MakePoint(-66.20, -17.40), ST_MakePoint(-66.10, -17.35)), 4326)::geography,
         'activo', 'borrador', now(), now())`,
      [rutaId, lineaId],
    );

    // 6 puntos de control equiespaciados sobre esa recta (usados por lecturas.mjs para el
    // contexto en-vivo; el generador no dispara cumplimientos, solo gps_point).
    const puntosControlIds = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const lng = -66.2 + t * 0.1;
      const lat = -17.4 + t * 0.05;
      const id = randomUUID();
      puntosControlIds.push(id);
      await client.query(
        `INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 40, true, 'activo', now(), now())`,
        [id, rutaId, i, lng, lat],
      );
    }

    console.log(`Seed base: sindicato=${sindicatoId} linea=${lineaId} ruta=${rutaId}`);

    // N "trufis" simulados: socio+vehiculo+conductor+rotacion+asignacion+sesion_operativa
    // activa por unidad — mismo camino real que crea una sesión operativa (login móvil), sin
    // pasar por Better-Auth (no hace falta para medir Postgres).
    const rotacionId = randomUUID();
    await client.query(
      `INSERT INTO rotaciones (id, "sindicatoId", periodo, estado, "createdAt", "updatedAt")
       VALUES ($1, $2, 'experimento-carga-gps', 'publicada', now(), now())`,
      [rotacionId, sindicatoId],
    );

    const sesiones = [];
    const hoy = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < N; i++) {
      const socioId = randomUUID();
      const vehiculoId = randomUUID();
      const conductorId = randomUUID();
      const asignacionId = randomUUID();
      const sesionId = randomUUID();
      const deviceId = `exp-device-${i.toString().padStart(5, '0')}`;
      const placa = `EXP${i.toString().padStart(4, '0')}`;

      await client.query(
        `INSERT INTO socios (id, "sindicatoId", nombre, "documentoIdentidad", estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'activo', now(), now())`,
        [socioId, sindicatoId, `Socio ${i}`, `EXP-DOC-${i}`],
      );
      await client.query(
        `INSERT INTO vehiculos (id, "sindicatoId", "socioId", placa, tipo, marca, modelo, color, capacidad, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'minibus', 'Toyota', 'Hiace', 'blanco', 15, 'activo', now(), now())`,
        [vehiculoId, sindicatoId, socioId, placa],
      );
      await client.query(
        `INSERT INTO conductores (id, "sindicatoId", nombre, "documentoIdentidad", "licenciaConducir", estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'activo', now(), now())`,
        [conductorId, sindicatoId, `Conductor ${i}`, `EXP-CI-${i}`, `EXP-LIC-${i}`],
      );
      await client.query(
        `INSERT INTO asignaciones (id, "rotacionId", "vehiculoId", "conductorId", "rutaId", fecha, horario, orden, "venceAt", estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 'mañana', $7, now() + interval '1 day', 'vigente', now(), now())`,
        [asignacionId, rotacionId, vehiculoId, conductorId, rutaId, hoy, i],
      );
      await client.query(
        `INSERT INTO sesiones_operativas
           (id, "sindicatoId", "asignacionId", "vehiculoId", "conductorId", "deviceId",
            inicio, estado, "accessTokenHash", "refreshTokenHash", "accessExpiresAt", "refreshExpiresAt",
            "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, now(), 'activa', $7, $8, now() + interval '1 day', now() + interval '30 day', now(), now())`,
        [sesionId, sindicatoId, asignacionId, vehiculoId, conductorId, deviceId, `exp-hash-acc-${i}`, `exp-hash-ref-${i}`],
      );

      sesiones.push({ sesionId, deviceId, vehiculoId, conductorId });
      if (i % 200 === 0) process.stdout.write(`  ${i}/${N} sesiones...\r`);
    }
    console.log(`\nSesiones operativas creadas: ${sesiones.length}`);

    await client.query('COMMIT');

    const estado = { sindicatoId, lineaId, rutaId, puntosControlIds, sesiones };
    writeFileSync(SALIDA, JSON.stringify(estado));
    console.log(`Estado del seed escrito en ${SALIDA}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Seed falló:', err);
  process.exitCode = 1;
});
