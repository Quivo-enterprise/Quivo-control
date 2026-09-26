#!/usr/bin/env node
// Genera `src/features/operacion/leaflet-inline.generated.ts` a partir de los archivos de
// distribución de la dependencia `leaflet` (fijada en 1.9.4 en package.json).
//
// POR QUÉ: el mapa de navegación del chofer corre en un WebView sin acceso a internet
// garantizado (Entrega 25 del plan post-piloto — el requisito del CTO es que la navegación en
// ruta nunca dependa de la red). Antes, `route-map-view.tsx` traía Leaflet desde
// `https://unpkg.com/...`: sin cobertura, el `<script>` nunca cargaba y el mapa quedaba en
// pantalla gris. Este script lee el `.js`/`.css` YA instalados por pnpm (deterministas, versión
// fijada por el lockfile) y los vuelca como strings TypeScript que se inyectan inline en el HTML
// del WebView — quedan embebidos en el bundle JS de la app, viajan dentro del APK, cero fetch de
// red para inicializar el mapa.
//
// Por qué generar y commitear el resultado en vez de leer node_modules en runtime: Metro no
// puede `require()` un UMD bundle pensado para DOM/browser (leaflet.js referencia `window` y
// `document` en su carga inicial) sin que explote en el entorno JS de React Native/Hermes. Leerlo
// como texto en un script de Node (este archivo) y congelarlo en un `.ts` commiteado evita ese
// problema por completo y hace el resultado reproducible sin pasos de build adicionales en CI/EAS.
//
// Licencia: Leaflet es BSD-2-Clause. El aviso de copyright (`/* @preserve ... */`) vive dentro
// del propio `leaflet.js` minificado y se conserva íntegro porque este script vuelca el archivo
// completo sin tocarlo.
//
// Re-generar tras un bump de versión: `pnpm --filter @quivo/mobile generar:leaflet-inline`
// (requiere haber corrido `pnpm install` antes para que `node_modules/leaflet/dist` exista).

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = join(scriptDir, '../src/features/operacion/leaflet-inline.generated.ts');

// Resolvemos el paquete `leaflet` con `require.resolve` (en vez de armar la ruta a mano) para
// que funcione sin importar la topología de node_modules que arme pnpm (hoisted o no).
const leafletPackageJsonPath = require.resolve('leaflet/package.json');
const leafletDir = dirname(leafletPackageJsonPath);
const leafletVersion = JSON.parse(readFileSync(leafletPackageJsonPath, 'utf8')).version;

if (leafletVersion !== '1.9.4') {
  console.error(
    `[generar-leaflet-inline] versión de leaflet instalada (${leafletVersion}) ≠ 1.9.4 fijada ` +
      'en package.json. Actualizá package.json y este mensaje antes de regenerar, o el criterio ' +
      'de "determinista" del plan de mapa offline se rompe.',
  );
  process.exit(1);
}

const jsPath = join(leafletDir, 'dist/leaflet.js');
const cssPath = join(leafletDir, 'dist/leaflet.css');

const leafletJs = readFileSync(jsPath, 'utf8');
const leafletCss = readFileSync(cssPath, 'utf8');

if (!leafletJs.includes('@preserve') || !leafletJs.includes('Leaflet 1.9.4')) {
  console.error(
    '[generar-leaflet-inline] no se encontró el aviso de licencia "@preserve" esperado en ' +
      'leaflet.js — abortando para no perder la atribución BSD-2-Clause.',
  );
  process.exit(1);
}

const encabezado = `// GENERADO por scripts/generar-leaflet-inline.mjs — NO EDITAR A MANO.
// Fuente: node_modules/leaflet/dist/{leaflet.js,leaflet.css}, versión ${leafletVersion} (fijada
// exacta en apps/mobile/package.json). Para regenerar tras un bump de versión:
//   pnpm --filter @quivo/mobile generar:leaflet-inline
//
// Leaflet es BSD-2-Clause. El string LEAFLET_JS_INLINE conserva íntegro el comentario
// "/* @preserve ... */" con el aviso de copyright de Leaflet — no recortar ni minificar más
// este archivo sin conservar esa licencia.
//
// route-map-view.tsx inyecta estos dos strings dentro de <style>/<script> del HTML del WebView
// en vez de referenciar https://unpkg.com/... — así el mapa de navegación arranca sin red
// (Entrega 25, plan post-piloto 2026-09-09: la navegación en ruta no puede tocar la red).

export const LEAFLET_JS_INLINE = ${JSON.stringify(leafletJs)};

export const LEAFLET_CSS_INLINE = ${JSON.stringify(leafletCss)};
`;

writeFileSync(outputPath, encabezado, 'utf8');

const kb = (n) => (n / 1024).toFixed(1);
console.log(
  `[generar-leaflet-inline] escrito ${outputPath}\n` +
    `  leaflet.js:  ${kb(leafletJs.length)} KB\n` +
    `  leaflet.css: ${kb(leafletCss.length)} KB\n` +
    `  archivo generado: ${kb(encabezado.length)} KB`,
);
