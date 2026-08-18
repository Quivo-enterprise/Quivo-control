/**
 * Arma el circuito real de la línea Z12 (Villa Armonía → Univalle → Salomón → Villa Armonía)
 * y lo carga en producción, editando EN EL LUGAR la ruta `33333333-3333-4333-8333-000000000011`
 * (la que ya apunta la asignación publicada — así se evita anular/republicar la rotación, el
 * único punto de no retorno real: mientras una rotación está en `borrador`,
 * `auth-movil.service.ts:429` exige `rotacion.estado = 'publicada'` y ningún login nuevo
 * funcionaría).
 *
 * Ver el informe de esta tarea para el detalle completo (tabla de los 28 puntos, poda,
 * mapeo de ids, qué NO cubre este script). Resumen de lo que hace, en orden:
 *
 *   0. Backup a disco de las 2 geometrías, los 2 sets de puntos de control y la
 *      asignación/rotación — ANTES de tocar nada. Si el backup falla, aborta.
 *   1. Arma la geometría del circuito: traza real de subida (Villa→Univalle, 593 vértices)
 *      + conector interpolado (~50 m entre vértices, aproximado — NO es calle real) que pasa
 *      por la parada Salomón (el punto de control obligatorio de esta misma ruta más cercano
 *      al inicio de la traza de bajada, así queda a 0 m del trazado) + traza real de bajada
 *      (Salomón→Villa, 624 vértices).
 *   2. Recrea sobre esta ruta los puntos de control activos que hoy cuelgan de la ruta
 *      `813c6130-2c30-46e4-b533-e3ca2ba17cd2` (el paquete del día sólo trae los puntos de la
 *      ÚNICA rutaId de la asignación — apps/api/src/modules/tracking/paquete-dia.service.ts:
 *      61-68 — así que si no cuelgan de la misma ruta, el teléfono nunca los ve). Los
 *      originales quedan `estado: 'inactivo'`, nunca se borran.
 *   3. Poda por redundancia: todo punto NO obligatorio a menos de su radio de tolerancia
 *      (150 m hoy) de un punto obligatorio → `estado: 'inactivo'`. El obligatorio siempre gana.
 *   4. Renumera `orden` de todos los puntos activos que quedan, proyectándolos sobre la nueva
 *      geometría con ST_LineLocatePoint (sentido real de marcha Villa→Univalle→Salomón→Villa).
 *   5. Verifica todo (vértices, largo, distancias, orden contiguo, asignación/rotación intactas)
 *      y recién ahí decide COMMIT o ROLLBACK.
 *
 * ## Cómo se corre
 *
 *   DATABASE_URL=postgresql://postgres:...@127.0.0.1:5433/quivo_control \
 *     node_modules/.bin/tsx scripts/cargar-circuito-z12.ts              # dry-run (default)
 *
 *   DATABASE_URL=postgresql://postgres:...@127.0.0.1:5433/quivo_control \
 *     node_modules/.bin/tsx scripts/cargar-circuito-z12.ts --apply      # aplica de verdad
 *
 * (también funciona con `pnpm exec tsx scripts/cargar-circuito-z12.ts` desde la raíz del repo).
 *
 * ## El truco del dry-run: transacción real con ROLLBACK forzado
 *
 * El dry-run NO simula la matemática de PostGIS en JS — hace las mismas INSERT/UPDATE que el
 * modo `--apply`, dentro de una única transacción Postgres, y al final SIEMPRE hace ROLLBACK
 * salvo que se haya pasado `--apply` Y todas las verificaciones hayan pasado (recién ahí
 * COMMIT). Así los números que imprime (distancias ST_Distance, largo ST_Length, fracciones
 * ST_LineLocatePoint) son los reales que calcularía Postgres, no una aproximación — sin
 * escribir nada en disco de la base. Si el proceso muere a mitad de camino (Ctrl+C, crash),
 * Postgres descarta solo la transacción no confirmada al cerrar la conexión: no hay forma de
 * dejar un estado a medio aplicar.
 *
 * ## Idempotencia
 *
 * Cada paso compara contra el estado actual antes de escribir:
 *   - Geometría/sentido: sólo se actualiza si difiere del objetivo calculado (comparación con
 *     tolerancia de 1e-6° ≈ 11 cm, para absorber el redondeo del viaje por GEOGRAPHY).
 *   - Puntos a recrear: sólo se toman los puntos ACTIVOS de la ruta `813c6130-…` — una vez
 *     aplicado, esa ruta los deja en `inactivo` y una segunda corrida no encuentra nada que
 *     recrear. Además, por las dudas, se descarta cualquier candidato que ya tenga un punto
 *     activo equivalente (misma coordenada a <0.5 m, mismo radio, mismo `obligatorio`) en la
 *     ruta destino.
 *   - Poda: sólo mira puntos activos — uno ya podado (inactivo) no vuelve a evaluarse.
 *   - `orden`: se recalcula siempre desde cero a partir del conjunto activo actual — repetirlo
 *     dos veces dando el mismo conjunto activo da el mismo resultado.
 *
 * ## Rollback (después de un --apply ya confirmado)
 *
 * Ver el JSON de backup que este script escribe en `scripts/backups-z12/<timestamp>/` — trae
 * el comando exacto de restauración en `README-rollback.txt` dentro de esa misma carpeta.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// --- Resolución de 'pg' sin depender de que el root del monorepo tenga la dependencia
// hoisted: se ancla la resolución al package.json de packages/db, que sí la declara
// (`pg": "^8.22.0"`, la misma que usa @prisma/adapter-pg en apps/api). No se importa nada
// de @quivo/db en sí — este script es standalone a propósito, para no acoplarse al estado
// de packages/ mientras hay otros agentes trabajando ahí en paralelo.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const requireDesdeDb = createRequire(path.join(REPO_ROOT, 'packages/db/package.json'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = requireDesdeDb('pg') as typeof import('pg');

// ============================================================================================
// Constantes
// ============================================================================================

/** La ruta a la que ya apunta la asignación publicada (Salomón→Villa hoy, `sentido: 'ida'`).
 * Se edita EN EL LUGAR — confirmado en docs/handoff.md §"La línea Z12" y
 * docs/plan-v2-app-y-mapa-en-vivo.md §2.5. */
