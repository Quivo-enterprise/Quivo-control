import * as Sentry from '@sentry/react-native';
import {
  asegurarInicioRecorrido,
  type ContextoInicioRecorrido,
  type EstadoInicioRecorrido,
} from './inicio-recorrido-retry';

/**
 * REDISEÑO iniciar()/detener() (bug en producción, 2026-09-25 — reemplaza el enfoque de
 * `crearCoordinadorIniciarDetener.esperarIniciarConTimeout`, que atacaba el síntoma equivocado:
 * el timeout evitaba que `detener()` quedara colgado, pero seguía colgándose ÉL MISMO en su
 * propio `abrirOutbox()`/`encolarEvento` antes de este fix).
 *
 * Premisa verificada: "Finalizar" solo se muestra con `tracking=true`, que se marca apenas
 * `iniciarSeguimientoContinuo`/`start()` resuelve (ANTES del outbox) — así que el único cuelgue
 * alcanzable por `detener()` es esta fase de outbox (`sembrarCumplimientos`/`abrirOutbox`/
 * `asegurarInicioRecorrido`). El fix: sacar el outbox del camino crítico de la UI del todo.
 * `detener()` (`use-gps-operativo.ts`) ya dejó `tracking=false` y devolvió el control al chofer
 * ANTES de llamar a esta función — la dispara con `void`, sin esperarla, y solo usa su resultado
 * para actualizar el veredicto/diagnóstico cuando (si) termina.
 *
 * Dos escrituras, EN ESE ORDEN, cada una best-effort desde la perspectiva del llamador (esta
 * función SÍ propaga sus propios rechazos — es `detener()` quien decide qué hacer con ellos:
 * reportar a Sentry, nunca bloquear ni volver a mostrarle nada al chofer que ya vio "Finalizar"
 * completarse):
 *
 * 1. `asegurarInicioRecorrido` — el respaldo final del marcador `inicio_recorrido`, con el MISMO
 *    `eventId`/`ts` del intento de `iniciar()` original (idempotente vía `INSERT OR IGNORE`,
 *    `db/outbox.ts`) — si ni `iniciar()` ni sus reintentos (`onLocation`, heartbeat) lograron
 *    escribirlo, esta es la última oportunidad antes de que el recorrido quede cerrado del todo.
 * 2. `fin_recorrido`, con `ts: tsFin` — el instante REAL en que el chofer tocó "Finalizar",
 *    capturado por el llamador ANTES de cualquier operación que pueda demorarse (nunca la hora
 *    en que este `INSERT` finalmente corre) — y un `eventId` generado UNA sola vez para este
 *    cierre (`deps.generarEventId()`, acá arriba, no dentro de `encolarEvento`).
 *
 * El orden (1 antes que 2) es lo que reemplaza la garantía que antes daba "`detener()` espera a
 * `iniciar()`": si algo lee el outbox mientras esta tarea todavía está corriendo, en el peor
 * caso ve un recorrido sin `fin_recorrido` todavía (que es la verdad: el cierre sigue en curso),
 * nunca un `fin_recorrido` sin que se haya intentado escribir su `inicio_recorrido` primero.
 *
 * B (hallazgo de revisión 3, 2026-09-25): el paso 1 (`asegurarInicioRecorrido`) va bajo su
 * PROPIO try/catch, reportado a Sentry — antes, si ese respaldo rechazaba (SQLite sin espacio,
 * el mismo caso que ya motivó todo este reintento), la excepción se propagaba y este `await`
 * cortaba la función ANTES de llegar al paso 2: un recorrido terminaba sin `fin_recorrido`
 * simplemente porque su respaldo de `inicio_recorrido` (que además puede ya estar confirmado por
 * otro camino — `onLocation`/heartbeat) falló. `fin_recorrido` (paso 2) se escribe SIEMPRE
 * después, sin importar el resultado del paso 1 — es el marcador más importante de los dos para
 * cerrar el recorrido, y el único que el chofer nunca tiene otra oportunidad de reintentar.
 */
export interface DependenciasCierreRecorrido<Db> {
  abrirOutbox: () => Promise<Db>;
  encolarEvento: (
    db: Db,
    evento: {
      deviceId: string;
      tipo: 'inicio_recorrido' | 'fin_recorrido';
      payload: Record<string, unknown>;
      eventId: string;
      ts: string;
    },
  ) => Promise<unknown>;
  generarEventId: () => Promise<string>;
}

export interface ResultadoCierreRecorrido {
  /** `eventId` con el que se encoló `fin_recorrido` — el llamador no lo necesita hoy, pero
   * queda disponible por si un diagnóstico futuro lo pide (mismo criterio que
   * `encolarEvento`, que también lo devuelve). */
  eventIdFin: string;
}

export async function cerrarRecorridoEnOutbox<Db>(
  estadoInicioRecorrido: EstadoInicioRecorrido,
  deps: DependenciasCierreRecorrido<Db>,
  contexto: ContextoInicioRecorrido,
  tsFin: string,
): Promise<ResultadoCierreRecorrido> {
  // B (hallazgo de revisión 3): respaldo del marcador de inicio, best-effort — un fallo acá
  // (SQLite sin espacio, handle zombi) se reporta a Sentry y NO impide el paso 2 de abajo.
  // `onLocation`/heartbeat ya reintentaron este marcador mientras el recorrido estuvo activo; si
  // los tres intentos fallan, un `inicio_recorrido` faltante es preferible a un recorrido que
  // nunca cierra (`fin_recorrido` ausente) — ver el docblock de arriba.
  try {
    await asegurarInicioRecorrido(estadoInicioRecorrido, deps, contexto);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { contexto: 'gps-foreground', paso: 'cierre-respaldo-inicio-recorrido' },
    });
  }

  const eventIdFin = await deps.generarEventId();
  const db = await deps.abrirOutbox();
  await deps.encolarEvento(db, {
    deviceId: contexto.deviceId,
    tipo: 'fin_recorrido',
    payload: { sesionId: contexto.sesionId },
    eventId: eventIdFin,
    ts: tsFin,
  });
  return { eventIdFin };
}
