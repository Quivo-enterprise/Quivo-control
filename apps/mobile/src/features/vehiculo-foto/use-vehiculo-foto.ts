import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Sentry from '@sentry/react-native';
import type { FotoVehiculo } from '@quivo/shared';
import { ApiError } from '../../shared/api/http-client';
import { vehiculoFotoApi } from '../../shared/api/vehiculo-foto-api';
import { calcularIsOffline } from '../operacion/use-sync-status';
import {
  CALIDAD_JPEG,
  LADO_FOTO_PX,
  MENSAJE_FOTO_GRANDE,
  excedeTopeFoto,
  subirConReintentos,
  type ErrorSubida,
  type EstadoFoto,
} from './vehiculo-foto-core';

/**
 * Captura y subida de la foto del vehículo (PR D). Subida DIRECTA (no pasa por el outbox):
 * reintenta con backoff y, si no hay red, deja la foto pendiente EN MEMORIA hasta que vuelva la
 * conexión o la app pase a primer plano. Si la app se cierra antes, la foto pendiente se pierde
 * (decisión explícita: una foto no justifica persistir un blob en SQLite). Nunca se loguea el
 * base64.
 */

interface Snapshot {
  estado: EstadoFoto;
  mensaje: string | null;
  permisoDenegado: boolean;
}

let snapshot: Snapshot = { estado: 'idle', mensaje: null, permisoDenegado: false };
let pendienteBase64: string | null = null;
let ocupado = false;
/** `getPendingResultAsync` se consulta una sola vez por proceso: el hook se monta en Perfil y en
 * Operación, y el resultado nativo se consume al leerlo. */
let recuperacionIntentada = false;
const listeners = new Set<() => void>();

function publicar(parcial: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...parcial };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function clasificar(error: unknown): ErrorSubida {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return { red: true };
    return { red: false, status: error.status };
  }
  return { red: false };
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const claveFoto = (sesionId: string) => ['vehiculo-foto', sesionId] as const;

async function enviarPendiente(
  obtenerAccessToken: () => Promise<string | null>,
  queryClient: QueryClient,
  sesionId: string,
): Promise<void> {
  const base64 = pendienteBase64;
  if (!base64 || ocupado) return;
  ocupado = true;
  publicar({ estado: 'enviando', mensaje: null });
  try {
    const resultado = await subirConReintentos<FotoVehiculo>({
      intentar: async () => {
        const token = await obtenerAccessToken();
        if (!token) throw new ApiError('network', 'Sin sesión renovable');
        return vehiculoFotoApi.subir(token, { imagenBase64: base64, contentType: 'image/jpeg' });
      },
      clasificar,
      dormir,
    });
    if (resultado.tipo === 'ok') {
      pendienteBase64 = null;
      queryClient.setQueryData(claveFoto(sesionId), resultado.valor);
      publicar({ estado: 'enviada', mensaje: 'Foto enviada.', permisoDenegado: false });
    } else if (resultado.tipo === 'pendiente') {
      publicar({ estado: 'pendiente', mensaje: resultado.mensaje });
    } else {
      pendienteBase64 = null;
      publicar({ estado: 'error', mensaje: resultado.mensaje });
    }
  } finally {
    ocupado = false;
  }
}

/** Reduce a 512x512 JPEG ~0.7 y devuelve el base64 (sin prefijo data:). */
async function procesarImagen(uri: string): Promise<string> {
  const contexto = ImageManipulator.manipulate(uri);
  try {
    contexto.resize({ width: LADO_FOTO_PX, height: LADO_FOTO_PX });
    const imagen = await contexto.renderAsync();
    try {
      const guardada = await imagen.saveAsync({
        format: SaveFormat.JPEG,
        compress: CALIDAD_JPEG,
        base64: true,
      });
      if (!guardada.base64) throw new Error('El manipulador no devolvió base64');
      return guardada.base64;
    } finally {
      imagen.release();
    }
  } finally {
    contexto.release();
  }
}

/** Pipeline posterior a la captura, compartido por la ruta normal y por la recuperación tras un
 * kill de la actividad: reduce, valida el tope y sube (o deja pendiente). */
