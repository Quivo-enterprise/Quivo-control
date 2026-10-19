import type { Prisma } from '@prisma/client';
import { prisma } from './client.js';

export interface TenantContext {
  rol: string;
  sindicatoId: string | null;
}

/**
 * Ejecuta `callback` dentro de una transacción con `app.rol` / `app.sindicato_id` fijados
 * vía `set_config(..., true)` — el `true` final es `is_local`, equivalente a `SET LOCAL`:
 * se descarta solo al terminar la transacción, nunca queda pegado a una conexión reusada
 * del pool (a diferencia de `SET` sin `LOCAL`). Las políticas RLS de la migración
 * `20260730152500_rls_multi_tenant` leen esos dos valores con `current_setting(..., true)`.
 *
 * `set_config` es una llamada a función normal (no el statement `SET`), así que acepta
 * `rol`/`sindicatoId` como parámetros bindeados de verdad — nunca se interpolan como texto
 * en el SQL, no hay superficie de inyección acá.
 *
 * `options` (opcional) se pasa tal cual a `$transaction`: el default de Prisma es `timeout` 5 s /
 * `maxWait` 2 s, corto para los lotes pesados del worker de ingesta. Los llamadores de la API no
 * lo usan.
 */
export function withTenantContext<T>(
  { rol, sindicatoId }: TenantContext,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rol', ${rol}, true)`;
    await tx.$executeRaw`SELECT set_config('app.sindicato_id', ${sindicatoId ?? ''}, true)`;
    return callback(tx);
  }, options);
}
