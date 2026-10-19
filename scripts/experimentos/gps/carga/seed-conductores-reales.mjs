#!/usr/bin/env node
// Seed para conductores-reales.mjs: sindicato de prueba `carga` con la línea 16 REAL
// (geometría de l16-circuito.json), N vehículos/conductores/asignaciones de hoy, una sesión
// operativa móvil por conductor (token opaco con el mismo formato y hash que
// auth-movil/token-opaco.ts) y un usuario admin_sindicato para las pestañas del panel.
// Escribe los tokens en un JSON local (0600, gitignored): NO commitear.
//
// SOLO CLON / LOCAL. Se niega a correr salvo que:
//   - modo remoto: QUIVO_CARGA_DATABASE_URL + QUIVO_CARGA_TEMP_IP (los emite
//     `scripts/carga-efimera.sh url-seed`; lib/pg.mjs ya exige que coincidan) Y
//     `--clon <host>` explícito igual al host de la URL, Y el host no es privado (la IP de
//     prod es privada: el clon recibe IP pública solo para el seed);
//   - modo local (sin QUIVO_CARGA_DATABASE_URL): flag `--local`, contra localhost.
//
// Uso: node seed-conductores-reales.mjs --conductores 60 --clon <ip> [--salida carga-tokens.local.json]
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { adminClient, adminUrl, ES_REMOTO, logObjetivo } from './lib/pg.mjs';
import { cargarCircuito } from './lib/geometria-l16.mjs';

const { values: a } = parseArgs({
  options: {
    conductores: { type: 'string', default: '60' },
    clon: { type: 'string' },
    local: { type: 'boolean', default: false },
    salida: { type: 'string', default: new URL('./carga-tokens.local.json', import.meta.url).pathname },
  },
});
const N = Number(a.conductores);

function guardas() {
  const host = new URL(adminUrl()).hostname;
  if (ES_REMOTO) {
    if (a.clon !== host) throw new Error(`GUARDA: --clon '${a.clon ?? ''}' no coincide con el host de la URL ('${host}').`);
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      throw new Error(`GUARDA: '${host}' es una IP privada (así es producción). El clon se siembra por su IP pública.`);
    }
  } else if (!a.local || !['localhost', '127.0.0.1'].includes(host)) {
    throw new Error('GUARDA: sin QUIVO_CARGA_DATABASE_URL solo corro con --local contra localhost.');
  }
}

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const token = (prefijo) => `${prefijo}${randomBytes(32).toString('base64url')}`; // = emitirTokenOpaco

async function hashPasswordBetterAuth(pw) {
  const req = createRequire(new URL('../../../../../packages/db/package.json', import.meta.url));
  const { hashPassword } = await import(pathToFileURL(req.resolve('better-auth/crypto')).href);
  return hashPassword(pw);
}

