import type { Prisma } from '@quivo/db';

/** Fila de salida: el trufi de las sesiones que se cierran sale de la fila (`retirado`). Va en código y no
 * en un trigger SQL porque solo logout y el cierre de zombis son salidas; rotar PIN ya queda fuera de la
 * fila porque el cálculo solo cuenta sesiones activas. */
export async function retirarFilaDeSesiones(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$executeRaw`
    UPDATE fila_salida SET estado = 'retirado'
    WHERE estado = 'en_fila' AND "sesionId" = ANY(${ids}::text[])
  `;
}
