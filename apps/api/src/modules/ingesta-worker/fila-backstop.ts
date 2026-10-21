import { Logger } from '@nestjs/common';
import type { Prisma } from '@quivo/db';
import { fechaActualBolivia } from '@quivo/shared';
import { esAnticipada } from '../salidas/salidas.logic.js';
import { bloquearTerminal, calcularFilaPc } from '../salidas/fila-datos.js';

type Tx = Prisma.TransactionClient;

const logger = new Logger('FilaBackstop');

/**
 * Los `ts` de los eventos son del teléfono y `llegadaTs` del servidor: un evento debe ser al menos
 * esto posterior a la llegada para contar como salida.
 * shortcut: asume reloj del teléfono sincronizado por red (±60 s); si aparecen salidas falsas, estimar el offset por lote
 */
export const MARGEN_RELOJ_BACKSTOP_MS = 60_000;

export interface EntradaBackstopFila {
  sindicatoId: string;
  sesionId: string;
  /** PC con rol `terminal` de la ruta de la sesión: sus cumplimientos nunca cuentan como salida. */
  terminalesIds: ReadonlySet<string>;
  /** Cumplimientos del lote de PC activos de la ruta de la sesión. */
  cumplimientos: { ts: Date; puntoControlId: string }[];
  fines: Date[];
  ahora: Date;
}

/**
 * Backstop de la fila de salida (plan "fila de salida"): si la sesión está `en_fila` y el lote trae
 * el cumplimiento de un PC que NO es la terminal, el trufi ya salió (`salio`, origen `deteccion`);
 * con `fin_recorrido` sale de la fila (`retirado`). Solo cuentan eventos con
 * `ts >= llegadaTs + MARGEN_RELOJ_BACKSTOP_MS`: un lote offline viejo no puede sacar de la fila a
 * quien llegó después. Pasar por CUALQUIER terminal de la ruta no es salir.
 *
 * Corre dentro de la transacción de `procesarVueltasSesion`, DESPUÉS de tomar el advisory lock de
 * la sesión. Una falla acá se loguea y NUNCA rompe la ingesta: va en un SAVEPOINT para que el error
 * de SQL no deje abortada la transacción de las vueltas.
 */
export async function aplicarBackstopFila(tx: Tx, entrada: EntradaBackstopFila): Promise<void> {
  const eventos = [
    ...entrada.cumplimientos
      .filter((c) => !entrada.terminalesIds.has(c.puntoControlId))
      .map((c) => ({ ts: c.ts, tipo: 'salio' as const, pcId: c.puntoControlId })),
    ...entrada.fines.map((ts) => ({ ts, tipo: 'retirado' as const, pcId: null })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  if (eventos.length === 0) return;
  try {
    await tx.$executeRaw`SAVEPOINT fila_backstop`;
    const [fila] = await tx.$queryRaw<{ id: string; puntoControlId: string; llegadaTs: Date }[]>`
      SELECT id, "puntoControlId", "llegadaTs" FROM fila_salida
      WHERE "sesionId" = ${entrada.sesionId} AND "sindicatoId" = ${entrada.sindicatoId} AND estado = 'en_fila'
    `;
    // La terminal de la fila nunca cuenta como salida, aunque `terminalesIds` no la trajera.
    const evento =
      fila &&
      eventos.find(
        (e) => e.pcId !== fila.puntoControlId && e.ts.getTime() >= fila.llegadaTs.getTime() + MARGEN_RELOJ_BACKSTOP_MS,
      );
    if (fila && evento) {
      await bloquearTerminal(tx, fila.puntoControlId);
      if (evento.tipo === 'retirado') {
        await tx.$executeRaw`UPDATE fila_salida SET estado = 'retirado' WHERE id = ${fila.id} AND estado = 'en_fila'`;
      } else {
        // `ts` acotado a `ahora` (un reloj adelantado no puede fechar la salida en el futuro). La
        // anticipada se evalúa con la fila, las reglas y la última salida a ese instante.
        const ts = new Date(Math.min(evento.ts.getTime(), entrada.ahora.getTime()));
        const { posiciones } = await calcularFilaPc(tx, fila.puntoControlId, fechaActualBolivia(ts), ts, ts);
        const anticipada = esAnticipada(posiciones, fila.id, ts);
        await tx.$executeRaw`
          UPDATE fila_salida
          SET estado = 'salio', "salidaTs" = ${ts}, "salidaOrigen" = 'deteccion', anticipada = ${anticipada}
          WHERE id = ${fila.id} AND estado = 'en_fila'
        `;
      }
    }
    await tx.$executeRaw`RELEASE SAVEPOINT fila_backstop`;
  } catch (error) {
    try {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT fila_backstop`;
    } catch {
      // Si ni el rollback al savepoint funciona la transacción ya está perdida: la falla real sale en el siguiente paso.
    }
    logger.error(
      `Fila de salida: backstop falló en la sesión ${entrada.sesionId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
