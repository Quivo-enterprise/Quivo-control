import type { MolinosLinea, PosicionEnVivo, PuntoControl, Variante, VueltaPosicion } from '@quivo/shared';
import { formatearHace, formatearHoraBolivia } from './jornadas';
import { offsetRelojServidorMs } from './traza';

/**
 * Lógica pura de la designación a Molinos en `/en-vivo` (docs/plan-molinos-designacion.md, F1):
 * qué variantes se ofrecen, cuándo se sugiere enviar, el estado de acuse del chofer, el reloj de
 * la espera y el bloqueo con motivo. Sin React: se testea en `node`.
 */

export type PosicionConVuelta = Pick<PosicionEnVivo, 'vuelta' | 'molinosHoy'>;

/** Variantes que se pueden designar: activas y con punto de espera (la de "Vía Molinos"). */
export function variantesDeEspera(variantes: readonly Variante[] | undefined): Variante[] {
  return (variantes ?? []).filter((v) => v.estado === 'activo' && Boolean(v.puntoEsperaId));
}

/** Minutos de espera de una variante: el `esperaMin` de su punto de espera, o `null` = salida libre. */
export function esperaMinDeVariante(
  varianteId: string | null | undefined,
  variantes: readonly Variante[] | undefined,
  puntos: readonly Pick<PuntoControl, 'id' | 'esperaMin'>[] | undefined,
): number | null {
  const variante = variantes?.find((v) => v.id === varianteId);
  const punto = puntos?.find((p) => p.id === variante?.puntoEsperaId);
  return punto?.esperaMin && punto.esperaMin > 0 ? punto.esperaMin : null;
}

/** Minutos enteros (hacia abajo, mínimo 0) entre dos instantes en ms. */
function minutosEntre(desdeMs: number, hastaMs: number): number {
  return Math.max(0, Math.floor((hastaMs - desdeMs) / 60_000));
}

/**
 * ¿Toca enviar a este vehículo? Solo si hoy todavía no fue a Molinos, tiene una vuelta en curso
 * sin designar ni en espera, y el HUD de su línea dice que el próximo sugerido ya llegó.
 * `ahoraServidorMs` = el reloj del cliente corrido por el desfase con el servidor.
 */
export function esSugerido(
  p: PosicionConVuelta,
  linea: Pick<MolinosLinea, 'proximoSugeridoEn'> | undefined,
  ahoraServidorMs: number,
): boolean {
  if (p.molinosHoy || !p.vuelta || !linea) return false;
  if (p.vuelta.varianteId !== null || p.vuelta.enEspera || p.vuelta.molinosProxima) return false;
  const proximo = Date.parse(linea.proximoSugeridoEn);
  return Number.isFinite(proximo) && proximo <= ahoraServidorMs;
}

/** Reloj del servidor estimado a partir del reloj local y el `servidorTs` del último poll. */
export function ahoraServidor(servidorTs: string | undefined, recibidoEnMs: number, ahoraMs: number): number {
  return servidorTs ? ahoraMs + offsetRelojServidorMs(servidorTs, recibidoEnMs) : ahoraMs;
}

export type EstadoAcuse =
  | { tipo: 'sin_designacion' }
  | { tipo: 'esperando'; avisadoA: string; texto: string }
  | { tipo: 'visto'; avisadoA: string; vistoA: string; texto: string };

/**
 * Estado del aviso al chofer: "Avisado 14:32 · visto ✓ 14:33" o "Avisado 14:32 · esperando que
 * el chofer lo vea…". Un acuse anterior a la designación vigente no cuenta (la API lo limpia al
 * cambiar, pero un poll puede traer ambos a destiempo).
 */
export function estadoAcuse(v: Pick<VueltaPosicion, 'varianteId' | 'designadaEn' | 'acuseEn'> | null): EstadoAcuse {
  if (!v || !v.varianteId || !v.designadaEn) return { tipo: 'sin_designacion' };
  const avisado = formatearHoraBolivia(v.designadaEn);
  const visto = v.acuseEn && Date.parse(v.acuseEn) >= Date.parse(v.designadaEn);
  if (visto) {
    const vistoA = formatearHoraBolivia(v.acuseEn ?? null);
    return { tipo: 'visto', avisadoA: avisado, vistoA, texto: `Avisado ${avisado} · visto ✓ ${vistoA}` };
  }
  return { tipo: 'esperando', avisadoA: avisado, texto: `Avisado ${avisado} · esperando que el chofer lo vea…` };
}

export interface EsperaMolinos {
  transcurridoMin: number;
  faltanMin: number;
  cumplida: boolean;
  texto: string;
}

