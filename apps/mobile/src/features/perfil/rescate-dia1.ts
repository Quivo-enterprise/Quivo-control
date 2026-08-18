import * as Crypto from 'expo-crypto';
import * as Sentry from '@sentry/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundGeolocation, { type Location } from 'react-native-background-geolocation';
import { abrirOutbox, encolarEvento } from '../../db/outbox';
import { cargarSesionMovil, obtenerDeviceIdMovil } from '../../shared/security/sesion-movil-store';
import {
  construirEventoRescatado,
  filtrarPuntosRescatables,
  type Sha256Hex,
} from './rescate-dia1-core';

/**
 * Rescate de emergencia del día 1 del piloto (build de rescate, Entrega 1): el outbox local
 * (`quivo-outbox.db`) no grabó ni un punto GPS por la regresión de `expo-sqlite@16.0.10`
 * documentada en `db/outbox.ts`, pero el recorrido NO se perdió — sigue vivo en la SQLite
 * INTERNA del SDK de Transistorsoft, independiente del outbox roto:
 * `gps/background-geolocation.config.ts` tiene `http.autoSync: false` y el SDK persiste cada
 * ubicación con `persist: true` (default), `persistMode: PERSIST_MODE_ALL` (default) y
 * `maxRecordsToPersist: -1` (sin límite) — nadie llama `sync()`, `getLocations()`,
 * `getCount()` ni `destroyLocations()` en el resto de la app, así que esos puntos quedan
 * acumulados sin tocar hasta que el propio SDK los pode (`maxDaysToPersist`, ver H7 en
 * `background-geolocation.config.ts`).
 *
 * Este módulo SOLO lee de esa SQLite nativa y reencola por la vía normal del outbox
 * (`encolarEvento`) — nunca borra nada del lado nativo. `destroyLocations()` es
 * responsabilidad de un paso manual aparte, después de confirmar en el servidor que los
 * puntos llegaron a `gps_points`.
 *
 * `getLocations()` devuelve TODO lo que el SDK tiene persistido, no solo lo del día 1, y un
 * re-run de este módulo (segunda corrida, timeout, crash a mitad de camino) podía duplicar
 * evidencia legal completa en `gps_points` (hallazgo de revisión CRÍTICO, H1). Defensas:
 * - H1.a: `eventId` DETERMINÍSTICO derivado de `location.uuid` (`rescate-dia1-core.ts`) — un
 *   re-run produce los MISMOS `eventId` y el `ON CONFLICT` del servidor los descarta solo.
 * - C1/M4 (hallazgo de revisión CRÍTICO, reemplaza el corte temporal H1.b original): cota
 *   INFERIOR por antigüedad (`filtrarPuntosRescatables`, `rescate-dia1-core.ts`), la MISMA
 *   `TOLERANCIA_TS_FIX_PASADO_MS` que el servidor usa en `resolverTsFix` (`@quivo/shared`).
 *   El corte SUPERIOR original ("solo puntos anteriores al primer arranque de este build")
 *   se eliminó por completo (decisión M2): su premisa —que el camino normal ya encoló los
 *   puntos posteriores— es falsa cuando el paquete del día está vencido, la sesión está
 *   cerrada, o la app está en foreground sin `iniciar()`, y en los tres casos dejaba esos
 *   puntos INALCANZABLES para siempre. La cota inferior, en cambio, nunca pierde un punto
 *   rescatable de verdad — solo evita que el servidor le invente una fecha en silencio a uno
 *   ya fuera de rango.
 * - H1.c/H2: una sola corrida por defecto, marcada en `AsyncStorage`, con confirmación
 *   explícita (`QuivoConfirmDialog`, ver `ajustes-screen.tsx`) para volver a correrlo.
 */

/** Tamaño de lote de escritura al outbox: SQLite corre a través del bridge async, pero
 * encolar miles de eventos de un tirón sin ceder el hilo de JS entre uno y otro congela la
 * UI (el conductor puede tener miles de puntos acumulados de una jornada completa). */
const TAMANO_LOTE_ENCOLADO = 50;

