#!/usr/bin/env node
// Carga con la cadencia REAL actual de la app móvil + pestañas del panel en vivo, contra la API
// HTTP (quivo-api-carga). Distinto de generador.mjs (que escribe directo en Postgres): esto
// mide la pila completa API -> Redis/BullMQ -> worker -> Cloud SQL.
//
// Por conductor: POST /v1/sync/batches cada 3 s (1-3 puntos GPS, gzip como sync-api.ts),
//   GET /v1/mobile/vuelta-actual 20 s, vecinos-ruta 30 s, perfil 60 s, ruta-a-punto 15 s.
// Por pestaña admin (token compartido: /v1/auth/login permite 5/min por IP):
//   GET /v1/reportes/en-vivo/posiciones 2 s, .../molinos 15 s, /v1/reportes/jornadas 30 s.
//
// Uso: node conductores-reales.mjs --base-url https://... --conductores 30 --admins 3 --minutos 30
//        [--tokens carga-tokens.local.json] [--salida resultado.json]
// Los tokens salen de seed-conductores-reales.mjs (solo contra el clon).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { cargarCircuito, cuerpoLoteGzip, eventoGps, posicionEn } from './lib/geometria-l16.mjs';
import { imprimirTabla, registrar, resumen, totales } from './lib/metricas.mjs';

const { values: a } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    conductores: { type: 'string', default: '30' },
    admins: { type: 'string', default: '3' },
    minutos: { type: 'string', default: '30' },
    tokens: { type: 'string', default: new URL('./carga-tokens.local.json', import.meta.url).pathname },
    salida: { type: 'string' },
  },
});
if (!a['base-url']) {
  console.error('Falta --base-url (p.ej. $(scripts/carga-efimera.sh url-api))');
  process.exit(1);
}
const BASE = a['base-url'].replace(/\/$/, '');
const host = new URL(BASE).hostname;
if (!host.includes('-carga') && host !== 'localhost' && host !== '127.0.0.1') {
  console.error(`GUARDA: '${host}' no contiene '-carga' ni es localhost; me niego a cargar algo que podría ser producción.`);
  process.exit(1);
}
const N = Number(a.conductores);
const NADMIN = Number(a.admins);
const DURACION_MS = Number(a.minutos) * 60_000;
const TOKENS = JSON.parse(readFileSync(a.tokens, 'utf8'));
if (TOKENS.conductores.length < N) {
  console.error(`El archivo de tokens tiene ${TOKENS.conductores.length} conductores, pidieron ${N}. Re-sembrar con --conductores >= ${N}.`);
  process.exit(1);
}

const circuito = cargarCircuito();
const VELOCIDAD_MS = 8; // ~29 km/h
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let corriendo = true;

