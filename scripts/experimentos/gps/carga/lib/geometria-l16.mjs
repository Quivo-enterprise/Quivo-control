// Geometría real de la línea 16 (packages/shared/src/fixtures/l16-circuito.json) para mover
// conductores simulados, más los helpers de payload que replican a la app móvil.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const FIXTURE = new URL('../../../../../packages/shared/src/fixtures/l16-circuito.json', import.meta.url);

const R = 6371000;
const rad = (g) => (g * Math.PI) / 180;
function haversine([lng1, lat1], [lng2, lat2]) {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Circuito (fixture.ruta) como polilínea [lng, lat] con distancias acumuladas. */
export function cargarCircuito() {
  const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const puntos = f.ruta; // "retorno"/"terminal" del fixture son puntos sueltos, no tramos
  const acum = [0];
  for (let i = 1; i < puntos.length; i++) acum.push(acum[i - 1] + haversine(puntos[i - 1], puntos[i]));
  return { puntos, acum, largoM: acum[acum.length - 1], ruta: f.ruta, retorno: f.retorno };
}

/** Posición {lat, lng} a `d` metros del inicio, dando la vuelta al circuito (módulo). */
export function posicionEn(c, d) {
  const x = ((d % c.largoM) + c.largoM) % c.largoM;
  let lo = 0;
  let hi = c.acum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.acum[mid] <= x) lo = mid;
    else hi = mid;
  }
  const seg = c.acum[hi] - c.acum[lo] || 1;
  const t = (x - c.acum[lo]) / seg;
  const [lng1, lat1] = c.puntos[lo];
  const [lng2, lat2] = c.puntos[hi];
  return { lat: lat1 + (lat2 - lat1) * t, lng: lng1 + (lng2 - lng1) * t };
}

/** UUIDv7 (mismo formato que exige uuidV7Schema de @quivo/shared). */
export function uuidV7(ahora = Date.now()) {
  const b = randomBytes(16);
  b.writeUIntBE(ahora, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Body de POST /v1/sync/batches igual que apps/mobile/src/shared/api/sync-api.ts: gzip del
 * JSON `{eventos}` (se manda con el header X-Content-Encoding: gzip, no Content-Encoding). */
export function cuerpoLoteGzip(eventos) {
  return gzipSync(JSON.stringify({ eventos }));
}

export function eventoGps({ deviceId, sesionId, lat, lng, ts }) {
  return {
    eventId: uuidV7(ts),
    deviceId,
    ts: new Date(ts).toISOString(),
    tipo: 'gps_point',
    payload: {
      sesionId,
      lat,
      lng,
      accuracy: 5 + Math.random() * 10,
      speed: 3 + Math.random() * 8,
      tsFix: new Date(ts).toISOString(),
    },
  };
}
