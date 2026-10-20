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
//        [--login-real [--rafaga-segundos 60]]  cada conductor hace POST /mobile/auth/sesion (placa+PIN)
//                                               repartido al azar en la ráfaga, todos desde esta IP (CGNAT)
//        [--probar-misma-placa]                 6 logins con PIN malo a la placa reservada: el 6.º debe dar 429 del throttle;
//                                               solo vale con la API en 1 instancia; luego resetea fallos con el PIN bueno
//        [--offline-desde K --offline-minutos M] del minuto K al K+M no se envía; al volver se vuelca el backlog
// Los tokens/PIN salen de seed-conductores-reales.mjs (solo contra el clon). Después de la corrida:
// verificar-ingesta.mjs --resultado <salida.json> compara puntos enviados vs ingeridos.
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
    'login-real': { type: 'boolean', default: false },
    'rafaga-segundos': { type: 'string', default: '60' },
    'probar-misma-placa': { type: 'boolean', default: false },
    'offline-desde': { type: 'string' },
    'offline-minutos': { type: 'string' },
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
if (a['probar-misma-placa'] && !TOKENS.mismaPlaca) {
  console.error("El archivo de tokens no trae 'mismaPlaca': re-sembrar con el seed nuevo.");
  process.exit(1);
}

if ((a['offline-desde'] === undefined) !== (a['offline-minutos'] === undefined)) {
  console.error('--offline-desde y --offline-minutos van juntos.');
  process.exit(1);
}
const OFFLINE = a['offline-desde'] !== undefined;
const OFF_DESDE_MS = Number(a['offline-desde']) * 60_000;
const OFF_HASTA_MS = OFF_DESDE_MS + Number(a['offline-minutos']) * 60_000;
if (OFFLINE && !(Number.isFinite(OFF_DESDE_MS) && OFF_DESDE_MS >= 0 && Number.isFinite(OFF_HASTA_MS) && Number(a['offline-minutos']) > 0)) {
  console.error('--offline-desde debe ser un número >= 0 y --offline-minutos un número > 0.');
  process.exit(1);
}
const MAX_LOTE = 500; // SyncBatchSchema (packages/shared/src/sync/evento.ts): eventos .min(1).max(500)
const login = { ok: 0, 429: 0, otros: 0 };
let sesionesMuertas = 0;
const loginsEnCurso = []; // promesas de los N logins; la prueba de misma placa espera a que terminen
let tInicio = Date.now();
const offlineAhora = () => OFFLINE && Date.now() - tInicio >= OFF_DESDE_MS && Date.now() - tInicio < OFF_HASTA_MS;
const offline = { puntosAcumulados: 0, lotesVolcados: 0, erroresVolcado: 0, volcadoMaxMs: 0 };

const circuito = cargarCircuito();
const VELOCIDAD_MS = 8; // ~29 km/h
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let corriendo = true;
const detalle = []; // estado por conductor (sesionId, enviados, cola) para el resumen y verificar-ingesta