async function http(etiqueta, metodo, ruta, { token, body, headers = {} } = {}) {
  const t0 = performance.now();
  let estado;
  try {
    const res = await fetch(BASE + ruta, {
      method: metodo,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    await res.arrayBuffer(); // consumir el body: la latencia incluye la descarga
    estado = res.status;
  } catch {
    estado = 'ERR';
  }
  registrar(etiqueta, performance.now() - t0, estado);
  return estado;
}

/** Ejecuta fn cada `periodoMs` (sin solaparse consigo misma) hasta que termine la corrida. */
async function periodico(periodoMs, fn) {
  await sleep(Math.random() * periodoMs); // desfasa: los teléfonos no arrancan sincronizados
  while (corriendo) {
    const t0 = Date.now();
    await fn();
    await sleep(Math.max(0, periodoMs - (Date.now() - t0)));
  }
}

function conductor(i) {
  const c = TOKENS.conductores[i];
  let dist = (circuito.largoM / N) * i; // reparte las unidades a lo largo del circuito
  let ultimoTs = Date.now();
  const pos = () => posicionEn(circuito, dist);
  const get = (etiqueta, ruta) => http(etiqueta, 'GET', ruta, { token: c.accessToken });

  const sync = async () => {
    const ahora = Date.now();
    const k = 1 + Math.floor(Math.random() * 3);
    const eventos = [];
    for (let j = 1; j <= k; j++) {
      const ts = ultimoTs + ((ahora - ultimoTs) * j) / k;
      dist += VELOCIDAD_MS * ((ahora - ultimoTs) / k / 1000);
      const p = posicionEn(circuito, dist);
      eventos.push(eventoGps({ deviceId: c.deviceId, sesionId: c.sesionId, lat: p.lat, lng: p.lng, ts: Math.round(ts) }));
    }
    ultimoTs = ahora;
    await http('POST /sync/batches', 'POST', '/v1/sync/batches', {
      token: c.accessToken,
      body: cuerpoLoteGzip(eventos),
      // X-Content-Encoding y no Content-Encoding: OkHttp descarta el estándar (ver sync-api.ts)
      headers: { 'Content-Type': 'application/json', 'X-Content-Encoding': 'gzip' },
    });
  };
  const vecinos = () => {
    const p = pos();
    return get('GET /mobile/vecinos-ruta', `/v1/mobile/vecinos-ruta?lat=${p.lat}&lng=${p.lng}`);
  };
  const rutaAPunto = () => {
    const o = pos();
    const d = posicionEn(circuito, dist + 1000);
    return get('GET /mobile/ruta-a-punto', `/v1/mobile/ruta-a-punto?origenLat=${o.lat}&origenLng=${o.lng}&destinoLat=${d.lat}&destinoLng=${d.lng}`);
  };
  return [
    periodico(3_000, sync),
    periodico(20_000, () => get('GET /mobile/vuelta-actual', '/v1/mobile/vuelta-actual')),
    periodico(30_000, vecinos),
    periodico(60_000, () => get('GET /mobile/perfil', '/v1/mobile/perfil')),
    periodico(15_000, rutaAPunto),
  ];
}

// --- Admin: un login (5/min por IP) y refresh del JWT cada 10 min; las N pestañas comparten token.
const admin = { token: null, refresh: null };
async function loginAdmin() {
  const res = await fetch(`${BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TOKENS.admin.email, password: TOKENS.admin.password }),
  });
  if (!res.ok) throw new Error(`login admin falló: HTTP ${res.status}`);
  const j = await res.json();
  admin.token = j.accessToken;
  admin.refresh = j.refreshToken;
}
async function refrescarAdmin() {
  while (corriendo) {
    await sleep(10 * 60_000);
    const res = await fetch(`${BASE}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: admin.refresh }),
    }).catch(() => null);
    if (res?.ok) {
      const j = await res.json();
      admin.token = j.accessToken;
      admin.refresh = j.refreshToken;
    } else console.error('refresh admin falló: las lecturas del panel pueden empezar a dar 401');
  }
}
const getAdmin = (etiqueta, ruta) => http(etiqueta, 'GET', ruta, { token: admin.token });
function pestana() {
  return [
    periodico(2_000, () => getAdmin('GET /reportes/en-vivo/posiciones', '/v1/reportes/en-vivo/posiciones')),
    periodico(15_000, () => getAdmin('GET /reportes/en-vivo/molinos', '/v1/reportes/en-vivo/molinos')),
    periodico(30_000, () => getAdmin('GET /reportes/jornadas', '/v1/reportes/jornadas')),
  ];
}

async function main() {
  console.log(`Carga -> ${BASE} | ${N} conductores, ${NADMIN} pestañas admin, ${a.minutos} min`);
  const health = await fetch(`${BASE}/v1/health/ready`).catch(() => null);
  if (!health?.ok) throw new Error('health/ready no responde OK: ¿el entorno está arriba?');
  if (NADMIN > 0) await loginAdmin();

  const tareas = [];
  for (let i = 0; i < N; i++) tareas.push(...conductor(i));
  for (let i = 0; i < NADMIN; i++) tareas.push(...pestana());
  if (NADMIN > 0) tareas.push(refrescarAdmin());

  const t0 = Date.now();
  const reloj = setInterval(() => {
    const t = totales();
    console.log(
      `[${Math.round((Date.now() - t0) / 60_000)} min] requests=${t.n} 429=${t.c429} 5xx=${t.c5xx} errRed=${t.err}`,
    );
  }, 60_000);
  await sleep(DURACION_MS);
  corriendo = false;
  clearInterval(reloj);
  await sleep(1_000); // las requests en vuelo terminan solas (timeout 20 s); no se esperan

  const filas = resumen();
  console.log('\n=== Resultado final (latencias en ms) ===');
  imprimirTabla(filas);
  console.log('totales:', JSON.stringify(totales()));
  if (a.salida) {
    writeFileSync(a.salida, JSON.stringify({ baseUrl: BASE, conductores: N, admins: NADMIN, minutos: a.minutos, filas, totales: totales() }, null, 2));
    console.log(`Resultado escrito en ${a.salida}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FALLÓ:', e.message);
  process.exit(1);
});
