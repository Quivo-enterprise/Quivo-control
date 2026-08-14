import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthVehiculoMovilResponse,
  ContextoOperativoMovil,
  ResumenAsignacionMovil,
} from '@quivo/shared';
import { AuthMovilApiError, authMovilApi } from '../../shared/api/auth-movil-api';
import {
  actualizarSesionMovil,
  borrarSesionMovil,
  cargarSesionMovil,
  guardarSesionMovil,
  obtenerDeviceIdMovil,
  type SesionMovilGuardada,
} from '../../shared/security/sesion-movil-store';

export type EtapaAuthMovil = 'restaurando' | 'vehiculo' | 'conductor' | 'asignacion' | 'operacion';

export interface EstadoAuthMovil {
  etapa: EtapaAuthMovil;
  cargando: boolean;
  error: string | null;
  aviso: string | null;
  vehiculo: AuthVehiculoMovilResponse | null;
  asignaciones: ResumenAsignacionMovil[];
  sesion: SesionMovilGuardada | null;
  deviceId: string | null;
}

const ESTADO_INICIAL: EstadoAuthMovil = {
  etapa: 'restaurando',
  cargando: false,
  error: null,
  aviso: null,
  vehiculo: null,
  asignaciones: [],
  sesion: null,
  deviceId: null,
};

