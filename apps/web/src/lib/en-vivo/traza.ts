import type { EstadoFrescura, PuntoTrazaGps, TrazaEnVivo } from '@quivo/shared';

/**
 * Lógica pura del mapa en vivo (`/en-vivo`, ENTREGA 3). Vive fuera del componente a
 * propósito: el merge del delta, el auto-heal y la medición de antigüedad son las tres
 * piezas con reglas de negocio reales, y así se testean sin montar React ni Leaflet.
 */

/**
 * Solape que el cliente resta al cursor antes de pedir el delta.
 *
 * `gps_points.ts` es el timestamp del **fix** (reloj del dispositivo cuando se capturó la
 * posición), NO el de la ingesta. Al salir de Doze el teléfono descarga una ráfaga de
 * puntos con `ts` viejos — medido el 2026-08-18 contra producción: lag captura→servidor
 * con mediana 153-166 s, p95 684-814 s. Un cursor exclusivo (`desde = ultimo_ts`) los
 * descartaría **para siempre**, porque su `ts` ya quedó por debajo. Pidiendo 2 min hacia
 * atrás en cada poll esas ráfagas entran, y el dedupe por `ts|lat|lng` evita duplicarlas.
 */
export const SOLAPE_CURSOR_MS = 120_000;

/** Cadencia normal del poll de posiciones. */
export const INTERVALO_POLL_MS = 10_000;

/** Cadencia mientras el server avisa `hayMas` (la carga inicial vino truncada por `limite`). */
export const INTERVALO_POLL_RAPIDO_MS = 1_000;

/**
 * Inactividad (medida por el server con `inactivaDesdeMs`) a partir de la cual se corta el
 * poll.
 *
 * El corte **no puede depender de `fin`**: "Finalizar recorrido" en la app registra un
 * evento pero no cierra la `sesion_operativa`, así que `fin` queda NULL indefinidamente
 * (había sesiones colgadas el 2026-08-18). La regla original "sesión con `fin` +5 min ⇒
 * dejar de pollear" no se dispararía nunca.
 *
 * El valor sale de los datos de campo: el lag de ingesta tiene p95 de 684-814 s (~14 min) y
 * un máximo observado de 4275 s (~71 min). Cortar cerca del p95 mataría el seguimiento de un
 * teléfono que solo está atrasado. 30 min es el doble del umbral con el que el server declara
 * `perdido` (15 min) y deja margen sobre el p95, sin llegar a pollear indefinidamente una
 * sesión zombi. Si el corte se equivoca, el costo es bajo: la UI ofrece "Reanudar", que
 * vuelve a pedir y reactiva el poll si el vehículo revivió.
 */
export const UMBRAL_CORTE_POLL_MS = 30 * 60_000;

/** Traza acumulada en la cache de TanStack Query: el último payload del server con los
 * puntos ya fusionados con lo que había. */
export interface TrazaAcumulada extends TrazaEnVivo {
  /** `true` cuando lo acumulado cubre el `totalPuntos` que reporta el server, o sea que no
   * quedaron huecos. Ver `necesitaRecargaCompleta`. */
  completa: boolean;
  /** `true` si ya se recargó la ventana entera y AUN ASÍ quedó por debajo de `totalPuntos`.
   * Corta el bucle: ver `debeRecargar`. */
  recargaFallida: boolean;
}

/**
 * Identidad de un punto para el dedupe. `ts` solo no alcanza como clave: dos fixes pueden
 * compartir timestamp (redondeo del dispositivo) y los reenvíos del solape traen el punto
 * exacto otra vez.
 */
export function clavePunto(punto: PuntoTrazaGps): string {
  return `${punto.ts}|${punto.lat}|${punto.lng}`;
}

/**
 * Fusiona el delta con lo acumulado. Idempotente: aplicar dos veces el mismo delta (doble
 * render de Strict Mode, dos polls solapados) da exactamente el mismo resultado.
 *
 * Reordena por `ts` porque las ráfagas post-Doze llegan con timestamps **anteriores** al
 * último punto dibujado; sin el sort la polilínea daría saltos hacia atrás.
 */
