import { z } from 'zod';

export const uuidSchema = z.string().uuid();

/** UUIDv7: mismo formato de UUID, versión fija en el 3er grupo (RF-72, doc técnico §7). */
export const uuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'debe ser un UUIDv7 válido',
  );

export const sindicatoIdSchema = uuidSchema;

/**
 * Shapea un buffer de EXACTAMENTE 16 bytes como un UUIDv7 sintácticamente válido según
 * `uuidV7Schema` de arriba: fija el nibble de versión (7) en el 7mo byte y los 2 bits de
 * variante RFC (10) en el 9no, sin tocar el resto. `uuidV7Schema` es un chequeo de FORMATO
 * (regex), no de semántica temporal — sirve tanto para un UUIDv7 "real" (`generarUuidV7`, que
 * SÍ mete un timestamp real en los primeros 6 bytes) como para un id DETERMINÍSTICO derivado de
 * un hash (`derivarEventIdDeterministico`, abajo), que no lleva ningún timestamp: el servidor
 * no puede distinguir uno de otro, y no hace falta que pueda.
 */
function bytesAUuidV7(bytes16: Uint8Array): string {
  const bytes = new Uint8Array(bytes16); // copia — nunca mutar el buffer del caller
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Genera un UUIDv7 (RFC 9562): 48 bits de timestamp en ms + 74 bits aleatorios, ordenable
 * por tiempo de creación (RF-72, doc técnico §7 — el outbox móvil los usa como `event_id`
 * para idempotencia, QUI-238). No genera la aleatoriedad por sí misma para no atarse a una
 * API de crypto específica de plataforma (Node vs `expo-crypto` en el dispositivo) —
 * `randomBytes` debe traer al menos 10 bytes de una fuente de entropía real del llamador.
 */
export function generarUuidV7(randomBytes: Uint8Array, ahora: Date = new Date()): string {
  if (randomBytes.length < 10) {
    throw new Error('generarUuidV7 necesita al menos 10 bytes aleatorios');
  }

  const ts = BigInt(ahora.getTime());
  const bytes = new Uint8Array(16);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = randomBytes[0]!; // versión fijada por bytesAUuidV7
  bytes[7] = randomBytes[1]!;
  bytes[8] = randomBytes[2]!; // variante fijada por bytesAUuidV7
  for (let i = 9; i < 16; i++) {
    bytes[i] = randomBytes[i - 6]!;
  }

  return bytesAUuidV7(bytes);
}

/** FNV-1a de 64 bits (BigInt) — mezcla determinística, sin dependencias de crypto (corre igual
 * en Node, RN/Hermes o el navegador). No es criptográfico: no hace falta serlo para un id de
 * idempotencia sobre un espacio de entrada chico y conocido (UUIDs + un contador) — solo hace
 * falta que la MISMA entrada produzca SIEMPRE la MISMA salida y que dos entradas DISTINTAS casi
 * nunca choquen, y 64 bits de mezcla (128 combinando dos semillas, ver
 * `derivarEventIdDeterministico`) sobran para eso. */
function fnv1a64(input: string, seed: bigint): bigint {
  const FNV_PRIME_64 = 0x100000001b3n;
  const MASK_64 = 0xffffffffffffffffn;
  let hash = seed & MASK_64;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i) & 0xff);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash;
}

function bigInt64ABytes(valor: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let v = valor;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

/**
 * eventId DETERMINÍSTICO, con forma de UUIDv7 (pasa `uuidV7Schema`), derivado de una lista de
 * partes (p. ej. `[sesionId, puntoControlId, String(pasada)]`) — la MISMA tripleta produce
 * SIEMPRE el MISMO id, sin importar cuándo ni desde qué camino se calcule. Existe para que dos
 * caminos que confirman la MISMA pasada de la MISMA visita (un fix real y un heartbeat
 * corriendo casi en paralelo, por ejemplo — hallazgo de revisión R1/concurrencia,
 * `apps/mobile/src/gps/headless-task.ts`) emitan el MISMO `eventId` en vez de dos distintos: el
 * dedupe del servidor es únicamente por `eventId` (`ON CONFLICT (event_id) DO NOTHING`,
 * QUI-241) — dos ids distintos para el mismo hecho hacen que el paso se cuente dos veces.
 *
 * Deliberadamente SÍNCRONO (sin SHA-256 ni ningún crypto async): `construirEventosDeUbicacion`
 * (`apps/mobile/src/gps/location-task.ts`) es una función PURA y síncrona a propósito (para
 * poder testearla bajo vitest/Node sin mockear `expo-crypto`) — volverla async para poder
 * derivar el eventId habría cascadeado por todos sus callers sin necesidad: FNV-1a de 128 bits
 * (dos pasadas de 64 bits con semillas distintas) alcanza de sobra para este espacio de entrada
 * (ver el comentario de `fnv1a64`).
 */
export function derivarEventIdDeterministico(partes: readonly string[]): string {
  const clave = partes.join('\u0000'); // separador que nunca aparece en un UUID/entero
  const SEMILLA_A = 0xcbf29ce484222325n; // FNV offset basis de 64 bits
  const SEMILLA_B = 0x9e3779b97f4a7c15n; // constante de mezcla distinta (golden ratio de 64 bits)
  const bytes = new Uint8Array(16);
  bytes.set(bigInt64ABytes(fnv1a64(clave, SEMILLA_A)), 0);
  bytes.set(bigInt64ABytes(fnv1a64(clave, SEMILLA_B)), 8);
  return bytesAUuidV7(bytes);
}