const RUTA_OBJETIVO_ID = '33333333-3333-4333-8333-000000000011';

/** La ruta `vuelta` (Villa→Univalle) cuyos puntos de control activos hay que recrear sobre
 * RUTA_OBJETIVO_ID — sus 138 vértices NO se usan acá (se reemplazan por la traza GPS real de
 * `subida_simp.json`, más precisa: media 5.2 m contra esta polilínea, ver informe). */
const RUTA_VUELTA_ID = '813c6130-2c30-46e4-b533-e3ca2ba17cd2';

/** `sentido` es `z.string().min(1).max(50)` en packages/shared/src/entities/ruta.ts — string
 * libre, SIN enum ni CHECK constraint en la migración (`rutas.sentido` es `String` a secas en
 * schema.prisma). Nunca se compara contra un literal en el código (grep confirmado sobre
 * apps/api, apps/mobile, packages/shared): sólo se muestra como texto ("Ruta {sentido}" en
 * assignment-selection-screen.tsx, y en el label de reportes de cumplimiento.service.ts).
 * "circuito" es válido sin migración y describe la geometría nueva con precisión. */
const SENTIDO_NUEVO = 'circuito';

/** Espaciado objetivo entre vértices interpolados del conector Univalle→Salomón. Es geometría
 * APROXIMADA (línea recta en lon/lat, no calle real) — no hay traza GPS de este tramo (ninguna
 * de las dos trazas lo cubre, y la ruta 813c6130 tampoco: termina 848 m pasando Univalle pero
 * alejándose de Salomón). Documentado también en el informe. */
const CONECTOR_ESPACIADO_M = 50;

/** Tolerancia de "cercanía a la ruta" que aplica el backend (apps/api/src/common/geo/
 * proximidad-ruta.ts) — cualquier punto de control a 100 m o más de la geometría de su ruta
 * es rechazado por la API. Se usa acá sólo para verificar ANTES de escribir, nunca para
 * bajarla (eso está expresamente prohibido en el plan). */
const TOLERANCIA_PROXIMIDAD_M = 100;

/** Distancia bajo la cual un punto ya recreado se considera "el mismo" que el candidato a
 * recrear (idempotencia de la recreación de puntos). Muy por debajo de cualquier ruido de
 * redondeo GEOGRAPHY real. */
const EPSILON_PUNTO_YA_EXISTE_M = 0.5;

/** Tolerancia en grados para comparar la geometría objetivo contra la ya guardada en la ruta
 * (idempotencia del PATCH de geometría). 1e-6° ≈ 11 cm en esta latitud — muy por debajo de la
 * resolución real de la traza (vértices simplificados a 25 m) pero por encima de cualquier
 * ruido de punto flotante del viaje por GEOGRAPHY/GeoJSON. */
const EPSILON_GEOMETRIA_GRADOS = 1e-6;

const SUBIDA_PATH_DEFAULT = path.join(REPO_ROOT, 'scripts/data/z12-circuito/subida_simp.json');
const BAJADA_PATH_DEFAULT = path.join(REPO_ROOT, 'scripts/data/z12-circuito/bajada_simp.json');

// ============================================================================================
// Tipos
// ============================================================================================

type Coord = [number, number]; // [lon, lat], GeoJSON estándar (RFC 7946)

interface RutaRow {
  id: string;
  lineaId: string;
  sentido: string;
  estado: string;
  geometriaGeoJson: string; // texto ST_AsGeoJSON
  numVertices: number;
  largoM: number;
}

interface PuntoControlRow {
  id: string;
  rutaId: string;
  orden: number;
  coordGeoJson: string; // texto ST_AsGeoJSON
  radioToleranciaM: number;
  obligatorio: boolean;
  estado: string;
}

// ============================================================================================
// Helpers de geometría (independientes de packages/shared a propósito — ver comentario de
// arriba sobre no acoplarse a packages/ mientras hay otros agentes trabajando ahí. La fórmula
// es la misma haversine de packages/shared/src/geo.ts, sólo copiada).
// ============================================================================================

const RADIO_TIERRA_METROS = 6_371_000;