async function procesarYEnviar(
  uri: string,
  obtenerAccessToken: () => Promise<string | null>,
  queryClient: QueryClient,
  sesionId: string,
): Promise<void> {
  publicar({ estado: 'procesando', mensaje: null });
  const base64 = await procesarImagen(uri);
  if (excedeTopeFoto(base64)) {
    publicar({ estado: 'error', mensaje: MENSAJE_FOTO_GRANDE });
    return;
  }
  pendienteBase64 = base64;
  await enviarPendiente(obtenerAccessToken, queryClient, sesionId);
}

export function useVehiculoFoto(opts: {
  obtenerAccessToken: () => Promise<string | null>;
  sesionId: string;
}) {
  const { obtenerAccessToken, sesionId } = opts;
  const queryClient = useQueryClient();
  const estado = useSyncExternalStore(subscribe, () => snapshot);
  const netInfo = useNetInfo();
  const offline = calcularIsOffline(netInfo.isConnected, netInfo.isInternetReachable);

  const consulta = useQuery({
    queryKey: claveFoto(sesionId),
    queryFn: async (): Promise<FotoVehiculo | null> => {
      const token = await obtenerAccessToken();
      if (!token) throw new Error('No hay sesión activa para cargar la foto');
      return vehiculoFotoApi.obtener(token);
    },
    staleTime: 5 * 60 * 1000,
  });

  const reintentar = useCallback(
    () => enviarPendiente(obtenerAccessToken, queryClient, sesionId),
    [obtenerAccessToken, queryClient, sesionId],
  );

  // Foto pendiente: se reintenta al volver la conexión o al volver a primer plano. Depende solo de
  // `offline` (no del estado) a propósito: si dependiera de `estado`, un pendiente que vuelve a
  // fallar re-dispararía el efecto en bucle mientras NetInfo diga "online".
  useEffect(() => {
    if (!offline && pendienteBase64 && snapshot.estado === 'pendiente') void reintentar();
  }, [offline, reintentar]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && pendienteBase64 && snapshot.estado === 'pendiente') void reintentar();
    });
    return () => sub.remove();
  }, [reintentar]);

  const tomarFoto = useCallback(async () => {
    if (ocupado || snapshot.estado === 'procesando' || snapshot.estado === 'enviando') return;
    try {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) {
        publicar({
          estado: 'error',
          mensaje:
            'Sin permiso de cámara no se puede tomar la foto. Actívalo en los ajustes de la app.',
          permisoDenegado: true,
        });
        return;
      }
      publicar({ permisoDenegado: false });
      const captura = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (captura.canceled || !captura.assets[0]) return;
      await procesarYEnviar(captura.assets[0].uri, obtenerAccessToken, queryClient, sesionId);
    } catch (error) {
      // Sin datos de la imagen: solo el tipo de fallo.
      Sentry.captureException(error, { tags: { feature: 'vehiculo-foto' } });
      publicar({ estado: 'error', mensaje: 'No se pudo tomar la foto. Intenta nuevamente.' });
    }
  }, [obtenerAccessToken, queryClient, sesionId]);

  // Android puede matar la actividad mientras la cámara del sistema está abierta (gama baja, p.
  // ej. Moto E13) y la captura se pierde. `getPendingResultAsync` la devuelve una vez al volver:
  // si hay una foto, sigue por el mismo pipeline. El guard de módulo evita repetirlo cuando se
  // monta el hook en la segunda pantalla.
  useEffect(() => {
    if (recuperacionIntentada) return;
    recuperacionIntentada = true;
    void (async () => {
      try {
        const pendiente = await ImagePicker.getPendingResultAsync();
        if (!pendiente || 'code' in pendiente || pendiente.canceled || !pendiente.assets[0]) return;
        if (ocupado || snapshot.estado === 'procesando' || snapshot.estado === 'enviando') return;
        await procesarYEnviar(pendiente.assets[0].uri, obtenerAccessToken, queryClient, sesionId);
      } catch (error) {
        Sentry.captureException(error, { tags: { feature: 'vehiculo-foto' } });
        publicar({ estado: 'error', mensaje: 'No se pudo recuperar la foto. Intenta nuevamente.' });
      }
    })();
  }, [obtenerAccessToken, queryClient, sesionId]);

  return {
    foto: consulta.data ?? null,
    cargando: consulta.isLoading,
    estado: estado.estado,
    mensaje: estado.mensaje,
    permisoDenegado: estado.permisoDenegado,
    tomarFoto,
  };
}
