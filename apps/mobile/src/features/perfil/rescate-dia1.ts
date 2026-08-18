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
 * evidencia legal completa en `gps_points` (hallazgo de revisión CRÍTICO, H1). Tres defensas,
 * ninguna sola alcanza:
 * - H1.a: `eventId` DETERMINÍSTICO derivado de `location.uuid` (`rescate-dia1-core.ts`) — un
 *   re-run produce los MISMOS `eventId` y el `ON CONFLICT` del servidor los descarta solo.
 * - H1.b: corte temporal (`obtenerCortePrimerArranque`) — solo se rescatan puntos ANTERIORES
 *   al primer arranque de este build; los posteriores ya los encoló el camino normal.
 * - H1.c/H2: una sola corrida por defecto, marcada en `AsyncStorage`, con confirmación
 *   explícita (`QuivoConfirmDialog`, ver `ajustes-screen.tsx`) para volver a correrlo.
 */

/** Tamaño de lote de escritura al outbox: SQLite corre a través del bridge async, pero
 * encolar miles de eventos de un tirón sin ceder el hilo de JS entre uno y otro congela la
 * UI (el conductor puede tener miles de puntos acumulados de una jornada completa). */
const TAMANO_LOTE_ENCOLADO = 50;

/** H1.b: clave de `AsyncStorage` que fija el corte temporal del rescate — el ISO del primer
 * arranque de ESTE build. Se siembra "solo si no existe" desde `App.tsx` (ver
 * `sembrarPrimerArranqueRescate` más abajo), así que queda fija aunque el chofer abra la app
 * muchas veces. */
const CLAVE_PRIMER_ARRANQUE_RESCATE = 'quivo-rescate:primer-arranque-build-fix';

/** H2: clave de `AsyncStorage` que marca que el rescate ya corrió al menos una vez, con su
 * resultado — la usa `ajustes-screen.tsx` para deshabilitar el botón principal y mostrar
 * "Ya se ejecutó..." en vez de dejar la UI en un estado que invita a re-correrlo sin querer. */
const CLAVE_RESULTADO_RESCATE = 'quivo-rescate:resultado-dia1';

export interface ProgresoRescateDia1 {
  total: number;
  encolados: number;
  fallidos: number;
}

export interface ResultadoRescateGuardado {
  /** ISO del momento en que terminó ese rescate (no el de cada punto). */
  fechaIso: string;
  encolados: number;
  fallidos: number;
}

/**
 * Solo lectura — cuántos puntos quedan en la SQLite interna del SDK. Se llama ANTES de
 * invertir en extraer/encolar (paso 1 del flujo de rescate), para saber si hay algo que
 * rescatar sin tocar ni un byte todavía.
 */
export async function contarPuntosRescatablesDia1(): Promise<number> {
  return BackgroundGeolocation.getCount();
}

/**
 * H1.b (hallazgo de revisión CRÍTICO): siembra, la PRIMERA vez que corre este build, el
 * instante en que el outbox volvió a funcionar — el corte que `rescatarPuntosDia1` usa para
 * NO reencolar puntos que el camino normal (`onLocation`/headless) ya encoló una vez que el
 * fix de `db/outbox.ts` entró en producción. "Solo si no existe": una apertura posterior de la
 * app NO debe correr el corte hacia adelante — tiene que quedar fijo al primer arranque de
 * ESTE build, no moverse cada vez que el chofer abre la app.
 *
 * Se llama desde `App.tsx`, temprano y SIN bloquear el render (fire-and-forget: AsyncStorage
 * es async y este módulo no tiene por qué demorar la primera pantalla). Best-effort a
 * propósito — ver el comentario de `filtrarPuntosRescatables` en `rescate-dia1-core.ts` para
 * el caso en que la clave no llegó a sembrarse.
 */
