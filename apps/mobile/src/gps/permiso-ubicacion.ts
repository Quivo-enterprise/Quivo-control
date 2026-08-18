/**
 * Máquina de decisión PURA del flujo de permisos de ubicación para "Iniciar recorrido"
 * (QUI-338). Reportado desde la calle: un conductor con Samsung Galaxy A71 (Android 10-13)
 * inició sesión sin problema pero no pudo arrancar el recorrido — la app nunca pedía el
 * permiso de forma explícita (quedaba delegado al efecto colateral de
 * `BackgroundGeolocation.ready()`/`start()`, que en Android 14+/targetSdk 34+ puede tirar
 * `SecurityException` en vez de simplemente no arrancar), y el botón "Iniciar recorrido"
 * seguía habilitado aunque no hubiera permiso, así que tocarlo no hacía nada.
 *
 * Este módulo decide, a partir del estado real reportado por
 * `BackgroundGeolocation.getProviderState()` (servicio de ubicación del sistema + estado del
 * permiso) y `requestPermission()` (pedido explícito), qué mensaje mostrarle al conductor y
 * qué acción ofrecerle — ANTES de intentar `ready()`/`start()`, en vez de intentar y fallar.
 *
 * Sin dependencias de React Native ni del SDK nativo: testeable en Node/vitest, mismo patrón
 * que `geofence.ts`/`battery-gap-monitor.ts`/`location-task.ts` (ver sus comentarios de
 * cabecera). El estado nativo (`use-gps-operativo.ts`) llama a este módulo pasándole números
 * planos, no objetos del SDK.
 *
 * Los valores de `estadoPermiso` son los de `AuthorizationStatus`, verificados contra
 * `node_modules/.pnpm/@transistorsoft+background-geolocation-types@5.2.2/.../dist/enums/
 * AuthorizationStatus.d.ts` (versión instalada del SDK, 5.4.0 de
 * `react-native-background-geolocation`): NotDetermined=0, Restricted=1, Denied=2, Always=3,
 * WhenInUse=4. Redeclarados acá como constantes propias (en vez de importar el enum) para que
 * este módulo no dependa en runtime del paquete nativo.
 *
 * ## Semántica por plataforma — CRÍTICO, causa raíz del hallazgo CRÍTICO de la revisión previa
 *
 * `node_modules/.pnpm/react-native-background-geolocation@5.4.0/.../declarations/interfaces/
 * ProviderChangeEvent.d.ts` documenta, en la tabla de `status` y en su nota, que
 * `NotDetermined` (0), `Restricted` (1) y `WhenInUse` (4) son **exclusivos de iOS**. En
 * Android el propio `.d.ts` lo dice explícito: *"When Android location permission is
 * **granted**, `status` == `ALWAYS` (3), **otherwise** `DENIED` (2)"* — es decir, en Android
 * el SDK solo reporta dos valores posibles, y `DENIED` cubre TANTO "nunca se pidió" COMO
 * "el conductor lo denegó" COMO "concedió solo mientras se usa la app". Una lectura pasiva de
 * `status` en Android **no puede distinguir esos tres casos entre sí** — hace falta contexto
 * adicional (`permisoYaSolicitado`, más abajo) para no tratar una instalación nueva como si ya
 * hubiera sido rechazada.
 *
 * Por eso `decidirPermisoGps` recibe `plataforma` (para ramificar por la semántica real de
 * cada SO, no por una tabla de valores que solo es válida en iOS) y `permisoYaSolicitado`
 * (para que Android pueda reconstruir, con memoria entre sesiones, la distinción que el SDK no
 * expone).
 */

export const AUTORIZACION_NO_DETERMINADA = 0;
export const AUTORIZACION_RESTRINGIDA = 1;
export const AUTORIZACION_DENEGADA = 2;
export const AUTORIZACION_SIEMPRE = 3;
export const AUTORIZACION_MIENTRAS_SE_USA = 4;

export type EstadoPermisoGps =
  | 'listo'
  | 'no_solicitado'
  | 'servicio_desactivado'
  | 'permiso_denegado'
  | 'permiso_parcial'
  | 'error_nativo';

/**
 * Qué pantalla del sistema abrir cuando `accion` no es null:
 * - `ajustes_ubicacion_sistema`: el interruptor de ubicación (GPS) del TELÉFONO, no de la
 *   app — vive fuera de la pantalla de permisos de cualquier app.
 * - `ajustes_app`: la pantalla de permisos de QUIVO. En Android 11+ "Permitir todo el
 *   tiempo" NO se puede otorgar desde ningún diálogo del sistema — hay que ir a
 *   Ajustes → Apps → QUIVO → Permisos → Ubicación, y el SDK (`DeviceSettings`, ver
 *   `use-gps-operativo.ts`) no expone un atajo directo a esa pantalla, así que se usa
 *   `Linking.openSettings()` (deja al conductor a un toque de "Permisos").
 */
export type AccionPermisoGps = 'ajustes_ubicacion_sistema' | 'ajustes_app';

