/**
 * LOW-MED (hallazgo de revisión, QUI-247): si la escritura del marcador `inicio_recorrido`
 * fallaba dentro de `iniciar()` (SQLite sin espacio, handle zombi de `expo-sqlite`), `tracking`
 * se quedaba en `true` (G2, ver `resultado-iniciar-recorrido.ts`) pero NADA volvía a intentar
 * escribir ese marcador — un recorrido con `fin_recorrido` pero sin `inicio_recorrido` rompe la
 * reconstrucción del recorrido (mismo daño de fondo que QUI-247 en el hallazgo MEDIO de al lado).
 *
 * Este módulo es la parte PURA (sin SQLite, sin `expo-crypto`, sin el SDK de Transistorsoft) de
 * ese reintento: `use-gps-operativo.ts` es el único lugar que la conecta con `abrirOutbox`/
 * `encolarEvento` reales, y la llama desde CUATRO puntos que comparten el mismo estado mutable
 * (`EstadoInicioRecorrido`, guardado en un `useRef` por hook):
 * - El intento inicial en `iniciar()`, justo antes de arrancar el tracking nativo.
 * - Cada `onLocation` mientras el marcador siga sin confirmar.
 * - Cada `onHeartbeat` (cada 60 s), mismo motivo.
 * - `detener()`, como última red de seguridad ANTES de escribir `fin_recorrido` — si ninguno
 *   de los reintentos anteriores tuvo éxito, esta es la última oportunidad de no dejar un
 *   `fin_recorrido` huérfano.
 *
 * IDEMPOTENCIA: el `eventId` se genera UNA sola vez por intento de `iniciar()`
 * (`reiniciarEstadoInicioRecorrido`, más abajo) y se reusa en TODOS los reintentos —
 * `encolarEvento` con un `eventId` explícito usa `INSERT OR IGNORE` (`db/outbox.ts`), así que
 * reintentar nunca duplica el evento aunque un intento previo ya lo hubiera insertado con
 * éxito (p. ej. si el `INSERT` corrió pero algo posterior en la misma llamada lanzó de todos
 * modos). `estado.confirmado` es además una guarda barata para no volver a tocar SQLite en
 * absoluto una vez que se sabe que el marcador ya quedó escrito.
 *
 * PROTECCIÓN DEL CAMINO DE RE-ENGANCHE (QUI-247, invariante ya existente): el estado inicial
 * (`crearEstadoInicioRecorrido`) tiene `eventId: null`, y `asegurarInicioRecorrido` es un no-op
 * mientras siga así. El único lugar que le asigna un `eventId` real es
 * `reiniciarEstadoInicioRecorrido`, llamado SOLO desde `iniciar()`. El `useEffect` de
 * re-enganche de `use-gps-operativo.ts` (el chofer mata la app a mitad de turno y la reabre con
 * el plugin nativo ya `enabled`) nunca pasa por `iniciar()` — así que, aunque ese camino
 * también dispare `onLocation`/heartbeats, `asegurarInicioRecorrido` sigue sin hacer nada: un
 * segundo `inicio_recorrido` ahí deformaría el recorrido reconstruido, exactamente lo que esa
 * invariante existe para evitar.
 */

export interface EstadoInicioRecorrido {
  /** `null`: no hay ningún `iniciar()` real en curso en este proceso (estado inicial, o el
   * camino de re-enganche que nunca lo asigna) — `asegurarInicioRecorrido` es un no-op. */
  eventId: string | null;
  /** `true` una vez que el marcador quedó persistido (o ya lo estaba antes de este intento). */
  confirmado: boolean;
  /**
   * H2 (hallazgo de revisión, 2026-09-25): `ts` (ISO) capturado por el llamador al arrancar ESTE
   * intento de `iniciar()` — junto con `eventId`, ANTES de cualquier operación que pueda
   * colgarse (`abrirOutbox()`, el nativo). `asegurarInicioRecorrido` lo pasa como `ts` explícito
   * del evento `inicio_recorrido` en cada reintento (`onLocation`, heartbeat, `detener()`), así
   * que aunque la escritura real a SQLite se demore, el `ts` persistido sigue siendo el del
   * instante en que el recorrido REALMENTE empezó — nunca el de cuándo se logró escribir. `null`
   * en el mismo caso que `eventId: null` (estado inicial / re-enganche, donde no hay nada que
   * escribir).
   */
  ts: string | null;
}

/** Objeto mutable (no inmutable/funcional a propósito): vive en un `useRef` del hook, igual que
 * `puntosControlDetectados` — `asegurarInicioRecorrido` lo actualiza in-place para que los
 * cuatro call sites (arriba) compartan siempre el mismo estado sin pasarse una copia stale. */
