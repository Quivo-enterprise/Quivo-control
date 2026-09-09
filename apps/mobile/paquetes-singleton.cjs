// @ts-check
// Única fuente de verdad de qué paquetes deben ser singleton (una sola copia física) en el
// bundle de `apps/mobile`. La consumen `apps/mobile/metro.config.js` (fuerza la resolución, ver
// el comentario ahí) y `scripts/assert-bundle-singletons.mjs` (lo verifica sobre el bundle ya
// exportado). Antes la lista vivía duplicada a mano en los dos archivos: iban a divergir tarde o
// temprano, y cuando divergieran el canario iba a dejar de cubrir en silencio lo que se agregara
// de un solo lado — la misma clase de falla silenciosa que el resto del script existe para
// evitar (ver ahí los comentarios sobre "0 sourcemaps" y el hoist dir sin parsear).
//
// CommonJS (`.cjs`) a propósito: `metro.config.js` es CJS y no puede hacer `import` estático de
// un módulo ESM sin volverse async; `assert-bundle-singletons.mjs` sí puede hacer `import` (con
// el interop de default export de Node) de un módulo CJS. Este formato es el único que sirve
// para los dos lados sin duplicar nada.
//
// Trampa (detalle completo en el comentario de la guardia en metro.config.js): `expo-asset`,
// `expo-modules-core` y `react-dom` están acá por blindaje a futuro, no porque
// `apps/mobile/package.json` los declare hoy como dependencia directa — 0 apariciones en el
// bundle es el resultado esperado y correcto para esos tres. `react` y `react-native`, en
// cambio, siempre tienen que aparecer (ver el chequeo en assert-bundle-singletons.mjs).
module.exports = [
  'react',
  'react-dom',
  'react-native',
  'expo',
  'expo-font',
  'expo-asset',
  'expo-constants',
  'expo-modules-core',
];
