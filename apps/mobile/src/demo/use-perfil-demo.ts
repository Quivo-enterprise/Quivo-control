import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ContextoOperativoMovil } from '@quivo/shared';
import type { usePerfilQuery } from '../features/perfil/use-perfil-query';

/**
 * Store de perfil demo (foto + teléfono), persistido en AsyncStorage POR CONDUCTOR (namespaced
 * por `conductorId` — `cuentas.ts` le da un id distinto a cada uno de los 2 conductores por
 * placa jugable, así "cambio de conductor en el mismo vehículo" también cambia la foto/teléfono
 * mostrados). No existe en el contrato real (`ContextoOperativoMovil` no lleva foto/teléfono
 * hoy) — es una pieza NUEVA que B/C consumen directo, sin equivalente real que swappear.
 *
 * FIX POST-REVISIÓN (hallazgo de revisión): antes `usePerfilDemo` era un `useState` local — cada
 * instancia montada (`AvatarPerfilDemo`, `TelefonoRow`, la tarjeta de identidad de la pantalla de
 * operación) tenía su PROPIA copia de `datos`, sin enterarse de lo que guardaban las demás. Como
 * `persistir` escribía `{ ...datos, ...cambio }` usando esa copia local (potencialmente vieja),
 * guardar el teléfono en `TelefonoRow` DESPUÉS de subir una foto en `AvatarPerfilDemo` pisaba el
 * registro completo de AsyncStorage con `{ telefono, foto: undefined }` — la foto recién subida
 * desaparecía sin ningún error visible. Y aunque no se perdiera nada, la tarjeta de identidad de
 * `operation-screen.tsx` (otra instancia de este mismo hook) nunca se enteraba de una foto nueva
 * sin desmontarse y remontarse.
 *
 * Ahora es un store a nivel de MÓDULO — un único caché en memoria + un único set de listeners
 * POR `conductorId`, expuesto vía `useSyncExternalStore` — así todas las instancias leen y
 * escriben el MISMO registro:
 *   - se carga de AsyncStorage una sola vez por conductor (`cargarSiHaceFalta`, con una promesa
 *     compartida para que dos instancias que montan a la vez no disparen 2 lecturas);
 *   - cada guardado (`persistirMerge`) mergea sobre la versión MÁS RECIENTE del caché — nunca
 *     sobre un closure de React que puede haber quedado desactualizado — y notifica a TODOS los
 *     suscriptores de ese conductor antes de persistir, así el nuevo valor se ve de inmediato en
 *     cualquier pantalla montada.
 */

interface PerfilDemoGuardado {
  foto?: string;
  telefono?: string;
}

const REGISTRO_VACIO: PerfilDemoGuardado = Object.freeze({});

function clavePerfilDemo(conductorId: string): string {
  return `quivo.demo.perfil.${conductorId}.v1`;
}

/** Última versión conocida de cada conductor — compartida por TODAS las instancias de
 * `usePerfilDemo` del árbol. */
const cache = new Map<string, PerfilDemoGuardado>();
/** Listeners de `useSyncExternalStore`, por `conductorId` — notificar solo a los suscriptores de
 * ESE conductor, nunca al árbol completo. */
const listeners = new Map<string, Set<() => void>>();
/** Evita disparar más de una lectura de AsyncStorage por conductor aunque varias instancias se
 * monten a la vez (p. ej. `AvatarPerfilDemo` y `TelefonoRow` montan juntas en el primer render de
 * `PerfilScreen`) — todas esperan la MISMA promesa. */
const cargasEnCurso = new Map<string, Promise<void>>();
/** `conductorId` ya cargados de AsyncStorage al menos una vez — antes de esto, `cargando` es
 * `true` para cualquier instancia nueva de ese conductor. */
const cargados = new Set<string>();

function notificar(conductorId: string): void {
  listeners.get(conductorId)?.forEach((listener) => listener());
}

function suscribir(conductorId: string, listener: () => void): () => void {
  let suscriptores = listeners.get(conductorId);
  if (!suscriptores) {
    suscriptores = new Set();
    listeners.set(conductorId, suscriptores);
  }
  suscriptores.add(listener);
  return () => {
    suscriptores!.delete(listener);
    if (suscriptores!.size === 0) listeners.delete(conductorId);
  };
}

