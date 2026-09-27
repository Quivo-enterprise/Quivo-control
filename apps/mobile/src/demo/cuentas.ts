import type { ContextoOperativoMovil } from '@quivo/shared';
import { normalizarPlacaVehiculo } from '@quivo/shared';
import { LINEAS_MOCK, TRUFIS_MOCK } from './datos/datos';
import type { LineaMockId } from './datos/tipos';

/**
 * Cuentas jugables del APK demo (`docs/plan-apk-demo-conductor.md`) — login = placa (de una de
 * las 2 unidades JUGABLES) + PIN de un conductor asignado a esa placa. Cada placa jugable tiene
 * DOS conductores (PINs distintos) para poder mostrar "cambio de conductor en el mismo
 * vehículo" en el guion (E06 03:42: Perfil → Cerrar sesión → loguear con el otro PIN).
 *
 * Unidades elegidas (plan): la Z12 en 3ª posición de 5 en el orden de salida (`trufi-z12-3`,
 * placa `4521-BQP`) y la Línea 120 en 2ª de 3 (`trufi-l120-2`, placa `6248-GNS`) — así el motor
 * (`./motor.ts`) siempre arranca con una unidad ADELANTE ya en ruta.
 *
 * PINs: `PinMovilSchema` (`@quivo/shared`) exige 6-12 dígitos — el guion de grabación real usa
 * `111111`/`222222` (no los `1111`/`2222` de 4 dígitos del plan original, que no pasarían la
 * misma validación que usa `VehicleLoginScreen` en el login real).
 */
export interface CuentaDemo {
  trufiId: string;
  placaNormalizada: string;
  pin: string;
  conductorId: string;
  conductorNombre: string;
  documentoIdentidad: string;
}

/** Unidades jugables (una por línea) — únicos `trufiId` que aceptan login en modo demo. */
export const TRUFIS_JUGABLES_DEMO: Record<LineaMockId, string> = {
  z12: 'trufi-z12-3',
  l120: 'trufi-l120-2',
};

export const CUENTAS_DEMO: CuentaDemo[] = [
  {
    trufiId: 'trufi-z12-3',
    placaNormalizada: normalizarPlacaVehiculo('4521-BQP'),
    pin: '111111',
    conductorId: 'conductor-demo-z12-a',
    conductorNombre: 'Freddy Choque',
    documentoIdentidad: '7451236 CBB',
  },
  {
    trufiId: 'trufi-z12-3',
    placaNormalizada: normalizarPlacaVehiculo('4521-BQP'),
    pin: '222222',
    conductorId: 'conductor-demo-z12-b',
    conductorNombre: 'Norma Villca',
    documentoIdentidad: '6893214 CBB',
  },
  {
    trufiId: 'trufi-l120-2',
    placaNormalizada: normalizarPlacaVehiculo('6248-GNS'),
    pin: '111111',
    conductorId: 'conductor-demo-l120-a',
    conductorNombre: 'Hugo Rocha',
    documentoIdentidad: '5127843 CBB',
  },
  {
    trufiId: 'trufi-l120-2',
    placaNormalizada: normalizarPlacaVehiculo('6248-GNS'),
    pin: '222222',
    conductorId: 'conductor-demo-l120-b',
    conductorNombre: 'Ruth Mamani',
    documentoIdentidad: '8342167 CBB',
  },
];

/** Sindicato ficticio, genérico a propósito (no corresponde a ningún sindicato real). */
const SINDICATO_DEMO = { id: '00000000-0000-4000-8000-000000000001', nombre: 'Sindicato Mixto de Transporte Valle Alto' };

/** Busca una cuenta por placa (case/espacios/guiones-insensitive, igual que el login real —
 * ver `normalizarPlacaVehiculo`) + PIN exacto. `null` si no matchea ninguna (placa no jugable o
 * PIN incorrecto) — el caller (`use-auth-movil-demo.ts`) muestra el mismo mensaje de error que
 * el login real en ambos casos, sin distinguir cuál fue, por seguridad (igual que el backend
 * real no distingue "placa no existe" de "PIN incorrecto" en el mensaje al usuario). */
