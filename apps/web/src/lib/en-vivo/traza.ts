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
 * puntos con `ts` viejos. Lo que importa acá no es la mediana del lag captura→servidor
 * (153-166 s, medido el 2026-08-18 contra producción) sino su cola: p95 684-814 s, máximo
 * observado 4275 s (~71 min). Un solape de 2 min cubre la mediana pero descarta **para
 * siempre** cualquier ráfaga que aterrice más tarde que eso — el cursor (`desde = ultimo_ts
 * - solape`) ya quedó por encima de su `ts`. 75 min cubren el máximo observado (71 min, piloto
 * 14/10). Pedirlos en cada poll sería ~1500 puntos cada 10 s, así que el solape largo se usa
 * solo cada `POLLS_POR_SOLAPE_LARGO` polls (≈ 1 por minuto) y el resto usa
 * `SOLAPE_CURSOR_CORTO_MS`; el dedupe por `ts|lat|lng` de `fusionarTraza` absorbe lo repetido.
 *
 * shortcut: una ráfaga con más de 75 min de atraso sigue dependiendo del auto-heal (recarga
 * completa); el siguiente paso es un cursor por hora de ingesta (no de captura) en la API.
 */
export const SOLAPE_CURSOR_MS = 4_500_000;
/** Solape de los polls intermedios (ver `SOLAPE_CURSOR_MS`). */
export const SOLAPE_CURSOR_CORTO_MS = 15 * 60_000;
/** Cada cuántos polls del delta se usa el solape largo. */
export const POLLS_POR_SOLAPE_LARGO = 6;

/** Cadencia normal del poll de posiciones. */
export const INTERVALO_POLL_MS = 10_000;

/** Cadencia mientras el server avisa `hayMas` (la carga inicial vino truncada por `limite`). */
export const INTERVALO_POLL_RAPIDO_MS = 1_000;

/**
 * Inactividad (medida por el server con `inactivaDesdeMs`) a partir de la cual se corta el
 * poll — el fallback LENTO para sesiones zombi, no la vía normal de corte.
 *
 * El corte **no puede depender de `fin`**: "Finalizar" en la app registra un evento (hoy,
 * además, deriva `estadoFrescura: 'finalizado'`, ver `intervaloPoll` más abajo) pero no
 * cierra la `sesion_operativa` de LOGIN — `fin` queda NULL indefinidamente (había sesiones
 * colgadas el 2026-08-18; sigue siendo así después de Fase A, es intencional: el conductor
 * puede iniciar un recorrido nuevo sin volver a loguearse). La regla original "sesión con
 * `fin` +5 min ⇒ dejar de pollear" no se dispararía nunca.
 *
 * Con Fase A, `intervaloPoll` pasa a una cadencia LENTA (`INTERVALO_POLL_FINALIZADO_MS`,
 * 60 s) cuando el estado es `finalizado` — no corta del todo, porque la sesión de LOGIN
 * sigue viva y el conductor puede iniciar un recorrido nuevo sin volver a loguearse (decisión
 * del chairman sobre un hallazgo de Codex: cortar del todo dejaría ese reinicio sin forma de
 * detectarse). Este umbral de 30 min sigue siendo la red de seguridad para lo que
 * `finalizado` no cubre: una sesión sin `fin_recorrido` (app vieja, o cerrada de mala manera)
 * que simplemente dejó de reportar. El valor sale de los datos de campo: el lag de ingesta tiene p95 de 684-814 s (~14 min) y
 * un máximo observado de 4275 s (~71 min). Cortar cerca del p95 mataría el seguimiento de un
 * teléfono que solo está atrasado. 30 min es el doble del umbral con el que el server declara
 * `perdido` (15 min) y deja margen sobre el p95, sin llegar a pollear indefinidamente una
 * sesión zombi. Si el corte se equivoca, el costo es bajo: la UI ofrece "Reanudar", que
 * vuelve a pedir y reactiva el poll si el vehículo revivió.
 */
export const UMBRAL_CORTE_POLL_MS = 30 * 60_000;

