export type ResultadoTerminarDia = { ok: true } | { ok: false; motivo: 'detener' | 'sin_conexion' };

interface DepsTerminarDia {
  /** Hay que detener el recorrido (GPS activo, o un `fin_recorrido` que quedó sin encolar). */
  necesitaDetener: boolean;
  /** El servidor ya dio la sesión por cerrada: sin token no hay drenado posible. */
  sesionMuerta: boolean;
  detener: () => Promise<boolean>;
  drenar: () => Promise<{ enviados: number; leidos: number } | null>;
  contarPendientes: () => Promise<number>;
  logout: () => Promise<void>;
  ahora: () => number;
  esperar: (ms: number) => Promise<void>;
  topeMs?: number;
}

/** Cierre completo del día: detener recorrido, drenar el outbox y recién ahí logout. Sin red no
 * hace logout: revocar el token con eventos sin enviar los dejaría varados en el teléfono (401). */
export async function terminarDia(deps: DepsTerminarDia): Promise<ResultadoTerminarDia> {
  const { topeMs = 15_000 } = deps;
  if (deps.necesitaDetener && !(await deps.detener())) return { ok: false, motivo: 'detener' };

  // Sesión muerta: no hay token para drenar; los eventos quedan en el teléfono (igual que con el banner).
  if (deps.sesionMuerta) {
    await deps.logout();
    return { ok: true };
  }

  const limite = deps.ahora() + topeMs;
  for (;;) {
    try {
      // null = otro camino tiene el lease (reintentar). Si se leyeron filas y el servidor no acusó
      // ninguna, solo quedan eventos que nunca acusa: no bloquean el cierre. `leidos` 0 con
      // pendientes (filas en vuelo de otro drenador) NO es eso: se reintenta.
      const r = await deps.drenar();
      if (r !== null && ((await deps.contarPendientes()) === 0 || (r.leidos > 0 && r.enviados === 0))) {
        break;
      }
    } catch {
      // Un fallo de red cuenta como intento fallido: se reintenta hasta el tope.
    }
    if (deps.ahora() >= limite) return { ok: false, motivo: 'sin_conexion' };
    await deps.esperar(1_000);
  }

  // shortcut: el tope de 15 s se chequea entre rondas; una ronda con mucho atraso en red lenta puede
  // tardar más (hasta 20 lotes x 20 s de timeout) con el diálogo bloqueado; upgrade: AbortController
  // o tope por ronda.
  // shortcut: si la red se corta entre el drenado y el logout, `ejecutarLogout` deja la
  // revocación pendiente y la sesión del servidor sigue abierta hasta el reintento o el cierre
  // por inactividad (3 h); upgrade: revocar antes de borrar la sesión local.
  await deps.logout();
  return { ok: true };
}
