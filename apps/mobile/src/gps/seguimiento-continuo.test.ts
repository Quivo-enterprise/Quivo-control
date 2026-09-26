import { beforeEach, describe, expect, it, vi } from 'vitest';

// `/codex-debug verify-fix` (riesgos 1 y 2 de la Entrega 31a): este módulo ahora reporta a
// Sentry cuando `changePace`/`setConfig`/`getCurrentPosition` rechazan sin tirar abajo el
// flujo que los llama — hace falta el mock para poder aserir `captureException` sin levantar
// el SDK real (mismo patrón que `headless-task.test.ts`).
vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/react-native';
import {
  crearCoordinadorIniciarDetener,
  crearManejadorForegroundActivo,
  crearManejadorReafirmarMovimiento,
  crearSerializadorRestauracion,
  detenerNativoConTimeout,
  EsperaIniciarInvalidadoAgotadaError,
  iniciarConSingleFlight,
  iniciarSeguimientoContinuo,
  reafirmarMovimiento,
  reafirmarMovimientoSiEstacionario,
  reconciliarStopTardio,
  restaurarComportamientoNormal,
  TIMEOUT_ESPERA_INICIAR_INVALIDADO_MS,
  TIMEOUT_STOP_NATIVO_MS,
  type SdkSeguimientoContinuo,
} from './seguimiento-continuo';

/**
 * QUI-P0 (la flecha no se mueve en el mapa): estos tests cubren el módulo PURO que decide
 * cómo forzar "en movimiento" contra el SDK — sin levantar React Native ni el módulo nativo,
 * mismo patrón que `permiso-ubicacion.test.ts`/`geofence.test.ts`. El reporte de campo del CTO
 * ("Finalizo el recorrido, vuelvo a iniciar y hace lo mismo que la primera vez") es lo que
 * obliga a probar explícitamente que NO hay guarda de "solo la primera vez": se llama dos
 * veces seguidas (simulando `finalizar()` + `iniciar()`) y las dos tienen que reafirmar
 * movimiento igual.
 */

/** Mock mínimo de `SdkSeguimientoContinuo` que además registra el ORDEN de las llamadas — es
 * lo que el hallazgo "ORDEN CRÍTICO" de `iniciarSeguimientoContinuo` necesita verificar: que
 * `start()` corre siempre antes que `changePace`/`setConfig`, nunca al revés. */
function sdkConOrden(): SdkSeguimientoContinuo & { orden: string[] } {
  const orden: string[] = [];
  return {
    orden,
    start: vi.fn(async () => {
      orden.push('start');
      return {};
    }),
    changePace: vi.fn(async (isMoving: boolean) => {
      orden.push(`changePace:${isMoving}`);
      return {};
    }),
    setConfig: vi.fn(async (config) => {
      orden.push(`setConfig:${JSON.stringify(config)}`);
      return {};
    }),
    getState: vi.fn(async () => {
      orden.push('getState');
      return { isMoving: false };
    }),
  };
}

