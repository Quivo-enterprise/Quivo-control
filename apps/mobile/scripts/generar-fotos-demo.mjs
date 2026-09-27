#!/usr/bin/env node
// QUI-… (docs/plan-apk-demo-conductor.md, paso A): genera las miniaturas embebidas de los 8
// trufis mock para el APK demo del conductor. Las fotos ORIGINALES viven en
// `apps/web/public/mock/trufis/*.jpg` (ver FUENTES.md ahí para la procedencia/licencia de cada
// una — z12-1.jpg es CC BY 2.0 de un tercero, el resto son placeholders generados con
// ImageMagick); el APK demo necesita su PROPIA copia porque corre 100% offline en el teléfono,
// sin acceso a `apps/web/public` — no se puede hacer un `fetch` a esa carpeta desde el bundle
// nativo. En vez de empaquetar los JPG como assets (que sí funcionaría, pero suma peso al APK y
// una dependencia de `expo-asset`/`require()` de imágenes dinámicas por id, más frágil que un
// simple `Record<string, string>` importado), se generan miniaturas CHICAS (96×96, calidad ~70)
// y se embeben como `data:image/jpeg;base64,...` directo en un módulo TS — así `FOTOS_TRUFI` es
// un objeto plano que cualquier hook demo puede leer sin tocar el sistema de archivos ni pedir
// permisos, y el tamaño total queda bajo control (ver el chequeo de tamaño al final).
//
// Uso: `node scripts/generar-fotos-demo.mjs` desde `apps/mobile/` (o con cualquier cwd, las
// rutas de abajo son relativas a este archivo, no al cwd).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ_REPO = join(__dirname, '..', '..', '..');
const CARPETA_FOTOS_WEB = join(RAIZ_REPO, 'apps', 'web', 'public', 'mock', 'trufis');
const ARCHIVO_SALIDA = join(__dirname, '..', 'src', 'demo', 'datos', 'fotos.generated.ts');

const LADO_PX = 96;
const CALIDAD_JPEG = 70;

/** `trufiId` (mismo id que `TRUFIS_MOCK` en `../src/demo/datos/datos.ts`) → nombre de archivo
 * en `apps/web/public/mock/trufis/`. */
const FOTOS = {
  'trufi-z12-1': 'z12-1.jpg',
  'trufi-z12-2': 'z12-2.jpg',
  'trufi-z12-3': 'z12-3.jpg',
  'trufi-z12-4': 'z12-4.jpg',
  'trufi-z12-5': 'z12-5.jpg',
  'trufi-l120-1': 'l120-1.jpg',
  'trufi-l120-2': 'l120-2.jpg',
  'trufi-l120-3': 'l120-3.jpg',
};

function resolverBinarioImageMagick() {
  for (const candidato of ['magick', 'convert']) {
    try {
      execFileSync(candidato, ['-version'], { stdio: 'ignore' });
      return candidato;
    } catch {
      // probar el siguiente candidato
    }
  }
  throw new Error(
    'No se encontró ImageMagick (`magick` ni `convert`) en PATH — instalar ImageMagick para generar las fotos del demo.',
  );
}

function recortarYRedimensionar(binario, entrada, salida) {
  // `-resize <n>x<n>^` escala manteniendo proporción hasta que el lado MENOR llegue a `n`
  // (puede pasarse del otro lado); `-gravity center -extent <n>x<n>` recorta centrado al
  // cuadrado final. Mismo patrón documentado en FUENTES.md para las miniaturas del web.
  const args =
    binario === 'magick'
      ? [entrada, '-resize', `${LADO_PX}x${LADO_PX}^`, '-gravity', 'center', '-extent', `${LADO_PX}x${LADO_PX}`, '-quality', String(CALIDAD_JPEG), salida]
      : [entrada, '-resize', `${LADO_PX}x${LADO_PX}^`, '-gravity', 'center', '-extent', `${LADO_PX}x${LADO_PX}`, '-quality', String(CALIDAD_JPEG), salida];
  execFileSync(binario, args, { stdio: 'inherit' });
}

function main() {
  const binario = resolverBinarioImageMagick();
  const dirTemp = mkdtempSync(join(tmpdir(), 'quivo-fotos-demo-'));
  const entradas = [];

  try {
    for (const [trufiId, archivo] of Object.entries(FOTOS)) {
      const rutaOriginal = join(CARPETA_FOTOS_WEB, archivo);
      const rutaMiniatura = join(dirTemp, `${trufiId}.jpg`);
      console.log(`[generar-fotos-demo] ${archivo} → ${LADO_PX}x${LADO_PX} q${CALIDAD_JPEG}`);
      recortarYRedimensionar(binario, rutaOriginal, rutaMiniatura);
      const base64 = readFileSync(rutaMiniatura).toString('base64');
      entradas.push([trufiId, base64]);
    }

    const bytesTotal = entradas.reduce((acc, [, base64]) => acc + base64.length, 0);
    const kbTotal = bytesTotal / 1024;

    const lineas = entradas
      .map(([trufiId, base64]) => `  '${trufiId}': 'data:image/jpeg;base64,${base64}',`)
      .join('\n');

    const contenido = `/**
 * GENERADO por \`apps/mobile/scripts/generar-fotos-demo.mjs\` — no editar a mano.
 *
 * Miniaturas ${LADO_PX}×${LADO_PX} (recorte centrado, JPEG calidad ~${CALIDAD_JPEG}) de las 8
 * fotos mock de \`apps/web/public/mock/trufis/*.jpg\` (ver FUENTES.md ahí para procedencia y
 * licencia de cada una), embebidas como data URI para que el APK demo funcione 100% offline sin
 * empaquetar los JPG originales como assets nativos. Para regenerar tras un cambio en las fotos
 * del web: \`node scripts/generar-fotos-demo.mjs\` (requiere ImageMagick — \`magick\` o
 * \`convert\` en PATH).
 *
 * Tamaño total embebido: ~${kbTotal.toFixed(1)} KB en base64.
 */
export const FOTOS_TRUFI: Record<string, string> = {
${lineas}
};
`;

    writeFileSync(ARCHIVO_SALIDA, contenido);
    console.log(`[generar-fotos-demo] escrito ${ARCHIVO_SALIDA} (~${kbTotal.toFixed(1)} KB)`);
  } finally {
    rmSync(dirTemp, { recursive: true, force: true });
  }
}

main();
