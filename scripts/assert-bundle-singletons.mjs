#!/usr/bin/env node
// Canario de CI (ver `.github/workflows/ci.yml`): durante mucho tiempo CI nunca corrió Metro
// (ni `expo export`), así que un bundle roto —con dos copias de React, de React Native o de
// `expo-font` mezcladas en el mismo `.hbc`— se podía mergear con CI en verde: recién se
// detectaba al instalar el APK real y verlo crashear (`Cannot read property 'useState' of
// null` dentro de `useFonts`, ver el comentario de la guardia de singletons en
// `apps/mobile/metro.config.js`). Este script recibe un directorio de export de Expo
// (`expo export --dump-sourcemap --output-dir <dir>`), lee el sourcemap del bundle y falla si
// detecta más de una copia física de alguno de los paquetes que DEBEN ser singleton.
//
// Cómo identifica "una copia": cada `source` de un sourcemap de Metro en un monorepo pnpm trae
// el path completo dentro del store, con la forma
// `node_modules/.pnpm/<clave>/node_modules/<paquete>/...`. Esa `<clave>` (p. ej.
// `expo-font@14.0.12_expo@54.0.36_@babel+core@7.29.7_..._e1746842f85375c1c8e70f428fb16397`) es
// la unidad real de "copia física" en pnpm: agrupamos las claves por nombre de paquete y, si
// para algún paquete de la lista aparece MÁS DE UNA clave distinta, es porque el bundle está
// arrastrando dos instalaciones distintas de ese paquete (no necesariamente dos versiones
// "nominales" distintas — pnpm sufija cada clave con sus peers, así que dos claves con la
// MISMA versión pero distinto sufijo de peer también son dos copias separadas en el bundle, y
// tienen que fallar igual). Por eso el nombre de paquete se extrae normalizando `<nombre>@<versión>`
// desde el principio de la clave, pero la clave COMPLETA (con sufijo de peers) es lo que se
// compara para contar copias y lo que se imprime en el mensaje de error.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Fuente de verdad única: apps/mobile/paquetes-singleton.cjs (la comparte
// apps/mobile/metro.config.js — ver el comentario ahí sobre por qué está en un .cjs separado en
// vez de duplicada a mano en los dos archivos, y sobre por qué cada paquete de la lista importa).
// Node ESM puede importar un módulo CJS con interop de default export, así que esto funciona
// aunque este script sea .mjs y metro.config.js sea CommonJS.
import PAQUETES_SINGLETON from '../apps/mobile/paquetes-singleton.cjs';

// De los ocho, estos DOS siempre tienen que aparecer en un bundle real de Expo/React Native —
// a diferencia de `react-dom`/`expo-asset`/`expo-modules-core`/etc., que hoy legítimamente no
// son dependencia directa y pueden dar 0. Si el parser de sourcemaps de este script se rompe
// (Metro cambia el layout de `sources`, CLAVE_STORE_RE deja de matchear, etc.), el síntoma es
// "0 apariciones" para los ocho — indistinguible de un bundle limpio salvo por este chequeo. Ver
// el chequeo más abajo, después de recorrer los sourcemaps.
const PAQUETES_SIEMPRE_PRESENTES = ['react', 'react-native'];

const CLAVE_STORE_RE = /node_modules\/\.pnpm\/([^/]+)\//;

/** Lista todos los archivos (no directorios) bajo `dir`, recursivamente. `recursive: true` en
 * `readdirSync` requiere Node >=18.17/20.1 — el repo fija Node 22 vía `.nvmrc`, así que no hace
 * falta implementar la recursión a mano ni traer una dependencia sólo para esto. */
function listarArchivos(dir) {
  return readdirSync(dir, { recursive: true })
    .map((relativo) => join(dir, relativo))
    .filter((ruta) => {
      try {
        return statSync(ruta).isFile();
      } catch {
        // Puede ser un symlink roto u otra rareza del filesystem — no es un archivo, se ignora.
        return false;
      }
    });
}

/** Preferimos `.hbc.map` (el sourcemap del bundle Hermes que exporta `expo export
 * --dump-sourcemap`) y sólo si no hay ninguno caemos a cualquier `.map` — así el script sigue
 * sirviendo si algún día se exporta con un bundle JS plano en vez de bytecode Hermes. */
