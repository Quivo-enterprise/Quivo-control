import { createHash, randomBytes } from 'node:crypto';

type TipoToken = 'challenge' | 'access' | 'refresh';

const PREFIJOS: Record<TipoToken, string> = {
  challenge: 'mobile_ch_',
  access: 'mobile_at_',
  refresh: 'mobile_rt_',
};

export interface TokenOpacoEmitido {
  value: string;
  hash: string;
}

/** Emite un bearer aleatorio; sólo su SHA-256 se persiste para permitir revocación sin
 * guardar el secreto reutilizable. */
export function emitirTokenOpaco(tipo: TipoToken): TokenOpacoEmitido {
  const value = `${PREFIJOS[tipo]}${randomBytes(32).toString('base64url')}`;
  return { value, hash: hashTokenOpaco(value) };
}

export function hashTokenOpaco(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