export function useAuthMovil() {
  const [estado, setEstado] = useState<EstadoAuthMovil>(ESTADO_INICIAL);
  const mounted = useRef(true);
  const deviceId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    void restaurarSesion();
    return () => {
      mounted.current = false;
    };

    async function restaurarSesion() {
      try {
        deviceId.current = await obtenerDeviceIdMovil();
        setEstado((actual) => ({ ...actual, deviceId: deviceId.current }));
        const guardada = await cargarSesionMovil();
        if (!mounted.current) return;
        
        // Validar que la sesión no esté vencida y que no tenga una estructura corrupta
        if (
          !guardada || 
          !guardada.contexto?.conductor || 
          !guardada.contexto?.asignacion?.horario ||
          new Date(guardada.refreshTokenExpiresAt) <= new Date()
        ) {
          if (guardada) await borrarSesionMovil();
          setEstado((actual) => ({ ...actual, etapa: 'vehiculo', sesion: null }));
          return;
        }

        // El contexto cacheado permite continuar el recorrido aunque la app se abra sin red.
        setEstado((actual) => ({ ...actual, etapa: 'operacion', sesion: guardada }));
        void reconciliarSesion(guardada);
      } catch {
        if (mounted.current) {
          setEstado((actual) => ({
            ...actual,
            etapa: 'vehiculo',
            error: 'No se pudo abrir el almacenamiento seguro del dispositivo.',
          }));
        }
      }
    }

    async function reconciliarSesion(guardada: SesionMovilGuardada) {
      try {
        let vigente = guardada;
        if (new Date(guardada.accessTokenExpiresAt) <= new Date()) {
          vigente = await refrescar(guardada);
        }
        const contexto = await authMovilApi.obtenerContexto(vigente.accessToken);
        if (!mounted.current) return;
        const actualizada = { ...vigente, contexto };
        await guardarSesionMovil(actualizada);
        setEstado((actual) => ({ ...actual, sesion: actualizada, aviso: null }));
      } catch (error: unknown) {
        if (!mounted.current) return;
        if (error instanceof AuthMovilApiError && error.status === 401) {
          try {
            const vigente = await refrescar(guardada);
            const contexto = await authMovilApi.obtenerContexto(vigente.accessToken);
            const actualizada = { ...vigente, contexto };
            await guardarSesionMovil(actualizada);
            if (mounted.current) setEstado((actual) => ({ ...actual, sesion: actualizada }));
            return;
          } catch (refreshError: unknown) {
            if (refreshError instanceof AuthMovilApiError && refreshError.kind === 'network') {
              setEstado((actual) => ({
                ...actual,
                aviso: 'Trabajando offline. La sesión se validará al recuperar conexión.',
              }));
              return;
            }
            await borrarSesionMovil();
            if (mounted.current) setEstado({ ...ESTADO_INICIAL, etapa: 'vehiculo' });
            return;
          }
        }
        setEstado((actual) => ({
          ...actual,
          aviso: 'Trabajando offline. Los eventos quedarán pendientes de sincronización.',
        }));
      }
    }
  }, []);

  const autenticarVehiculo = useCallback(async (placa: string, pin: string) => {
    await ejecutar(async () => {
      const instalacionId = await asegurarDeviceId();
      const vehiculo = await authMovilApi.autenticarVehiculo({
        placa,
        pin,
        deviceId: instalacionId,
      });
      setEstado((actual) => ({ ...actual, etapa: 'conductor', vehiculo, asignaciones: [] }));
    });
  }, []);

  const autenticarConductor = useCallback(
    async (documentoIdentidad: string, pin: string) => {
      await ejecutar(async () => {
        const actual = obtenerDesafio(estado);
        const respuesta = await authMovilApi.autenticarConductor({
          challengeToken: actual.challengeToken,
          deviceId: await asegurarDeviceId(),
          documentoIdentidad,
          pin,
        });
        if (respuesta.status === 'seleccion_requerida') {
          setEstado((previo) => ({
            ...previo,
            etapa: 'asignacion',
            asignaciones: respuesta.asignaciones,
          }));
          return;
        }
        await guardarSesionMovil(respuesta);
        setEstado((previo) => ({ ...previo, etapa: 'operacion', sesion: respuesta }));
      });
    },
    [estado],
  );

  const seleccionarAsignacion = useCallback(
    async (asignacionId: string) => {
      await ejecutar(async () => {
        const actual = obtenerDesafio(estado);
        const respuesta = await authMovilApi.autenticarConductor({
          challengeToken: actual.challengeToken,
          deviceId: await asegurarDeviceId(),
          asignacionId,
        });
        if (respuesta.status !== 'autenticado') {
          throw new Error('La asignación no pudo confirmarse');
        }
        await guardarSesionMovil(respuesta);
        setEstado((previo) => ({ ...previo, etapa: 'operacion', sesion: respuesta }));
      });
    },
    [estado],
  );

  const volverAVehiculo = useCallback(() => {
    setEstado((actual) => ({
      ...actual,
      etapa: 'vehiculo',
      vehiculo: null,
      asignaciones: [],
      error: null,
    }));
  }, []);

  const logout = useCallback(async () => {
    setEstado((actual) => ({ ...actual, cargando: true, error: null }));
    const refreshToken = estado.sesion?.refreshToken;
    if (refreshToken) {
      try {
        await authMovilApi.logout(refreshToken);
      } catch {
        // La limpieza local siempre se ejecuta; la sesión expira/revoca server-side después.
      }
    }
    await borrarSesionMovil();
    if (mounted.current) setEstado({ ...ESTADO_INICIAL, etapa: 'vehiculo' });
  }, [estado.sesion?.refreshToken]);

  /** Access token vigente para llamadas propias de la pantalla de operación (paquete del
   * día QUI-236, sync QUI-240) — refresca sola si ya venció, sin duplicar la lógica de
   * `reconciliarSesion`. Devuelve `null` sin sesión o si el refresh falla (offline). */
  const obtenerAccessToken = useCallback(async (): Promise<string | null> => {
    const sesion = estado.sesion;
    if (!sesion) return null;
    if (new Date(sesion.accessTokenExpiresAt) > new Date()) {
      return sesion.accessToken;
    }
    try {
      const actualizada = await refrescar(sesion);
      if (mounted.current) setEstado((actual) => ({ ...actual, sesion: actualizada }));
      return actualizada.accessToken;
    } catch {
      return null;
    }
  }, [estado.sesion]);

  async function ejecutar(accion: () => Promise<void>): Promise<void> {
    setEstado((actual) => ({ ...actual, cargando: true, error: null, aviso: null }));
    try {
      await accion();
    } catch (error: unknown) {
      if (!mounted.current) return;
      setEstado((actual) => ({ ...actual, error: mensajeUsuario(error) }));
    } finally {
      if (mounted.current) setEstado((actual) => ({ ...actual, cargando: false }));
    }
  }

  async function asegurarDeviceId(): Promise<string> {
    deviceId.current ??= await obtenerDeviceIdMovil();
    setEstado((actual) => ({ ...actual, deviceId: deviceId.current }));
    return deviceId.current;
  }

  return {
    estado,
    autenticarVehiculo,
    autenticarConductor,
    seleccionarAsignacion,
    volverAVehiculo,
    logout,
    obtenerAccessToken,
  };
}

function obtenerDesafio(estado: EstadoAuthMovil): AuthVehiculoMovilResponse {
  if (!estado.vehiculo) throw new Error('La validación del vehículo expiró. Vuelve a comenzar.');
  if (new Date(estado.vehiculo.expiresAt) <= new Date()) {
    throw new Error('La validación del vehículo expiró. Vuelve a comenzar.');
  }
  return estado.vehiculo;
}

async function refrescar(guardada: SesionMovilGuardada): Promise<SesionMovilGuardada> {
  const tokens = await authMovilApi.refresh(guardada.refreshToken);
  return actualizarSesionMovil(guardada, tokens);
}

function mensajeUsuario(error: unknown): string {
  if (error instanceof AuthMovilApiError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado. Intenta nuevamente.';
}

export function contextoDe(estado: EstadoAuthMovil): ContextoOperativoMovil | null {
  return estado.sesion?.contexto ?? null;
}