describe('iniciarSeguimientoContinuo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('llama start() ANTES que changePace/setConfig, en ese orden', async () => {
    const sdk = sdkConOrden();
    await iniciarSeguimientoContinuo(sdk);
    expect(sdk.orden).toEqual([
      'start',
      'changePace:true',
      'setConfig:{"activity":{"disableStopDetection":true}}',
    ]);
  });

  it('reafirma movimiento de nuevo en una SEGUNDA llamada (simulando finalizar() + iniciar()) — sin guarda de "solo la primera vez"', async () => {
    const sdk = sdkConOrden();
    await iniciarSeguimientoContinuo(sdk);
    sdk.orden.length = 0; // limpiar para aislar la segunda corrida
    await iniciarSeguimientoContinuo(sdk);
    // La segunda corrida repite EXACTAMENTE la misma secuencia — el reporte de campo del CTO
    // confirma que el freeze reaparece igual en el segundo arranque, así que este módulo no
    // puede "recordar" que ya corrió una vez y saltearse el trabajo.
    expect(sdk.orden).toEqual([
      'start',
      'changePace:true',
      'setConfig:{"activity":{"disableStopDetection":true}}',
    ]);
    expect(sdk.start).toHaveBeenCalledTimes(2);
    expect(sdk.changePace).toHaveBeenCalledTimes(2);
    expect(sdk.setConfig).toHaveBeenCalledTimes(2);
  });

  // RIESGO 1 (`/codex-debug verify-fix`): antes, un rechazo de `changePace`/`setConfig` DESPUÉS
  // de un `start()` exitoso subía como rechazo de `iniciarSeguimientoContinuo` — el catch único
  // de `use-gps-operativo.ts` lo trataba igual que un fallo de `start()` (removía
  // suscripciones, `tracking=false`) pese a que el SDK nativo ya estaba grabando. Este test
  // prueba el fix: la función NO rechaza, y el fallo queda reportado a Sentry en su lugar.
  it('start() OK + changePace rechaza: NO propaga el rechazo (el recorrido sigue activo) y reporta a Sentry', async () => {
    const sdk: SdkSeguimientoContinuo = {
      start: vi.fn(async () => ({})),
      changePace: vi.fn(async () => {
        throw new Error('changePace: fallo nativo simulado');
      }),
      setConfig: vi.fn(async () => ({})),
      getState: vi.fn(async () => ({ isMoving: false })),
    };

    await expect(iniciarSeguimientoContinuo(sdk)).resolves.toBeUndefined();

    expect(sdk.start).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ paso: 'iniciar-reafirmar-movimiento' }),
      }),
    );
  });

  it('start() OK + setConfig rechaza (changePace sí resuelve): tampoco propaga y reporta a Sentry', async () => {
    const sdk: SdkSeguimientoContinuo = {
      start: vi.fn(async () => ({})),
      changePace: vi.fn(async () => ({})),
      setConfig: vi.fn(async () => {
        throw new Error('setConfig: fallo nativo simulado');
      }),
      getState: vi.fn(async () => ({ isMoving: false })),
    };

    await expect(iniciarSeguimientoContinuo(sdk)).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  // Contraparte explícita: si lo que falla es `start()` mismo, el comportamiento NO cambia —
  // sigue siendo un rechazo real (nada se grabó), y `changePace`/`setConfig` ni se intentan.
  it('start() rechaza: SÍ propaga el rechazo (comportamiento sin cambios) y no llega a changePace/setConfig', async () => {
    const sdk: SdkSeguimientoContinuo = {
      start: vi.fn(async () => {
        throw new Error('start: fallo nativo simulado');
      }),
      changePace: vi.fn(async () => ({})),
      setConfig: vi.fn(async () => ({})),
      getState: vi.fn(async () => ({ isMoving: false })),
    };

    await expect(iniciarSeguimientoContinuo(sdk)).rejects.toThrow('start: fallo nativo simulado');
    expect(sdk.changePace).not.toHaveBeenCalled();
    expect(sdk.setConfig).not.toHaveBeenCalled();
    // El fallo de `start()` lo reporta/maneja el llamador (`use-gps-operativo.ts`), no esta
    // función — acá no hay nada más que reafirmar, así que Sentry no se llama desde adentro.
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('reafirmarMovimiento', () => {
  it('llama changePace(true) antes que setConfig(disableStopDetection: true)', async () => {
    const sdk = sdkConOrden();
    await reafirmarMovimiento(sdk);
    expect(sdk.orden).toEqual([
      'changePace:true',
      'setConfig:{"activity":{"disableStopDetection":true}}',
    ]);
  });
});

describe('restaurarComportamientoNormal', () => {
  it('restaura disableStopDetection a false al finalizar el recorrido', async () => {
    const setConfig = vi.fn(async () => ({}));
    await restaurarComportamientoNormal({ setConfig });
    expect(setConfig).toHaveBeenCalledWith({ activity: { disableStopDetection: false } });
  });
});

/** Mock mínimo para `crearManejadorForegroundActivo` (necesita `changePace`/`setConfig`/
 * `getState` desde el gap G1 — ver su docblock). `isMoving` por defecto `true` para que los
 * tests que solo prueban el fix inmediato de `getCurrentPosition` no disparen de paso
 * `reafirmarMovimientoSiEstacionario` — esos casos tienen su propio bloque `describe` abajo. */
function sdkForeground(isMoving = true) {
  return {
    getCurrentPosition: vi.fn(async () => ({})),
    changePace: vi.fn(async () => ({})),
    setConfig: vi.fn(async () => ({})),
    getState: vi.fn(async () => ({ isMoving })),
  };
}

describe('crearManejadorForegroundActivo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con recorrido en curso y estado "active": pide una posición inmediata (samples:1, persist:true)', () => {
    const sdk = sdkForeground();
    const manejador = crearManejadorForegroundActivo(sdk, () => true);
    manejador('active');
    expect(sdk.getCurrentPosition).toHaveBeenCalledWith({ samples: 1, persist: true });
  });

  it('sin recorrido en curso: NO pide posición aunque el estado sea "active"', () => {
    const sdk = sdkForeground();
    const manejador = crearManejadorForegroundActivo(sdk, () => false);
    manejador('active');
    expect(sdk.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('con recorrido en curso pero estado distinto de "active" (background/inactive): NO pide posición', () => {
    const sdk = sdkForeground();
    const manejador = crearManejadorForegroundActivo(sdk, () => true);
    manejador('background');
    expect(sdk.getCurrentPosition).not.toHaveBeenCalled();
  });

  // RIESGO 2 (`/codex-debug verify-fix`): la promesa de `getCurrentPosition` quedaba suelta
  // sin `catch` — un timeout o rechazo nativo producía un rechazo sin manejar. El handler tiene
  // que seguir sin lanzar (es un callback de `AppState`, sincrónico) y dejar rastro en Sentry.
  it('con getCurrentPosition rechazando: el handler NO lanza y reporta a Sentry', async () => {
    const sdk = sdkForeground();
    sdk.getCurrentPosition.mockRejectedValue(new Error('getCurrentPosition: timeout simulado'));
    const manejador = crearManejadorForegroundActivo(sdk, () => true);

    expect(() => manejador('active')).not.toThrow();
    // El rechazo se resuelve en un microtask aparte (el handler solo dispara `void promesa.catch(...)`)
    // — hay que darle una vuelta al microtask queue antes de aserir el reporte.
    await Promise.resolve();
    await Promise.resolve();

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ paso: 'foreground-activo-getCurrentPosition' }),
      }),
    );
  });

  // G1 (merge post-drenado, Entrega 31a — gap de revisión): el regreso a foreground es uno de
  // los dos puntos (junto al heartbeat) que reafirman movimiento SIN depender de
  // `onMotionChange`/`ACTIVITY_RECOGNITION`.
  describe('G1: reafirma movimiento sin depender de onMotionChange', () => {
    it('con recorrido en curso, estado "active" y el SDK reportando isMoving:false: reafirma changePace(true) + disableStopDetection', async () => {
      const sdk = sdkForeground(false);
      const manejador = crearManejadorForegroundActivo(sdk, () => true);
      manejador('active');
      await vi.waitFor(() => {
        expect(sdk.setConfig).toHaveBeenCalledWith({ activity: { disableStopDetection: true } });
      });
      expect(sdk.getState).toHaveBeenCalledTimes(1);
      expect(sdk.changePace).toHaveBeenCalledWith(true);
    });

    it('con isMoving:true: NO reafirma nada (ya está en movimiento)', async () => {
      const sdk = sdkForeground(true);
      const manejador = crearManejadorForegroundActivo(sdk, () => true);
      manejador('active');
      await vi.waitFor(() => {
        expect(sdk.getState).toHaveBeenCalledTimes(1);
      });
      expect(sdk.changePace).not.toHaveBeenCalled();
      expect(sdk.setConfig).not.toHaveBeenCalled();
    });

    it('sin recorrido en curso: NO consulta getState ni reafirma, aunque el estado sea "active"', async () => {
      const sdk = sdkForeground(false);
      const manejador = crearManejadorForegroundActivo(sdk, () => false);
      manejador('active');
      await Promise.resolve();
      await Promise.resolve();
      expect(sdk.getState).not.toHaveBeenCalled();
      expect(sdk.changePace).not.toHaveBeenCalled();
    });

    it('con changePace rechazando: el handler NO lanza y reporta a Sentry con su propio tag', async () => {
      const sdk = sdkForeground(false);
      sdk.changePace.mockRejectedValue(new Error('changePace: fallo nativo simulado'));
      const manejador = crearManejadorForegroundActivo(sdk, () => true);

      expect(() => manejador('active')).not.toThrow();
      // Cadena más larga que un `changePace` directo (`getState()` -> `reafirmarMovimiento` ->
      // `changePace()` -> el `.catch()` externo): varias vueltas de microtask antes de que el
      // reporte llegue a Sentry, por eso `vi.waitFor` en vez de un número fijo de `await
      // Promise.resolve()`.
      await vi.waitFor(() => {
        expect(Sentry.captureException).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({
            tags: expect.objectContaining({ paso: 'foreground-activo-reafirmar-movimiento' }),
          }),
        );
      });
    });
  });
});

/** Promesa con `resolve`/`reject` expuestos para simular una llamada nativa que tarda un
 * tiempo arbitrario en resolver — necesario para forzar, de forma determinística, la carrera
 * que R1 corrige (sin esto, dos promesas ya resueltas "compiten" en el mismo microtask y el
 * orden real de un dispositivo real no queda cubierto). */