// `c` = conductor (token rotable); `token` = token fijo (admin); `salida` recibe el JSON de la respuesta.
async function http(etiqueta, metodo, ruta, { token, c, body, headers = {}, salida, reintento = true } = {}) {
  if (c?.muerta) return 'ERR'; // refresh fallido: no se vuelve a pegar con una sesión muerta
  const t0 = performance.now();
  const tokenUsado = token ?? c?.accessToken;
  let estado;
  try {
    const res = await fetch(BASE + ruta, {
      method: metodo,
      headers: { Accept: 'application/json', ...(tokenUsado ? { Authorization: `Bearer ${tokenUsado}` } : {}), ...headers },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const bytes = await res.arrayBuffer(); // consumir el body: la latencia incluye la descarga
    estado = res.status;
    if (salida) {
      try {
        salida.cuerpo = JSON.parse(Buffer.from(bytes).toString('utf8'));
      } catch {
        salida.cuerpo = null;
      }
    }
  } catch {
    estado = 'ERR';
  }
  registrar(etiqueta, performance.now() - t0, estado);
  // El access móvil dura ~15 min y la corrida 30: ante 401 se rota con el refresh y se reintenta una vez.
  // Si otro request ya rotó el token (el que dio 401 usó uno viejo), se reintenta con el actual sin refrescar.
  if (estado === 401 && c?.refreshToken && reintento) {
    if (c.accessToken !== tokenUsado || (await refrescar(c))) {
      return http(etiqueta, metodo, ruta, { c, body, headers, salida, reintento: false });
    }
  }
  return estado;
}

/** POST /mobile/auth/refresh del conductor: single-flight (los 401 concurrentes comparten una rotación).
 * Si falla, la sesión queda muerta (`muerta`): no se refresca ni se envía más y cuenta como error. */
function refrescar(c) {
  c.refrescando ??= (async () => {
    const salida = {};
    const estado = await jsonPost('POST /mobile/auth/refresh', '/v1/mobile/auth/refresh', { refreshToken: c.refreshToken }, salida);
    c.refrescando = null;
    if (estado === 200 && salida.cuerpo?.accessToken) {
      c.accessToken = salida.cuerpo.accessToken;
      c.refreshToken = salida.cuerpo.refreshToken;
      return true;
    }
    c.muerta = true;
    sesionesMuertas++;
    registrar('sesión muerta (refresh falló)', 0, 'ERR');
    console.error(`FAIL refresh ${c.placa}: HTTP ${estado}; sesión muerta, sin más envíos`);
    return false;
  })();
  return c.refrescando;
}

const jsonPost = (etiqueta, ruta, obj, salida) =>
  http(etiqueta, 'POST', ruta, { body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json' }, salida });

/** Login de un paso (placa + PIN + deviceId); si la API pide elegir asignación (>=2 hoy) toma la primera. */
async function loginReal(c) {
  const salida = {};
  let estado = await jsonPost('POST /mobile/auth/sesion', '/v1/mobile/auth/sesion', { placa: c.placa, pin: c.pin, deviceId: c.deviceId }, salida);
  if (estado === 200 && salida.cuerpo?.status === 'seleccion_requerida') {
    estado = await jsonPost(
      'POST /mobile/auth/sesion/asignacion',
      '/v1/mobile/auth/sesion/asignacion',
      { seleccionToken: salida.cuerpo.seleccionToken, asignacionId: salida.cuerpo.asignaciones[0].id, deviceId: c.deviceId },
      salida,
    );
  }
  if (estado === 200 && salida.cuerpo?.status === 'autenticado') {
    const r = salida.cuerpo;
    Object.assign(c, { accessToken: r.accessToken, refreshToken: r.refreshToken, sesionId: r.contexto.sesionId });
    login.ok++;
    return true;
  }
  if (estado === 429) login[429]++;
  else login.otros++;
  console.error(`FAIL login ${c.placa}: HTTP ${estado}`);
  return false;
}

/** 6 logins con PIN malo a la placa reservada. Se espacian tras el 4.º y 5.º para que el lockout por
 * vehículo (espera 2^(fallos-3) s desde el 4.º fallo) no se confunda con el throttle: el 6.º debe ser
 * 429 SIN `retryAfterSeconds` en el body (ese campo solo lo pone el filtro del lockout). Un 429 CON
 * `retryAfterSeconds` en los 5 primeros = fallos de una corrida anterior (`lockoutPrevio`).
 * Al pasar la ventana `cuenta` (61 s tras el 1.º) se hace un login con el PIN bueno: resetea `fallos`
 * para que la prueba se pueda repetir sin re-sembrar. Si ese reseteo falla se informa, no tumba el check. */
async function probarMismaPlaca() {
  const r = TOKENS.mismaPlaca;
  const pinMalo = r.pin === '00000000' ? '11111111' : '00000000';
  const estados = [];
  const cuerpos = [];
  const t1 = Date.now();
  for (let i = 1; i <= 6; i++) {
    const salida = {};
    estados.push(await jsonPost('POST /mobile/auth/sesion (misma placa)', '/v1/mobile/auth/sesion', { placa: r.placa, pin: pinMalo, deviceId: r.deviceId }, salida));
    cuerpos.push(salida.cuerpo);
    if (i === 4) await sleep(2_500);
    if (i === 5) await sleep(4_500);
  }
  const sextoEsLockout = cuerpos[5]?.retryAfterSeconds !== undefined;
  const lockoutPrevio = cuerpos.slice(0, 5).some((c, i) => estados[i] === 429 && c?.retryAfterSeconds !== undefined);
  await sleep(Math.max(0, t1 + 61_000 - Date.now()));
  const estadoReset = await jsonPost('POST /mobile/auth/sesion (reseteo misma placa)', '/v1/mobile/auth/sesion', { placa: r.placa, pin: r.pin, deviceId: r.deviceId }, {});
  const reseteo = estadoReset === 200 || estadoReset === 409; // 409 = PIN bueno sin rotación: también resetea `fallos`
  return { pass: !lockoutPrevio && estados.slice(0, 5).every((e) => e === 401) && estados[5] === 429 && !sextoEsLockout, estados, sextoEsLockout, lockoutPrevio, reseteo, estadoReset };
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
  const c = { ...TOKENS.conductores[i], cola: [], enviados: 0 };
  detalle.push(c);
  let dist = (circuito.largoM / N) * i; // reparte las unidades a lo largo del circuito
  let ultimoTs = Date.now();
  const pos = () => posicionEn(circuito, dist);
  const get = (etiqueta, ruta) => (offlineAhora() ? null : http(etiqueta, 'GET', ruta, { c }));

  /** Como el outbox móvil: lotes de <= 500 en orden; si uno falla se queda en la cola y se reintenta. */
  const drenarUno = async () => {
    while (c.cola.length > 0) {
      const lote = c.cola.slice(0, MAX_LOTE);
      const volcado = c.estuvoOffline === true; // backlog = lo acumulado offline; un reintento de un envío normal no cuenta
      const t0 = performance.now();
      const estado = await http(volcado ? 'POST /sync/batches (volcado)' : 'POST /sync/batches', 'POST', '/v1/sync/batches', {
        c,
        body: cuerpoLoteGzip(lote),
        // X-Content-Encoding y no Content-Encoding: OkHttp descarta el estándar (ver sync-api.ts)
        headers: { 'Content-Type': 'application/json', 'X-Content-Encoding': 'gzip' },
      });
      const ok = estado >= 200 && estado < 300;
      if (volcado) {
        offline.volcadoMaxMs = Math.max(offline.volcadoMaxMs, performance.now() - t0);
        if (ok) offline.lotesVolcados++;
        else offline.erroresVolcado++;
      }
      if (!ok) return;
      c.cola.splice(0, lote.length);
      c.enviados += lote.length;
      if (c.cola.length === 0) c.estuvoOffline = false; // backlog vaciado
    }
  };

  // Serializa: el vaciado final no debe pisar un envío en vuelo del tick periódico.
  c.drenar = () => (c.turno = (c.turno ?? Promise.resolve()).then(drenarUno));

  const sync = async () => {
    const ahora = Date.now();
    const k = 1 + Math.floor(Math.random() * 3);
    for (let j = 1; j <= k; j++) {
      const ts = ultimoTs + ((ahora - ultimoTs) * j) / k;
      dist += VELOCIDAD_MS * ((ahora - ultimoTs) / k / 1000);
      const p = posicionEn(circuito, dist);
      c.cola.push(eventoGps({ deviceId: c.deviceId, sesionId: c.sesionId, lat: p.lat, lng: p.lng, ts: Math.round(ts) }));
      if (offlineAhora()) {
        offline.puntosAcumulados++;
        c.estuvoOffline = true;
      }
    }
    ultimoTs = ahora;
    if (!offlineAhora()) await c.drenar();
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
  // Con --login-real el conductor entra en un instante al azar de la ráfaga y recién ahí empieza su ciclo.
  const arrancar = async () => {
    if (a['login-real']) {
      const entrada = sleep(Math.random() * Number(a['rafaga-segundos']) * 1000).then(() => loginReal(c));
      loginsEnCurso.push(entrada);
      if (!(await entrada)) return;
    }
    await Promise.all([
      periodico(3_000, sync),
      periodico(20_000, () => get('GET /mobile/vuelta-actual', '/v1/mobile/vuelta-actual')),
      periodico(30_000, vecinos),
      periodico(60_000, () => get('GET /mobile/perfil', '/v1/mobile/perfil')),
      periodico(15_000, rutaAPunto),
    ]);
  };
  return [arrancar()];
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
  tInicio = t0;
  // Comparte el cubo `ip` (60/min) con los N logins: arranca ≥ 61 s después del último login real.
  const mismaPlaca = a['probar-misma-placa']
    ? Promise.allSettled(loginsEnCurso)
        .then(() => sleep(a['login-real'] ? 61_000 : 0))
        .then(probarMismaPlaca)
        .catch((e) => ({ pass: false, error: e.message, estados: [] }))
    : null;
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
  await Promise.all(detalle.map((c) => c.drenar())); // vacía lo que haya quedado en la cola (backlog offline o envíos fallidos)
  const sinLogin = a['login-real'] ? login.ok < N : false;

  const filas = resumen();
  console.log('\n=== Resultado final (latencias en ms) ===');
  imprimirTabla(filas);
  console.log('totales:', JSON.stringify(totales()));
  let fallo = false;
  if (a['login-real']) {
    console.log('login:', JSON.stringify(login));
    if (login[429] > 0) console.log(`FAIL: ${login[429]} de ${N} logins recibieron 429`), (fallo = true);
    if (sinLogin) console.log(`FAIL: solo ${login.ok} de ${N} conductores lograron entrar`), (fallo = true);
  }
  const misma = mismaPlaca ? await mismaPlaca : null;
  if (misma) {
    if (misma.error) console.log(`FAIL: misma placa, la prueba falló: ${misma.error}`);
    else if (misma.lockoutPrevio) console.log(`FAIL: misma placa, lockout previo (fallos de una corrida anterior): re-seed o esperar -> ${misma.estados.join(',')}`);
    else console.log(`${misma.pass ? 'PASS' : 'FAIL'}: misma placa, 6 logins con PIN malo -> ${misma.estados.join(',')} (6.º es lockout: ${misma.sextoEsLockout}) [válido solo con la API en 1 instancia: el throttle es en memoria por instancia]`);
    if (!misma.error) console.log(`reseteo de fallos (login con PIN bueno): ${misma.reseteo ? 'ok' : `FALLÓ (HTTP ${misma.estadoReset}); la próxima corrida dará lockout previo: re-seed o esperar`}`);
    fallo ||= !misma.pass;
  }
  if (sesionesMuertas > 0) console.log(`FAIL: ${sesionesMuertas} sesiones murieron (refresh falló)`), (fallo = true);
  if (OFFLINE) console.log('offline:', JSON.stringify({ ...offline, volcadoMaxMs: Math.round(offline.volcadoMaxMs) }));
  const conductoresDetalle = detalle.filter((c) => c.sesionId).map((c) => ({ placa: c.placa, sesionId: c.sesionId, enviados: c.enviados, pendientes: c.cola.length }));
  const enviados = conductoresDetalle.reduce((s, c) => s + c.enviados, 0);
  console.log(`puntos enviados (aceptados por la API): ${enviados}; sin enviar: ${conductoresDetalle.reduce((s, c) => s + c.pendientes, 0)}`);
  if (a.salida) {
    writeFileSync(
      a.salida,
      JSON.stringify(
        { baseUrl: BASE, conductores: N, admins: NADMIN, minutos: a.minutos, filas, totales: totales(), login: a['login-real'] ? login : undefined, mismaPlaca: misma ?? undefined, offline: OFFLINE ? offline : undefined, puntosEnviados: enviados, conductoresDetalle },
        null,
        2,
      ),
    );
    console.log(`Resultado escrito en ${a.salida}`);
  }
  process.exit(fallo ? 1 : 0);
}

main().catch((e) => {
  console.error('FALLÓ:', e.message);
  process.exit(1);
});
