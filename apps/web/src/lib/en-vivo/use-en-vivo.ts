'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TRAZA_EN_VIVO_LIMITE_MAX,
  type ContextoEnVivo,
  type Infraccion,
  type JornadasDelDia,
  type MolinosResumen,
  type PosicionEnVivo,
  type PuntoControl,
  type SesionEnVivoResumen,
  type Variante,
} from '@quivo/shared';
import { enVivoApi } from '../api/en-vivo';
import { infraccionesApi } from '../api/infracciones';
import { puntosControlApi } from '../api/puntos-control';
import { reportesApi } from '../api/reportes';
import { variantesApi } from '../api/variantes';
import {
  debeRecargar,
  desdeConSolape,
  fusionarTraza,
  INTERVALO_POLL_MS,
  intervaloPoll,
  type TrazaAcumulada,
} from './traza';
import { aplicarDesignacion } from './vuelta';

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

/** Cadencia del poll de `/posiciones`; también es la duración de la animación del vehículo seleccionado. */
export const INTERVALO_POLL_POSICIONES_MS = 2_000;

/**
 * ENTREGA 13 — última posición de TODOS los vehículos con sesión activa/reciente
 * (`GET /reportes/en-vivo/posiciones`, sin `sesionId`). Reemplaza a `useSesionesEnVivo` como
 * fuente del mapa: gobierna qué se dibuja, no un `<select>` de una sola sesión.
 *
 * `refetchInterval: INTERVALO_POLL_POSICIONES_MS` (2 s; bajado de 5 s para recortar la latencia
 * web vs. teléfono, PR 2 de `docs/plan-en-vivo-google.md`; la traza por sesión sigue a 10 s):
 * acá el costo NO escala con N — siempre es una query — así que se puede pollear rápido sin acercarse al
 * throttle (600 req/min por usuario en `en-vivo.controller.ts`, y esto es ~30 req/min por
 * pestaña). `refetchIntervalInBackground: false` (mismo criterio que el
 * resto de los hooks de esta pantalla): con la pestaña oculta no tiene sentido seguir
 * pollendo un mapa que nadie mira.
 */
export function usePosicionesEnVivo(token: string | null) {
  return useQuery<PosicionEnVivo[]>({
    queryKey: ['en-vivo', 'posiciones-todas'],
    enabled: Boolean(token),
    queryFn: () => enVivoApi.posicionesTodas(token as string),
    refetchInterval: INTERVALO_POLL_POSICIONES_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: REINTENTOS,
    retryDelay,
  });
}

/**
 * Contexto de la sesión: `staleTime: Infinity` porque la geometría de la ruta son cientos de
 * vértices — reenviarla en cada poll sería ~90 % del payload y 0 % de información nueva. El
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
      // `limite: TRAZA_EN_VIVO_LIMITE_MAX` (no el default) es obligatorio acá: una jornada Z12
      // completa puede rondar 30.000-43.000 puntos con el `distanceFilter` de 15 m del móvil
      // (ver el comentario de `TRAZA_EN_VIVO_LIMITE_MAX` en `@quivo/shared`), así que sin el
      // `limite` explícito el server trunca esta respuesta igual que el delta normal,
      // `fusionarTraza(undefined, completa)` descarta la traza acumulada y la reemplaza por
      // los primeros `TRAZA_EN_VIVO_LIMITE_DEFAULT` puntos (la polilínea rebobina a la
      // mañana), y la respuesta trunca sigue trayendo `hayMas: true` — con lo que
      // `recargaFallida` nunca se marca (ver abajo) y el ciclo de recarga completa se repite
      // sin fin.
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
      // creciendo de verdad en cada poll) siga disparando una recarga completa en cada poll.
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

/**
 * Release 13 — panel "Jornada de hoy": quién declaró "Empezar día", quién está en ruta y
 * quién no inició. Sin `fecha`: el servidor decide la jornada vigente (el día boliviano
 * rota a medianoche de Bolivia, 04:00 UTC), así que la pestaña abierta de madrugada cambia de día sola en el
 * siguiente poll. 30 s alcanza — la declaración es un evento humano, no telemetría. Mismo
 * criterio de pestaña oculta/foco que el resto de los hooks de esta pantalla.
 */
export function useJornadasHoy(token: string | null) {
  return useQuery<JornadasDelDia>({
    queryKey: ['en-vivo', 'jornadas'],
    enabled: Boolean(token),
    queryFn: () => reportesApi.jornadas(token as string),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: REINTENTOS,
    retryDelay,
  });
}

