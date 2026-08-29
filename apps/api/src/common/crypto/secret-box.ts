import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Cifra secretos que el worker necesita volver a utilizar (por ejemplo, tokens de push).
 * La clave se obtiene de un secreto de entorno y nunca se guarda en la base de datos.
 * `JWT_SECRET` es fallback de desarrollo para no romper instalaciones existentes; en
 * producción se recomienda declarar `NOTIFICATION_TOKEN_ENCRYPTION_KEY` explícitamente.
 */
export function encryptSecret(value: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(encoded: string): string {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = encoded.split('.');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error('Secreto cifrado inválido');
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encryptionKey(): Buffer {
  const source = process.env.NOTIFICATION_TOKEN_ENCRYPTION_KEY ?? process.env.JWT_SECRET;
  if (!source || source.length < 16) {
    throw new Error(
      'Falta NOTIFICATION_TOKEN_ENCRYPTION_KEY (o JWT_SECRET de al menos 16 caracteres)',
    );
  }
  return createHash('sha256').update(source).digest();
}
