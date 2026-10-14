import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
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
  debeReiniciarPorSesion,
  estadoFotoVehiculo,
  excedeTopeFoto,
  pendientePerteneceASesion,
  recorteCuadradoCentrado,
  subidaYaAplicada,
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
  /** `false` si el sistema ya no vuelve a mostrar el diálogo (hay que ir a Ajustes). */
  puedePedirPermiso: boolean;
}

const SNAPSHOT_INICIAL: Snapshot = {
  estado: 'idle',
  mensaje: null,
  permisoDenegado: false,
  puedePedirPermiso: true,
};

let snapshot: Snapshot = SNAPSHOT_INICIAL;
/** Foto a enviar y la sesión que la capturó: nunca se sube bajo otra sesión (p. ej. tras un
 * logout + login de otro conductor en el mismo proceso). */
let pendienteBase64: string | null = null;
let pendienteSesionId: string | null = null;
/** Instante (cliente) en que empezó el primer intento de ESTA captura y la fecha de foto que ya
 * existía: sirven para detectar un POST que sí llegó aunque la respuesta se perdiera. */
let pendienteInicioMs = 0;
let pendienteFotoPreviaEn: string | null = null;
let pendienteIntentado = false;
/** Sesión dueña del estado del módulo; cambia -> el estado se reinicia. */
let sesionModulo: string | null = null;
/** Se incrementa en cada reinicio: invalida envíos en vuelo de la sesión anterior. */
let generacion = 0;
let ocupado = false;
/** Candado síncrono de `tomarFoto`: se toma ANTES de cualquier await para que dos toques
 * simultáneos (aviso y Perfil) no abran dos cámaras. */
let tomandoFoto = false;
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

function descartarPendiente(): void {
  pendienteBase64 = null;
  pendienteSesionId = null;
  pendienteIntentado = false;
}

/** Si el hook ve una sesión distinta a la dueña del estado, descarta todo (mensajes, estado y
 * foto pendiente) y deja el módulo a nombre de la sesión nueva. */
function sincronizarSesion(sesionId: string): void {
  if (debeReiniciarPorSesion(sesionModulo, sesionId)) {
    generacion += 1;
    descartarPendiente();
    ocupado = false;
    tomandoFoto = false;
    snapshot = SNAPSHOT_INICIAL;
    listeners.forEach((l) => l());
  }
  sesionModulo = sesionId;
}

/** Se lanza si la sesión cambió con un envío en vuelo: corta los reintentos sin subir nada. */
class SesionCambiadaError extends Error {}

function clasificar(error: unknown): ErrorSubida {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return { red: true };
    return { red: false, status: error.status };
  }
  // Sesión cambiada: no reintentable (se trata como 401, el resultado se ignora igual).
  if (error instanceof SesionCambiadaError) return { red: false, status: 401 };
  return { red: false };
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const claveFoto = (sesionId: string) => ['vehiculo-foto', sesionId] as const;

function registrarPendiente(base64: string, sesionId: string, queryClient: QueryClient): void {
  pendienteBase64 = base64;
  pendienteSesionId = sesionId;
  pendienteInicioMs = Date.now();
  pendienteIntentado = false;
  pendienteFotoPreviaEn =
    queryClient.getQueryData<FotoVehiculo | null>(claveFoto(sesionId))?.fotoActualizadaEn ?? null;
}

async function enviarPendiente(
  obtenerAccessToken: () => Promise<string | null>,
  queryClient: QueryClient,
  sesionId: string,
): Promise<void> {
  const base64 = pendienteBase64;
  if (!base64 || ocupado) return;
  // La foto pertenece a otra sesión: se descarta y NO se sube.
  if (!pendientePerteneceASesion(pendienteSesionId, sesionId) || sesionModulo !== sesionId) {
    descartarPendiente();
    publicar({ estado: 'idle', mensaje: null });
    return;
  }
  const miGeneracion = generacion;
  const vigente = () => miGeneracion === generacion && sesionModulo === sesionId;
  ocupado = true;
  publicar({ estado: 'enviando', mensaje: null });
  try {
    const obtenerToken = async (): Promise<string> => {
      if (!vigente()) throw new SesionCambiadaError();
      const token = await obtenerAccessToken();
      if (!token) {
        // Sin token no hay sesión que pueda enviar: error permanente (no reintentable), no red.
        throw new ApiError('http', 'Sin sesión activa', 401);
      }
      if (!vigente()) throw new SesionCambiadaError();
      return token;
    };
    const resultado = await subirConReintentos<FotoVehiculo>({
      intentar: async () => {
        const token = await obtenerToken();
        pendienteIntentado = true;
        return vehiculoFotoApi.subir(token, { imagenBase64: base64, contentType: 'image/jpeg' });
      },
      clasificar,
      dormir,
      cancelado: () => !vigente(),
      verificarPrimero: pendienteIntentado,
      yaExistente: async () => {
        const token = await obtenerToken();
        const actual = await vehiculoFotoApi.obtener(token);
        if (
          actual &&
          subidaYaAplicada({
            fotoActualizadaEn: actual.fotoActualizadaEn,
            inicioMs: pendienteInicioMs,
            previaEn: pendienteFotoPreviaEn,
          })
        ) {
          return actual;
        }
        return null;
      },
    });
    if (!vigente()) return; // otra sesión: se ignora el resultado
    if (resultado.tipo === 'ok') {
      descartarPendiente();
      queryClient.setQueryData(claveFoto(sesionId), resultado.valor);
      void queryClient.invalidateQueries({ queryKey: claveFoto(sesionId) });
      publicar({ estado: 'enviada', mensaje: 'Foto enviada.', permisoDenegado: false });
    } else if (resultado.tipo === 'pendiente') {
      publicar({ estado: 'pendiente', mensaje: resultado.mensaje });
    } else {
      descartarPendiente();
      publicar({ estado: 'error', mensaje: resultado.mensaje });
    }
  } finally {
    if (miGeneracion === generacion) ocupado = false;
  }
}