function crearDiferida<T>(): { promesa: Promise<T>; resolver: (valor: T) => void } {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

describe('crearSerializadorRestauracion', () => {
  // R1 (merge post-drenado, Entrega 31a — gap de revisión): `detener()` dispara
  // `restaurarComportamientoNormal` (`setConfig(disableStopDetection:false)`) sin esperarlo. Si
  // el chofer vuelve a tocar "Iniciar" antes de que ese `setConfig` resuelva, podía terminar
  // corriendo DESPUÉS del `setConfig(disableStopDetection:true)` del recorrido nuevo — el
  // nativo queda en el estado de quien resuelve último, no del que corresponde al recorrido
  // activo. Estos tests cubren el serializador que cierra esa carrera.

  it('sin ninguna promesa registrada: esperarPendiente() resuelve de inmediato', async () => {
    const serializador = crearSerializadorRestauracion();
    await expect(serializador.esperarPendiente()).resolves.toBeUndefined();
  });

  it('con una promesa registrada: esperarPendiente() espera a que esa promesa resuelva', async () => {
    const serializador = crearSerializadorRestauracion();
    const { promesa, resolver } = crearDiferida<void>();
    serializador.registrar(promesa);

    let resuelto = false;
    const esperar = serializador.esperarPendiente().then(() => {
      resuelto = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(resuelto).toBe(false); // la diferida todavía no resolvió — esperarPendiente() no debe adelantarse

    resolver();
    await esperar;
    expect(resuelto).toBe(true);
  });

  // EL CASO REAL que R1 corrige: el `setConfig(false)` de `detener()` (registrado) tiene que
  // quedar completado ANTES de que el `setConfig(true)` del siguiente `iniciar()` arranque,
  // sin importar cuál de los dos "tardaría más" en un dispositivo real.
  it('orden garantizado: la operación registrada corre completa ANTES de que el llamador de esperarPendiente() siga', async () => {
    const orden: string[] = [];
    const serializador = crearSerializadorRestauracion();
    const { promesa, resolver } = crearDiferida<void>();

    serializador.registrar(
      promesa.then(() => {
        orden.push('restauracion:false');
      }),
    );

    const siguienteIniciar = (async () => {
      await serializador.esperarPendiente();
      orden.push('iniciar:true');
    })();

    // La restauración "tarda" — se resuelve recién acá, simulando un setConfig nativo lento.
    await Promise.resolve();
    resolver();
    await siguienteIniciar;

    expect(orden).toEqual(['restauracion:false', 'iniciar:true']);
  });

  it('se limpia sola tras resolver: una segunda llamada a esperarPendiente() sin un nuevo registrar() no espera nada', async () => {
    const serializador = crearSerializadorRestauracion();
    const { promesa, resolver } = crearDiferida<void>();
    serializador.registrar(promesa);
    resolver();
    await serializador.esperarPendiente();

    // Segunda llamada: nada registrado ya (se limpió sola) — debe resolver de inmediato.
    await expect(serializador.esperarPendiente()).resolves.toBeUndefined();
  });

  // Contraparte del "se limpia sola": si SE registra una promesa NUEVA antes de que la vieja
  // termine de limpiarse (su propio `.finally`), la limpieza tardía de la vieja no debe borrar
  // el registro de la nueva — ver el comentario de `registrar()` en `seguimiento-continuo.ts`.
  it('una promesa nueva registrada no es borrada por la limpieza tardía de una promesa vieja ya reemplazada', async () => {
    const serializador = crearSerializadorRestauracion();
    const vieja = crearDiferida<void>();
    const nueva = crearDiferida<void>();

    serializador.registrar(vieja.promesa);
    // Se reemplaza ANTES de que la vieja resuelva — mismo escenario que dos `detener()`
    // seguidos, o un `detener()` + `iniciar()` que vuelve a registrar por su cuenta.
    serializador.registrar(nueva.promesa);

    // La vieja resuelve TARDE — su `.finally` no debe pisar el registro de la nueva.
    vieja.resolver();
    await Promise.resolve();
    await Promise.resolve();

    let resuelto = false;
    const esperar = serializador.esperarPendiente().then(() => {
      resuelto = true;
    });
    await Promise.resolve();
    expect(resuelto).toBe(false); // la nueva todavía no resolvió — si la vieja hubiera pisado el registro, esto ya sería true

    nueva.resolver();
    await esperar;
    expect(resuelto).toBe(true);
  });

  // Punto 1 (hallazgo de revisión, 2026-09-25): CASO REAL que motiva el cambio de "la más nueva
  // gana" a "encadenar" — un `stop()` vencido (`detenerNativoConTimeout`) registrado por
  // `detener()`, seguido de una restauración registrada por el `iniciar()` invalidado que se
  // apaga solo (`detenerNativoYRestaurar`, `use-gps-operativo.ts`) MIENTRAS el `stop()` vencido
  // todavía no se asentó. Con "la más nueva gana" (diseño anterior), `registrar()` de la segunda
  // pisaba el slot sin esperar la primera — un `iniciar()` posterior que llama `esperarPendiente()`
  // podía arrancar (`ready()`/`start()`) ANTES de que el `stop()` vencido tardío se asentara contra
  // el nativo, reabriendo la ventana de carrera que este serializador existe para cerrar.
  it('un stop vencido registrado, y luego una restauración registrada ANTES de que el stop se asiente: esperarPendiente() espera a las DOS', async () => {
    const serializador = crearSerializadorRestauracion();
    const orden: string[] = [];
    const stopVencido = crearDiferida<void>();
    const restauracion = crearDiferida<void>();

    serializador.registrar(
      stopVencido.promesa.then(() => {
        orden.push('stop-vencido-asentado');
      }),
    );
    serializador.registrar(
      restauracion.promesa.then(() => {
        orden.push('restauracion-asentada');
      }),
    );

    let resuelto = false;
    const esperar = serializador.esperarPendiente().then(() => {
      resuelto = true;
    });

    // Ninguna de las dos resolvió todavía — esperarPendiente() no debe adelantarse a ninguna.
    await Promise.resolve();
    await Promise.resolve();
    expect(resuelto).toBe(false);

    // La restauración (la MÁS NUEVA) resuelve primero — con "la más nueva gana" esto ya habría
    // sido suficiente para que esperarPendiente() se considerara satisfecho. Acá NO debe serlo:
    // el stop vencido (la más VIEJA) sigue sin asentarse.
    restauracion.resolver();
    await Promise.resolve();
    await Promise.resolve();
    expect(resuelto).toBe(false);
    expect(orden).toEqual(['restauracion-asentada']);

    // Recién cuando el stop vencido por fin se asienta, esperarPendiente() resuelve.
    stopVencido.resolver();
    await esperar;
    expect(resuelto).toBe(true);
    expect(orden).toEqual(['restauracion-asentada', 'stop-vencido-asentado']);
  });

  // Contraparte: si el registro más viejo TERMINA EN RECHAZO, no debe tirar abajo la espera de
  // la más nueva (ambas ramas del `Promise.all` interno están normalizadas con `.catch()`).
  it('si la promesa más vieja encadenada rechaza, esperarPendiente() igual espera a la nueva y resuelve (nunca rechaza)', async () => {
    const serializador = crearSerializadorRestauracion();
    let rechazarVieja!: (error: Error) => void;
    const vieja = new Promise<void>((_resolve, reject) => {
      rechazarVieja = reject;
    });
    const nueva = crearDiferida<void>();

    serializador.registrar(vieja);
    serializador.registrar(nueva.promesa);
    rechazarVieja(new Error('stop(): fallo simulado'));

    let resuelto = false;
    let rechazado = false;
    const esperar = serializador
      .esperarPendiente()
      .then(() => {
        resuelto = true;
      })
      .catch(() => {
        rechazado = true;
      });

    await Promise.resolve();
    await Promise.resolve();
    expect(resuelto).toBe(false); // la nueva todavía no resolvió — el rechazo de la vieja no adelanta nada

    nueva.resolver();
    await esperar;
    expect(rechazado).toBe(false);
    expect(resuelto).toBe(true);
  });
});

describe('reafirmarMovimientoSiEstacionario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con recorrido en curso e isMoving:false: reafirma changePace(true) + disableStopDetection', async () => {
    const sdk = sdkForeground(false);
    await reafirmarMovimientoSiEstacionario(sdk, () => true);
    expect(sdk.changePace).toHaveBeenCalledWith(true);
    expect(sdk.setConfig).toHaveBeenCalledWith({ activity: { disableStopDetection: true } });
  });

  it('con recorrido en curso e isMoving:true: no hace nada, ya está en movimiento', async () => {
    const sdk = sdkForeground(true);
    await reafirmarMovimientoSiEstacionario(sdk, () => true);
    expect(sdk.changePace).not.toHaveBeenCalled();
    expect(sdk.setConfig).not.toHaveBeenCalled();
  });

  it('sin recorrido en curso: ni siquiera consulta getState (nada que defender)', async () => {
    const sdk = sdkForeground(false);
    await reafirmarMovimientoSiEstacionario(sdk, () => false);
    expect(sdk.getState).not.toHaveBeenCalled();
    expect(sdk.changePace).not.toHaveBeenCalled();
  });

  // Esto es exactamente el caso G1 que motiva la función: sin el permiso ACTIVITY_RECOGNITION,
  // `onMotionChange` puede no disparar nunca — esta función no lo necesita, solo lee
  // `getState()` directamente.
  it('no depende de ningún evento onMotionChange — solo de getState()', async () => {
    const sdk = sdkForeground(false);
    await reafirmarMovimientoSiEstacionario(sdk, () => true);
    expect(sdk.getState).toHaveBeenCalledTimes(1);
    expect(sdk.changePace).toHaveBeenCalledTimes(1);
  });
});

describe('crearManejadorReafirmarMovimiento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con recorrido en curso y el SDK reportando isMoving:false: reafirma changePace(true) de inmediato', () => {
    const changePace = vi.fn(async () => ({}));
    const manejador = crearManejadorReafirmarMovimiento({ changePace }, () => true);
    manejador({ isMoving: false });
    expect(changePace).toHaveBeenCalledWith(true);
  });

  it('con isMoving:true: no hace nada (ya está en movimiento, no hay nada que reafirmar)', () => {
    const changePace = vi.fn(async () => ({}));
    const manejador = crearManejadorReafirmarMovimiento({ changePace }, () => true);
    manejador({ isMoving: true });
    expect(changePace).not.toHaveBeenCalled();
  });

  it('sin recorrido en curso: no reafirma aunque el SDK caiga a estacionario (nada que defender fuera de un recorrido)', () => {
    const changePace = vi.fn(async () => ({}));
    const manejador = crearManejadorReafirmarMovimiento({ changePace }, () => false);
    manejador({ isMoving: false });
    expect(changePace).not.toHaveBeenCalled();
  });

  // RIESGO 2 (`/codex-debug verify-fix`): mismo problema que `crearManejadorForegroundActivo` —
  // la promesa de `changePace` quedaba suelta sin `catch`.
  it('con changePace rechazando: el handler NO lanza y reporta a Sentry', async () => {
    const changePace = vi.fn(async () => {
      throw new Error('changePace: fallo nativo simulado');
    });
    const manejador = crearManejadorReafirmarMovimiento({ changePace }, () => true);

    expect(() => manejador({ isMoving: false })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ paso: 'motion-change-reafirmar-movimiento' }),
      }),
    );
  });
});