function haversineMetros(a: Coord, b: Coord): number {
  const [lonA, latA] = a;
  const [lonB, latB] = b;
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLon = (lonB - lonA) * rad;
  const senoLat = Math.sin(dLat / 2);
  const senoLon = Math.sin(dLon / 2);
  const h = senoLat * senoLat + Math.cos(latA * rad) * Math.cos(latB * rad) * senoLon * senoLon;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function redondear(n: number): number {
  return Math.round(n * 1e7) / 1e7; // ~1.1 cm de precisión, suficiente y legible
}

/** Interpola una línea RECTA (lon/lat lineal — no geodésica, no calle real) entre `inicio` y
 * `fin`, con vértices espaciados ~`espaciadoM` metros. Devuelve sólo los puntos INTERIORES
 * (sin incluir `inicio` ni `fin`) para que el llamador no duplique vértices al empalmar. */
function interpolarRecta(inicio: Coord, fin: Coord, espaciadoM: number): Coord[] {
  const distanciaTotal = haversineMetros(inicio, fin);
  const segmentos = Math.max(1, Math.round(distanciaTotal / espaciadoM));
  const puntos: Coord[] = [];
  for (let i = 1; i < segmentos; i++) {
    const t = i / segmentos;
    puntos.push([redondear(inicio[0] + (fin[0] - inicio[0]) * t), redondear(inicio[1] + (fin[1] - inicio[1]) * t)]);
  }
  return puntos;
}

function cargarLineString(rutaArchivo: string): Coord[] {
  const contenido = JSON.parse(fs.readFileSync(rutaArchivo, 'utf8'));
  if (contenido.type !== 'LineString' || !Array.isArray(contenido.coordinates)) {
    throw new Error(`${rutaArchivo} no es un GeoJSON LineString válido`);
  }
  const coords = contenido.coordinates as Coord[];
  if (coords.length < 2) {
    throw new Error(`${rutaArchivo} tiene menos de 2 vértices`);
  }
  for (const [lon, lat] of coords) {
    // Footgun documentado en el plan: los datos de origen (sindicato, GPX) a veces vienen
    // lat,lng. Si esto dispara, alguien invirtió el orden a mano.
    if (Math.abs(lon) <= 90 && Math.abs(lat) > 90) {
      throw new Error(`${rutaArchivo}: coordenada [${lon}, ${lat}] parece [lat, lon] invertido`);
    }
  }
  return coords.map(([lon, lat]) => [redondear(lon), redondear(lat)] as Coord);
}

function coordsIguales(a: Coord[], b: Coord[], epsilonGrados: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i];
    const pb = b[i];
    if (!pa || !pb) return false; // inalcanzable en la práctica (i < a.length === b.length), defensivo
    if (Math.abs(pa[0] - pb[0]) > epsilonGrados) return false;
    if (Math.abs(pa[1] - pb[1]) > epsilonGrados) return false;
  }
  return true;
}

function coordDeGeoJson(geoJsonTexto: string): Coord {
  const g = JSON.parse(geoJsonTexto);
  return [g.coordinates[0], g.coordinates[1]];
}

function coordsDeGeoJson(geoJsonTexto: string): Coord[] {
  const g = JSON.parse(geoJsonTexto);
  return g.coordinates;
}

// ============================================================================================
// CLI args
// ============================================================================================

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');
const argValor = (flag: string, fallback: string): string => {
  const i = argv.indexOf(flag);
  const valor = i >= 0 ? argv[i + 1] : undefined;
  return valor ?? fallback;
};
const SUBIDA_PATH = argValor('--subida', SUBIDA_PATH_DEFAULT);
const BAJADA_PATH = argValor('--bajada', BAJADA_PATH_DEFAULT);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  DATABASE_URL=postgresql://postgres:...@127.0.0.1:5433/<db> tsx scripts/cargar-circuito-z12.ts [opciones]

Opciones:
  --apply              Aplica de verdad (COMMIT). Sin esto, siempre dry-run (ROLLBACK forzado).
  --subida <path>       Override del GeoJSON LineString de la subida (default: scripts/data/z12-circuito/subida_simp.json)
  --bajada <path>       Override del GeoJSON LineString de la bajada (default: scripts/data/z12-circuito/bajada_simp.json)
  --help                Esta ayuda.
