'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TRAZA_EN_VIVO_LIMITE_MAX, type ContextoEnVivo, type SesionEnVivoResumen } from '@quivo/shared';
import { enVivoApi } from '../api/en-vivo';
import {
  debeRecargar,
  desdeConSolape,
  fusionarTraza,
  intervaloPoll,
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
      // Capturado una sola vez: es lo que se compara contra `ultimoIntentoRecargaMs` para el
      // cooldown y, si se dispara una recarga, lo que queda grabado como el nuevo intento.
      const ahora = Date.now();

      const delta = await enVivoApi.posiciones(autenticacion, sesion, {
        desde: desdeConSolape(previa?.cursor),
      });
      const fusionada = fusionarTraza(previa, delta);
      if (!debeRecargar(previa, fusionada, ahora)) {
        // Se arrastra la marca de "ya recargué y seguía incompleta" (déficit y el instante del
        // último intento) mientras el hueco siga ahí, para no repetir la descarga completa en
        // cada poll ni resetear el cooldown por accidente.
        return {
          ...fusionada,
          recargaFallida: !fusionada.completa && Boolean(previa?.recargaFallida),
          deficitFallido: fusionada.completa ? null : (previa?.deficitFallido ?? null),
          ultimoIntentoRecargaMs: fusionada.completa ? null : (previa?.ultimoIntentoRecargaMs ?? null),
        };
      }

      // Auto-heal, **una sola vez** por ciclo: faltan puntos respecto de `totalPuntos`, así
      // que se recarga la ventana entera y se descarta lo acumulado (que tenía el hueco).
      //
      // `limite: TRAZA_EN_VIVO_LIMITE_MAX` (no el default de 2000) es obligatorio acá: una
      // jornada Z12 completa ronda 4300 puntos, así que sin el `limite` explícito el server
      // trunca esta respuesta igual que el delta normal, `fusionarTraza(undefined, completa)`
      // descarta la traza acumulada y la reemplaza por los primeros 2000 puntos (la polilínea
      // rebobina a la mañana), y la respuesta trunca sigue trayendo `hayMas: true` — con lo
      // que `recargaFallida` nunca se marca (ver abajo) y el ciclo de recarga completa se
      // repite sin fin.
      const completa = await enVivoApi.posiciones(autenticacion, sesion, {
        limite: TRAZA_EN_VIVO_LIMITE_MAX,
      });
      const recargada = fusionarTraza(undefined, completa);
      // `recargaFallida` sale de si la recarga REALMENTE completó (`recargada.completa`), no
      // de `necesitaRecargaCompleta` — que además de mirar lo mismo también da `false` cuando
      // `hayMas` sigue en `true` (jornada > `TRAZA_EN_VIVO_LIMITE_MAX`), justo el caso en el
      // que las guardas anti-bucle de `debeRecargar` (déficit + cooldown) más necesitan saber
      // que la recarga falló. `ultimoIntentoRecargaMs` se graba siempre, haya completado o no:
      // es lo único que impide que este caso (jornada > `TRAZA_EN_VIVO_LIMITE_MAX`, déficit
      // creciendo de verdad en cada poll) siga disparando una recarga completa cada 10 s.
      const completoAhora = recargada.completa;
      return {
        ...recargada,
        recargaFallida: !completoAhora,
        deficitFallido: completoAhora ? null : recargada.totalPuntos - recargada.puntos.length,
        ultimoIntentoRecargaMs: ahora,
      };
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