function buscarSourcemaps(dir) {
  const archivos = listarArchivos(dir);
  const hbcMaps = archivos.filter((archivo) => archivo.endsWith('.hbc.map'));
  if (hbcMaps.length > 0) {
    return hbcMaps;
  }
  return archivos.filter((archivo) => archivo.endsWith('.map'));
}

/** Separa una clave de store pnpm (`<nombre>@<versión>[_<sufijo-de-peers>]`) en nombre y
 * versión. Los paquetes con scope guardan la clave con el `/` reemplazado por `+`
 * (`@expo+vector-icons@15.1.1_...`) y tienen un `@` extra al principio por el scope — por eso
 * buscamos el `@` que separa nombre de versión salteando el primer carácter cuando la clave
 * arranca con `@`. Ninguno de los ocho paquetes de `PAQUETES_SINGLETON` tiene scope, pero el
 * parseo genérico evita falsos positivos si algún día se agrega uno. */
function parsearClave(clave) {
  const inicioVersion = clave.startsWith('@') ? clave.indexOf('@', 1) : clave.indexOf('@');
  if (inicioVersion === -1) {
    return null;
  }
  const nombre = clave.slice(0, inicioVersion).replace(/\+/g, '/');
  const resto = clave.slice(inicioVersion + 1);
  const finVersion = resto.indexOf('_');
  const version = finVersion === -1 ? resto : resto.slice(0, finVersion);
  return { nombre, version };
}

