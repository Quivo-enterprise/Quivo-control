import { beforeEach, describe, expect, it, vi } from 'vitest';

// `/codex-debug verify-fix` (riesgos 1 y 2 de la Entrega 31a): este módulo ahora reporta a
// Sentry cuando `changePace`/`setConfig`/`getCurrentPosition` rechazan sin tirar abajo el
// flujo que los llama — hace falta el mock para poder aserir `captureException` sin levantar
// el SDK real (mismo patrón que `headless-task.test.ts`).
vi.mock('@sentry/react-native', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from '@sentry/react-native';
import {
  crearManejadorForegroundActivo,
  crearManejadorReafirmarMovimiento,
  crearSerializadorPromesaEnCurso,
  crearSerializadorRestauracion,
  iniciarSeguimientoContinuo,
  reafirmarMovimiento,
  reafirmarMovimientoSiEstacionario,
  reportarErrorUbicacionSentry,
  restaurarComportamientoNormal,
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

describe('reportarErrorUbicacionSentry', () => {
  const tags = { contexto: 'gps-foreground', paso: 'paso-x' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([408, 0, 2, 499])('código transitorio %i: breadcrumb warning, sin captureException', (code) => {
    reportarErrorUbicacionSentry(code, tags);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning', category: 'gps-foreground' }),
    );
  });

  it.each([1, 3, 500])('código %i (permanente/desconocido): captureException con los tags', (code) => {
    reportarErrorUbicacionSentry(code, tags);
    expect(Sentry.captureException).toHaveBeenCalledWith(code, { tags });
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('error ilegible (sin code): captureException, no se degrada a breadcrumb', () => {
    const error = new Error('x');
    reportarErrorUbicacionSentry(error, tags);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags });
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });
});

describe('crearManejadorForegroundActivo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con recorrido en curso y estado "active": pide una posición inmediata (samples:1, persist:true)', () => {
    const sdk = sdkForeground();
    const manejador = crearManejadorForegroundActivo(sdk, () => true);
    manejador('active');
    expect(sdk.getCurrentPosition).toHaveBeenCalledWith({
      samples: 1,
      persist: true,
      timeout: 30,
    });
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

  it('con getCurrentPosition rechazando con 408: breadcrumb de warning, NO captureException', async () => {
    const sdk = sdkForeground();
    sdk.getCurrentPosition.mockRejectedValue(408);
    const manejador = crearManejadorForegroundActivo(sdk, () => true);

    manejador('active');
    await Promise.resolve();
    await Promise.resolve();

    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('con getCurrentPosition rechazando con un código desconocido (500): captureException, sin breadcrumb', async () => {
    const sdk = sdkForeground();
    sdk.getCurrentPosition.mockRejectedValue(500);
    const manejador = crearManejadorForegroundActivo(sdk, () => true);

    manejador('active');
    await Promise.resolve();
    await Promise.resolve();

    expect(Sentry.captureException).toHaveBeenCalledWith(
      500,
      expect.objectContaining({
        tags: expect.objectContaining({ paso: 'foreground-activo-getCurrentPosition' }),
      }),
    );
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
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

describe('crearSerializadorPromesaEnCurso — carrera Iniciar→Finalizar rápido (QUI-247, MEDIO)', () => {
  // Hallazgo MEDIO de revisión: `tracking` pasa a `true` apenas resuelve `start()`, ANTES de
  // que `iniciar()` termine de escribir `inicio_recorrido` (espera la semilla de cumplimientos
  // + `abrirOutbox()`, puede tardar segundos) — y `next-control-sheet.tsx` ya ofrece "FINALIZAR
  // RUTA" en esa ventana. Un toque Iniciar→Finalizar muy rápido hacía que `detener()` escribiera
  // `fin_recorrido` ANTES de que el `iniciar()` en vuelo llegara a escribir `inicio_recorrido`:
  // reconstrucción de recorrido rota (fin sin inicio). El fix: `use-gps-operativo.ts` guarda el
  // `iniciar()` en vuelo en una instancia de este mismo serializador (alias genérico de
  // `crearSerializadorRestauracion`, mismo mecanismo) y `detener()` la espera ANTES de tocar
  // nada. Este test reproduce la carrera con el propio serializador, sin levantar el hook
  // completo (que no tiene arnés jest-expo/RNTL en este paquete).
  it('detener() esperado tras registrar un iniciar() en vuelo: inicio_recorrido siempre se escribe antes que fin_recorrido', async () => {
    const orden: string[] = [];
    const serializadorIniciar = crearSerializadorPromesaEnCurso();
    const { promesa: iniciarEnCurso, resolver: resolverIniciar } = crearDiferida<void>();

    // Simula `iniciar()`: se registra ANTES de que nada más corra (mismo orden que el wrapper
    // real en `use-gps-operativo.ts`), y su "trabajo" (escribir `inicio_recorrido`) solo se
    // asienta cuando `resolverIniciar()` se llama más abajo — simulando la espera real de la
    // semilla + `abrirOutbox()`.
    serializadorIniciar.registrar(
      iniciarEnCurso.then(() => {
        orden.push('inicio_recorrido');
      }),
    );

    // El chofer toca "Finalizar" YA, con `iniciar()` todavía en vuelo — `detener()` tiene que
    // esperar antes de escribir `fin_recorrido`.
    const detenerSimulado = (async () => {
      await serializadorIniciar.esperarPendiente();
      orden.push('fin_recorrido');
    })();

    // El `iniciar()` en vuelo "tarda" — se resuelve recién acá, después de que `detener()` ya
    // esté esperando.
    await Promise.resolve();
    expect(orden).toEqual([]); // ninguno de los dos escribió nada todavía

    resolverIniciar();
    await detenerSimulado;

    expect(orden).toEqual(['inicio_recorrido', 'fin_recorrido']);
  });

  it('sin ningún iniciar() en vuelo (camino normal): detener() no espera nada', async () => {
    const serializadorIniciar = crearSerializadorPromesaEnCurso();
    await expect(serializadorIniciar.esperarPendiente()).resolves.toBeUndefined();
  });
});