/** Recorta al cuadrado central (con el ancho/alto reales), reduce a 512x512 JPEG ~0.7 y devuelve
 * el base64 (sin prefijo data:). Sin recorte la foto 4:3 se estiraba al forzar 512x512. */
async function procesarImagen(uri: string, ancho: number, alto: number): Promise<string> {
  const contexto = ImageManipulator.manipulate(uri);
  try {
    const recorte = recorteCuadradoCentrado(ancho, alto);
    if (recorte) contexto.crop(recorte);
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
 * kill de la actividad: recorta, reduce, valida el tope y sube (o deja pendiente). */
async function procesarYEnviar(
  asset: { uri: string; width: number; height: number },
  obtenerAccessToken: () => Promise<string | null>,
  queryClient: QueryClient,
  sesionId: string,
): Promise<void> {
  publicar({ estado: 'procesando', mensaje: null });
  const base64 = await procesarImagen(asset.uri, asset.width, asset.height);
  if (sesionModulo !== sesionId) return; // la sesión cambió mientras se procesaba
  if (excedeTopeFoto(base64)) {
    publicar({ estado: 'error', mensaje: MENSAJE_FOTO_GRANDE });
    return;
  }
  registrarPendiente(base64, sesionId, queryClient);
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

  // Antes de cualquier otro efecto: si el estado del módulo es de otra sesión, se descarta.
  useLayoutEffect(() => {
    sincronizarSesion(sesionId);
  }, [sesionId]);

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
  // fallar re-dispararía el efecto en bucle mientras NetInfo diga "online". Un error permanente
  // (p. ej. sesión vencida) descarta la foto y deja el estado en `error`, así que no hay bucle.
  useEffect(() => {
    if (!offline && pendienteBase64 && snapshot.estado === 'pendiente') void reintentar();
  }, [offline, reintentar]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      if (pendienteBase64 && snapshot.estado === 'pendiente') void reintentar();
      // Si el conductor concedió el permiso desde Ajustes, se limpia el aviso de permiso denegado.
      if (snapshot.permisoDenegado) {
        void ImagePicker.getCameraPermissionsAsync()
          .then((permiso) => {
            if (permiso.granted) {
              publicar({ permisoDenegado: false, puedePedirPermiso: true, mensaje: null, estado: 'idle' });
            }
          })
          .catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [reintentar]);

  const tomarFoto = useCallback(async () => {
    // Candado síncrono, antes de cualquier await.
    if (tomandoFoto || ocupado || snapshot.estado === 'procesando' || snapshot.estado === 'enviando')
      return;
    tomandoFoto = true;
    const miGeneracion = generacion;
    try {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) {
        publicar({
          estado: 'error',
          mensaje: permiso.canAskAgain
            ? 'Necesitamos el permiso de cámara para tomar la foto.'
            : 'Sin permiso de cámara no se puede tomar la foto. Actívalo en los ajustes de la app.',
          permisoDenegado: true,
          puedePedirPermiso: permiso.canAskAgain,
        });
        return;
      }
      publicar({ permisoDenegado: false, puedePedirPermiso: true });
      const captura = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      const asset = captura.canceled ? undefined : captura.assets[0];
      if (!asset) return;
      await procesarYEnviar(asset, obtenerAccessToken, queryClient, sesionId);
    } catch (error) {
      // Sin datos de la imagen: solo el tipo de fallo.
      Sentry.captureException(error, { tags: { feature: 'vehiculo-foto' } });
      if (miGeneracion === generacion) {
        publicar({ estado: 'error', mensaje: 'No se pudo tomar la foto. Intenta nuevamente.' });
      }
    } finally {
      if (miGeneracion === generacion) tomandoFoto = false;
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
        if (
          tomandoFoto ||
          ocupado ||
          snapshot.estado === 'procesando' ||
          snapshot.estado === 'enviando'
        )
          return;
        tomandoFoto = true;
        try {
          await procesarYEnviar(pendiente.assets[0], obtenerAccessToken, queryClient, sesionId);
        } finally {
          tomandoFoto = false;
        }
      } catch (error) {
        Sentry.captureException(error, { tags: { feature: 'vehiculo-foto' } });
        publicar({ estado: 'error', mensaje: 'No se pudo recuperar la foto. Intenta nuevamente.' });
      }
    })();
  }, [obtenerAccessToken, queryClient, sesionId]);

  return {
    foto: consulta.data ?? null,
    /** `desconocido` = la consulta falló: nunca debe leerse como "sin foto". */
    estadoFoto: estadoFotoVehiculo({
      cargando: consulta.isLoading,
      error: consulta.isError,
      datos: consulta.data,
    }),
    cargando: consulta.isLoading,
    estado: estado.estado,
    mensaje: estado.mensaje,
    permisoDenegado: estado.permisoDenegado,
    /** Solo cuando el sistema ya no muestra el diálogo hay que mandar al conductor a Ajustes. */
    requiereAjustes: estado.permisoDenegado && !estado.puedePedirPermiso,
    tomarFoto,
  };
}
