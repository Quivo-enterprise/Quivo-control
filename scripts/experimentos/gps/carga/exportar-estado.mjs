#!/usr/bin/env node
// Reconstruye seed-estado.json leyendo lo que YA está en la base (útil si seed.mjs corrió
// una vez y no hace falta repetirlo — evita el choque de unicidad de placa/documento al
// reintentar el INSERT).
import { writeFileSync } from 'node:fs';
import { adminClient, logObjetivo } from './lib/pg.mjs';

const SALIDA = process.argv[2] ?? new URL('./seed-estado.json', import.meta.url).pathname;

async function main() {
  logObjetivo('exportar-estado.mjs');
  const client = adminClient();
  await client.connect();
  try {
    const { rows: sindicatos } = await client.query(
      `SELECT id FROM sindicatos WHERE nombre = 'Sindicato Experimento Carga GPS' LIMIT 1`,
    );
    if (sindicatos.length === 0) throw new Error('No hay sindicato de experimento — corré seed.mjs primero.');
    const sindicatoId = sindicatos[0].id;

    const { rows: lineas } = await client.query(
      `SELECT id FROM lineas WHERE "sindicatoId" = $1 LIMIT 1`,
      [sindicatoId],
    );
    const lineaId = lineas[0].id;

    const { rows: rutas } = await client.query(`SELECT id FROM rutas WHERE "lineaId" = $1 LIMIT 1`, [lineaId]);
    const rutaId = rutas[0].id;

    const { rows: puntosControl } = await client.query(
      `SELECT id FROM puntos_control WHERE "rutaId" = $1 ORDER BY orden`,
      [rutaId],
    );

    const { rows: sesiones } = await client.query(
      `SELECT so.id AS "sesionId", so."deviceId", so."vehiculoId", so."conductorId"
       FROM sesiones_operativas so WHERE so."sindicatoId" = $1 ORDER BY so."deviceId"`,
      [sindicatoId],
    );

    const estado = {
      sindicatoId,
      lineaId,
      rutaId,
      puntosControlIds: puntosControl.map((p) => p.id),
      sesiones,
    };
    writeFileSync(SALIDA, JSON.stringify(estado));
    console.log(`Estado reconstruido: ${sesiones.length} sesiones -> ${SALIDA}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
