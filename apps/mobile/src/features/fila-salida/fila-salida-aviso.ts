import { cancelarAvisoProgramado, programarAvisoEnCanal } from '../operacion/anuncio-punto-control';
import type { EstadoLocalVuelta } from '../vuelta-actual/vuelta-actual-core';
import {
  TEXTO_AVISO_FILA,
  TITULO_AVISO_FILA,
  idAvisoFila,
  momentoLocalAviso,
} from './fila-salida-core';

/** Si el aviso caería en menos que esto, no se programa: lo cubre el aviso de foreground. */
const MARGEN_MINIMO_MS = 2_000;

/**
 * Mantiene UNA notificación local programada para "falta 1 minuto" (T-1) de la fila de salida,
 * a la hora corregida por el desfase del reloj (`desfaseFilaMs`). Se llama cada vez que cambia el estado local de la
 * vuelta (foreground y headless): reprograma (mismo `identifier` = reemplazo) y cancela la del
 * `etaTs` anterior cuando cambia, el trufi sale de la fila o se habilita. Best-effort: nunca rechaza.
 */
export async function sincronizarAvisoFila(
  previo: EstadoLocalVuelta,
  nuevo: EstadoLocalVuelta,
  ahoraMs: number = Date.now(),
): Promise<void> {
  try {
    const anterior = previo.ultimo?.fila ?? null;
    const fila = nuevo.ultimo?.fila ?? null;
    if (anterior && (!fila || anterior.etaTs !== fila.etaTs)) {
      await cancelarAvisoProgramado(idAvisoFila(anterior.etaTs));
    }
    if (!fila) return;
    // Solo se avisa al primero: el 2.º recibiría un T-1 que se vuelve a calcular al pasar a 1.º.
    if (fila.habilitado || fila.posicion !== 1) {
      await cancelarAvisoProgramado(idAvisoFila(fila.etaTs));
      return;
    }
    if (nuevo.desfaseFilaMs === undefined) return;
    const momento = momentoLocalAviso(fila, nuevo.desfaseFilaMs);
    if (momento === null || momento - ahoraMs < MARGEN_MINIMO_MS) return;
    await programarAvisoEnCanal({
      identifier: idAvisoFila(fila.etaTs),
      titulo: TITULO_AVISO_FILA,
      cuerpo: TEXTO_AVISO_FILA,
      fechaMs: momento,
    });
  } catch {
    // best-effort: sin aviso programado queda el de foreground
  }
}

/** Cancela el aviso programado de la fila que tenía `estado` (fin del recorrido / cierre de sesión). */
export async function cancelarAvisoFilaDe(estado: EstadoLocalVuelta): Promise<void> {
  const fila = estado.ultimo?.fila ?? null;
  if (fila) await cancelarAvisoProgramado(idAvisoFila(fila.etaTs));
}