/**
 * Piso de tiempo entre dos disparos de la recarga completa, sin importar por qué se pidió.
 *
 * La guarda por déficit de `debeRecargar` corta el caso del hueco fijo (reingesta colisionada:
 * el déficit no crece entre polls), pero NO alcanza sola cuando la ventana de la sesión supera
 * `TRAZA_EN_VIVO_LIMITE_MAX` (50.000 puntos): ahí la recarga completa nunca puede completar
 * (`recargada.completa` da siempre `false`, ver `use-en-vivo.ts`) y el déficit
 * (`totalPuntos - 50000`) SÍ crece en casi cada poll, porque `totalPuntos` es un `count(*)`
 * vivo que sigue subiendo con el vehículo reportando. La guarda por déficit sola dejaría pasar
 * eso — y volvería el bucle original: una descarga completa (varios MB con el volumen actual)
 * cada 10 s, la traza acumulada descartada, la polilínea rebobinando cada vez. Este cooldown
 * es un techo duro sobre la FRECUENCIA, independiente de la causa: como mucho una recarga
 * completa cada `COOLDOWN_RECARGA_MS`, sea el déficit fijo o creciendo de verdad.
 */
export const COOLDOWN_RECARGA_MS = 60_000;

/** Traza acumulada en la cache de TanStack Query: el último payload del server con los
 * puntos ya fusionados con lo que había. */
export interface TrazaAcumulada extends TrazaEnVivo {
  /** `true` cuando lo acumulado cubre el `totalPuntos` que reporta el server, o sea que no
   * quedaron huecos. Ver `necesitaRecargaCompleta`. */
  completa: boolean;
  /** `true` si ya se recargó la ventana entera y AUN ASÍ quedó por debajo de `totalPuntos`.
   * Corta el bucle: ver `debeRecargar`. */
  recargaFallida: boolean;
  /** Déficit (`totalPuntos - puntos.length`) que dejó la última recarga fallida, o `null`
   * si no hubo ninguna (o la última recarga sí completó). Ver `debeRecargar`: la guarda
   * compara el déficit ACTUAL contra este, no `totalPuntos` — que en una sesión viva sube
   * en casi cada poll y nunca se queda quieto. */
  deficitFallido: number | null;
  /** `Date.now()` (reloj del navegador, ver `debeRecargar`) del último intento de recarga
   * completa, exitoso o no, o `null` si todavía no se intentó ninguna. Piso de frecuencia
   * independiente del déficit: ver `COOLDOWN_RECARGA_MS`. */
  ultimoIntentoRecargaMs: number | null;
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

