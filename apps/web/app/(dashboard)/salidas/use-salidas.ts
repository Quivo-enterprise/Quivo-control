'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActualizarGrupoVehiculo,
  BaseFrecuencia,
  CrearFrecuenciaRegla,
  CrearGrupoVehiculo,
  EstadoFilaSalidaPanel,
  GrupoVehiculo,
  ReglasFrecuenciaPanel,
  Vehiculo,
} from '@quivo/shared';
import { salidasApi, type TerminalesCargadas } from '../../../src/lib/api/salidas';
import { vehiculosApi } from '../../../src/lib/api/vehiculos';

/** Cadencia del poll de la fila: 1 request cada 5 s por pantalla (plan "fila de salida"). */
export const INTERVALO_POLL_FILA_MS = 5_000;

const keyFila = (pcId: string) => ['salidas', 'fila', pcId] as const;
const keyReglas = (pcId: string) => ['salidas', 'reglas', pcId] as const;
const KEY_GRUPOS = ['salidas', 'grupos'] as const;

export function useTerminales(token: string | null) {
  return useQuery<TerminalesCargadas>({
    queryKey: ['salidas', 'terminales'],
    enabled: Boolean(token),
    queryFn: () => salidasApi.listarTerminales(token as string),
    staleTime: 5 * 60_000,
  });
}

/** Fila en vivo con poll de 5 s; igual que `use-en-vivo.ts`, se pausa con la pestaña oculta. */
export function useFilaSalida(token: string | null, pcId: string | null) {
  return useQuery<EstadoFilaSalidaPanel>({
    queryKey: keyFila(pcId ?? ''),
    enabled: Boolean(token && pcId),
    queryFn: () => salidasApi.fila(token as string, pcId as string),
    refetchInterval: INTERVALO_POLL_FILA_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 2,
  });
}

/** Cadencia de refresco de las reglas: otro operador puede cambiarlas y el día de Bolivia puede rodar. */
export const INTERVALO_REGLAS_MS = 60_000;

/** Reglas del día: se invalidan tras cada mutación propia y se refrescan cada 60 s (sin pestaña oculta). */
export function useReglasSalida(token: string | null, pcId: string | null) {
  return useQuery<ReglasFrecuenciaPanel>({
    queryKey: keyReglas(pcId ?? ''),
    enabled: Boolean(token && pcId),
    queryFn: () => salidasApi.reglas(token as string, pcId as string),
    refetchInterval: INTERVALO_REGLAS_MS,
    refetchIntervalInBackground: false,
  });
}

/** Grupos de trufis: solo los pide un admin (el operador recibe 403). */
export function useGruposVehiculo(token: string | null, habilitado: boolean) {
  return useQuery<GrupoVehiculo[]>({
    queryKey: KEY_GRUPOS,
    enabled: Boolean(token) && habilitado,
    queryFn: () => salidasApi.grupos(token as string),
  });
}

/** Vehículos del sindicato (número interno en la fila, selector de trufis). */
export function useVehiculosSalida(token: string | null) {
  return useQuery<Vehiculo[]>({
    queryKey: ['salidas', 'vehiculos'],
    enabled: Boolean(token),
    queryFn: () => vehiculosApi.listar(token as string),
    staleTime: 60_000,
  });
}

export function useAccionesFila(token: string, pcId: string) {
  const qc = useQueryClient();
  const refrescar = () => qc.invalidateQueries({ queryKey: keyFila(pcId) });
  const despachar = useMutation({
    mutationFn: (filaId: string) => salidasApi.despachar(token, pcId, filaId),
    onSettled: refrescar,
  });
  const moverAlFinal = useMutation({
    mutationFn: (filaId: string) => salidasApi.moverAlFinal(token, pcId, filaId),
    onSettled: refrescar,
  });
  const retirar = useMutation({
    mutationFn: (filaId: string) => salidasApi.retirar(token, pcId, filaId),
    onSettled: refrescar,
  });
  return { despachar, moverAlFinal, retirar };
}

export function useAccionesFrecuencia(token: string, pcId: string) {
  const qc = useQueryClient();
  // La base viaja también en la fila (`baseMin`): se invalidan las dos.
  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: keyReglas(pcId) });
    void qc.invalidateQueries({ queryKey: keyFila(pcId) });
  };
  const crearRegla = useMutation({
    mutationFn: (data: CrearFrecuenciaRegla) => salidasApi.crearRegla(token, pcId, data),
    onSuccess: refrescar,
  });
  const anularRegla = useMutation({
    mutationFn: (reglaId: string) => salidasApi.anularRegla(token, pcId, reglaId),
    onSuccess: refrescar,
  });
  const fijarBase = useMutation({
    mutationFn: (data: BaseFrecuencia) => salidasApi.fijarBase(token, pcId, data),
    onSuccess: refrescar,
  });
  return { crearRegla, anularRegla, fijarBase };
}

export function useAccionesGrupo(token: string) {
  const qc = useQueryClient();
  const refrescar = () => qc.invalidateQueries({ queryKey: KEY_GRUPOS });
  const crear = useMutation({
    mutationFn: (data: CrearGrupoVehiculo) => salidasApi.crearGrupo(token, data),
    onSuccess: refrescar,
  });
  const actualizar = useMutation({
    mutationFn: (v: { id: string; data: ActualizarGrupoVehiculo }) =>
      salidasApi.actualizarGrupo(token, v.id, v.data),
    onSuccess: refrescar,
  });
  const agregarMiembro = useMutation({
    mutationFn: (v: { id: string; vehiculoId: string }) => salidasApi.agregarMiembro(token, v.id, v.vehiculoId),
    onSuccess: refrescar,
  });
  const quitarMiembro = useMutation({
    mutationFn: (v: { id: string; vehiculoId: string }) => salidasApi.quitarMiembro(token, v.id, v.vehiculoId),
    onSuccess: refrescar,
  });
  return { crear, actualizar, agregarMiembro, quitarMiembro };
}

export function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}