/** H2: clave de `AsyncStorage` que marca que el rescate ya corrió al menos una vez, con su
 * resultado — la usa `ajustes-screen.tsx` para deshabilitar el botón principal y mostrar
 * "Ya se ejecutó..." en vez de dejar la UI en un estado que invita a re-correrlo sin querer. */
const CLAVE_RESULTADO_RESCATE = 'quivo-rescate:resultado-dia1';

export interface ProgresoRescateDia1 {
  total: number;
  encolados: number;
  /** B1 (hallazgo de revisión, bajo): filas que `INSERT OR IGNORE` descartó porque el
   * `eventId` determinístico (H1.a) ya estaba en el outbox de una corrida anterior — la
   * idempotencia funcionando, no un fallo. Separado de `encolados` para que un re-run no
   * reporte "3000 encolados" cuando en realidad 0 filas nuevas se escribieron. */
  yaExistente: number;
  fallidos: number;
  /** C1/M4 (hallazgo de revisión CRÍTICO): puntos con `tsFix` más viejo que
   * `TOLERANCIA_TS_FIX_PASADO_MS` (`@quivo/shared`) — NO se encolaron a propósito (ver
   * `filtrarPuntosRescatables`, `rescate-dia1-core.ts`), nunca en silencio. */
  omitidosPorAntiguedad: number;
}

export interface ResultadoRescateGuardado {
  /** ISO del momento en que terminó ese rescate (no el de cada punto). */
  fechaIso: string;
  encolados: number;
  yaExistente: number;
  fallidos: number;
  omitidosPorAntiguedad: number;
}

/**
 * Solo lectura — cuántos puntos quedan en la SQLite interna del SDK. Se llama ANTES de
 * invertir en extraer/encolar (paso 1 del flujo de rescate), para saber si hay algo que
 * rescatar sin tocar ni un byte todavía.
 */
export async function contarPuntosRescatablesDia1(): Promise<number> {
  return BackgroundGeolocation.getCount();
}

/** H2: lee la marca de "rescate ya ejecutado" — `null` si nunca corrió (o si la lectura falla,
 * que es el mismo caso a efectos de la UI: dejar que se pueda correr). Los campos nuevos
 * (`yaExistente`, `omitidosPorAntiguedad`, B1/C1) se leen con default `0` para tolerar un
 * resultado guardado por una versión anterior de este módulo, sin esos campos. */
export async function obtenerResultadoRescateGuardado(): Promise<ResultadoRescateGuardado | null> {
  try {
    const raw = await AsyncStorage.getItem(CLAVE_RESULTADO_RESCATE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResultadoRescateGuardado>;
    if (typeof parsed.fechaIso !== 'string' || typeof parsed.encolados !== 'number') return null;
    return {
      fechaIso: parsed.fechaIso,
      encolados: parsed.encolados,
      yaExistente: typeof parsed.yaExistente === 'number' ? parsed.yaExistente : 0,
      fallidos: typeof parsed.fallidos === 'number' ? parsed.fallidos : 0,
      omitidosPorAntiguedad:
        typeof parsed.omitidosPorAntiguedad === 'number' ? parsed.omitidosPorAntiguedad : 0,
    };
  } catch {
    return null;
  }
}

/** H2: persiste el resultado de un rescate recién terminado — lo llama `ajustes-screen.tsx`
 * después de que `rescatarPuntosDia1` resuelve con éxito. */
export async function guardarResultadoRescate(
  resultado: ProgresoRescateDia1,
): Promise<ResultadoRescateGuardado> {
  const guardado: ResultadoRescateGuardado = {
    fechaIso: new Date().toISOString(),
    encolados: resultado.encolados,
    yaExistente: resultado.yaExistente,
    fallidos: resultado.fallidos,
    omitidosPorAntiguedad: resultado.omitidosPorAntiguedad,
  };
  await AsyncStorage.setItem(CLAVE_RESULTADO_RESCATE, JSON.stringify(guardado));
  return guardado;
}

/** SHA-256 real (dispositivo) para `derivarEventIdRescate` — ver `rescate-dia1-core.ts` para
 * el porqué de inyectar esta función en vez de importar `expo-crypto` ahí. */
const sha256HexNativo: Sha256Hex = (input) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);

