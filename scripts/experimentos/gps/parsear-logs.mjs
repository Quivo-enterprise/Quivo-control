// parsear-logs.mjs
//
// Toma el archivo de logs bajado con gcloud logging read (ver exportar-sesion.README.md,
// --format="value(textPayload)" con orden asc, un log entry por línea de stdout de
// exportar-sesion.cjs) y escribe cada bloque ===BEGIN <nombre>===...===END <nombre>=== como
// un CSV en datos/<nombre>.csv.
//
// Falla (exit 1) si:
//   - no aparece ningún marcador ===COUNT <nombre>=<n>=== en el archivo (el export nunca
//     llegó a imprimir su marcador final — log truncado o job que no terminó).
//   - el bloque que un ===COUNT <nombre>=<n>=== referencia no se encontró.
//   - el número de filas de datos parseadas para ese bloque no coincide con <n> — evidencia
//     de que el log llegó truncado (hallazgo de revisión: un exit prematuro de Node puede
//     cortar stdout en pipe antes de que termine de escribirse).
//
// Uso: node parsear-logs.mjs <archivo-de-logs> [directorio-salida]
// Default de directorio-salida: datos/ junto a este script.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

function parsearLog(contenido) {
  const lineas = contenido.split('\n').map((linea) => linea.replace(/\r$/, ''));

  const bloques = new Map(); // nombre -> { header: string, filas: string[] }
  const conteos = []; // { nombre, n }

  let bloqueActual = null; // { nombre, filas: string[], header: string | null }

  const reBegin = /^===BEGIN (.+)===$/;
  const reEnd = /^===END (.+)===$/;
  const reCount = /^===COUNT (.+)=(\d+)===$/;

  for (const linea of lineas) {
    const mBegin = linea.match(reBegin);
    if (mBegin) {
      bloqueActual = { nombre: mBegin[1], header: null, filas: [] };
      continue;
    }

    const mEnd = linea.match(reEnd);
    if (mEnd) {
      if (bloqueActual && bloqueActual.nombre === mEnd[1]) {
        bloques.set(bloqueActual.nombre, {
          header: bloqueActual.header ?? '',
          filas: bloqueActual.filas,
        });
      }
      bloqueActual = null;
      continue;
    }

    const mCount = linea.match(reCount);
    if (mCount) {
      conteos.push({ nombre: mCount[1], n: Number(mCount[2]) });
      continue;
    }

    if (bloqueActual) {
      if (bloqueActual.header === null) {
        bloqueActual.header = linea;
      } else {
        bloqueActual.filas.push(linea);
      }
    }
  }

  return { bloques, conteos };
}

function main() {
  const archivoLog = process.argv[2];
  if (!archivoLog) {
    throw new Error('Uso: node parsear-logs.mjs <archivo-de-logs> [directorio-salida]');
  }
  const dirSalida = resolve(process.argv[3] ?? join(aqui, 'datos'));

  const contenido = readFileSync(resolve(archivoLog), 'utf8');
  const { bloques, conteos } = parsearLog(contenido);

  if (conteos.length === 0) {
    throw new Error(
      'No se encontró ningún marcador ===COUNT ...=== en el log: el export puede haber ' +
        'quedado truncado o el job no llegó a terminar. No se escribe ningún CSV.',
    );
  }

  for (const { nombre, n } of conteos) {
    const bloque = bloques.get(nombre);
    if (!bloque) {
      throw new Error(
        'El marcador ===COUNT ' + nombre + '=' + n + '=== no tiene un bloque ' +
          '===BEGIN ' + nombre + '===...===END ' + nombre + '=== correspondiente en el log.',
      );
    }
    if (bloque.filas.length !== n) {
      throw new Error(
        'Desajuste en "' + nombre + '": el marcador COUNT dice ' + n + ' filas, pero se ' +
          'parsearon ' + bloque.filas.length + '. El log llegó truncado o duplicado — no se ' +
          'escribe ningún CSV.',
      );
    }
  }

  if (bloques.size === 0) {
    throw new Error('No se encontró ningún bloque ===BEGIN ...===/===END ...=== en el log.');
  }

  mkdirSync(dirSalida, { recursive: true });

  const escritos = [];
  for (const [nombre, bloque] of bloques) {
    const rutaCsv = join(dirSalida, nombre + '.csv');
    const contenidoCsv = [bloque.header, ...bloque.filas].join('\n') + '\n';
    writeFileSync(rutaCsv, contenidoCsv, 'utf8');
    escritos.push({ nombre, filas: bloque.filas.length, ruta: rutaCsv });
  }

  console.log('parsear-logs: OK — ' + escritos.length + ' bloque(s) escrito(s) en ' + dirSalida);
  for (const e of escritos) {
    console.log('  ' + e.nombre + '.csv: ' + e.filas + ' fila(s) de datos -> ' + e.ruta);
  }
}

try {
  main();
} catch (err) {
  console.error('parsear-logs: FALLÓ — ' + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
}
