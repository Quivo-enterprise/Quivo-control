import { z } from 'zod';

export const MENSAJE_TELEFONO_BOLIVIA = 'Número boliviano de 8 dígitos que empiece con 6 o 7';

/**
 * Celular boliviano a E.164 (`+59171234567`). Acepta espacios, guiones, puntos y paréntesis,
 * y el prefijo `+591`/`591`/`00591` opcional. Exige 8 dígitos que empiecen con 6 o 7
 * (celulares); fijos (`4xxxxxxx`) y largos distintos de 8 se rechazan. Devuelve `null` si
 * la entrada no es un celular válido.
 */
export function normalizarTelefonoBolivia(input: string): string | null {
  const limpio = input.normalize('NFKC').trim().replace(/[\s\-.()]/g, '');
  const match = /^(?:\+?591|00591)?([67]\d{7})$/.exec(limpio);
  return match ? `+591${match[1]}` : null;
}

/** `+59171234567` -> `+591 7123 4567` para mostrar; lo que no sea E.164 válido vuelve igual. */
export function formatearTelefonoBolivia(telefono: string): string {
  const normalizado = normalizarTelefonoBolivia(telefono);
  return normalizado
    ? `+591 ${normalizado.slice(4, 8)} ${normalizado.slice(8)}`
    : telefono;
}

/**
 * Teléfono opcional del conductor. `undefined` se conserva (PATCH parcial no lo toca);
 * `''`/`null` limpian el valor (`null`); cualquier otra cosa debe ser un celular válido y
 * sale normalizada a E.164.
 */
export const TelefonoBoliviaSchema = z
  .string()
  .nullish()
  .transform((value, ctx): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || value.trim() === '') return null;
    const normalizado = normalizarTelefonoBolivia(value);
    if (!normalizado) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_TELEFONO_BOLIVIA });
      return z.NEVER;
    }
    return normalizado;
  });