/** B2 (hallazgo de revisión, bajo): el `try/catch` del loop de `rescatarPuntosDia1` cubre
 * solo el trabajo de encolado — un `onProgreso` que tira (p. ej. un `setState` de React
 * sobre un componente en un estado raro) no debe tumbar el rescate a mitad de camino. El
 * progreso es best-effort para la UI, nunca parte crítica del flujo. */
function reportarProgreso(
  onProgreso: (progreso: ProgresoRescateDia1) => void,
  progreso: ProgresoRescateDia1,
): void {
  try {
    onProgreso({ ...progreso });
  } catch (error) {
    console.error('[QUIVO][rescate-dia1] onProgreso lanzó, se ignora (best-effort)', error);
  }
}

/**
 * Extrae lo que el SDK nativo tiene persistido (`BackgroundGeolocation.getLocations()`,
 * filtrado por `filtrarPuntosRescatables` — ver su comentario para el porqué de la cota
 * inferior por antigüedad, C1/M4/M2) y lo encola en el outbox de la app como eventos
 * `gps_point`, en lotes, cediendo el hilo de JS entre lote y lote para no congelar la UI.
 * Reporta progreso incremental vía `onProgreso`.
 *
 * Usa la sesión actualmente logueada (`cargarSesionMovil`) como `sesionId`/`deviceId` del
 * evento — es la única identidad de sesión disponible desde este dispositivo (H5): los puntos
 * rescatados no traían `sesionId` propio (la SQLite nativa de Transistorsoft no conoce el
 * concepto de sesión de la app, solo guarda fixes GPS crudos), y en el escenario real la
 * sesión restaurada del dispositivo ES la del día 1, que quedó abierta con `fin: null`. El
 * `tsFix` real de cada punto SÍ se preserva (`location.timestamp`), así que el orden
 * cronológico real del recorrido no se pierde aunque el `sesionId` sea el de la sesión que
 * hace el rescate, no el del día 1. `ajustes-screen.tsx` hace esa atribución EXPLÍCITA y
 * verificable antes de apretar (diálogo de confirmación, H5).
 */