function main() {
  const dirExport = process.argv[2];
  if (!dirExport) {
    console.error('Uso: node scripts/assert-bundle-singletons.mjs <directorio-de-export-de-expo>');
    process.exit(1);
  }

  let dirStat;
  try {
    dirStat = statSync(dirExport);
  } catch {
    console.error(`✗ No existe el directorio "${dirExport}".`);
    process.exit(1);
  }
  if (!dirStat.isDirectory()) {
    console.error(`✗ "${dirExport}" no es un directorio.`);
    process.exit(1);
  }

  const sourcemaps = buscarSourcemaps(dirExport);
  if (sourcemaps.length === 0) {
    // Un canario que no encuentra nada y dice OK es peor que no tenerlo: acá es donde ese caso
    // se corta en seco en vez de pasar en silencio.
    console.error(
      `✗ No se encontró ningún sourcemap (*.hbc.map ni *.map) dentro de "${dirExport}". ` +
        '¿Corriste "expo export --dump-sourcemap --output-dir ..." antes de este script?',
    );
    process.exit(1);
  }

  // paquete -> (clave completa del store -> cantidad de `sources` que la referencian). El
  // conteo por clave es sólo contexto para el mensaje de error; el veredicto es la CANTIDAD de
  // claves distintas por paquete.
  const clavesPorPaquete = new Map(PAQUETES_SINGLETON.map((paquete) => [paquete, new Map()]));

  for (const rutaMapa of sourcemaps) {
    let contenido;
    try {
      contenido = JSON.parse(readFileSync(rutaMapa, 'utf8'));
    } catch (error) {
      console.error(`✗ No se pudo parsear "${rutaMapa}" como JSON: ${error.message}`);
      process.exit(1);
    }
    const { sources } = contenido;
    if (!Array.isArray(sources)) {
      console.error(`✗ "${rutaMapa}" no tiene un array "sources" — ¿es realmente un sourcemap de Metro?`);
      process.exit(1);
    }
    for (const fuente of sources) {
      if (typeof fuente !== 'string') {
        continue;
      }
      const coincidencia = fuente.match(CLAVE_STORE_RE);
      if (!coincidencia) {
        continue;
      }
      const claveCompleta = coincidencia[1];
      const parseada = parsearClave(claveCompleta);
      if (!parseada) {
        // No es un caso normal: toda clave real del store pnpm tiene la forma
        // `<nombre>@<versión>[_<peers>]`, así que `parsearClave` sólo devuelve `null` cuando
        // `CLAVE_STORE_RE` capturó algo que NO es una clave de store — el caso conocido es
        // `node_modules/.pnpm/node_modules/<paquete>/...`, donde el hoist dir COMPARTIDO
        // (`node_modules/.pnpm/node_modules/`, ver el comentario de la guardia en
        // `apps/mobile/metro.config.js`) queda capturado como si fuera la clave. Si
        // saltáramos esto con un `continue` silencioso, una copia que vino exactamente del
        // directorio ambiguo que este script existe para vigilar no aportaría ninguna clave y
        // el duplicado se volvería invisible. Preferimos fallar duro.
        console.error(
          `✗ No se pudo interpretar la clave de store pnpm "${claveCompleta}" en "${rutaMapa}" ` +
            `(source: "${fuente}"). Si la clave es literalmente "node_modules", es el hoist dir ` +
            'compartido del store — el mismo que la guardia de metro.config.js existe para' +
            ' evitar. Revisá manualmente ese source antes de confiar en el resultado de este script.',
        );
        process.exit(1);
      }
      const mapaClaves = clavesPorPaquete.get(parseada.nombre);
      if (!mapaClaves) {
        continue;
      }
      mapaClaves.set(claveCompleta, (mapaClaves.get(claveCompleta) ?? 0) + 1);
    }
  }

  // Si el parser no matchea NINGUNA clave para ninguno de los ocho paquetes, el resultado es
  // idéntico al de un bundle limpio: "0 apariciones" para todos, exit 0. Un parser roto (por
  // ejemplo si Metro cambia el formato de `sources` y CLAVE_STORE_RE deja de matchear) queda
  // así indistinguible de que no hay duplicados — exactamente el modo de falla silenciosa que
  // el chequeo de "0 sourcemaps" de más arriba ya corta para el caso "no corriste expo export".
  // `react` y `react-native` SIEMPRE están en un bundle real de Expo/React Native (a diferencia
  // de `react-dom`, `expo-asset`, etc., que legítimamente pueden dar 0 hoy) — si cualquiera de
  // los dos aparece con 0 claves, no es que el bundle esté limpio: es que este script no está
  // viendo nada.
  const ausentes = PAQUETES_SIEMPRE_PRESENTES.filter((paquete) => clavesPorPaquete.get(paquete).size === 0);
  if (ausentes.length > 0) {
    console.error(
      `✗ ${ausentes.join(' y ')} aparece con 0 claves de store en los ${sourcemaps.length} ` +
        'sourcemap(s) revisado(s). Un bundle de Expo/React Native real siempre los incluye — esto' +
        ' es señal de que el parser de este script (CLAVE_STORE_RE / parsearClave) no está' +
        ' matchando nada, no de que el bundle esté limpio. Revisá si Metro cambió el formato de' +
        ' "sources" en los sourcemaps antes de confiar en cualquier otro resultado de este script.',
    );
    process.exit(1);
  }

  const fallas = [];
  for (const paquete of PAQUETES_SINGLETON) {
    const claves = clavesPorPaquete.get(paquete);
    if (claves.size > 1) {
      fallas.push({ paquete, claves: [...claves.keys()] });
    }
  }

  if (fallas.length > 0) {
    console.error('✗ El bundle lleva más de una copia de al menos un paquete que debe ser singleton:\n');
    for (const { paquete, claves } of fallas) {
      console.error(`  ${paquete}: ${claves.length} copias distintas en el bundle`);
      for (const clave of claves) {
        console.error(`    - node_modules/.pnpm/${clave}/`);
      }
    }
    console.error(
      '\nCada línea de arriba es una clave de store pnpm distinta: aunque la versión "nominal"' +
        ' coincida, un sufijo de peers distinto ya es una copia física distinta dentro del' +
        ' bundle. Revisá la guardia de singletons en apps/mobile/metro.config.js y qué paquete' +
        ' está trayendo la copia de más (¿algo nuevo en el workspace sin "dependencies" propias' +
        ' que cae al hoist dir compartido del store?).',
    );
    process.exit(1);
  }

  console.log(`✓ Sin duplicados. ${sourcemaps.length} sourcemap(s) revisado(s):`);
  for (const paquete of PAQUETES_SINGLETON) {
    const claves = clavesPorPaquete.get(paquete);
    if (claves.size === 0) {
      console.log(`  ${paquete}: 0 apariciones en el bundle`);
      continue;
    }
    const [clave] = claves.keys();
    console.log(`  ${paquete}: 1 copia (${clave})`);
  }
  process.exit(0);
}

main();