/**
 * PR E (`docs/plan-en-vivo-alertas.md`) — infracciones de la sesión con el panel abierto
 * (`GET /reportes/en-vivo/:sesionId/infracciones`). Se refresca al ritmo del poll de la traza
 * de ESA sesión (`intervaloPoll` sobre la cache de `useTrazaEnVivo`: más lento en reporte
 * normal y `false` —pausado— cuando la traza también lo está): son datos que cambian al ritmo
 * del worker de ingesta, no de la telemetría. Las mutaciones invalidan esta key y la de
 * posiciones.
 */
export function useInfraccionesSesion(token: string | null, sesionId: string | null) {
  const queryClient = useQueryClient();
  return useQuery<Infraccion[]>({
    queryKey: ['en-vivo', 'infracciones', sesionId],
    enabled: Boolean(token && sesionId),
    queryFn: () => infraccionesApi.listarPorSesion(token as string, sesionId as string),
    refetchInterval: () => {
      const intervalo = intervaloPoll(queryClient.getQueryData<TrazaAcumulada>(['en-vivo', 'traza', sesionId]));
      // El catch-up de la traza (1 s) no aplica a las infracciones: piso en la cadencia normal.
      return intervalo === false ? false : Math.max(intervalo, INTERVALO_POLL_MS);
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: REINTENTOS,
    retryDelay,
  });
}

/** Cadencia del HUD de Molinos: cambia al ritmo de los envíos (minutos), no de la telemetría. */
export const INTERVALO_POLL_MOLINOS_MS = 15_000;

/**
 * `GET /reportes/en-vivo/molinos` — resumen por línea (en espera, último envío, próximo sugerido).
 * Poll lento y aparte del de posiciones: agrega por línea/día. Mismo criterio de pestaña oculta.
 */
export function useMolinosResumen(token: string | null) {
  return useQuery<MolinosResumen>({
    queryKey: ['en-vivo', 'molinos'],
    enabled: Boolean(token),
    queryFn: () => enVivoApi.molinos(token as string),
    refetchInterval: INTERVALO_POLL_MOLINOS_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: REINTENTOS,
    retryDelay,
  });
}

/**
 * Variantes de la ruta de la sesión (las que tienen punto de espera son las designables) y los
 * puntos de control de esa ruta (para los minutos de espera). Cambian solo si un admin edita la
 * ruta: `staleTime` largo. Si fallan, el panel degrada (sin control de designación / 30 min).
 */
export function useOpcionesDesignacion(token: string | null, rutaId: string | null) {
  const variantes = useQuery<Variante[]>({
    queryKey: ['en-vivo', 'variantes', rutaId],
    enabled: Boolean(token && rutaId),
    queryFn: () => variantesApi.listarPorRuta(token as string, rutaId as string),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: REINTENTOS,
    retryDelay,
  });
  const puntos = useQuery<PuntoControl[]>({
    queryKey: ['en-vivo', 'puntos-control', rutaId],
    enabled: Boolean(token && rutaId),
    queryFn: () => puntosControlApi.listarPorRuta(token as string, rutaId as string),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: REINTENTOS,
    retryDelay,
  });
  return { variantes, puntos };
}

export interface DesignarVars {
  sesionId: string;
  varianteId: string | null;
  varianteNombre: string | null;
}

/**
 * Designa (o cancela) la vuelta en curso. Optimista sobre la caché de posiciones (el control
 * responde al instante) con rollback si la API rechaza (409 con motivo en español); al terminar,
 * `invalidate` trae la verdad del servidor. `onError` lo maneja el panel (mensaje + aviso).
 */
export function useDesignarVuelta(token: string | null) {
  const queryClient = useQueryClient();
  const key = ['en-vivo', 'posiciones-todas'];
  return useMutation({
    mutationFn: (v: DesignarVars) => enVivoApi.designarVuelta(token as string, v.sesionId, v.varianteId),
    onMutate: async (v) => {
      // Un poll en vuelo pisaría el cambio optimista con datos previos a la designación.
      await queryClient.cancelQueries({ queryKey: key });
      const previo = queryClient.getQueryData<PosicionEnVivo[]>(key);
      const ahoraIso = new Date().toISOString();
      queryClient.setQueryData<PosicionEnVivo[]>(key, (cur) =>
        cur?.map((p) => (p.id === v.sesionId ? aplicarDesignacion(p, v.varianteId, v.varianteNombre, ahoraIso) : p)),
      );
      return { previo };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.previo) queryClient.setQueryData(key, ctx.previo);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['en-vivo', 'molinos'] });
    },
  });
}