describe('crearCoordinadorIniciarDetener — single-flight de iniciar()/detener() (rediseño 2026-09-25)', () => {
  // REDISEÑO: reemplaza al coordinador con timeout/generaciones "más nueva que…" — con
  // single-flight garantizado, nunca puede haber DOS `iniciar()` en curso a la vez, así que
  // "vigente" pasa a ser simplemente "no invalidada por un detener()".

  it('promesaIniciarEnCurso(): null cuando no hay ningún iniciar() en curso', () => {
    const coordinador = crearCoordinadorIniciarDetener();
    expect(coordinador.promesaIniciarEnCurso()).toBeNull();
  });

  it('single-flight: una segunda llamada mientras hay un iniciar() en curso debe reusar la MISMA promesa registrada', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    coordinador.nuevaGeneracion();
    const { promesa, resolver } = crearDiferida<void>();
    coordinador.registrarPromesaIniciar(promesa);

    expect(coordinador.promesaIniciarEnCurso()).toBe(promesa);
    resolver();
    await promesa;
  });

  it('la promesa registrada se limpia sola al resolver: promesaIniciarEnCurso() vuelve a null', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    coordinador.nuevaGeneracion();
    const { promesa, resolver } = crearDiferida<void>();
    coordinador.registrarPromesaIniciar(promesa);

    resolver();
    await promesa;
    await Promise.resolve();

    expect(coordinador.promesaIniciarEnCurso()).toBeNull();
  });

  it('nuevaGeneracion() sucesivas: la más reciente es la vigente, la anterior deja de serlo', () => {
    const coordinador = crearCoordinadorIniciarDetener();
    const generacionVieja = coordinador.nuevaGeneracion();
    const generacionNueva = coordinador.nuevaGeneracion();

    expect(coordinador.estaVigente(generacionVieja)).toBe(false);
    expect(coordinador.estaVigente(generacionNueva)).toBe(true);
  });

  it('invalidarEnCurso() es SÍNCRONO — no requiere esperar nada, a diferencia del timeout del diseño anterior', () => {
    const coordinador = crearCoordinadorIniciarDetener();
    const generacion = coordinador.nuevaGeneracion();
    expect(coordinador.estaVigente(generacion)).toBe(true);

    coordinador.invalidarEnCurso(); // sin await — detener() nunca espera nada acá
    expect(coordinador.estaVigente(generacion)).toBe(false);
  });

  it('invalidarEnCurso() sin ningún iniciar() en curso: no-op, no rompe nada', () => {
    const coordinador = crearCoordinadorIniciarDetener();
    expect(() => coordinador.invalidarEnCurso()).not.toThrow();
  });

  it('iniciarEnCursoInvalidado(): false mientras el intento en curso sigue vigente', () => {
    const coordinador = crearCoordinadorIniciarDetener();
    coordinador.nuevaGeneracion();
    coordinador.registrarPromesaIniciar(new Promise<void>(() => {}));
    expect(coordinador.iniciarEnCursoInvalidado()).toBe(false);
  });

  // EL CASO que distingue "Iniciando…" de "Guardando recorrido anterior…" en la UI: un
  // `detener()` invalidó el intento en curso, pero ese intento SIGUE en vuelo (colgado en su
  // propio outbox) — el single-flight de `iniciar()` sigue bloqueado hasta que por fin resuelva.
  it('iniciarEnCursoInvalidado(): true cuando detener() invalidó un iniciar() que sigue en curso', () => {
    const coordinador = crearCoordinadorIniciarDetener();
    coordinador.nuevaGeneracion();
    coordinador.registrarPromesaIniciar(new Promise<void>(() => {}));

    coordinador.invalidarEnCurso();

    expect(coordinador.iniciarEnCursoInvalidado()).toBe(true);
  });

  it('iniciarEnCursoInvalidado(): vuelve a false una vez que el intento invalidado termina de resolver', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    coordinador.nuevaGeneracion();
    const { promesa, resolver } = crearDiferida<void>();
    coordinador.registrarPromesaIniciar(promesa);
    coordinador.invalidarEnCurso();
    expect(coordinador.iniciarEnCursoInvalidado()).toBe(true);

    resolver();
    await promesa;
    await Promise.resolve();

    expect(coordinador.iniciarEnCursoInvalidado()).toBe(false);
  });

  it('detener() single-flight: promesaDetenerEnCurso() devuelve la promesa registrada y se limpia sola al resolver', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    expect(coordinador.promesaDetenerEnCurso()).toBeNull();

    const { promesa, resolver } = crearDiferida<void>();
    coordinador.registrarPromesaDetener(promesa);
    expect(coordinador.promesaDetenerEnCurso()).toBe(promesa);

    resolver();
    await promesa;
    await Promise.resolve();
    expect(coordinador.promesaDetenerEnCurso()).toBeNull();
  });

  it('un iniciar() nuevo (tras resolver el anterior) arranca vigente y sin invalidar — el ciclo se reinicia limpio', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    const generacionA = coordinador.nuevaGeneracion();
    coordinador.registrarPromesaIniciar(Promise.resolve());
    coordinador.invalidarEnCurso();
    await Promise.resolve();
    await Promise.resolve();

    const generacionB = coordinador.nuevaGeneracion();
    expect(coordinador.estaVigente(generacionB)).toBe(true);
    expect(coordinador.estaVigente(generacionA)).toBe(false);
  });

  // Punto 4 (hallazgo de revisión, 2026-09-25): `causaInvalidacion()` — `ejecutarIniciar`
  // (`use-gps-operativo.ts`) la usa para decidir si un intento invalidado que resuelve tarde debe
  // apagar el nativo (`causa: 'detener'`) o dejarlo corriendo (`causa: 'desmontaje'`).
  describe('causaInvalidacion() — punto 4 de la revisión 2026-09-25', () => {
    it('null mientras no hay ninguna invalidación', () => {
      const coordinador = crearCoordinadorIniciarDetener();
      coordinador.nuevaGeneracion();
      expect(coordinador.causaInvalidacion()).toBeNull();
    });

    it('sin argumento, invalidarEnCurso() usa "detener" por default', () => {
      const coordinador = crearCoordinadorIniciarDetener();
      coordinador.nuevaGeneracion();
      coordinador.invalidarEnCurso();
      expect(coordinador.causaInvalidacion()).toBe('detener');
    });

    it('con causa "desmontaje" explícita: causaInvalidacion() la refleja', () => {
      const coordinador = crearCoordinadorIniciarDetener();
      coordinador.nuevaGeneracion();
      coordinador.invalidarEnCurso('desmontaje');
      expect(coordinador.causaInvalidacion()).toBe('desmontaje');
    });

    it('"detener" es sticky: una invalidación por "desmontaje" posterior no la pisa', () => {
      const coordinador = crearCoordinadorIniciarDetener();
      coordinador.nuevaGeneracion();
      coordinador.invalidarEnCurso('detener');
      coordinador.invalidarEnCurso('desmontaje');
      expect(coordinador.causaInvalidacion()).toBe('detener');
    });

    it('"desmontaje" primero, "detener" después: "detener" pasa a ser la causa (sigue siendo la más segura)', () => {
      const coordinador = crearCoordinadorIniciarDetener();
      coordinador.nuevaGeneracion();
      coordinador.invalidarEnCurso('desmontaje');
      coordinador.invalidarEnCurso('detener');
      expect(coordinador.causaInvalidacion()).toBe('detener');
    });

    it('se resetea a null en nuevaGeneracion() — un intento fresco no hereda la causa del anterior', () => {
      const coordinador = crearCoordinadorIniciarDetener();
      coordinador.nuevaGeneracion();
      coordinador.invalidarEnCurso('detener');
      expect(coordinador.causaInvalidacion()).toBe('detener');

      coordinador.nuevaGeneracion();
      expect(coordinador.causaInvalidacion()).toBeNull();
    });
  });
});