async function main() {
  guardas();
  logObjetivo('seed-conductores-reales.mjs');
  const c = await cargarCircuito();
  const client = adminClient();
  await client.connect();
  try {
    await client.query(`SELECT set_config('app.rol', 'admin_quivo', false)`);
    const ya = await client.query(`SELECT 1 FROM sindicatos WHERE nombre = 'carga'`);
    if (ya.rowCount > 0) throw new Error("Ya existe el sindicato 'carga': este seed no es re-ejecutable (baja + alta del clon).");

    await client.query('BEGIN');
    const sindicatoId = randomUUID();
    await client.query(
      `INSERT INTO sindicatos (id, nombre, estado, "createdAt", "updatedAt") VALUES ($1, 'carga', 'activo', now(), now())`,
      [sindicatoId],
    );
    const lineaId = randomUUID();
    await client.query(
      `INSERT INTO lineas (id, "sindicatoId", "cityId", codigo, nombre, "publicStatus", "createdAt", "updatedAt")
       VALUES ($1, $2, 'cochabamba', 'L16-CARGA', 'Linea 16 (carga)', 'borrador', now(), now())`,
      [lineaId, sindicatoId],
    );
    const rutaId = randomUUID();
    const wkt = `LINESTRING(${c.ruta.map(([lng, lat]) => `${lng} ${lat}`).join(',')})`;
    await client.query(
      `INSERT INTO rutas (id, "lineaId", sentido, geometria, estado, "publicStatus", "createdAt", "updatedAt")
       VALUES ($1, $2, 'ida', ST_GeogFromText($3), 'activo', 'borrador', now(), now())`,
      [rutaId, lineaId, `SRID=4326;${wkt}`],
    );
    for (let i = 0; i < 6; i++) {
      const [lng, lat] = c.ruta[Math.floor((i / 5) * (c.ruta.length - 1))];
      await client.query(
        `INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 40, true, 'activo', now(), now())`,
        [randomUUID(), rutaId, i, lng, lat],
      );
    }
    const rotacionId = randomUUID();
    await client.query(
      `INSERT INTO rotaciones (id, "sindicatoId", periodo, estado, "createdAt", "updatedAt")
       VALUES ($1, $2, 'carga-conductores-reales', 'publicada', now(), now())`,
      [rotacionId, sindicatoId],
    );

    const hoy = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10); // día Bolivia (UTC-4)
    const conductores = [];
    for (let i = 0; i < N; i++) {
      const [socioId, vehiculoId, conductorId, asignacionId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const placa = `CRG${String(i).padStart(4, '0')}`;
      const deviceId = `carga-device-${String(i).padStart(4, '0')}`;
      const access = token('mobile_at_');
      const refresh = token('mobile_rt_');
      await client.query(
        `INSERT INTO socios (id, "sindicatoId", nombre, "documentoIdentidad", estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'activo', now(), now())`,
        [socioId, sindicatoId, `Socio carga ${i}`, `CRG-DOC-${i}`],
      );
      await client.query(
        `INSERT INTO vehiculos (id, "sindicatoId", "socioId", placa, tipo, marca, modelo, color, capacidad, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'minibus', 'Toyota', 'Hiace', 'blanco', 15, 'activo', now(), now())`,
        [vehiculoId, sindicatoId, socioId, placa],
      );
      await client.query(
        `INSERT INTO conductores (id, "sindicatoId", nombre, "documentoIdentidad", "licenciaConducir", estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'activo', now(), now())`,
        [conductorId, sindicatoId, `Conductor carga ${i}`, `CRG-CI-${i}`, `CRG-LIC-${i}`],
      );
      await client.query(
        `INSERT INTO asignaciones (id, "rotacionId", "vehiculoId", "conductorId", "rutaId", fecha, horario, orden, "venceAt", estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 'mañana', $7, now() + interval '1 day', 'vigente', now(), now())`,
        [asignacionId, rotacionId, vehiculoId, conductorId, rutaId, hoy, i],
      );
      const r = await client.query(
        `INSERT INTO sesiones_operativas
           (id, "sindicatoId", "asignacionId", "vehiculoId", "conductorId", "deviceId", inicio, estado,
            "accessTokenHash", "refreshTokenHash", "accessExpiresAt", "refreshExpiresAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, now(), 'activa', $7, $8, now() + interval '12 hours', now() + interval '1 day', now(), now())
         RETURNING id`,
        [randomUUID(), sindicatoId, asignacionId, vehiculoId, conductorId, deviceId, sha256(access), sha256(refresh)],
      );
      conductores.push({ sesionId: r.rows[0].id, deviceId, placa, accessToken: access });
    }

    // Admin del panel: mismas tablas que Better-Auth (user + account credential), contraseña aleatoria.
    const email = `carga-admin-${randomBytes(3).toString('hex')}@carga.invalid`;
    const password = randomBytes(18).toString('base64url');
    const userId = randomUUID();
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", rol, "sindicatoId")
       VALUES ($1, 'Admin carga', $2, true, now(), now(), 'admin_sindicato', $3)`,
      [userId, email, sindicatoId],
    );
    await client.query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, 'credential', $2, $3, now(), now())`,
      [randomUUID(), userId, await hashPasswordBetterAuth(password)],
    );
    await client.query('COMMIT');

    writeFileSync(a.salida, JSON.stringify({ sindicatoId, admin: { email, password }, conductores }, null, 2));
    chmodSync(a.salida, 0o600);
    console.log(`Sembrado: ${N} conductores + admin. Tokens en ${a.salida} (0600; no commitear).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('Seed falló:', e.message);
  process.exit(1);
});