export function buscarCuenta(placa: string, pin: string): CuentaDemo | null {
  const placaNormalizada = normalizarPlacaVehiculo(placa);
  return CUENTAS_DEMO.find((c) => c.placaNormalizada === placaNormalizada && c.pin === pin) ?? null;
}

/** Inversa de `contextoDeCuenta`: recupera el `trufiId` propio a partir de la placa del
 * `ContextoOperativoMovil` ya logueado — lo usa `App.tsx` para saber con qué `trufiPropioId`
 * montar `<DemoProvider>` (que no tiene acceso directo a `CuentaDemo`, solo al `contexto` que
 * ya restauró/devolvió `useAuthMovilDemo`). Cae a la unidad jugable de Z12 si por algún motivo
 * la placa no matchea ninguna cuenta conocida (no debería pasar: el contexto siempre sale de
 * `contextoDeCuenta` sobre una `CuentaDemo` real) — mejor una unidad jugable de más que un
 * crash. */
export function trufiIdDesdeContexto(contexto: ContextoOperativoMovil): string {
  const placaNormalizada = normalizarPlacaVehiculo(contexto.vehiculo.placa);
  const cuenta = CUENTAS_DEMO.find((c) => c.placaNormalizada === placaNormalizada);
  return cuenta?.trufiId ?? TRUFIS_JUGABLES_DEMO.z12;
}

let contadorSesionDemo = 0;
let contadorAsignacionDemo = 0;
let contadorVehiculoDemo = 0;

/**
 * cyrb128 — hash determinístico de 128 bits (4 × 32 bits) de un string arbitrario. Variante
 * estándar de dominio público (bryc/code). Usado por `uuidDemo` de abajo para mezclar TODOS los
 * caracteres de la semilla en el resultado — a diferencia de una conversión char-a-char truncada
 * a los primeros 16 caracteres (el bug que reemplaza, ver el docblock de `uuidDemo`), acá dos
 * semillas que difieren en CUALQUIER posición producen salidas distintas.
 */
