#!/usr/bin/env node
// Corre la matriz priorizada (docs/plan-experimento-puntos-gps.md §2, con el fallback de la
// consigna: si >60min, priorizar objetivos 300/500/1000 con sync 15s antes de expandir).
// Un punto a la vez, secuencial (correr dos perfiles de Postgres al mismo tiempo en un solo
// host de 16 cores / 13GiB compite por CPU y contamina la medición del otro).
//
// Modo remoto (docs/plan-experimento-puntos-gps.md §10): `spawnSync` hereda el entorno del
// proceso (incluye QUIVO_CARGA_DATABASE_URL/QUIVO_CARGA_CONCURRENCIA si están seteadas) —
// no hace falta reenviarlas a mano a correr-punto.mjs.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const DIR = new URL('./resultados/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });

const PUNTOS = JSON.parse(process.env.QUIVO_CARGA_PUNTOS ?? '[]');
if (PUNTOS.length === 0) {
  console.error('QUIVO_CARGA_PUNTOS vacío — nada que correr.');
  process.exit(1);
}

const K = process.env.QUIVO_CARGA_K ?? '20';
const DURACION_S = process.env.QUIVO_CARGA_DURACION ?? '300';
// Prefijo opcional (hallazgo 12 de revisión, 2026-09-22 — re-medición con el harness
// corregido): permite escribir bajo un nombre distinto (p.ej. `v2-`) SIN pisar los archivos
// de una corrida anterior con el mismo perfil/objetivo/sync. Default vacío = comportamiento
// idéntico al de siempre.
const PREFIJO = process.env.QUIVO_CARGA_PREFIJO ?? '';

for (const punto of PUNTOS) {
  const { perfil, objetivo, syncS } = punto;
  const nombre = `${PREFIJO}perfil-${perfil}_obj-${objetivo}_sync-${syncS}`;
  const salida = `${DIR}${nombre}.json`;
  console.error(`\n=== ${nombre} ===`);
  const r = spawnSync(
    process.execPath,
    ['correr-punto.mjs', perfil, String(objetivo), String(syncS), DURACION_S, K, salida],
    { stdio: 'inherit', cwd: new URL('.', import.meta.url).pathname },
  );
  if (r.status !== 0) {
    console.error(`Punto ${nombre} terminó con código ${r.status} — sigo con el resto de la matriz.`);
  }
}