/** "en Molinos hace 12 min (faltan 18)"; salida libre (`null`): "en Molinos hace 12 min"; cumplida: "en Molinos hace 35 min (espera cumplida)". */
export function esperaMolinos(
  esperaDesdeTs: string | null,
  esperaMin: number | null,
  ahoraServidorMs: number,
): EsperaMolinos | null {
  if (!esperaDesdeTs) return null;
  const desde = Date.parse(esperaDesdeTs);
  if (!Number.isFinite(desde)) return null;
  const transcurridoMin = minutosEntre(desde, ahoraServidorMs);
  if (esperaMin === null) {
    return { transcurridoMin, faltanMin: 0, cumplida: false, texto: `en Molinos hace ${transcurridoMin} min` };
  }
  const faltanMin = Math.max(0, esperaMin - transcurridoMin);
  const cumplida = faltanMin === 0;
  return {
    transcurridoMin,
    faltanMin,
    cumplida,
    texto: cumplida
      ? `en Molinos hace ${transcurridoMin} min (espera cumplida)`
      : `en Molinos hace ${transcurridoMin} min (faltan ${faltanMin})`,
  };
}

/**
 * Motivo por el que la designación no se puede tocar ahora (`null` = se puede). Ojo: la API
 * también responde 409 cuando el vehículo ya llegó a Molinos y ya salió, algo que la posición
 * no expone (`enEspera` vuelve a `false`); ese caso se resuelve con el mensaje del 409.
 * `molinosHoy` = ya llegó a Molinos hoy (en otra vuelta, si la actual no está designada).
 */
export function motivoBloqueo(
  v: Pick<VueltaPosicion, 'enEspera' | 'varianteId'> | null | undefined,
  molinosHoy = false,
): string | null {
  if (!v) return 'Todavía no pasó por la terminal.';
  if (v.enEspera) return 'Ya llegó a Molinos: la designación quedó cerrada.';
  if (molinosHoy && v.varianteId === null) return 'Ya fue a Molinos hoy.';
  return null;
}

/** Id de la opción seleccionada del control segmentado (`'directo'` o el id de la variante). */
export const OPCION_DIRECTO = 'directo';
export function opcionSeleccionada(v: Pick<VueltaPosicion, 'varianteId'> | null | undefined): string {
  return v?.varianteId ?? OPCION_DIRECTO;
}

/** Posición con la designación aplicada de forma optimista (la API la confirma en el siguiente poll). */
export function aplicarDesignacion(
  p: PosicionEnVivo,
  varianteId: string | null,
  varianteNombre: string | null,
  ahoraIso: string,
  proxima = false,
): PosicionEnVivo {
  if (!p.vuelta) return p;
  // Designación diferida: la vuelta actual no cambia, solo se marca la próxima.
  if (proxima) return { ...p, vuelta: { ...p.vuelta, molinosProxima: true } };
  return {
    ...p,
    vuelta: {
      ...p.vuelta,
      varianteId,
      varianteNombre: varianteId ? varianteNombre : null,
      designadaEn: varianteId ? ahoraIso : null,
      acuseEn: null,
      molinosProxima: false,
    },
  };
}

/** Designación pedida al servidor y todavía sin confirmar (por `sesionId`). */
export interface DesignacionPendiente {
  varianteId: string | null;
  varianteNombre: string | null;
  /** Instante de la petición: es el `designadaEn` optimista, estable entre polls. */
  ahoraIso: string;
  /** La API respondió `aplica: 'proxima_vuelta'`: se marca `molinosProxima` en vez de `varianteId`. */
  proxima?: boolean;
  /** Designación esperando la respuesta de la API: todavía no cambia la vuelta (puede ser tardía). */
  enVuelo?: boolean;
}

/**
 * Posiciones con las designaciones pendientes aplicadas por encima de lo que trajo el poll: así el
 * poll de 2 s no pisa el valor optimista mientras el PUT está en vuelo. Sin pendientes devuelve el
 * mismo array (referencia estable, sin re-render de más).
 */
export function aplicarDesignacionesPendientes(
  posiciones: PosicionEnVivo[],
  pendientes: ReadonlyMap<string, DesignacionPendiente>,
): PosicionEnVivo[] {
  if (pendientes.size === 0) return posiciones;
  return posiciones.map((p) => {
    const d = pendientes.get(p.id);
    return d && !d.enVuelo ? aplicarDesignacion(p, d.varianteId, d.varianteNombre, d.ahoraIso, d.proxima) : p;
  });
}

/** Texto del HUD de una línea: "Molinos: 2 en espera · último envío hace 4 min · próximo sugerido en 3 min". */
export function textoHudMolinos(l: MolinosLinea, ahoraServidorMs: number): string {
  const ultimo = l.ultimoEnvioTs ? formatearHace(l.ultimoEnvioTs, ahoraServidorMs) : null;
  const faltaMs = Date.parse(l.proximoSugeridoEn) - ahoraServidorMs;
  // Un `proximoSugeridoEn` que no parsea no se inventa ("NaN min"): se omite esa parte.
  const proximo = !Number.isFinite(faltaMs)
    ? null
    : faltaMs <= 0
      ? 'ya toca enviar'
      : `próximo sugerido en ${Math.max(1, Math.ceil(faltaMs / 60_000))} min`;
  return [
    `Molinos: ${l.enEspera} en espera`,
    ultimo && ultimo !== '—' ? `último envío ${ultimo}` : 'sin envíos hoy',
    proximo,
  ]
    .filter((parte): parte is string => parte !== null)
    .join(' · ');
}