describe('detenerNativoConTimeout (rediseño 2026-09-25) — stop() colgado/rechazado no impide la limpieza', () => {
  // Punto 3 del rediseño: `detener()` nunca queda a merced de un `BackgroundGeolocation.stop()`
  // que no responde — la limpieza JS (remover suscripciones, tracking=false) sigue de largo
  // pase lo que pase con el nativo.

  it('stop() resuelve rápido: ok:true, sin error', async () => {
    const sdk = { stop: vi.fn(async () => ({})) };
    await expect(detenerNativoConTimeout(sdk)).resolves.toMatchObject({ ok: true });
  });

  it('stop() rechaza: ok:false con el error original, no propaga (no lanza)', async () => {
    const error = new Error('stop(): fallo nativo simulado');
    const sdk = { stop: vi.fn(async () => { throw error; }) };
    await expect(detenerNativoConTimeout(sdk)).resolves.toMatchObject({ ok: false, error });
  });

  // Punto 7 (hallazgo de revisión, 2026-09-25): `sdk.stop()` que TIRA SINCRÓNICAMENTE (no
  // devuelve una promesa rechazada, lanza directo) — antes escapaba del `.then()` que lo
  // envolvía y de todo el `try/finally` del timer, propagándose como un rechazo de
  // `detenerNativoConTimeout` en vez de resolver `{ok:false, promesaAsentada}` como documenta su
  // contrato.
  it('stop() tira SINCRÓNICAMENTE (no devuelve una promesa): no propaga, resuelve ok:false igual que un rechazo async', async () => {
    const error = new Error('stop(): throw sincrónico simulado');
    const sdk = {
      stop: vi.fn((): Promise<unknown> => {
        throw error;
      }),
    };
    await expect(detenerNativoConTimeout(sdk)).resolves.toMatchObject({ ok: false, error });
  });

  it('stop() tira sincrónicamente: promesaAsentada tampoco rechaza', async () => {
    const sdk = {
      stop: vi.fn((): Promise<unknown> => {
        throw new Error('stop(): throw sincrónico simulado');
      }),
    };
    const { promesaAsentada } = await detenerNativoConTimeout(sdk);
    await expect(promesaAsentada).resolves.toBeUndefined();
  });

  it('stop() colgado (nunca resuelve): vence el timeout y devuelve ok:false sin esperar para siempre', async () => {
    vi.useFakeTimers();
    try {
      const sdk = { stop: vi.fn(() => new Promise<unknown>(() => {})) };
      const promesa = detenerNativoConTimeout(sdk, TIMEOUT_STOP_NATIVO_MS);
      await vi.advanceTimersByTimeAsync(TIMEOUT_STOP_NATIVO_MS);
      const resultado = await promesa;
      expect(resultado.ok).toBe(false);
      expect(resultado.error).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });

  it('TIMEOUT_STOP_NATIVO_MS es 5 s', () => {
    expect(TIMEOUT_STOP_NATIVO_MS).toBe(5_000);
  });

  it('stop() resuelve ANTES del timeout: no espera el timeout completo', async () => {
    vi.useFakeTimers();
    try {
      const sdk = { stop: vi.fn(async () => ({})) };
      const promesa = detenerNativoConTimeout(sdk, 10_000);
      const resultado = await promesa;
      expect(resultado).toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  // C (hallazgos de revisión 4/5, 2026-09-25): `promesaAsentada` es la promesa cruda de `stop()`
  // (nunca rechaza) que el llamador (`detener()`) registra en `SerializadorRestauracion` para
  // que el PRÓXIMO `iniciar()` la espere antes de `ready()/start()` — un `stop()` tardío no
  // puede matar un recorrido nuevo.
  describe('promesaAsentada', () => {
    it('con stop() exitoso: promesaAsentada resuelve una vez que stop() resuelve', async () => {
      const sdk = { stop: vi.fn(async () => ({})) };
      const { promesaAsentada } = await detenerNativoConTimeout(sdk);
      await expect(promesaAsentada).resolves.toBeUndefined();
    });

    it('con stop() rechazando: promesaAsentada NO rechaza, resuelve igual', async () => {
      const sdk = { stop: vi.fn(async () => { throw new Error('stop(): fallo simulado'); }) };
      const { promesaAsentada } = await detenerNativoConTimeout(sdk);
      await expect(promesaAsentada).resolves.toBeUndefined();
    });

    it('con timeout vencido: promesaAsentada sigue en pie y resuelve cuando stop() por fin se asienta tarde', async () => {
      vi.useFakeTimers();
      try {
        let resolverStopTardio!: () => void;
        const sdk = {
          stop: vi.fn(
            () =>
              new Promise<unknown>((resolve) => {
                resolverStopTardio = () => resolve({});
              }),
          ),
        };
        const promesaResultado = detenerNativoConTimeout(sdk, TIMEOUT_STOP_NATIVO_MS);
        await vi.advanceTimersByTimeAsync(TIMEOUT_STOP_NATIVO_MS);
        const resultado = await promesaResultado;
        expect(resultado.ok).toBe(false);

        let asentada = false;
        const esperar = resultado.promesaAsentada.then(() => {
          asentada = true;
        });
        expect(asentada).toBe(false); // stop() real todavía no resolvió

        resolverStopTardio();
        await esperar;
        expect(asentada).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('reconciliarStopTardio (bug en producción, 2026-09-25) — un stop() que resuelve tarde no deja el recorrido colgado', () => {
  /** Promesa + resolver expuestos por separado, para controlar a mano cuándo "se asienta" el
   * `stop()` original — mismo patrón que usan los tests de `promesaAsentada` de arriba. */
  function promesaControlada(): { promesa: Promise<void>; resolver: () => void } {
    let resolver!: () => void;
    const promesa = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    return { promesa, resolver };
  }

  it('se asienta + nativo ya apagado + debe reconciliar: llama detener() una vez y resuelve "reconciliado"', async () => {
    const { promesa, resolver } = promesaControlada();
    const detener = vi.fn(async () => {});
    const resultadoPromesa = reconciliarStopTardio({
      promesaAsentada: promesa,
      debeReconciliar: () => true,
      nativoHabilitado: async () => false,
      detener,
    });
    resolver();
    await expect(resultadoPromesa).resolves.toBe('reconciliado');
    expect(detener).toHaveBeenCalledTimes(1);
  });

  it('el nativo sigue enabled (el stop() tardío no apagó nada): no llama detener(), "sin-accion"', async () => {
    const detener = vi.fn(async () => {});
    const resultado = await reconciliarStopTardio({
      promesaAsentada: Promise.resolve(),
      debeReconciliar: () => true,
      nativoHabilitado: async () => true,
      detener,
    });
    expect(resultado).toBe('sin-accion');
    expect(detener).not.toHaveBeenCalled();
  });

  it('debeReconciliar() ya es false ANTES de leer getState(): no llama nativoHabilitado() ni detener()', async () => {
    const detener = vi.fn(async () => {});
    const nativoHabilitado = vi.fn(async () => false);
    const resultado = await reconciliarStopTardio({
      promesaAsentada: Promise.resolve(),
      debeReconciliar: () => false,
      nativoHabilitado,
      detener,
    });
    expect(resultado).toBe('sin-accion');
    expect(nativoHabilitado).not.toHaveBeenCalled();
    expect(detener).not.toHaveBeenCalled();
  });

  it('debeReconciliar() pasa a false DESPUÉS del await a getState() (p. ej. otro cierre ganó mientras tanto): no llama detener()', async () => {
    let vigente = true;
    const detener = vi.fn(async () => {});
    const resultado = await reconciliarStopTardio({
      promesaAsentada: Promise.resolve(),
      debeReconciliar: () => vigente,
      nativoHabilitado: async () => {
        // Cambia de estado MIENTRAS este await está en vuelo — simula que, entre que se leyó
        // getState() y se lo pudo usar, otra vía (reintento del chofer, recorrido nuevo) ya
        // dejó de corresponder la reconciliación.
        vigente = false;
        return false;
      },
      detener,
    });
    expect(resultado).toBe('sin-accion');
    expect(detener).not.toHaveBeenCalled();
  });

  it('promesaAsentada sigue pendiente: no evalúa debeReconciliar() ni hace nada hasta que se asienta', async () => {
    const { promesa, resolver } = promesaControlada();
    const debeReconciliar = vi.fn(() => true);
    const nativoHabilitado = vi.fn(async () => false);
    const detener = vi.fn(async () => {});
    const resultadoPromesa = reconciliarStopTardio({
      promesaAsentada: promesa,
      debeReconciliar,
      nativoHabilitado,
      detener,
    });

    // Deja correr microtasks sin resolver `promesa` — nada debería haber pasado todavía.
    await Promise.resolve();
    await Promise.resolve();
    expect(debeReconciliar).not.toHaveBeenCalled();
    expect(nativoHabilitado).not.toHaveBeenCalled();
    expect(detener).not.toHaveBeenCalled();

    resolver();
    await expect(resultadoPromesa).resolves.toBe('reconciliado');
    expect(detener).toHaveBeenCalledTimes(1);
  });

  it('detener() rechaza: el rechazo propaga (el llamador lo reporta a Sentry, no este helper)', async () => {
    const error = new Error('detener(): fallo simulado');
    const resultadoPromesa = reconciliarStopTardio({
      promesaAsentada: Promise.resolve(),
      debeReconciliar: () => true,
      nativoHabilitado: async () => false,
      detener: async () => {
        throw error;
      },
    });
    await expect(resultadoPromesa).rejects.toBe(error);
  });

  it('nativoHabilitado() rechaza: el rechazo propaga', async () => {
    const error = new Error('getState(): fallo simulado');
    const resultadoPromesa = reconciliarStopTardio({
      promesaAsentada: Promise.resolve(),
      debeReconciliar: () => true,
      nativoHabilitado: async () => {
        throw error;
      },
      detener: async () => {},
    });
    await expect(resultadoPromesa).rejects.toBe(error);
  });
});

describe('Rediseño iniciar()/detener() (bug en producción, 2026-09-25) — detener() no espera a iniciar()', () => {
  /**
   * Reproduce, con los mismos bloques puros que usa `use-gps-operativo.ts`
   * (`crearCoordinadorIniciarDetener`, `detenerNativoConTimeout`, `restaurarComportamientoNormal`
   * de este módulo, y `cerrarRecorridoEnOutbox` de `cierre-recorrido.ts`), el escenario completo
   * del rediseño: `iniciar()` queda colgado en su propio outbox (asegurarInicioRecorrido) →
   * `detener()` NO lo espera — invalida su generación de inmediato y sigue con su propio cierre
   * (stop acotado, limpiar suscripciones, tracking=false) → el `iniciar()` colgado, al resolver
   * tarde, ve que ya no es vigente y limpia lo que él mismo prendió sin tocar tracking/estado.
   */
  it('detener() invalida y cierra sin esperar al iniciar() colgado en outbox; el iniciar() invalidado, al resolver tarde, llama stop()+restaura y no toca tracking', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    const trackingRef = { current: false };
    const stopFn = vi.fn(async () => ({}));
    const setConfig = vi.fn(async (_config: Record<string, unknown>) => ({}));
    const orden: string[] = [];

    // --- iniciar(): arranca el nativo con éxito, marca tracking=true, y se cuelga en su propio
    // outbox (simulado con una promesa diferida sin resolver todavía). ---
    const generacion = coordinador.nuevaGeneracion();
    const { promesa: outboxColgado, resolver: resolverOutbox } = crearDiferida<void>();
    const ejecutarIniciarSimulado = (async () => {
      orden.push('start-nativo');
      trackingRef.current = true;
      await outboxColgado; // se cuelga acá, como `asegurarInicioRecorrido`/`abrirOutbox` real
      if (!coordinador.estaVigente(generacion)) {
        // Intento invalidado que resuelve tarde: NO toca tracking, pero sí apaga lo que prendió.
        await stopFn();
        await setConfig({ activity: { disableStopDetection: false } });
        orden.push('iniciar-invalidado-limpio');
        return;
      }
      orden.push('outbox-confirmado');
    })();
    coordinador.registrarPromesaIniciar(ejecutarIniciarSimulado);

    // --- El chofer toca "Finalizar" YA, con iniciar() todavía colgado en el outbox. ---
    coordinador.invalidarEnCurso(); // sync — nada que esperar acá
    orden.push('detener-invalida');
    await stopFn(); // stop() acotado (detenerNativoConTimeout real se prueba aparte)
    trackingRef.current = false;
    orden.push('detener-tracking-false');
    // `detener()` YA terminó su camino crítico — el chofer ve el recorrido detenido acá mismo,
    // sin haber esperado ni un microtask al iniciar() colgado.
    expect(trackingRef.current).toBe(false);
    expect(orden).toEqual(['start-nativo', 'detener-invalida', 'detener-tracking-false']);

    // --- El iniciar() colgado por fin resuelve, tarde. ---
    resolverOutbox();
    await ejecutarIniciarSimulado;

    expect(orden).toEqual([
      'start-nativo',
      'detener-invalida',
      'detener-tracking-false',
      'iniciar-invalidado-limpio',
    ]);
    // stop() se llamó dos veces (una desde detener(), otra redundante desde el iniciar()
    // invalidado) — idempotente, inocuo.
    expect(stopFn).toHaveBeenCalledTimes(2);
    expect(setConfig).toHaveBeenCalledWith({ activity: { disableStopDetection: false } });
    // tracking nunca volvió a true por culpa del intento invalidado.
    expect(trackingRef.current).toBe(false);
  });

  it('sin ningún iniciar() en curso (camino normal): invalidarEnCurso() es no-op y detener() no espera nada', () => {
    const coordinador = crearCoordinadorIniciarDetener();
    expect(coordinador.promesaIniciarEnCurso()).toBeNull();
    expect(() => coordinador.invalidarEnCurso()).not.toThrow();
  });
});

describe('iniciarConSingleFlight (hallazgos de revisión 1, 2, 7, 2026-09-25) — wrapper público de iniciar()', () => {
  it('sin ningún iniciar() en curso: arranca un intento nuevo con una generación fresca', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    const ejecutarIntento = vi.fn(async (_generacion: number) => {});

    await iniciarConSingleFlight(coordinador, ejecutarIntento);

    expect(ejecutarIntento).toHaveBeenCalledTimes(1);
    expect(ejecutarIntento).toHaveBeenCalledWith(1);
  });

  it('con un iniciar() en curso todavía VIGENTE: reusa la MISMA promesa, no arranca un segundo intento', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    const { promesa, resolver } = crearDiferida<void>();
    coordinador.nuevaGeneracion();
    coordinador.registrarPromesaIniciar(promesa);
    const ejecutarIntento = vi.fn(async (_g: number) => {});

    const resultado = iniciarConSingleFlight(coordinador, ejecutarIntento);
    resolver();
    await resultado;

    expect(ejecutarIntento).not.toHaveBeenCalled();
  });

  // EL CASO que corrige el bug (hallazgos 1/2): antes, esta llamada reusaba tal cual la promesa
  // invalidada — como un intento invalidado nunca deja `tracking=true`, el toque del chofer se
  // perdía sin haber arrancado nada nuevo.
  it('Comenzar tras invalidación: espera al intento invalidado y arranca uno FRESCO (no lo reusa)', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    const { promesa: intentoViejo, resolver: resolverViejo } = crearDiferida<void>();
    const generacionVieja = coordinador.nuevaGeneracion();
    coordinador.registrarPromesaIniciar(intentoViejo);

    // El chofer toca "Finalizar" — invalida el intento en curso mientras sigue en vuelo (p. ej.
    // todavía en `ready()`/`start()`).
    coordinador.invalidarEnCurso();

    const ejecutarIntentoNuevo = vi.fn(async (_g: number) => {});
    const resultadoSegundoToque = iniciarConSingleFlight(coordinador, ejecutarIntentoNuevo);

    // Todavía no debería haber arrancado nada nuevo — sigue esperando a que el viejo se asiente.
    await Promise.resolve();
    await Promise.resolve();
    expect(ejecutarIntentoNuevo).not.toHaveBeenCalled();

    // El intento viejo por fin se asienta (p. ej. `detenerNativoYRestaurar` en `ejecutarIniciar`).
    resolverViejo();
    await resultadoSegundoToque;

    // Recién ACÁ arranca el intento fresco, con una generación NUEVA (no la vieja invalidada).
    expect(ejecutarIntentoNuevo).toHaveBeenCalledTimes(1);
    expect(ejecutarIntentoNuevo).toHaveBeenCalledWith(generacionVieja + 1);
  });

  // Contraparte: outbox colgado (fase 2 de `ejecutarIniciar`, desacoplada del single-flight) NO
  // bloquea un "Comenzar" posterior — el `ejecutarIntento` simulado acá resuelve apenas termina
  // su fase pre-tracking, aunque deje una tarea de fondo sin terminar (igual que la fase 2 real).
  it('outbox colgado (fuera del single-flight) no bloquea un Comenzar posterior', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    const outboxColgado = new Promise<void>(() => {}); // nunca resuelve — simula SQLite trabada.
    const ejecutarIntentoA = vi.fn(async (_g: number) => {
      void outboxColgado; // fase 2 desacoplada, nunca esperada por el propio intento.
    });

    await iniciarConSingleFlight(coordinador, ejecutarIntentoA);
    expect(coordinador.promesaIniciarEnCurso()).toBeNull();

    // Un segundo "Comenzar" (tras un Finalizar/Iniciar posterior) arranca sin quedar bloqueado
    // por la fase 2 colgada del intento anterior.
    const ejecutarIntentoB = vi.fn(async (_g: number) => {});
    await iniciarConSingleFlight(coordinador, ejecutarIntentoB);
    expect(ejecutarIntentoB).toHaveBeenCalledTimes(1);
  });

  // Punto 5.a (hallazgo de revisión, 2026-09-25): un intento invalidado que TERMINA EN RECHAZO
  // (p. ej. `ejecutarIniciar` propagando un fallo real de `start()` — ver su `catch`,
  // `use-gps-operativo.ts`) no debe abortar el toque fresco del chofer con ESE error viejo.
  it('intento invalidado que RECHAZA al asentarse: el toque fresco igual arranca (no propaga el rechazo viejo)', async () => {
    const coordinador = crearCoordinadorIniciarDetener();
    let rechazarViejo!: (error: Error) => void;
    const intentoViejo = new Promise<void>((_resolve, reject) => {
      rechazarViejo = reject;
    });
    coordinador.nuevaGeneracion();
    coordinador.registrarPromesaIniciar(intentoViejo);
    coordinador.invalidarEnCurso();

    const ejecutarIntentoNuevo = vi.fn(async (_g: number) => {});
    const resultado = iniciarConSingleFlight(coordinador, ejecutarIntentoNuevo);

    // El intento viejo se asienta con un RECHAZO (no un resolve) — simula `ejecutarIniciar`
    // propagando un fallo real de `start()` mientras ya estaba invalidado.
    rechazarViejo(new Error('start(): fallo nativo simulado'));

    await expect(resultado).resolves.toBeUndefined();
    expect(ejecutarIntentoNuevo).toHaveBeenCalledTimes(1);
  });

  // Punto 5.b (hallazgo de revisión, 2026-09-25): tope de espera — si el intento invalidado
  // nunca se asienta (outbox colgado para siempre), `iniciarConSingleFlight` no puede dejar
  // "Comenzar" esperando sin límite: rechaza con `EsperaIniciarInvalidadoAgotadaError` pasado el
  // timeout inyectado.
  it('intento invalidado que NUNCA se asienta: rechaza con EsperaIniciarInvalidadoAgotadaError pasado el timeout', async () => {
    vi.useFakeTimers();
    try {
      const coordinador = crearCoordinadorIniciarDetener();
      const intentoColgado = new Promise<void>(() => {}); // nunca resuelve ni rechaza
      coordinador.nuevaGeneracion();
      coordinador.registrarPromesaIniciar(intentoColgado);
      coordinador.invalidarEnCurso();

      const ejecutarIntentoNuevo = vi.fn(async (_g: number) => {});
      const timeoutMs = 1_000;
      const resultado = iniciarConSingleFlight(coordinador, ejecutarIntentoNuevo, timeoutMs);
      // Evita un unhandled-rejection warning entre el `advanceTimersByTimeAsync` y el `await`
      // final de abajo — el rechazo real se asierta con `expect(...).rejects` más abajo.
      resultado.catch(() => {});

      await vi.advanceTimersByTimeAsync(timeoutMs);

      await expect(resultado).rejects.toBeInstanceOf(EsperaIniciarInvalidadoAgotadaError);
      expect(ejecutarIntentoNuevo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('el timeout de espera por default es TIMEOUT_ESPERA_INICIAR_INVALIDADO_MS (15 s) cuando no se inyecta uno', () => {
    expect(TIMEOUT_ESPERA_INICIAR_INVALIDADO_MS).toBe(15_000);
  });
});