export function fusionarTraza(
  previa: TrazaAcumulada | undefined,
  delta: TrazaEnVivo,
): TrazaAcumulada {
  const porClave = new Map<string, PuntoTrazaGps>();
  for (const punto of previa?.puntos ?? []) porClave.set(clavePunto(punto), punto);
  for (const punto of delta.puntos) porClave.set(clavePunto(punto), punto);

  const puntos = [...porClave.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const ultimo = puntos.at(-1);

  return {
    // El resto del payload (frescura, cumplimientos, estado de la sesión) siempre se
    // reemplaza: son valores del "ahora" del server, no algo que se acumule.
    ...delta,
    puntos,
    cursor: ultimo?.ts ?? null,
    completa: puntos.length >= delta.totalPuntos,
    recargaFallida: false,
  };
}

/** `desde` del próximo poll: el cursor menos el solape. `undefined` (= carga completa)
 * mientras no haya ningún punto todavía. */
export function desdeConSolape(cursor: string | null | undefined): Date | undefined {
  if (!cursor) return undefined;
  return new Date(Date.parse(cursor) - SOLAPE_CURSOR_MS);
}

/**
 * Auto-heal: si lo acumulado quedó por debajo de `totalPuntos` hubo un hueco (una ráfaga que
 * cayó fuera del solape, o una respuesta perdida) y conviene recargar la traza entera **una**
 * vez.
 *
 * `hayMas` desactiva la comprobación: ahí el delta vino truncado por `limite` a propósito y
 * estar por debajo del total es lo esperado — recargar sería un bucle infinito de descargas
 * completas.
 */
export function necesitaRecargaCompleta(traza: TrazaAcumulada): boolean {
  return !traza.hayMas && !traza.completa;
}

/**
 * Igual que `necesitaRecargaCompleta`, pero sin repetir una recarga que ya falló contra el
 * mismo `totalPuntos`.
 *
 * El caso que cubre: si en la base hay dos filas distintas (`event_id` distinto) con el
 * mismo `ts`, `lat` y `lng` — reingesta del mismo fix —, el dedupe del cliente las colapsa
 * y lo acumulado queda **permanentemente** por debajo de `totalPuntos`. Sin esta guarda,
 * cada poll dispararía una descarga completa de la traza para siempre. Se vuelve a intentar
 * en cuanto el total cambia, que es cuando puede haber un hueco nuevo y real.
 */
export function debeRecargar(
  previa: TrazaAcumulada | undefined,
  fusionada: TrazaAcumulada,
): boolean {
  if (!necesitaRecargaCompleta(fusionada)) return false;
  if (previa?.recargaFallida && previa.totalPuntos === fusionada.totalPuntos) return false;
  return true;
}

/**
 * Diferencia entre el reloj del servidor y el del navegador, en ms, calculada con el
 * `servidorTs` de la respuesta y el momento en que esa respuesta llegó (`dataUpdatedAt` de
 * TanStack Query). Incluye el tiempo de red, que a esta escala (segundos vs. minutos de
 * antigüedad) es ruido.
 */
export function offsetRelojServidorMs(servidorTs: string, recibidoEnMs: number): number {
  return Date.parse(servidorTs) - recibidoEnMs;
}

/**
 * Antigüedad de un timestamp **medida contra el reloj del servidor**, actualizada al
 * instante actual del cliente. Un navegador con el reloj corrido tres horas mostraría "sin
 * datos hace 3 h" con el trufi andando normal: por eso nunca se compara `Date.now()` contra
 * `ts` directamente, sino corrigiendo por el offset.
 */
export function antiguedadViva(
  ts: string | null,
  servidorTs: string,
  recibidoEnMs: number,
  ahoraMs: number,
): number | null {
  if (!ts) return null;
  const ahoraServidor = ahoraMs + offsetRelojServidorMs(servidorTs, recibidoEnMs);
  return Math.max(0, ahoraServidor - Date.parse(ts));
}

/** Cadencia del `refetchInterval`, según el último payload recibido. */
export function intervaloPoll(
  datos: Pick<TrazaEnVivo, 'hayMas' | 'inactivaDesdeMs'> | undefined,
): number | false {
  if (!datos) return INTERVALO_POLL_MS;
  if (datos.hayMas) return INTERVALO_POLL_RAPIDO_MS;
  if (datos.inactivaDesdeMs > UMBRAL_CORTE_POLL_MS) return false;
  return INTERVALO_POLL_MS;
}

export interface PresentacionFrescura {
  etiqueta: string;
  descripcion: string;
  color: string;
  /** `true` solo cuando el estado es una falla real. `detenido` NO lo es. */
  esFalla: boolean;
}

/**
 * Presentación de `estadoFrescura`. **No se usan los umbrales de color de la spec original**
 * (verde <90 s / ámbar 90 s-5 min / rojo >5 min): se escribieron antes de medir el campo, y
 * con el lag real de ingesta (mediana 153-166 s, p95 684-814 s) un trufi andando normal se
 * vería rojo casi todo el tiempo. El color sale del `estadoFrescura` que ya calcula el
 * server cruzando `ultimoFixTs` con `ultimoIngresoTs`.
 *
 * `detenido` es deliberadamente neutro-informativo: un vehículo esperando en terminal
 * (huecos de hasta 56 min medidos, el plugin apaga la captura con el vehículo quieto) está
 * trabajando normalmente. La falla es `perdido`.
 */
export const PRESENTACION_FRESCURA: Record<EstadoFrescura, PresentacionFrescura> = {
  reportando: {
    etiqueta: 'Reportando',
    descripcion: 'El vehículo se mueve y el teléfono sincroniza.',
    color: '#16a34a',
    esFalla: false,
  },
  detenido: {
    etiqueta: 'Detenido',
    descripcion:
      'El teléfono sincroniza pero no hay fixes nuevos: el vehículo está quieto (terminal o parada larga). No es una falla.',
    color: '#0891b2',
    esFalla: false,
  },
  perdido: {
    etiqueta: 'Sin señal',
    descripcion: 'El teléfono no está llegando al servidor. Revisar batería, datos y permisos.',
    color: '#dc2626',
    esFalla: true,
  },
  sin_datos: {
    etiqueta: 'Sin datos',
    descripcion: 'La sesión existe pero todavía no entró ningún punto GPS.',
    color: '#64748b',
    esFalla: false,
  },
};

/** Duración legible para las dos antigüedades (`hace 3 min 20 s`). */
export function formatearAntiguedad(ms: number | null): string {
  if (ms === null) return '—';
  const totalSegundos = Math.floor(ms / 1000);
  if (totalSegundos < 60) return `${totalSegundos} s`;
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  if (minutos < 60) return `${minutos} min ${String(segundos).padStart(2, '0')} s`;
  const horas = Math.floor(minutos / 60);
  return `${horas} h ${String(minutos % 60).padStart(2, '0')} min`;
}