export interface DecisionPermisoGps {
  estado: EstadoPermisoGps;
  /** Si es `true`, "Iniciar recorrido" NO debe llamar a `ready()`/`start()`: hay que mostrar
   * `mensaje` (y, si `accion` no es null, ofrecerla) en su lugar. */
  bloqueante: boolean;
  /** Vacío cuando `bloqueante` es `false` (no hay nada que mostrarle al conductor). */
  titulo: string;
  mensaje: string;
  accion: AccionPermisoGps | null;
  /** Texto del botón de acción — el literal que muestra Android en su propia pantalla
   * ("Permitir todo el tiempo") cuando corresponde, para que el conductor reconozca qué
   * tocar del otro lado. `null` cuando `accion` es null. */
  etiquetaAccion: string | null;
}

export interface EntradaDecisionPermisoGps {
  /** `getProviderState().enabled` — el servicio de ubicación del SISTEMA (el GPS del
   * teléfono está prendido), NO el permiso otorgado a la app. */
  servicioUbicacionActivo: boolean;
  /** `getProviderState().status`, o el valor que devuelve `requestPermission()` tras el
   * pedido explícito. `null` representa que ni siquiera se pudo consultar/pedir: el módulo
   * nativo tiró una excepción por otro motivo (licencia de Transistorsoft vencida/inválida,
   * Google Play Services ausente o desactualizado, etc.) — un caso DISTINTO de los tres de
   * permiso/servicio, con su propio mensaje genérico pero etiquetado aparte. */
  estadoPermiso: number | null;
  /** `Platform.OS` reducido a las dos plataformas que el SDK distingue en su semántica de
   * `status` (ver el comentario de cabecera). Cualquier valor que no sea `'ios'` se trata
   * como Android — hoy la app solo builds para Android (`app.config.ts`, `platforms:
   * ['android']`), pero el módulo modela ambas porque el propio SDK expone valores de las
   * dos y este archivo es el único lugar que decide qué significan. */
  plataforma: 'android' | 'ios';
  /**
   * `true` si esta app YA invocó `requestPermission()` explícitamente alguna vez en este
   * dispositivo (persistido entre sesiones — ver `use-gps-operativo.ts`). Es la única forma
   * de reconstruir, en Android, la distinción que `status` por sí solo no puede dar entre
   * "instalación nueva, nunca se preguntó" y "el conductor ya lo rechazó" — ambos leen
   * `DENIED`. En iOS no se usa para ramificar (ahí `NotDetermined` ya es una señal real y
   * distinguible), pero se acepta igual para no bifurcar la forma de llamar según plataforma.
   */
  permisoYaSolicitado: boolean;
}

/** Copy de "denegado" para Android — fusiona los dos casos que Android no puede distinguir
 * por lectura de estado (hallazgo de revisión BAJO #7): "nunca concedió nada" y "concedió
 * solo mientras se usa la app" leen el mismo `DENIED`. El texto sirve para los dos a la vez
 * (no asume cuál de los dos es, solo que falta "todo el tiempo") y termina siempre en la
 * MISMA instrucción accionable — que en Android 11+ es una de las tres opciones que el
 * conductor ve al entrar a Ajustes → Permisos → Ubicación en AMBOS casos, así que sirve como
 * CTA único. */
const MENSAJE_PERMISO_DENEGADO_ANDROID =
  'QUIVO necesita el permiso de ubicación "Todo el tiempo" para grabar el recorrido — no ' +
  'alcanza con permitirlo solo mientras usás la app, porque se corta al apagar la pantalla. ' +
  'Entrá a Ajustes de la app, tocá Permisos, Ubicación, y elegí "Permitir todo el tiempo".';

/** Copy de "denegado" para iOS: acá `status` SÍ distingue "solo mientras se usa la app"
 * (`permiso_parcial`, más abajo) de "denegado/restringido", así que este mensaje no necesita
 * cubrir el caso parcial — ese tiene el suyo propio. */
const MENSAJE_PERMISO_DENEGADO_IOS =
  'Sin este permiso no se puede grabar tu recorrido. Entrá a Ajustes de la app, tocá ' +
  'Permisos y en Ubicación elegí "Permitir todo el tiempo".';