export async function rescatarPuntosDia1(
  onProgreso: (progreso: ProgresoRescateDia1) => void,
): Promise<ProgresoRescateDia1> {
  const sesion = await cargarSesionMovil();
  if (!sesion) {
    throw new Error('No hay sesión activa: inicia sesión antes de rescatar los puntos.');
  }
  const deviceId = await obtenerDeviceIdMovil();
  const sesionId = sesion.contexto.sesionId;

  const locationsCrudas = (await BackgroundGeolocation.getLocations()) as unknown as Location[];
  // A3/C1/M4: separa en cubos explícitos en vez de descartar en silencio. `rescatables` es lo
  // único que se intenta encolar; los otros dos se reportan (nunca se pierden sin dejar
  // rastro).
  const { rescatables, omitidosPorAntiguedad, timestampIlegible } = filtrarPuntosRescatables(
    locationsCrudas,
    new Date(),
  );

  if (omitidosPorAntiguedad.length > 0) {
    // C1/M4: más viejos que la tolerancia del servidor (`TOLERANCIA_TS_FIX_PASADO_MS`,
    // `@quivo/shared`) — encolarlos igual haría que el servidor les invente una fecha en
    // silencio al momento del rescate (ver el comentario de `filtrarPuntosRescatables`).
    console.warn(
      `[QUIVO][rescate-dia1] ${omitidosPorAntiguedad.length} puntos omitidos por antigüedad (más viejos que la tolerancia del servidor)`,
    );
    Sentry.addBreadcrumb({
      category: 'rescate-dia1',
      message: 'Puntos omitidos por antigüedad (cota inferior, C1/M4)',
      level: 'warning',
      data: { cantidad: omitidosPorAntiguedad.length },
    });
  }
  for (const location of timestampIlegible) {
    // H6/A3 (hallazgo de revisión, medio): timestamp ilegible — no se encola con una fecha
    // inventada (ver el comentario de `construirEventoRescatado`), se cuenta aparte.
    console.warn(
      '[QUIVO][rescate-dia1] Timestamp ilegible: punto rescatado NO encolado',
      location.uuid,
    );
    Sentry.captureMessage('rescate-dia1: timestamp ilegible, punto no encolado', {
      level: 'warning',
      tags: { contexto: 'rescate-dia1', paso: 'timestamp-ilegible' },
      extra: { uuid: location.uuid, timestamp: String(location.timestamp) },
    });
  }

  // Orden cronológico ascendente por el fix real, no por el orden de entrega del SDK nativo
  // (no documentado, y da igual: los puntos NO llegan por red aquí, así que ordenar en
  // memoria antes de encolar es gratis y deja el outbox en el mismo orden que un recorrido
  // grabado en vivo).
  const locations = rescatables
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const progreso: ProgresoRescateDia1 = {
    total: locationsCrudas.length,
    encolados: 0,
    yaExistente: 0,
    fallidos: timestampIlegible.length,
    omitidosPorAntiguedad: omitidosPorAntiguedad.length,
  };
  reportarProgreso(onProgreso, progreso);
  if (locations.length === 0) return progreso;

  for (let inicio = 0; inicio < locations.length; inicio += TAMANO_LOTE_ENCOLADO) {
    const lote = locations.slice(inicio, inicio + TAMANO_LOTE_ENCOLADO);
    for (const location of lote) {
      try {
        // H3 (hallazgo de revisión): `abrirOutbox()` en CADA iteración, no una `db` capturada
        // una sola vez afuera del loop. Es una promesa cacheada (gratis si el handle sigue
        // vivo), pero si murió a mitad del rescate y otra llamada ya lo reemplazó, este
        // `await` toma la conexión NUEVA en vez de seguir insistiendo con una `db` vieja.
        const db = await abrirOutbox();

        const evento = await construirEventoRescatado(location, sesionId, sha256HexNativo);
        if (evento === null) {
          // Defensa redundante: `filtrarPuntosRescatables` ya excluyó los timestamps
          // ilegibles arriba, así que esta rama no debería dispararse en el flujo real — se
          // mantiene y se reporta igual, por si algún caso no anticipado llega hasta acá.
          progreso.fallidos += 1;
          console.warn(
            '[QUIVO][rescate-dia1] Timestamp ilegible: punto rescatado NO encolado',
            location.uuid,
          );
          Sentry.captureMessage('rescate-dia1: timestamp ilegible, punto no encolado', {
            level: 'warning',
            tags: { contexto: 'rescate-dia1', paso: 'timestamp-ilegible' },
            extra: { uuid: location.uuid, timestamp: String(location.timestamp) },
          });
          continue;
        }

        // B1 (hallazgo de revisión, bajo): `encolarEvento` ahora informa si la fila se
        // insertó de verdad o si `INSERT OR IGNORE` la descartó por un `eventId` que ya
        // estaba en el outbox (H1.a, re-run) — sin esto, un re-run reportaba "3000
        // encolados" con 0 filas nuevas escritas, y ese número quedaba persistido como
        // registro de auditoría (`guardarResultadoRescate`).
        const { insertado } = await encolarEvento(db, {
          deviceId,
          tipo: evento.tipo,
          payload: evento.payload,
          // H1.a: `eventId` determinístico — mismo punto ⇒ mismo `eventId` ⇒ el `ON CONFLICT`
          // del servidor lo descarta solo en un re-run.
          eventId: evento.eventId,
        });
        if (insertado) {
          progreso.encolados += 1;
        } else {
          progreso.yaExistente += 1;
        }
      } catch (error) {
        progreso.fallidos += 1;
        console.error('[QUIVO][rescate-dia1] No se pudo encolar un punto rescatado', error);
        // Nadie lee la consola del teléfono del conductor — mismo motivo que el resto de los
        // `captureException` de la app (QUI-365).
        Sentry.captureException(error, {
          tags: { contexto: 'rescate-dia1', paso: 'encolar-punto' },
          extra: { uuid: location.uuid },
        });
      }
    }
    reportarProgreso(onProgreso, progreso);
    // Cede el hilo de JS entre lotes en vez de encolar miles de eventos de un tirón.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return progreso;
}