function cyrb128(semilla: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < semilla.length; i += 1) {
    const k = semilla.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * UUID v4-shaped determinístico a partir de `semilla` — no hace falta que sea un UUID
 * criptográficamente aleatorio (nada en el motor demo lo usa como tal), pero mantener la FORMA
 * (`xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx`) evita sorpresas si algo llega a validarlo con
 * `uuidSchema` (`z.string().uuid()`, `@quivo/shared`, zod 3). Determinístico (no `Math.random`)
 * para que debuggear un estado demo sea reproducible. Exportada porque `use-paquete-dia-demo.ts`
 * la reusa para que los ids de `linea`/`ruta` del paquete del día coincidan con los del
 * `ContextoOperativoMovil` armado acá (misma `semilla` ⇒ mismo id).
 *
 * FIX POST-REVISIÓN (hallazgo de revisión): la versión anterior codificaba `semilla` char a char
 * y la truncaba a los primeros 16 caracteres (`padEnd(32, '0').slice(0, 32)` son 32 hex = 16
 * bytes = 16 chars de la semilla) — dos semillas que solo divergían DESPUÉS del carácter 16
 * colisionaban en el mismo id. Caso real: `idParadaDemo('l120', 'parada-san-sebastian')` y
 * `idParadaDemo('l120', 'parada-uyustus')` comparten el prefijo `'punto-l120-parad'` (16 chars) y
 * producían el MISMO id — dos puntos de control distintos de la misma línea, indistinguibles
 * entre sí. Con `contadorSesionDemo` reseteado a 1 (reinicio de app/hot reload), todos los
 * `sesionId` también colisionaban, porque `'sesion-1-conductor-demo-'` ya ocupa los primeros 16
 * caracteres para CUALQUIER conductor. `cyrb128` (arriba) hashea la semilla ENTERA, así que ya no
 * hay ningún prefijo compartido que pueda truncarse.
 */
export function uuidDemo(semilla: string): string {
  const hex = cyrb128(semilla)
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * UUID demo de una parada/punto de control — el MISMO id para una `paradaId` (slug corto del
 * mock, p. ej. `'villa-armonia'`) se usa tanto en `paradas[].id` como en `puntosControl[].id`
 * del `PaqueteDia` armado por `use-paquete-dia-demo.ts`, Y en `puntoControlId` de la
 * `DeteccionPuntoControl` que expone `use-gps-operativo-demo.ts` al cruzar ese punto — así el
 * toast/contador de puntos cumplidos existentes (`operation-screen.tsx`, sin cambios) matchean
 * la detección contra la lista del paquete exactamente como lo harían con datos reales.
 */
export function idParadaDemo(lineaId: LineaMockId, paradaId: string): string {
  return uuidDemo(`punto-${lineaId}-${paradaId}`);
}

/**
 * Arma el `ContextoOperativoMovil` completo de una cuenta demo — mismo contrato que la
 * respuesta real de `POST /v1/mobile/auth/sesion` (`ContextoOperativoMovilSchema`,
 * `packages/shared/src/auth/mobile.ts`), con datos de `LINEAS_MOCK`/`TRUFIS_MOCK`. `horaSalida`
 * queda `null` a propósito: el horario real de salida de la unidad propia vive en el motor
 * (`proximaSalidaDe`, `./motor.ts`) mientras está en cola — hardcodear un valor acá se
 * desincronizaría del horario que el motor calcula en vivo.
 */
export function contextoDeCuenta(cuenta: CuentaDemo, ahora: number): ContextoOperativoMovil {
  const trufi = TRUFIS_MOCK.find((t) => t.id === cuenta.trufiId);
  if (!trufi) {
    throw new Error(`contextoDeCuenta: trufi desconocido "${cuenta.trufiId}"`);
  }
  const linea = LINEAS_MOCK[trufi.lineaId];
  const fecha = new Date(ahora).toISOString().slice(0, 10);

  contadorSesionDemo += 1;
  contadorAsignacionDemo += 1;
  contadorVehiculoDemo += 1;

  return {
    sesionId: uuidDemo(`sesion-${contadorSesionDemo}-${cuenta.conductorId}`),
    asignacion: {
      id: uuidDemo(`asignacion-${contadorAsignacionDemo}-${cuenta.conductorId}`),
      fecha,
      horario: 'manana',
      horaSalida: null,
      horaPresentacion: null,
      venceAt: new Date(ahora + 24 * 60 * 60 * 1000).toISOString(),
    },
    vehiculo: {
      id: uuidDemo(`vehiculo-${contadorVehiculoDemo}-${trufi.id}`),
      placa: trufi.placa,
      tipo: 'trufi',
      marca: 'Toyota',
      modelo: 'Hiace',
      numeroInterno: trufi.numeroInterno,
      distintivo: null,
      cartelSuperior: null,
    },
    conductor: {
      id: cuenta.conductorId,
      nombre: cuenta.conductorNombre,
      documentoIdentidad: cuenta.documentoIdentidad,
    },
    sindicato: SINDICATO_DEMO,
    linea: {
      id: uuidDemo(`linea-${trufi.lineaId}`),
      codigo: linea.nombre,
      nombre: linea.nombre,
      color: linea.color,
      colorSecundario: null,
      // La 120 tiene fondo blanco (`linea.color`) — un texto oscuro asegura contraste legible;
      // la Z12 (azul) usa el texto claro por defecto de la marca real.
      colorTexto: trufi.lineaId === 'l120' ? '#0F1B5C' : '#ffffff',
      colorTerciario: null,
      colorFondo: trufi.lineaId === 'l120' ? '#ffffff' : null,
      nombreCorto: linea.nombre,
      lema: 'Puntual, todos los días',
      logoUrl: null,
      distintivoTipo: 'numero',
      distintivoValor: linea.nombre,
      cartelSuperior: linea.nombre,
    },
    ruta: {
      id: uuidDemo(`ruta-${trufi.lineaId}`),
      sentido: trufi.lineaId === 'z12' ? 'Circuito Villa Armonía' : 'Plaza Colón ⇄ La Cancha',
    },
  };
}
