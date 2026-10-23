import * as Sentry from '@sentry/react-native';

/**
 * Contexto de diagnóstico para Sentry (incidente 22/10: eventos sin placa/sesión y un teléfono
 * con el outbox sin sincronizar que nadie veía). Es observabilidad: NUNCA debe romper el flujo
 * que la llama (sesión, sync), por eso todo va en try/catch.
 *
 * Se aplica en el scope global, así que vale igual en el JS de UI y en el headless task (ambos
 * evalúan `index.js` → `sentry-init`).
 */

interface SesionEtiquetable {
  sesionId: string;
  vehiculo: { id: string; placa: string };
}

/** `null` limpia las etiquetas (logout / sesión borrada). */
export function etiquetarSesionSentry(contexto: SesionEtiquetable | null): void {
  try {
    // '' en vez de undefined: el sync nativo de tags no tolera undefined y Sentry descarta tags vacíos.
    Sentry.setTags({
      placa: contexto?.vehiculo.placa ?? '',
      sesionId: contexto?.sesionId ?? '',
      vehiculoId: contexto?.vehiculo.id ?? '',
    });
    if (!contexto) {
      Sentry.setContext('outbox', null);
      Sentry.setTags({ outboxAtrasado: '' });
    }
  } catch {
    // Observabilidad best-effort.
  }
}

export interface SaludOutbox {
  /** Eventos no acusados por el servidor (`pendiente` + `enviado`). */
  pendientes: number;
  /** `ts` ISO del evento no acusado más viejo; `null` si no hay. */
  masViejoTs: string | null;
}

/** Minutos desde el evento pendiente más viejo; `null` sin pendientes o con `ts` ilegible. */
export function edadMasViejoMin(salud: SaludOutbox, ahoraMs: number): number | null {
  if (salud.masViejoTs === null) return null;
  const ts = Date.parse(salud.masViejoTs);
  return Number.isNaN(ts) ? null : Math.max(0, Math.round((ahoraMs - ts) / 60_000));
}

/** Etiqueta de baja cardinalidad: ¿el outbox está atrasado y cuánto? */
export function bucketAtraso(edadMin: number | null): 'no' | '<10min' | '10-60min' | '>60min' {
  if (edadMin === null) return 'no';
  return edadMin < 10 ? '<10min' : edadMin <= 60 ? '10-60min' : '>60min';
}

/** Adjunta cuántos eventos faltan por sincronizar y desde cuándo a cada evento de Sentry. Los
 * números exactos van en el contexto (no indexado); el tag es solo el bucket. */
export function reportarSaludOutbox(salud: SaludOutbox, ahoraMs: number = Date.now()): void {
  try {
    const edadMin = edadMasViejoMin(salud, ahoraMs);
    Sentry.setContext('outbox', { pendientes: salud.pendientes, edadMasViejoMin: edadMin });
    Sentry.setTags({ outboxAtrasado: bucketAtraso(edadMin) });
  } catch {
    // Observabilidad best-effort.
  }
}