export function decidirPermisoGps(entrada: EntradaDecisionPermisoGps): DecisionPermisoGps {
  const { servicioUbicacionActivo, estadoPermiso, plataforma, permisoYaSolicitado } = entrada;

  // Caso del brief: cualquier otro error del módulo nativo. Se chequea primero porque, si ni
  // siquiera se pudo determinar el estado, no hay forma confiable de ramificar por
  // servicio/permiso/plataforma — mejor un mensaje genérico y claramente etiquetado que uno
  // inventado.
  if (estadoPermiso === null) {
    return {
      estado: 'error_nativo',
      bloqueante: true,
      titulo: 'No se pudo activar el GPS',
      mensaje:
        'Hubo un problema para iniciar el registro de ubicación en este celular. Cerrá la ' +
        'app y volvé a abrirla. Si te vuelve a pasar, avisá a soporte con el modelo de tu ' +
        'celular.',
      accion: null,
      etiquetaAccion: null,
    };
  }

  // Caso del brief: el servicio de ubicación del sistema está apagado. Independiente de
  // plataforma: `enabled` es el GPS del teléfono, no el permiso de la app.
  if (!servicioUbicacionActivo) {
    return {
      estado: 'servicio_desactivado',
      bloqueante: true,
      titulo: 'Prendé la ubicación de tu celular',
      mensaje:
        'Para arrancar el recorrido, primero tenés que prender la ubicación (GPS) de tu ' +
        'celular. Deslizá la pantalla de arriba hacia abajo y tocá el ícono de Ubicación, o ' +
        'entrá a Ajustes.',
      accion: 'ajustes_ubicacion_sistema',
      etiquetaAccion: 'Abrir ajustes de ubicación',
    };
  }

  // `ALWAYS` es la ÚNICA señal positiva confiable en las dos plataformas (ver comentario de
  // cabecera) — se chequea antes de ramificar por plataforma porque, a diferencia de los
  // demás valores, este SÍ significa lo mismo en ambas.
  if (estadoPermiso === AUTORIZACION_SIEMPRE) {
    return {
      estado: 'listo',
      bloqueante: false,
      titulo: '',
      mensaje: '',
      accion: null,
      etiquetaAccion: null,
    };
  }

  if (plataforma === 'android') {
    // Android solo reporta ALWAYS (ya cubierto arriba) o DENIED en cualquier otro caso —
    // "nunca se pidió", "el conductor lo rechazó" y "solo mientras se usa la app" son
    // indistinguibles por lectura de `status` (ver comentario de cabecera). El valor RAW de
    // `estadoPermiso` más allá de "es ALWAYS o no" no aporta nada acá — lo único que puede
    // desambiguar es si esta app ya pidió el permiso explícitamente alguna vez.
    if (!permisoYaSolicitado) {
      // Instalación nueva (o el conductor todavía nunca tocó "Iniciar recorrido" en este
      // dispositivo): NO bloquea — es justo lo que tiene que disparar el pedido explícito de
      // `requestPermission()` en `iniciar()` (`use-gps-operativo.ts`). Tratarlo como
      // "denegado" dejaría el botón deshabilitado y el conductor nunca vería el diálogo del
      // sistema — la regresión que este módulo existe para no repetir.
      return {
        estado: 'no_solicitado',
        bloqueante: false,
        titulo: '',
        mensaje: '',
        accion: null,
        etiquetaAccion: null,
      };
    }
    // Ya hubo un pedido explícito y no quedó en ALWAYS: denegado de verdad (hallazgo BAJO #7,
    // mensaje fusionado — ver `MENSAJE_PERMISO_DENEGADO_ANDROID`).
    return {
      estado: 'permiso_denegado',
      bloqueante: true,
      titulo: 'QUIVO necesita tu ubicación',
      mensaje: MENSAJE_PERMISO_DENEGADO_ANDROID,
      accion: 'ajustes_app',
      etiquetaAccion: 'Cambiar a "Permitir todo el tiempo"',
    };
  }

  // A partir de acá, plataforma === 'ios': `status` SÍ distingue los tres casos reales.
  if (estadoPermiso === AUTORIZACION_NO_DETERMINADA) {
    // El default antes de pedir permiso por primera vez — no bloquea, dispara el pedido
    // explícito la primera vez que el conductor toca "Iniciar recorrido".
    return {
      estado: 'no_solicitado',
      bloqueante: false,
      titulo: '',
      mensaje: '',
      accion: null,
      etiquetaAccion: null,
    };
  }

  if (estadoPermiso === AUTORIZACION_MIENTRAS_SE_USA) {
    // "Mientras se usa la app" otorgado, falta el paso a "todo el tiempo" — en iOS esta es
    // una señal REAL y distinguible (a diferencia de Android), así que tiene su propio
    // mensaje puntual en vez del fusionado.
    return {
      estado: 'permiso_parcial',
      bloqueante: true,
      titulo: 'Falta un paso para grabar todo el recorrido',
      mensaje:
        'Ahora QUIVO solo puede usar tu ubicación con la app abierta, y se corta al apagar la ' +
        'pantalla. Entrá a Ajustes de la app, tocá Permisos, Ubicación, y elegí "Permitir ' +
        'todo el tiempo".',
      accion: 'ajustes_app',
      etiquetaAccion: 'Cambiar a "Permitir todo el tiempo"',
    };
  }

  // `AUTORIZACION_DENEGADA`, `AUTORIZACION_RESTRINGIDA` (perfil gestionado/parental que
  // bloquea el permiso sin que el conductor lo haya tocado) y, defensivamente, cualquier
  // valor no reconocido: fail-closed con el mensaje de denegado.
  return {
    estado: 'permiso_denegado',
    bloqueante: true,
    titulo: 'QUIVO necesita tu ubicación',
    mensaje: MENSAJE_PERMISO_DENEGADO_IOS,
    accion: 'ajustes_app',
    etiquetaAccion: 'Abrir ajustes de la app',
  };
}
