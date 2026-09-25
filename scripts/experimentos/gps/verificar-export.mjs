// verificar-export.mjs
//
// Chequeo automatizado (docs/plan-experimento-puntos-gps.md, criterio de verificación §5:
// "el script de export no contiene statements mutantes"). Lee exportar-sesion.cjs y falla
// (exit 1) si encuentra cualquiera de:
//   - una comilla simple (')            -> rompería la comilla del shell que lo envuelve
//     (ver exportar-sesion.README.md: node -e '<contenido>').
//   - la secuencia $(                    -> sustitución de comando de shell.
//   - la secuencia //                    -> comentario de una línea (regla dura del CTO).
//   - la secuencia %%                    -> delimitador reservado del --args de gcloud.
//   - las palabras INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE/CREATE/GRANT como palabra
//     completa (case-insensitive), fuera de un identificador legítimo: se usa \b (límite de
//     palabra) así que camelCase continuo como "rutaId", "updatedAt" o "createdAt" nunca
//     dispara un falso positivo — \b no aparece en medio de una secuencia continua de
//     caracteres de palabra.
//
// Uso: node verificar-export.mjs [ruta-al-archivo]  (default: exportar-sesion.cjs, junto a
// este script). Exit 0 si limpio, exit 1 si encuentra algo, con el detalle línea por línea.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const objetivo = resolve(process.argv[2] ?? join(aqui, 'exportar-sesion.cjs'));

const contenido = readFileSync(objetivo, 'utf8');
const lineas = contenido.split('\n');

const PALABRAS_MUTANTES = ['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'TRUNCATE', 'CREATE', 'GRANT'];
const regexPalabras = PALABRAS_MUTANTES.map(
  (palabra) => new RegExp('\\b' + palabra + '\\b', 'i'),
);

const hallazgos = [];

for (let i = 0; i < lineas.length; i++) {
  const linea = lineas[i];
  const numero = i + 1;

  if (linea.includes("'")) {
    hallazgos.push({ numero, motivo: 'comilla simple', texto: linea.trim() });
  }
  if (linea.includes('$(')) {
    hallazgos.push({ numero, motivo: 'secuencia $( (sustitución de comando)', texto: linea.trim() });
  }
  if (linea.includes('//')) {
    hallazgos.push({ numero, motivo: 'comentario de una línea (//)', texto: linea.trim() });
  }
  if (linea.includes('%%')) {
    hallazgos.push({ numero, motivo: 'secuencia %% (delimitador de gcloud)', texto: linea.trim() });
  }
  for (let p = 0; p < PALABRAS_MUTANTES.length; p++) {
    if (regexPalabras[p].test(linea)) {
      hallazgos.push({
        numero,
        motivo: 'palabra mutante: ' + PALABRAS_MUTANTES[p],
        texto: linea.trim(),
      });
    }
  }
}

if (hallazgos.length > 0) {
  console.error('verificar-export: FALLÓ — ' + objetivo);
  for (const h of hallazgos) {
    console.error('  línea ' + h.numero + ': ' + h.motivo + ' -> ' + h.texto);
  }
  console.error(hallazgos.length + ' hallazgo(s).');
  process.exit(1);
}

console.log('verificar-export: OK — ' + objetivo + ' no contiene statements mutantes ni patrones prohibidos.');
process.exit(0);
