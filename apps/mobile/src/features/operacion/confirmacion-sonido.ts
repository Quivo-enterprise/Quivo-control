import { useCallback, useEffect, useRef } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Sentry from '@sentry/react-native';
import sonidoConfirmacion from '../../../assets/sounds/confirmacion-chime.wav';

/**
 * Sonido de confirmación al registrar un punto de control (distinto de la voz de
 * `navegacionVoz`, ver `gps-provider.tsx`): la voz informa la distancia, el sonido da certeza
 * de que quedó registrado — un conductor manejando no puede mirar la pantalla para verificarlo.
 *
 * El asset (`assets/sounds/confirmacion-chime.wav`) es 100% sintético, generado por
 * `assets/sounds/generate-confirmacion-chime.py` (sin acceso a internet para bajar un sonido de
 * stock) — ver ese script para el diseño del timbre y la verificación numérica del audio.
 *
 * Configura el modo de audio UNA sola vez a nivel de módulo (no por cada `GpsProvider` que
 * monte) con `interruptionMode: 'duckOthers'`: baja el volumen de lo que esté sonando en el
 * trufi (música del conductor) en vez de cortarlo, y lo restaura sola al terminar. `
 * playsInSilentMode: true` (iOS) hace que suene aunque el switch físico de silencio esté
 * activado — es una herramienta de trabajo, no una notificación social que deba respetar el
 * silencio del usuario.
 */
let modoAudioConfigurado = false;

async function asegurarModoAudioConfigurado(): Promise<void> {
  if (modoAudioConfigurado) return;
  // Marcado ANTES del await: dos `GpsProvider` montando casi al mismo tiempo (no debería pasar
  // en la práctica, pero el guard es barato) no deben disparar dos `setAudioModeAsync`
  // concurrentes.
  modoAudioConfigurado = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
    });
  } catch (error) {
    // Best-effort (ver el comentario de la función expuesta más abajo): si el modo de audio no
    // se pudo configurar, `reproducir()` igual intenta sonar con lo que el sistema tenga por
    // default — puede que no duckee ni suene en silencio, pero no debe bloquear nada.
    console.error('[QUIVO][audio] No se pudo configurar el modo de audio', error);
    // ENTREGA 7 (plan post-piloto 2026-09-09): este catch era invisible por diseño — bien para
    // el chofer (nunca debe bloquear nada), mal para nosotros (nadie lee la consola del
    // teléfono de un conductor en ruta). Reportar a Sentry sin cambiar el comportamiento.
    Sentry.captureException(error, {
      tags: { contexto: 'confirmacion-sonido', paso: 'configurar-modo-audio' },
    });
  }
}

/**
 * Hook que arma el player del sonido de confirmación y devuelve la función para dispararlo.
 *
 * TODO EL CAMINO de audio es best-effort a propósito (regla dura del ticket): si la
 * reproducción falla —audio ocupado, archivo corrupto, dispositivo raro— el error se traga y
 * el flujo sigue. Perder el sonido es un detalle; perder el cumplimiento (que ya se persistió
 * en el outbox ANTES de que el caller invoque esta función, ver `gps-provider.tsx`) es el
 * producto entero.
 */
export function usePuntoControlSonido() {
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    void asegurarModoAudioConfigurado();
    try {
      playerRef.current = createAudioPlayer(sonidoConfirmacion);
    } catch (error) {
      console.error('[QUIVO][audio] No se pudo cargar el sonido de confirmación', error);
      Sentry.captureException(error, {
        tags: { contexto: 'confirmacion-sonido', paso: 'crear-player' },
      });
      playerRef.current = null;
    }
    return () => {
      // Descargar el player al desmontar: sin esto, cada `GpsProvider` que monta/desmonta (o
      // cada recarga en desarrollo) deja un player nativo huérfano — en una jornada de 12
      // horas eso es una fuga de memoria lenta, no un detalle cosmético.
      try {
        playerRef.current?.remove();
      } catch {
        // Liberar el recurso nunca debe tirar en el camino de desmontaje.
      }
      playerRef.current = null;
    };
  }, []);

  return useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      // `seekTo(0)` antes de `play()`: sin esto, una segunda pasada del mismo turno reproduce
      // desde donde había quedado la reproducción anterior (o desde el final, en silencio) en
      // vez de sonar la campanita completa de nuevo.
      player
        .seekTo(0)
        .then(() => {
          try {
            player.play();
          } catch (error) {
            console.error('[QUIVO][audio] No se pudo iniciar la reproducción del sonido de confirmación', error);
            Sentry.captureException(error, {
              tags: { contexto: 'confirmacion-sonido', paso: 'play' },
            });
          }
        })
        .catch((error: unknown) => {
          console.error('[QUIVO][audio] No se pudo rebobinar el sonido de confirmación', error);
          Sentry.captureException(error, {
            tags: { contexto: 'confirmacion-sonido', paso: 'seek-to' },
          });
        });
    } catch (error) {
      console.error('[QUIVO][audio] No se pudo reproducir el sonido de confirmación', error);
      Sentry.captureException(error, {
        tags: { contexto: 'confirmacion-sonido', paso: 'reproducir' },
      });
    }
  }, []);
}
