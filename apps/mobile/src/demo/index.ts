/**
 * ============================================================================================
 * CONTRATO PÚBLICO del núcleo demo (`docs/plan-apk-demo-conductor.md`, paso A).
 * ============================================================================================
 *
 * Con `EXPO_PUBLIC_MOCK_DEMO=true` (`MODO_DEMO`, `./flag.ts`) la app corre 100% offline con
 * datos mock — sin backend, sin SDK de geolocalización en segundo plano. Sin el flag, todo lo
 * de acá queda sin usar y el comportamiento real no cambia (los puntos de swap en `App.tsx`,
 * `gps-provider.tsx` y `perfil-screen.tsx` eligen la implementación a nivel de MÓDULO, nunca
 * dentro de un componente).
 *
 * Lo que expone este módulo, para que los pasos B/C (UI) construyan encima sin tener que leer
 * `motor.ts` entero:
 *
 * — Datos (`./datos/`): `LINEAS_MOCK`, `TRUFIS_MOCK` (port 1:1 de
 *   `apps/web/src/lib/mock-flota` — mantener sincronizado) y `FOTOS_TRUFI` (miniaturas 96×96
 *   en base64, generadas por `scripts/generar-fotos-demo.mjs`).
 *
 * — Cuentas (`./cuentas.ts`): `CUENTAS_DEMO`, `buscarCuenta(placa, pin)`,
 *   `contextoDeCuenta(cuenta, ahora)`, `trufiIdDesdeContexto(contexto)`. 2 placas jugables
 *   (`TRUFIS_JUGABLES_DEMO`: Z12 3ª de 5, Línea 120 2ª de 3), cada una con 2 conductores (PIN
 *   `111111`/`222222`) para simular cambio de conductor en el mismo vehículo.
 *
 * — Motor (`./motor.ts`): reducer PURO con reloj inyectado. Tipos: `EstadoMotorDemo`,
 *   `UnidadDemo`, `VecinoDemo`, `PosicionDemo`, `VehiculoMapaDemo`, `TipoReporteDemo` (+
 *   `ETIQUETAS_TIPO_REPORTE_DEMO`). Acciones puras: `crearEstadoInicial`, `tick`,
 *   `iniciarJornada`, `finalizarJornada`, `perderSenal`, `recuperarSenal`, `alternarVelocidad`,
 *   `saltarAlProximoPunto`, `acercarAdelante`, `crearReporte`, `reiniciar`. Selectores:
 *   `adelanteAtras`, `colaDe`, `proximaSalidaDe`, `posicionDe`, `otrosVehiculos`.
 *
 * — Provider (`./demo-provider.tsx`): `<DemoProvider trufiPropioId={...}>` (tick de 1 s real,
 *   escalado por `estado.velocidadDemo`) + `useDemo()` → `{ estado, acciones, adelanteAtras,
 *   colaPropia, posicionPropia, proximaSalidaPropia, otrosVehiculosLineaPropia }`.
 *
 * — Hooks mock, MISMO contrato que sus pares reales (tipados con `ReturnType<typeof ...>` del
 *   hook real correspondiente, para que un cambio en el contrato real rompa el build acá en vez
 *   de divergir en silencio):
 *     · `useAuthMovilDemo()`      ≙ `useAuthMovil()` (`features/auth/use-auth-movil.ts`)
 *     · `usePaqueteDiaDemo(fn)`   ≙ `usePaqueteDia(fn)` (`features/operacion/use-paquete-dia.ts`)
 *     · `useGpsOperativoDemo(...)` ≙ `useGpsOperativo(...)` (`features/operacion/use-gps-operativo.ts`)
 *       — nunca importa el SDK nativo de geolocalización en segundo plano, ni directa ni
 *       transitivamente (solo `import type` de los módulos reales que sí lo hacen).
 *     · `usePerfilQueryDemo(contexto, fn)` ≙ `usePerfilQuery(contexto, fn)`
 *       (`features/perfil/use-perfil-query.ts`)
 *     · `usePerfilDemo(conductorId)` — SIN equivalente real (foto/teléfono no existen hoy en
 *       `ContextoOperativoMovil`): `{ foto?, telefono?, guardarFoto, guardarTelefono, cargando }`,
 *       persistido en AsyncStorage por conductor.
 *
 * Ver cada archivo para el detalle — este barrel solo re-exporta, no agrega lógica.
 * ============================================================================================
 */

export { MODO_DEMO } from './flag';

export { LINEAS_MOCK, TRUFIS_MOCK } from './datos/datos';
export { FOTOS_TRUFI } from './datos/fotos.generated';
export type { LineaMock, LineaMockId, ParadaMock, TrufiMock } from './datos/tipos';

export {
  buscarCuenta,
  contextoDeCuenta,
  CUENTAS_DEMO,
  idParadaDemo,
  trufiIdDesdeContexto,
  TRUFIS_JUGABLES_DEMO,
  uuidDemo,
} from './cuentas';
export type { CuentaDemo } from './cuentas';

export {
  acercarAdelante,
  adelanteAtras,
  alternarVelocidad,
  colaDe,
  crearEstadoInicial,
  crearReporte,
  DATOS_HOY_BASE_MB,
  ETIQUETAS_TIPO_REPORTE_DEMO,
  finalizarJornada,
  FRECUENCIA_MS,
  iniciarJornada,
  MB_POR_PUNTO,
  otrosVehiculos,
  perderSenal,
  posicionDe,
  proximaSalidaDe,
  recuperarSenal,
  reiniciar,
  saltarAlProximoPunto,
  tick,
  VELOCIDAD_NOMINAL_KMH,
} from './motor';
export type {
  DeteccionPuntoControlDemo,
  EstadoMotorDemo,
  EstadoSenalDemo,
  FaseUnidadDemo,
  PosicionDemo,
  ReporteDemo,
  TipoReporteDemo,
  UnidadDemo,
  VecinoDemo,
  VehiculoMapaDemo,
} from './motor';

export { DemoProvider, useDemo } from './demo-provider';
export type { AccionesDemo, UseDemoResultado } from './demo-provider';

export { useAuthMovilDemo } from './use-auth-movil-demo';
export { usePaqueteDiaDemo, construirPaqueteDiaDemo } from './use-paquete-dia-demo';
export { useGpsOperativoDemo } from './use-gps-operativo-demo';
export { usePerfilDemo, usePerfilQueryDemo } from './use-perfil-demo';
export type { UsePerfilDemoResultado } from './use-perfil-demo';