`);
  process.exit(0);
}

// ============================================================================================
// main
// ============================================================================================

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Falta DATABASE_URL en el entorno. Ejemplo:');
    console.error('  DATABASE_URL=postgresql://postgres:PASSWORD@127.0.0.1:5433/quivo_control tsx scripts/cargar-circuito-z12.ts');
    process.exit(1);
  }

  console.log('='.repeat(90));
  console.log(`Circuito Z12 — modo: ${APLICAR ? 'APPLY (va a hacer COMMIT si todo verifica)' : 'DRY-RUN (siempre hace ROLLBACK, no escribe nada)'}`);
  console.log('='.repeat(90));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(REPO_ROOT, 'scripts/backups-z12', timestamp);

  try {
    await client.query('BEGIN');
    // Bypass de RLS documentado (docs de la migración 20260730152500_rls_multi_tenant):
    // `admin_quivo` es un valor de app.rol, no un rol de Postgres — auditable igual que
    // cualquier otra acción. Necesario para `rotaciones` (FORCE RLS, confirmado leyendo
    // packages/db/prisma/migrations/20260731060000_rotaciones_asignaciones/migration.sql —
    // el brief original de esta tarea sólo mencionaba gps_points/cumplimientos_pc/
    // sesiones_operativas, pero rotaciones también la tiene). rutas/puntos_control/
    // asignaciones no tienen RLS, así que esto es inocuo para esas tres.
    await client.query(`SELECT set_config('app.rol', 'admin_quivo', true)`);
    await client.query(`SELECT set_config('app.sindicato_id', '', true)`);

    // ------------------------------------------------------------------------------------
    // Paso 0 — Backup obligatorio. Si algo de esto falla, el catch de abajo hace ROLLBACK
    // y el proceso termina con código != 0 antes de tocar nada.
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 0: backup ---');

    const rutaObjetivoAntes = await obtenerRuta(client, RUTA_OBJETIVO_ID);
    const rutaVueltaAntes = await obtenerRuta(client, RUTA_VUELTA_ID);
    if (!rutaObjetivoAntes) throw new Error(`No se encontró la ruta objetivo ${RUTA_OBJETIVO_ID}`);
    if (!rutaVueltaAntes) throw new Error(`No se encontró la ruta vuelta ${RUTA_VUELTA_ID}`);
    if (rutaObjetivoAntes.lineaId !== rutaVueltaAntes.lineaId) {
      throw new Error(
        `Las dos rutas no comparten lineaId (${rutaObjetivoAntes.lineaId} vs ${rutaVueltaAntes.lineaId}) — ` +
          `abortando: esto no debería pasar con los ids hardcodeados de la Z12, revisar a mano.`,
      );
    }

    const puntosObjetivoAntes = await obtenerPuntosControl(client, RUTA_OBJETIVO_ID);
    const puntosVueltaAntes = await obtenerPuntosControl(client, RUTA_VUELTA_ID);

    const asignaciones = await client.query(
      `SELECT id, "rotacionId", "vehiculoId", "conductorId", "rutaId", fecha, horario, orden, "venceAt", estado, "createdAt", "updatedAt"
       FROM asignaciones WHERE "rutaId" IN ($1, $2) ORDER BY fecha ASC`,
      [RUTA_OBJETIVO_ID, RUTA_VUELTA_ID],
    );
    const rotacionIds = [...new Set(asignaciones.rows.map((r) => r.rotacionId as string))];
    const rotaciones =
      rotacionIds.length > 0
        ? await client.query(
            `SELECT id, "sindicatoId", periodo, estado, "createdAt", "updatedAt" FROM rotaciones WHERE id = ANY($1::text[])`,
            [rotacionIds],
          )
        : { rows: [] as Record<string, unknown>[] };

    if (asignaciones.rows.length === 0) {
      console.warn(
        '  ⚠ No se encontró NINGUNA asignación apuntando a la ruta objetivo ni a la ruta vuelta. ' +
          'Es sospechoso (el brief dice que la asignación publicada ya apunta a la ruta objetivo) — revisar antes de aplicar.',
      );
    }
    if (rotaciones.rows.length === 0 && asignaciones.rows.length > 0) {
      throw new Error(
        'Hay asignaciones pero no se pudo leer ninguna rotación asociada — probable problema de RLS (falta el bypass admin_quivo). Abortando sin escribir.',
      );
    }

    fs.mkdirSync(backupDir, { recursive: true });
    escribirJson(path.join(backupDir, 'ruta-objetivo-antes.json'), rutaObjetivoAntes);
    escribirJson(path.join(backupDir, 'ruta-vuelta-antes.json'), rutaVueltaAntes);
    escribirJson(path.join(backupDir, 'puntos-control-ruta-objetivo-antes.json'), puntosObjetivoAntes);
    escribirJson(path.join(backupDir, 'puntos-control-ruta-vuelta-antes.json'), puntosVueltaAntes);
    escribirJson(path.join(backupDir, 'asignaciones-antes.json'), asignaciones.rows);
    escribirJson(path.join(backupDir, 'rotaciones-antes.json'), rotaciones.rows);
    // rollback-manual.sql y README-rollback.txt se escriben más abajo (Paso 3), una vez que
    // se conoce el mapeo id_viejo→id_nuevo de los puntos recreados — así el rollback puede
    // incluir el DELETE lógico de esos ids nuevos sin completar nada a mano.

    console.log(`  Backup escrito en ${path.relative(REPO_ROOT, backupDir)}/`);
    console.log(`  Ruta objetivo antes: ${rutaObjetivoAntes.numVertices} vértices, sentido="${rutaObjetivoAntes.sentido}"`);
    console.log(`  Ruta vuelta antes:   ${rutaVueltaAntes.numVertices} vértices, sentido="${rutaVueltaAntes.sentido}"`);
    console.log(`  Puntos activos hoy:  ${puntosObjetivoAntes.filter((p) => p.estado === 'activo').length} en ruta objetivo, ` +
      `${puntosVueltaAntes.filter((p) => p.estado === 'activo').length} en ruta vuelta`);

    // ------------------------------------------------------------------------------------
    // Paso 1 — Armar la geometría del circuito objetivo
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 1: geometría del circuito ---');

    const subida = cargarLineString(SUBIDA_PATH);
    const bajada = cargarLineString(BAJADA_PATH);
    console.log(`  Subida:  ${subida.length} vértices (${path.relative(REPO_ROOT, SUBIDA_PATH)})`);
    console.log(`  Bajada:  ${bajada.length} vértices (${path.relative(REPO_ROOT, BAJADA_PATH)})`);

    // cargarLineString ya garantiza length >= 2, así que estos accesos son seguros en la
    // práctica; las variables intermedias son sólo para que TS (noUncheckedIndexedAccess) no
    // se queje de un `Coord | undefined` que en verdad nunca ocurre acá.
    const subidaInicio = subida[0];
    const subidaFin = subida[subida.length - 1];
    const bajadaInicio = bajada[0];
    const bajadaFin = bajada[bajada.length - 1];
    if (!subidaInicio || !subidaFin || !bajadaInicio || !bajadaFin) {
      throw new Error('subida/bajada quedaron con menos de 2 vértices — no debería pasar tras cargarLineString.');
    }

    // La parada Salomón: el punto de control obligatorio que YA existe hoy en la ruta
    // objetivo, más cercano al inicio de la traza de bajada (el punto geográfico "Salomón" en
    // los datos de entrada). No se recrea ni se mueve — sólo se usa su coordenada para que el
    // conector pase exactamente por ahí (así queda a 0 m de la geometría nueva, resolviendo
    // los ~200 m que da contra el circuito ingenuo sin bajar la tolerancia de 100 m).
    //
    // Deliberadamente NO se identifica por `orden === 0`: ese era el orden ANTES de esta
    // misma corrida, pero el Paso 6 renumera todo en sentido de marcha real — una vez que el
    // conector existe, la parada Salomón queda a mitad del circuito (fracción ~0.5), no al
    // principio. Identificarla por `orden` rompería la idempotencia en la segunda corrida
    // (bug real, encontrado corriendo este script dos veces seguidas contra una base de
    // prueba antes de entregarlo). La proximidad geográfica a `bajadaInicio`, en cambio, es
    // estable: ese punto nunca lo toca el script.
    const obligatoriosActivos = puntosObjetivoAntes.filter((p) => p.estado === 'activo' && p.obligatorio);
    if (obligatoriosActivos.length === 0) {
      throw new Error('La ruta objetivo no tiene ningún punto de control activo obligatorio — no se puede ubicar la parada Salomón. Abortando.');
    }
    const distanciasASalomon = obligatoriosActivos
      .map((p) => ({ punto: p, dist: haversineMetros(coordDeGeoJson(p.coordGeoJson), bajadaInicio) }))
      .sort((a, b) => a.dist - b.dist);
    const paradaSalomon = distanciasASalomon[0]!.punto;
    const LIMITE_PLAUSIBLE_M = 1000; // el real da ~200 m; más de 1 km sería un dato sospechoso
    if (distanciasASalomon[0]!.dist > LIMITE_PLAUSIBLE_M) {
      throw new Error(
        `El punto obligatorio activo más cercano al inicio de la traza de bajada está a ` +
          `${distanciasASalomon[0]!.dist.toFixed(0)} m (${paradaSalomon.id}) — demasiado lejos para ser la parada Salomón ` +
          `con confianza. Revisar a mano antes de continuar.`,
      );
    }
    const salomonCoord = coordDeGeoJson(paradaSalomon.coordGeoJson);
    console.log(
      `  Parada Salomón identificada: punto de control ${paradaSalomon.id} ` +
        `(obligatorio activo más cercano al inicio de la traza de bajada, ${distanciasASalomon[0]!.dist.toFixed(1)} m) ` +
        `en [${salomonCoord.join(', ')}]`,
    );
    if (distanciasASalomon.length > 1) {
      console.log(
        `  (otros ${distanciasASalomon.length - 1} punto(s) obligatorio(s) activo(s) descartados por estar más lejos: ` +
          distanciasASalomon
            .slice(1)
            .map((d) => `${d.punto.id} a ${d.dist.toFixed(0)} m`)
            .join(', ') +
          ')',
      );
    }
    const distSubidaFinASalomon = haversineMetros(subidaFin, salomonCoord);
    const distSalomonABajadaInicio = haversineMetros(salomonCoord, bajadaInicio);
    const distCierre = haversineMetros(bajadaFin, subidaInicio);

    console.log(`  Univalle (fin subida) → parada Salomón: ${distSubidaFinASalomon.toFixed(1)} m`);
    console.log(`  Parada Salomón → inicio bajada:          ${distSalomonABajadaInicio.toFixed(1)} m`);
    console.log(`  Cierre del circuito (fin bajada → inicio subida, Villa): ${distCierre.toFixed(1)} m`);

    const conectorTramo1 = interpolarRecta(subidaFin, salomonCoord, CONECTOR_ESPACIADO_M);
    const conectorTramo2 = interpolarRecta(salomonCoord, bajadaInicio, CONECTOR_ESPACIADO_M);
    const conector: Coord[] = [...conectorTramo1, salomonCoord, ...conectorTramo2];

    const circuitoCoords: Coord[] = [...subida, ...conector, ...bajada];
    console.log(
      `  Conector interpolado: ${conector.length} vértices nuevos ` +
        `(${conectorTramo1.length} antes de Salomón + 1 Salomón + ${conectorTramo2.length} después, cada ~${CONECTOR_ESPACIADO_M} m)`,
    );
    console.log(
      `  Circuito total: ${subida.length} (subida) + ${conector.length} (conector) + ${bajada.length} (bajada) = ${circuitoCoords.length} vértices`,
    );

    const circuitoGeoJson = JSON.stringify({ type: 'LineString', coordinates: circuitoCoords });

    // ------------------------------------------------------------------------------------
    // Paso 2 — Actualizar geometría/sentido de la ruta objetivo (idempotente)
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 2: PATCH de geometría/sentido (idempotente) ---');

    const geometriaActualCoords = coordsDeGeoJson(rutaObjetivoAntes.geometriaGeoJson);
    const geometriaYaAplicada = coordsIguales(geometriaActualCoords, circuitoCoords, EPSILON_GEOMETRIA_GRADOS);
    const sentidoYaAplicado = rutaObjetivoAntes.sentido === SENTIDO_NUEVO;

    if (geometriaYaAplicada) {
      console.log('  Geometría: SIN CAMBIOS (ya coincide con el circuito objetivo — corrida repetida detectada).');
    } else {
      console.log(`  Geometría: ${rutaObjetivoAntes.numVertices} vértices → ${circuitoCoords.length} vértices. Aplicando UPDATE.`);
      await client.query(
        `UPDATE rutas SET geometria = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography, "updatedAt" = now() WHERE id = $2`,
        [circuitoGeoJson, RUTA_OBJETIVO_ID],
      );
      const validez = await client.query<{ valida: boolean }>(
        `SELECT ST_IsValid(geometria::geometry) as valida FROM rutas WHERE id = $1`,
        [RUTA_OBJETIVO_ID],
      );
      if (!validez.rows[0]?.valida) {
        throw new Error('La geometría del circuito resultó inválida para PostGIS (ST_IsValid = false). Abortando.');
      }
    }

    if (sentidoYaAplicado) {
      console.log(`  sentido: SIN CAMBIOS (ya es "${SENTIDO_NUEVO}").`);
    } else {
      console.log(`  sentido: "${rutaObjetivoAntes.sentido}" → "${SENTIDO_NUEVO}". Aplicando UPDATE.`);
      await client.query(`UPDATE rutas SET sentido = $1, "updatedAt" = now() WHERE id = $2`, [SENTIDO_NUEVO, RUTA_OBJETIVO_ID]);
    }

    // ------------------------------------------------------------------------------------
    // Paso 3 — Recrear sobre la ruta objetivo los puntos activos de la ruta vuelta
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 3: recrear puntos de control de la ruta vuelta (idempotente) ---');

    const puntosVueltaActivos = puntosVueltaAntes.filter((p) => p.estado === 'activo');
    const puntosObjetivoActivosActuales = await obtenerPuntosControl(client, RUTA_OBJETIVO_ID).then((r) =>
      r.filter((p) => p.estado === 'activo'),
    );

    const mapeoIdViejoANuevo: Record<string, { idNuevo: string; yaExistia: boolean }> = {};

    if (puntosVueltaActivos.length === 0) {
      console.log('  Ruta vuelta sin puntos activos que recrear (ya se corrió antes, o nunca tuvo puntos). Nada que hacer.');
    }

    for (const pViejo of puntosVueltaActivos) {
      const coordViejo = coordDeGeoJson(pViejo.coordGeoJson);
      const yaExiste = puntosObjetivoActivosActuales.find((pNuevo) => {
        const coordNuevo = coordDeGeoJson(pNuevo.coordGeoJson);
        return (
          haversineMetros(coordViejo, coordNuevo) < EPSILON_PUNTO_YA_EXISTE_M &&
          pNuevo.radioToleranciaM === pViejo.radioToleranciaM &&
          pNuevo.obligatorio === pViejo.obligatorio
        );
      });

      if (yaExiste) {
        mapeoIdViejoANuevo[pViejo.id] = { idNuevo: yaExiste.id, yaExistia: true };
        console.log(`  ${pViejo.id} → ya existe como ${yaExiste.id} en la ruta objetivo (sin duplicar).`);
        continue;
      }

      const idNuevo = randomUUID();
      await client.query(
        `INSERT INTO puntos_control (id, "rutaId", orden, coord, "radioToleranciaM", obligatorio, estado, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)::geography, $5, $6, 'activo', now(), now())`,
        [idNuevo, RUTA_OBJETIVO_ID, pViejo.orden, pViejo.coordGeoJson, pViejo.radioToleranciaM, pViejo.obligatorio],
      );
      mapeoIdViejoANuevo[pViejo.id] = { idNuevo, yaExistia: false };
      puntosObjetivoActivosActuales.push({ ...pViejo, id: idNuevo, rutaId: RUTA_OBJETIVO_ID });
      console.log(`  ${pViejo.id} → creado ${idNuevo} (radio ${pViejo.radioToleranciaM} m, obligatorio=${pViejo.obligatorio})`);
    }

    if (puntosVueltaActivos.length > 0) {
      await client.query(`UPDATE puntos_control SET estado = 'inactivo', "updatedAt" = now() WHERE "rutaId" = $1 AND estado = 'activo'`, [
        RUTA_VUELTA_ID,
      ]);
      console.log(`  ${puntosVueltaActivos.length} puntos originales de la ruta vuelta → estado 'inactivo' (no se borraron).`);
    }

    escribirJson(path.join(backupDir, 'mapeo-ids-puntos-control.json'), mapeoIdViejoANuevo);

    const idsNuevos = Object.values(mapeoIdViejoANuevo)
      .filter((m) => !m.yaExistia)
      .map((m) => m.idNuevo);
    escribirSqlRollbackManual(backupDir, rutaObjetivoAntes, puntosObjetivoAntes, puntosVueltaAntes, idsNuevos);
    fs.writeFileSync(
      path.join(backupDir, 'README-rollback.txt'),
      `Backup tomado ${new Date().toISOString()} antes de correr cargar-circuito-z12.ts.\n\n` +
        `Rollback (< 5 min) si ya se corrió --apply y hay que deshacer — un solo comando,\n` +
        `contra el mismo DATABASE_URL que se usó para aplicar:\n\n` +
        `  psql "$DATABASE_URL" -f "${path.join(backupDir, 'rollback-manual.sql')}"\n\n` +
        `Ese archivo restaura la geometría/sentido original de la ruta objetivo, el estado\n` +
        `original de cada uno de sus puntos de control (orden/radio/obligatorio/estado como\n` +
        `estaban antes), reactiva los puntos originales de la ruta vuelta, y desactiva los\n` +
        `${idsNuevos.length} puntos nuevos que este script creó. Totalmente generado — no hace\n` +
        `falta completar nada a mano.\n`,
    );

    // ------------------------------------------------------------------------------------
    // Paso 4 — Verificación de los puntos activos contra la geometría nueva (< 100 m)
    // ------------------------------------------------------------------------------------
    console.log(`\n--- Paso 4: distancia de los puntos activos a la geometría nueva (límite ${TOLERANCIA_PROXIMIDAD_M} m) ---`);

    const distancias = await client.query<{
      id: string;
      orden: number;
      obligatorio: boolean;
      radiotoleranciam: number;
      distancia_m: number;
    }>(
      `SELECT pc.id, pc.orden, pc.obligatorio, pc."radioToleranciaM" as radiotoleranciam,
              ST_Distance(pc.coord, r.geometria) as distancia_m
       FROM puntos_control pc JOIN rutas r ON r.id = pc."rutaId"
       WHERE pc."rutaId" = $1 AND pc.estado = 'activo'
       ORDER BY distancia_m DESC`,
      [RUTA_OBJETIVO_ID],
    );

    const totalActivos = distancias.rows.length;
    const fueraDeTolerancia = distancias.rows.filter((r) => Number(r.distancia_m) >= TOLERANCIA_PROXIMIDAD_M);
    const dentroDeTolerancia = totalActivos - fueraDeTolerancia.length;

    console.table(
      distancias.rows.map((r) => ({
        id: r.id,
        orden_viejo: r.orden,
        obligatorio: r.obligatorio,
        radio_m: r.radiotoleranciam,
        distancia_m: Number(r.distancia_m).toFixed(2),
      })),
    );
    console.log(`  ${dentroDeTolerancia}/${totalActivos} puntos activos quedan a menos de ${TOLERANCIA_PROXIMIDAD_M} m de la geometría nueva.`);
    if (totalActivos !== 28) {
      console.warn(
        `  ⚠ Se esperaban 28 puntos activos combinados (14 + 14 antes de la poda) y hay ${totalActivos}. ` +
          `No es necesariamente un error (puede ser una corrida repetida, o el conteo real cambió) — revisar antes de confiar ciegamente.`,
      );
    }
    if (fueraDeTolerancia.length > 0) {
      throw new Error(
        `${fueraDeTolerancia.length} punto(s) de control activo(s) quedan a ${TOLERANCIA_PROXIMIDAD_M} m o más de la geometría nueva: ` +
          fueraDeTolerancia.map((r) => `${r.id} (orden viejo ${r.orden}, ${Number(r.distancia_m).toFixed(1)} m)`).join(', ') +
          '. Abortando ANTES de tocar producción — nunca se resuelve bajando la tolerancia, se corrige la geometría.',
      );
    }

    // ------------------------------------------------------------------------------------
    // Paso 5 — Poda por redundancia
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 5: poda por redundancia (no-obligatorio a <radio de un obligatorio) ---');

    const candidatosAPodar = await client.query<{
      candidato_id: string;
      obligatorio_id: string;
      dist_m: number;
      radio_obligatorio_m: number;
    }>(
      `WITH obligatorios AS (
         SELECT id, coord, "radioToleranciaM" FROM puntos_control WHERE "rutaId" = $1 AND estado = 'activo' AND obligatorio = true
       ),
       candidatos AS (
         SELECT id, coord FROM puntos_control WHERE "rutaId" = $1 AND estado = 'activo' AND obligatorio = false
       )
       SELECT DISTINCT ON (c.id) c.id AS candidato_id, o.id AS obligatorio_id,
              ST_Distance(c.coord, o.coord) AS dist_m, o."radioToleranciaM" as radio_obligatorio_m
       FROM candidatos c JOIN obligatorios o ON ST_Distance(c.coord, o.coord) < o."radioToleranciaM"
       ORDER BY c.id, dist_m ASC`,
      [RUTA_OBJETIVO_ID],
    );

    if (candidatosAPodar.rows.length === 0) {
      console.log('  Nada que podar.');
    } else {
      console.table(
        candidatosAPodar.rows.map((r) => ({
          candidato_id: r.candidato_id,
          obligatorio_mas_cercano: r.obligatorio_id,
          distancia_m: Number(r.dist_m).toFixed(2),
          radio_m: r.radio_obligatorio_m,
        })),
      );
      await client.query(
        `UPDATE puntos_control SET estado = 'inactivo', "updatedAt" = now() WHERE id = ANY($1::text[])`,
        [candidatosAPodar.rows.map((r) => r.candidato_id)],
      );
      console.log(`  ${candidatosAPodar.rows.length} punto(s) podado(s) → estado 'inactivo'.`);
    }

    // ------------------------------------------------------------------------------------
    // Paso 6 — Renumerar `orden` en sentido real de marcha
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 6: renumerar orden (proyección sobre la geometría, ST_LineLocatePoint) ---');

    const ordenNuevo = await client.query<{ id: string; fraccion: number }>(
      `SELECT pc.id, ST_LineLocatePoint(r.geometria::geometry, pc.coord::geometry) as fraccion
       FROM puntos_control pc JOIN rutas r ON r.id = pc."rutaId"
       WHERE pc."rutaId" = $1 AND pc.estado = 'activo'
       ORDER BY fraccion ASC, pc.id ASC`,
      [RUTA_OBJETIVO_ID],
    );

    const tablaOrden: { id: string; orden_nuevo: number; fraccion: string }[] = [];
    for (let i = 0; i < ordenNuevo.rows.length; i++) {
      const fila = ordenNuevo.rows[i];
      await client.query(`UPDATE puntos_control SET orden = $1, "updatedAt" = now() WHERE id = $2`, [i, fila.id]);
      tablaOrden.push({ id: fila.id, orden_nuevo: i, fraccion: Number(fila.fraccion).toFixed(4) });
    }
    console.table(tablaOrden);
    console.log(`  ${tablaOrden.length} puntos activos renumerados 0..${tablaOrden.length - 1}.`);

    // ------------------------------------------------------------------------------------
    // Paso 7 — Verificación final
    // ------------------------------------------------------------------------------------
    console.log('\n--- Paso 7: verificación final ---');

    const rutaObjetivoDespues = await obtenerRuta(client, RUTA_OBJETIVO_ID);
    if (!rutaObjetivoDespues) throw new Error('La ruta objetivo desapareció durante la transacción (imposible salvo bug).');

    console.log(`  Vértices: ${rutaObjetivoDespues.numVertices}`);
    console.log(`  Largo:    ${rutaObjetivoDespues.largoM.toFixed(1)} m`);
    console.log(`  sentido:  "${rutaObjetivoDespues.sentido}"`);

    if (rutaObjetivoDespues.numVertices !== circuitoCoords.length) {
      throw new Error(
        `ST_NumPoints devuelve ${rutaObjetivoDespues.numVertices} pero se esperaban ${circuitoCoords.length}. Abortando.`,
      );
    }

    const ordenesActivos = (
      await client.query<{ orden: number }>(`SELECT orden FROM puntos_control WHERE "rutaId" = $1 AND estado = 'activo' ORDER BY orden ASC`, [
        RUTA_OBJETIVO_ID,
      ])
    ).rows.map((r) => r.orden);
    const ordenEsperado = ordenesActivos.map((_, i) => i);
    if (JSON.stringify(ordenesActivos) !== JSON.stringify(ordenEsperado)) {
      throw new Error(`orden de los puntos activos no es 0..N-1 contiguo: [${ordenesActivos.join(', ')}]. Abortando.`);
    }
    console.log(`  orden de los ${ordenesActivos.length} puntos activos: 0..${ordenesActivos.length - 1} sin huecos ni repetidos. OK.`);

    const asignacionesDespues = await client.query<{ id: string; rutaid: string }>(
      `SELECT id, "rutaId" as rutaid FROM asignaciones WHERE id = ANY($1::text[])`,
      [asignaciones.rows.map((r) => r.id)],
    );
    const asignacionesRotas = asignacionesDespues.rows.filter((r) => r.rutaid !== RUTA_OBJETIVO_ID);
    if (asignacionesRotas.length > 0) {
      throw new Error(`${asignacionesRotas.length} asignación(es) ya no apuntan a la ruta objetivo (esto NO debería pasar, el script nunca las toca). Abortando.`);
    }
    console.log(`  ${asignacionesDespues.rows.length} asignación(es) siguen apuntando a la ruta objetivo. OK.`);

    const rotacionesDespues =
      rotacionIds.length > 0
        ? await client.query<{ id: string; estado: string }>(`SELECT id, estado FROM rotaciones WHERE id = ANY($1::text[])`, [rotacionIds])
        : { rows: [] as { id: string; estado: string }[] };
    const rotacionesNoPublicadas = rotacionesDespues.rows.filter((r) => r.estado !== 'publicada');
    if (rotacionesNoPublicadas.length > 0) {
      throw new Error(
        `Rotación(es) no están en estado 'publicada' (esto NO debería pasar, el script nunca las toca): ` +
          rotacionesNoPublicadas.map((r) => `${r.id}=${r.estado}`).join(', '),
      );
    }
    console.log(`  ${rotacionesDespues.rows.length} rotación(es) siguen 'publicada'. OK.`);

    // ------------------------------------------------------------------------------------
    // Cierre
    // ------------------------------------------------------------------------------------
    if (APLICAR) {
      await client.query('COMMIT');
      console.log('\n✅ COMMIT. Cambios aplicados en producción.');
      console.log(`   Backup + mapeo de ids en: ${path.relative(REPO_ROOT, backupDir)}/`);
    } else {
      await client.query('ROLLBACK');
      console.log('\n🟡 DRY-RUN: ROLLBACK explícito — nada quedó escrito en la base.');
      console.log('   Para aplicar de verdad: agregar --apply a la misma línea de comando.');
      console.log(`   (el backup en ${path.relative(REPO_ROOT, backupDir)}/ sí quedó en disco — es solo lectura, no se deshace)`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Abortado, ROLLBACK. Nada quedó escrito en la base.');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// ============================================================================================
// Queries de lectura reutilizadas
// ============================================================================================

async function obtenerRuta(client: InstanceType<typeof Client>, id: string): Promise<RutaRow | null> {
  const { rows } = await client.query(
    `SELECT id, "lineaId", sentido, estado, ST_AsGeoJSON(geometria) as geometria,
            ST_NumPoints(geometria::geometry) as num_vertices, ST_Length(geometria) as largo_m
     FROM rutas WHERE id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    lineaId: r.lineaId,
    sentido: r.sentido,
    estado: r.estado,
    geometriaGeoJson: r.geometria,
    numVertices: Number(r.num_vertices),
    largoM: Number(r.largo_m),
  };
}