export function crearEstadoInicioRecorrido(): EstadoInicioRecorrido {
  return { eventId: null, confirmado: false, ts: null };
}

/** Arranca un intento nuevo (un `iniciar()` real): asigna el `eventId` estable de este intento
 * y resetea `confirmado` — necesario incluso si el intento ANTERIOR nunca llegó a confirmarse,
 * porque un `eventId` de un recorrido viejo nunca debe reusarse para el marcador de uno nuevo
 * (dos recorridos distintos en la misma sesión, tras `finalizar()` + `iniciar()`, necesitan dos
 * `inicio_recorrido` distintos).
 *
 * H2 (hallazgo de revisión, 2026-09-25): también recibe `ts` (ISO), capturado por el llamador
 * en el mismo instante en que arranca el intento — ver el docblock de `EstadoInicioRecorrido.ts`
 * para el porqué. */
export function reiniciarEstadoInicioRecorrido(
  estado: EstadoInicioRecorrido,
  eventId: string,
  ts: string,
): void {
  estado.eventId = eventId;
  estado.confirmado = false;
  estado.ts = ts;
}

/** Subconjunto de `db/outbox.ts` que este módulo necesita — declarado acá (no importado) para
 * que los tests puedan pasar fakes en memoria sin levantar `expo-sqlite`, mismo criterio que
 * `SdkSeguimientoContinuo` en `gps/seguimiento-continuo.ts`. `Db` es genérico: en runtime es
 * `SQLite.SQLiteDatabase`, pero a esta función no le importa su forma real. */
export interface DependenciasInicioRecorrido<Db> {
  abrirOutbox: () => Promise<Db>;
  encolarEvento: (
    db: Db,
    evento: {
      deviceId: string;
      tipo: 'inicio_recorrido';
      payload: Record<string, unknown>;
      eventId: string;
      /** H2 (hallazgo de revisión, 2026-09-25): ver `EstadoInicioRecorrido.ts`. */
      ts: string;
    },
  ) => Promise<unknown>;
}

export interface ContextoInicioRecorrido {
  deviceId: string;
  sesionId: string;
}

/**
 * No-op si ya no hace falta nada (`confirmado`) o si este proceso nunca llamó `iniciar()`
 * (`eventId === null`, ver docblock del módulo). Si `encolarEvento` rechaza, la excepción se
 * propaga tal cual — el llamador decide cómo reportarla (Sentry) y cuándo reintentar; esta
 * función no atrapa nada por su cuenta para no esconder el fallo real de un caller que sí
 * necesita saber si el intento tuvo éxito.
 */
export async function asegurarInicioRecorrido<Db>(
  estado: EstadoInicioRecorrido,
  deps: DependenciasInicioRecorrido<Db>,
  contexto: ContextoInicioRecorrido,
): Promise<void> {
  if (estado.confirmado || estado.eventId === null) return;
  const eventId = estado.eventId;
  // H2: `estado.ts` siempre se asigna junto con `eventId` en `reiniciarEstadoInicioRecorrido` —
  // invariante del módulo (el único lugar que asigna `eventId` no-null también asigna `ts`). El
  // fallback solo cubre un estado construido a mano sin pasar por esa función (p. ej. en tests).
  const ts = estado.ts ?? new Date().toISOString();
  const db = await deps.abrirOutbox();
  await deps.encolarEvento(db, {
    deviceId: contexto.deviceId,
    tipo: 'inicio_recorrido',
    payload: { sesionId: contexto.sesionId },
    eventId,
    ts,
  });
  // Punto 6 (rediseño iniciar()/detener(), 2026-09-25): marcar `confirmado` SOLO si
  // `estado.eventId` sigue siendo el mismo `eventId` que este intento acaba de escribir. Con
  // `detener()` ya no esperando a un `iniciar()` en curso, un intento invalidado puede seguir en
  // vuelo (colgado en este mismo `await encolarEvento`) mientras un `iniciar()` NUEVO ya llamó
  // `reiniciarEstadoInicioRecorrido` (nuevo `eventId`/`ts`) para el recorrido siguiente. Si el
  // intento viejo, al resolver tarde, marcara `confirmado = true` sin este chequeo, pisaría el
  // estado "sin confirmar" del recorrido NUEVO con un `true` que en realidad certifica el evento
  // del recorrido viejo — el reintento oportunista (`onLocation`/heartbeat/`detener()`) del
  // recorrido nuevo dejaría de reintentar creyendo que ya está escrito.
  if (estado.eventId === eventId) {
    estado.confirmado = true;
  }
}
