'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContextoEnVivo, SesionEnVivoResumen } from '@quivo/shared';
import { enVivoApi } from '../api/en-vivo';
import {
  debeRecargar,
  desdeConSolape,
  fusionarTraza,
  intervaloPoll,
  necesitaRecargaCompleta,
  type TrazaAcumulada,
} from './traza';

/**
 * Hooks de TanStack Query para `/en-vivo` — el primer consumidor real del `QueryClient` que
 * ya estaba montado en `app/providers.tsx`.
 *
 * El **dedupe por queryKey** no es cosmético acá: `apiFetch` no acepta `AbortSignal`, así que
 * una request en vuelo no se puede cancelar. Sin la deduplicación de la librería, un poll
 * lento y el siguiente podrían resolver fuera de orden y aplicar un delta viejo encima de uno
 * nuevo. Con ella, mientras hay un fetch en vuelo para la key, los disparos siguientes se
 * enganchan a esa misma promesa en vez de abrir una request nueva.
 */

const REINTENTOS = 4;
const retryDelay = (intento: number) => Math.min(1_000 * 2 ** intento, 30_000);

/** Listado de sesiones. Refresca lento: es el selector, no el mapa. */
export function useSesionesEnVivo(token: string | null) {
  return useQuery<SesionEnVivoResumen[]>({
    queryKey: ['en-vivo', 'sesiones'],
    enabled: Boolean(token),
    queryFn: () => enVivoApi.listar(token as string),
    refetchInterval: 30_000,
    // `false` (el default) pausa el intervalo con la pestaña oculta; `refetchOnWindowFocus`
    // hace el catch-up al volver.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: REINTENTOS,
    retryDelay,
  });
}

/**
 * Contexto de la sesión: `staleTime: Infinity` porque la geometría de la ruta son cientos de
 * vértices — reenviarla cada 10 s sería ~90 % del payload y 0 % de información nueva. El
 * cierre de la sesión no viaja por acá sino en cada respuesta de posiciones (`sesionFin`).
 */
export function useContextoEnVivo(token: string | null, sesionId: string | null) {
  return useQuery<ContextoEnVivo>({
    queryKey: ['en-vivo', 'contexto', sesionId],
    enabled: Boolean(token && sesionId),
    queryFn: () => enVivoApi.contexto(token as string, sesionId as string),
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: REINTENTOS,
    retryDelay,
  });
}

/**
 * Poll de la traza. El delta se fusiona **contra la cache** (`getQueryData` dentro del
 * `queryFn`), no contra un `useState` aparte: una sola fuente de verdad, sobrevive a los
 * remounts y es idempotente frente al doble render de Strict Mode.
 *
 * `structuralSharing: false` porque el array de puntos crece en cada poll y el diff
 * estructural de la librería no aporta nada — solo recorrería miles de objetos por tick.
 */
export function useTrazaEnVivo(token: string | null, sesionId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['en-vivo', 'traza', sesionId];

  return useQuery<TrazaAcumulada>({
    queryKey,
    enabled: Boolean(token && sesionId),
    structuralSharing: false,
    gcTime: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: REINTENTOS,
    retryDelay,
    refetchInterval: (query) => intervaloPoll(query.state.data),
    queryFn: async () => {
      const autenticacion = token as string;
      const sesion = sesionId as string;
      const previa = queryClient.getQueryData<TrazaAcumulada>(queryKey);

      const delta = await enVivoApi.posiciones(autenticacion, sesion, {
        desde: desdeConSolape(previa?.cursor),
      });
      const fusionada = fusionarTraza(previa, delta);
      if (!debeRecargar(previa, fusionada)) {
        // Se arrastra la marca de "ya recargué y seguía incompleta" mientras el hueco siga
        // ahí, para no repetir la descarga completa en cada poll.
        return {
          ...fusionada,
          recargaFallida: !fusionada.completa && Boolean(previa?.recargaFallida),
        };
      }

      // Auto-heal, **una sola vez** por ciclo: faltan puntos respecto de `totalPuntos`, así
      // que se recarga la ventana entera y se descarta lo acumulado (que tenía el hueco).
      const completa = await enVivoApi.posiciones(autenticacion, sesion, {});
      const recargada = fusionarTraza(undefined, completa);
      return { ...recargada, recargaFallida: necesitaRecargaCompleta(recargada) };
    },
  });
}

/**
 * Descarta la traza cacheada de la sesión y fuerza una descarga completa. Es lo que hace el
 * botón "Recargar" del aviso de traza incompleta: un `refetch` normal volvería a pedir solo
 * el delta desde el cursor, que es justo lo que dejó el hueco.
 */
export function useRecargarTraza(sesionId: string | null) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.removeQueries({ queryKey: ['en-vivo', 'traza', sesionId] });
  };
}