async function obtenerPuntosControl(client: InstanceType<typeof Client>, rutaId: string): Promise<PuntoControlRow[]> {
  const { rows } = await client.query(
    `SELECT id, "rutaId", orden, ST_AsGeoJSON(coord) as coord, "radioToleranciaM", obligatorio, estado
     FROM puntos_control WHERE "rutaId" = $1 ORDER BY orden ASC`,
    [rutaId],
  );
  return rows.map((r) => ({
    id: r.id,
    rutaId: r.rutaId,
    orden: r.orden,
    coordGeoJson: r.coord,
    radioToleranciaM: r.radioToleranciaM,
    obligatorio: r.obligatorio,
    estado: r.estado,
  }));
}

function escribirJson(rutaArchivo: string, datos: unknown): void {
  fs.writeFileSync(rutaArchivo, JSON.stringify(datos, null, 2));
}

function escribirSqlRollbackManual(
  backupDir: string,
  rutaObjetivoAntes: RutaRow,
  puntosObjetivoAntes: PuntoControlRow[],
  puntosVueltaAntes: PuntoControlRow[],
  idsPuntosNuevos: string[],
): void {
  const lineas: string[] = [
    '-- Rollback generado automáticamente por cargar-circuito-z12.ts — restaura el estado',
    '-- exacto de antes de esa corrida. Corre esto contra la misma base (mismo DATABASE_URL):',
    '--   psql "$DATABASE_URL" -f rollback-manual.sql',
    'BEGIN;',
    '',
    '-- 1) Geometría/sentido originales de la ruta objetivo',
    `UPDATE rutas SET geometria = ST_SetSRID(ST_GeomFromGeoJSON('${rutaObjetivoAntes.geometriaGeoJson}'), 4326)::geography, ` +
      `sentido = '${rutaObjetivoAntes.sentido}', "updatedAt" = now() WHERE id = '${rutaObjetivoAntes.id}';`,
    '',
    '-- 2) Estado original de CADA punto de control que ya existía en la ruta objetivo antes de',
    '--    correr el script (deshace la poda y la renumeración de orden)',
    ...puntosObjetivoAntes.map(
      (p) =>
        `UPDATE puntos_control SET orden = ${p.orden}, "radioToleranciaM" = ${p.radioToleranciaM}, obligatorio = ${p.obligatorio}, ` +
        `estado = '${p.estado}', "updatedAt" = now() WHERE id = '${p.id}';`,
    ),
    '',
    '-- 3) Reactivar los puntos originales de la ruta vuelta que el script pasó a inactivo',
    ...puntosVueltaAntes
      .filter((p) => p.estado === 'activo')
      .map((p) => `UPDATE puntos_control SET estado = 'activo', "updatedAt" = now() WHERE id = '${p.id}';`),
    '',
    idsPuntosNuevos.length > 0
      ? `-- 4) Desactivar los ${idsPuntosNuevos.length} puntos NUEVOS que creó el script (no se borran, soft-delete)`
      : '-- 4) (el script no creó puntos nuevos en esta corrida — nada que desactivar acá)',
    ...idsPuntosNuevos.map((id) => `UPDATE puntos_control SET estado = 'inactivo', "updatedAt" = now() WHERE id = '${id}';`),
    '',
    'COMMIT;',
  ];
  fs.writeFileSync(path.join(backupDir, 'rollback-manual.sql'), lineas.join('\n') + '\n');
}

main();