function snapshotDatos(conductorId: string): PerfilDemoGuardado {
  return cache.get(conductorId) ?? REGISTRO_VACIO;
}

function snapshotCargando(conductorId: string): boolean {
  return !cargados.has(conductorId);
}

function cargarSiHaceFalta(conductorId: string): Promise<void> {
  if (cargados.has(conductorId)) return Promise.resolve();
  const enCurso = cargasEnCurso.get(conductorId);
  if (enCurso) return enCurso;

  const promesa = (async () => {
    try {
      const guardado = await AsyncStorage.getItem(clavePerfilDemo(conductorId));
      cache.set(conductorId, guardado ? (JSON.parse(guardado) as PerfilDemoGuardado) : {});
    } catch {
      cache.set(conductorId, {});
    } finally {
      cargados.add(conductorId);
      cargasEnCurso.delete(conductorId);
      notificar(conductorId);
    }
  })();
  cargasEnCurso.set(conductorId, promesa);
  return promesa;
}

/** Mergea `cambio` sobre la versión MÁS RECIENTE del caché (nunca sobre un closure de React que
 * puede estar desactualizado) — la clave del fix: un guardado desde `AvatarPerfilDemo` seguido de
 * otro desde `TelefonoRow` componen sobre el MISMO registro en vez de pisarse. Notifica ANTES de
 * persistir para que la UI refleje el cambio de inmediato — el `await` de AsyncStorage no bloquea
 * la lectura en memoria, que ya es la fuente de verdad para el resto del árbol. */
async function persistirMerge(conductorId: string, cambio: Partial<PerfilDemoGuardado>): Promise<void> {
  const siguiente: PerfilDemoGuardado = { ...snapshotDatos(conductorId), ...cambio };
  cache.set(conductorId, siguiente);
  notificar(conductorId);
  await AsyncStorage.setItem(clavePerfilDemo(conductorId), JSON.stringify(siguiente));
}

export interface UsePerfilDemoResultado {
  /** Data URI (`data:image/...;base64,...`) de la foto de perfil, o `undefined` si el
   * conductor todavía no subió ninguna. */
  foto?: string;
  telefono?: string;
  guardarFoto: (dataUri: string) => Promise<void>;
  guardarTelefono: (telefono: string) => Promise<void>;
  cargando: boolean;
}

export function usePerfilDemo(conductorId: string): UsePerfilDemoResultado {
  const suscribirConductor = useCallback(
    (listener: () => void) => suscribir(conductorId, listener),
    [conductorId],
  );
  const datos = useSyncExternalStore(
    suscribirConductor,
    () => snapshotDatos(conductorId),
    () => REGISTRO_VACIO,
  );
  const cargando = useSyncExternalStore(
    suscribirConductor,
    () => snapshotCargando(conductorId),
    () => true,
  );

  useEffect(() => {
    void cargarSiHaceFalta(conductorId);
  }, [conductorId]);

  const guardarFoto = useCallback(
    (dataUri: string) => persistirMerge(conductorId, { foto: dataUri }),
    [conductorId],
  );
  const guardarTelefono = useCallback(
    (telefono: string) => persistirMerge(conductorId, { telefono }),
    [conductorId],
  );

  return { foto: datos.foto, telefono: datos.telefono, guardarFoto, guardarTelefono, cargando };
}

/**
 * Equivalente demo de `usePerfilQuery` (`../features/perfil/use-perfil-query.ts`) — mismo
 * contrato (`ReturnType<typeof usePerfilQuery>`, un `UseQueryResult<ContextoOperativoMovil>` de
 * `@tanstack/react-query`, construido con el mismo hook real en vez de simularlo a mano). El
 * demo no tiene nada que refetchear (`contextoInicial` ya es toda la verdad, no cambia salvo un
 * login nuevo) — `queryFn` simplemente lo devuelve tal cual, con `staleTime: Infinity` para que
 * react-query nunca dispare un refetch de fondo.
 */
export function usePerfilQueryDemo(
  contextoInicial: ContextoOperativoMovil,
  _obtenerAccessToken: () => Promise<string | null>,
): ReturnType<typeof usePerfilQuery> {
  return useQuery({
    queryKey: ['perfil-demo', contextoInicial.sesionId],
    queryFn: async () => contextoInicial,
    initialData: contextoInicial,
    staleTime: Infinity,
  });
}