export async function sembrarPrimerArranqueRescate(): Promise<void> {
  try {
    const existente = await AsyncStorage.getItem(CLAVE_PRIMER_ARRANQUE_RESCATE);
    if (existente) return;
    await AsyncStorage.setItem(CLAVE_PRIMER_ARRANQUE_RESCATE, new Date().toISOString());
  } catch (error) {
    console.error('[QUIVO][rescate-dia1] No se pudo sembrar el corte de primer arranque', error);
    Sentry.captureException(error, {
      tags: { contexto: 'rescate-dia1', paso: 'sembrar-corte' },
    });
  }
}

async function obtenerCortePrimerArranque(): Promise<Date | null> {
  try {
    const iso = await AsyncStorage.getItem(CLAVE_PRIMER_ARRANQUE_RESCATE);
    if (!iso) return null;
    const fecha = new Date(iso);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  } catch {
    return null;
  }
}

/** H2: lee la marca de "rescate ya ejecutado" — `null` si nunca corrió (o si la lectura falla,
 * que es el mismo caso a efectos de la UI: dejar que se pueda correr). */
export async function obtenerResultadoRescateGuardado(): Promise<ResultadoRescateGuardado | null> {
  try {
    const raw = await AsyncStorage.getItem(CLAVE_RESULTADO_RESCATE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResultadoRescateGuardado>;
    if (typeof parsed.fechaIso !== 'string' || typeof parsed.encolados !== 'number') return null;
    return {
      fechaIso: parsed.fechaIso,
      encolados: parsed.encolados,
      fallidos: typeof parsed.fallidos === 'number' ? parsed.fallidos : 0,
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
    fallidos: resultado.fallidos,
  };
  await AsyncStorage.setItem(CLAVE_RESULTADO_RESCATE, JSON.stringify(guardado));
  return guardado;
}

/** SHA-256 real (dispositivo) para `derivarEventIdRescate` — ver `rescate-dia1-core.ts` para
 * el porqué de inyectar esta función en vez de importar `expo-crypto` ahí. */
const sha256HexNativo: Sha256Hex = (input) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);

/**
 * Extrae lo que el SDK nativo tiene persistido de ANTES del corte de H1.b
 * (`BackgroundGeolocation.getLocations()` filtrado por `filtrarPuntosRescatables`) y lo
 * encola en el outbox de la app como eventos `gps_point`, en lotes, cediendo el hilo de JS
 * entre lote y lote para no congelar la UI. Reporta progreso incremental vía `onProgreso`.
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
  const corte = await obtenerCortePrimerArranque();
  // H1.b: solo los puntos ANTERIORES al primer arranque de este build — los posteriores ya
  // los encoló el camino normal, ahora que el outbox anda.
  const locationsRescatables = filtrarPuntosRescatables(locationsCrudas, corte);
  // Orden cronológico ascendente por el fix real, no por el orden de entrega del SDK nativo
  // (no documentado, y da igual: los puntos NO llegan por red aquí, así que ordenar en
  // memoria antes de encolar es gratis y deja el outbox en el mismo orden que un recorrido
  // grabado en vivo).
  const locations = locationsRescatables
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const progreso: ProgresoRescateDia1 = { total: locations.length, encolados: 0, fallidos: 0 };
  onProgreso({ ...progreso });
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
          // H6 (hallazgo de revisión, medio): timestamp ilegible — no se encola con una fecha
          // inventada (ver el comentario de `construirEventoRescatado`), se cuenta aparte.
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

        await encolarEvento(db, {
          deviceId,
          tipo: evento.tipo,
          payload: evento.payload,
          // H1.a: `eventId` determinístico — mismo punto ⇒ mismo `eventId` ⇒ el `ON CONFLICT`
          // del servidor lo descarta solo en un re-run.
          eventId: evento.eventId,
        });
        progreso.encolados += 1;
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
    onProgreso({ ...progreso });
    // Cede el hilo de JS entre lotes en vez de encolar miles de eventos de un tirón.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return progreso;
}