  // Sin puntos nuevos se conserva la referencia previa: lo memoizado sobre `puntos` no se recalcula.
  const puntos =
    previa && porClave.size === previa.puntos.length
      ? previa.puntos
      : [...porClave.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const ultimo = puntos.at(-1);

  return {
    // El resto del payload (frescura, cumplimientos, estado de la sesión) siempre se
    // reemplaza: son valores del "ahora" del server, no algo que se acumule.
    ...delta,
    puntos,
    cursor: ultimo?.ts ?? null,
    completa: puntos.length >= delta.totalPuntos,
    recargaFallida: false,
    deficitFallido: null,
    // Igual que `recargaFallida`/`deficitFallido`: el merge puro resetea, y es el llamador
    // (`use-en-vivo.ts`) el que decide si corresponde arrastrar el valor previo o no.
    ultimoIntentoRecargaMs: null,
  };
}

/** `desde` del próximo poll: el cursor menos el solape (largo o corto, ver `SOLAPE_CURSOR_MS`).
 * `undefined` (= carga completa) mientras no haya ningún punto todavía. */
export function desdeConSolape(cursor: string | null | undefined, largo = true): Date | undefined {
  if (!cursor) return undefined;
  return new Date(Date.parse(cursor) - (largo ? SOLAPE_CURSOR_MS : SOLAPE_CURSOR_CORTO_MS));
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
 * Igual que `necesitaRecargaCompleta`, pero con DOS guardas adicionales para no repetir una
 * recarga completa sin sentido. Cada una corta un caso distinto:
 *
 * **1. Guarda por déficit fijo.** Si en la base hay dos filas distintas (`event_id`
 * distinto) con el mismo `ts`, `lat` y `lng` — reingesta del mismo fix —, el dedupe del
 * cliente las colapsa y lo acumulado queda **permanentemente** un punto por debajo de
 * `totalPuntos`. Comparar `totalPuntos` entre polls (la guarda vieja) no sirve: es un
 * `count(*)` **vivo** sobre la ventana de la sesión, sube en casi cada poll de una sesión
 * viva, así que esa comparación nunca coincidía y no frenaba nada. Por eso se compara el
 * **déficit** (`totalPuntos - puntos.length`), que para este caso se queda fijo aunque
 * `totalPuntos` siga subiendo: mientras no crezca es el mismo hueco permanente y no vale la
 * pena repetir la descarga. Si crece, apareció un hueco nuevo y real y sí conviene
 * reintentar.
 *
 * **2. Cooldown temporal (`COOLDOWN_RECARGA_MS`).** La guarda 1 sola NO cubre una sesión
 * cuya ventana supera `TRAZA_EN_VIVO_LIMITE_MAX` (50.000 puntos): ahí la recarga completa
 * nunca puede completar (`recargada.completa` da siempre `false`, ver `use-en-vivo.ts`) y el
 * déficit (`totalPuntos - 50000`) SÍ crece en casi cada poll porque `totalPuntos` sigue
 * subiendo con el vehículo reportando — con lo que la guarda 1 deja pasar
 * (`deficitActual > previa.deficitFallido`) en cada ciclo y vuelve el bucle original: una
 * descarga completa cada 10 s, la traza acumulada descartada, la polilínea rebobinando. El
 * cooldown es un techo duro sobre la FRECUENCIA, aplicado ANTES que la guarda 1 y
 * ortogonal a ella: no importa si el déficit está fijo o creciendo de verdad, como mucho se
 * dispara una recarga completa cada `COOLDOWN_RECARGA_MS`.
 *
 * `ahoraMs` se inyecta como parámetro (nunca se llama `Date.now()` acá adentro) para que la
 * función siga siendo pura y testeable: es una comparación de duración local entre dos polls
 * del mismo navegador, así que el reloj del cliente es la referencia correcta (a diferencia
 * de `antiguedadViva`, que sí corrige por el offset del servidor porque compara contra un
 * `ts` que viajó por la red).
 */
export function debeRecargar(
  previa: TrazaAcumulada | undefined,
  fusionada: TrazaAcumulada,
  ahoraMs: number,
): boolean {
  if (!necesitaRecargaCompleta(fusionada)) return false;
  if (
    previa?.ultimoIntentoRecargaMs != null &&
    ahoraMs - previa.ultimoIntentoRecargaMs < COOLDOWN_RECARGA_MS
  ) {
    return false;
  }
  if (!previa?.recargaFallida || previa.deficitFallido === null) return true;
  const deficitActual = fusionada.totalPuntos - fusionada.puntos.length;
  return deficitActual > previa.deficitFallido;
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

/**
 * Cadencia del poll mientras el estado es `finalizado` (Fase A) — MÁS LENTA que
 * `INTERVALO_POLL_MS`, no cortada del todo (decisión del chairman sobre el hallazgo de
 * Codex): la `sesion_operativa` de LOGIN sigue viva y el conductor puede arrancar un
 * recorrido NUEVO (`inicio_recorrido`) sin volver a loguearse — cortar el poll del todo
 * (`false`) dejaría a ese reinicio sin forma de detectarse hasta que algo dispare un
 * `refetch` manual. 60 s es un piso barato para notar el reinicio sin pollear a la cadencia
 * normal (10 s) una sesión que, la mayor parte del tiempo, no va a reiniciar.
 */
export const INTERVALO_POLL_FINALIZADO_MS = 60_000;

/** Cadencia del `refetchInterval`, según el último payload recibido. */
export function intervaloPoll(
  datos: Pick<TrazaEnVivo, 'hayMas' | 'inactivaDesdeMs' | 'estadoFrescura'> | undefined,
): number | false {
  if (!datos) return INTERVALO_POLL_MS;
  // Fase A (docs/plan-ubicacion-fluida.md) — va ANTES que el corte por inactividad: un
  // recorrido finalizado (`inactivaDesdeMs` todavía chico) no debe pollear a la cadencia
  // normal ni caer en el corte de 30 min, tiene su propia cadencia lenta. `hayMas` manda
  // primero: si la carga inicial vino truncada por `limite`, sigue el catch-up normal a 1 s
  // — no tiene sentido frenarlo solo porque el estado actual es `finalizado`.
  if (datos.estadoFrescura === 'finalizado') {
    return datos.hayMas ? INTERVALO_POLL_RAPIDO_MS : INTERVALO_POLL_FINALIZADO_MS;
  }
  // El corte por inactividad va PRIMERO que `hayMas`: una sesión zombi cuya traza además
  // excede `limite` (`hayMas: true`) tiene que cortar, no pollear a 1 s para siempre.
  if (datos.inactivaDesdeMs > UMBRAL_CORTE_POLL_MS) return false;
  if (datos.hayMas) return INTERVALO_POLL_RAPIDO_MS;
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
 *
 * `finalizado` (Fase A, docs/plan-ubicacion-fluida.md) es, igual que `detenido`, un estado
 * NORMAL — el conductor tocó "Finalizar" y el recorrido cerró bien. Antes de esta entrega
 * ese mismo caso pasaba por `reportando` → `detenido` → `perdido` (rojo, falla) a los 15 min,
 * que es exactamente lo que este estado nuevo corrige.
 */
export const PRESENTACION_FRESCURA: Record<EstadoFrescura, PresentacionFrescura> = {
  reportando: {
    etiqueta: 'Reportando',
    descripcion: 'El vehículo se mueve y el teléfono sincroniza.',
    color: 'var(--qv-color-success)',
    esFalla: false,
  },
  detenido: {
    etiqueta: 'Detenido',
    descripcion:
      'El teléfono sincroniza pero no hay fixes nuevos: el vehículo está quieto (terminal o parada larga). No es una falla.',
    color: 'var(--qv-color-info)',
    esFalla: false,
  },
  perdido: {
    etiqueta: 'Sin señal',
    descripcion: 'El teléfono no está llegando al servidor. Revisar batería, datos y permisos.',
    color: 'var(--qv-color-danger)',
    esFalla: true,
  },
  sin_datos: {
    etiqueta: 'Sin datos',
    descripcion: 'La sesión existe pero todavía no entró ningún punto GPS.',
    color: 'var(--qv-text-secondary)',
    esFalla: false,
  },
  finalizado: {
    etiqueta: 'Recorrido finalizado',
    descripcion: 'El conductor finalizó el recorrido. No es una falla.',
    color: 'var(--qv-text-muted)',
    esFalla: false,
  },
};

/**
 * Trampa de deploy (plan §Fase A): `scripts/deploy-gcp.sh` despliega API antes que WEB (y el
 * worker último de los tres) — con `--solo`, o incluso en el orden fijo del script completo,
 * hay una ventana real donde la API ya puede devolver `estadoFrescura: 'finalizado'` (por el
 * backfill de la migración, o por un evento nuevo si el worker viejo ya corría) mientras el
 * panel desplegado todavía es el código VIEJO, sin esta clave en `PRESENTACION_FRESCURA`.
 * `apiFetch` (`apps/web/src/lib/api/client.ts`) NO valida la respuesta con zod en runtime —
 * solo castea el tipo — así que un panel viejo indexando `PRESENTACION_FRESCURA['finalizado']`
 * directo (`objeto[clave]` con una clave que no existe) recibiría `undefined` y reventaría al
 * leer `.color`/`.etiqueta`. Esta función es el fallback: cualquier valor fuera del dominio
 * conocido (el código viejo antes de este cambio, o un estado futuro que el panel todavía no
 * conoce) cae a `sin_datos` en vez de tirar. Los 3 sitios que antes indexaban
 * `PRESENTACION_FRESCURA[...]` directo (`panel-frescura.tsx`, `map-builders.ts`, `page.tsx`)
 * pasan por acá.
 */
export function presentacionFrescura(estado: string): PresentacionFrescura {
  return PRESENTACION_FRESCURA[estado as EstadoFrescura] ?? PRESENTACION_FRESCURA.sin_datos;
}

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
