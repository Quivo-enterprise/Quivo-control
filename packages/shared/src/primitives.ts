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
  bytes[6] = 0x70 | (randomBytes[0]! & 0x0f); // nibble alto = versión 7
  bytes[7] = randomBytes[1]!;
  bytes[8] = 0x80 | (randomBytes[2]! & 0x3f); // 2 bits altos = variante RFC (10)
  for (let i = 9; i < 16; i++) {
    bytes[i] = randomBytes[i - 6]!;
  }

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
