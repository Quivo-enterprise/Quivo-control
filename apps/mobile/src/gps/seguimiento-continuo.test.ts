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
  crearManejadorForegroundActivo,
  crearManejadorReafirmarMovimiento,
  iniciarSeguimientoContinuo,
  reafirmarMovimiento,
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

describe('crearManejadorForegroundActivo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con recorrido en curso y estado "active": pide una posición inmediata (samples:1, persist:true)', () => {
    const getCurrentPosition = vi.fn(async () => ({}));
    const manejador = crearManejadorForegroundActivo({ getCurrentPosition }, () => true);
    manejador('active');
    expect(getCurrentPosition).toHaveBeenCalledWith({ samples: 1, persist: true });
  });

  it('sin recorrido en curso: NO pide posición aunque el estado sea "active"', () => {
    const getCurrentPosition = vi.fn(async () => ({}));
    const manejador = crearManejadorForegroundActivo({ getCurrentPosition }, () => false);
    manejador('active');
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('con recorrido en curso pero estado distinto de "active" (background/inactive): NO pide posición', () => {
    const getCurrentPosition = vi.fn(async () => ({}));
    const manejador = crearManejadorForegroundActivo({ getCurrentPosition }, () => true);
    manejador('background');
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  // RIESGO 2 (`/codex-debug verify-fix`): la promesa de `getCurrentPosition` quedaba suelta
  // sin `catch` — un timeout o rechazo nativo producía un rechazo sin manejar. El handler tiene
  // que seguir sin lanzar (es un callback de `AppState`, sincrónico) y dejar rastro en Sentry.
  it('con getCurrentPosition rechazando: el handler NO lanza y reporta a Sentry', async () => {
    const getCurrentPosition = vi.fn(async () => {
      throw new Error('getCurrentPosition: timeout simulado');
    });
    const manejador = crearManejadorForegroundActivo({ getCurrentPosition }, () => true);

    expect(() => manejador('active')).not.toThrow();
    // El rechazo se resuelve en un microtask aparte (el handler solo dispara `void promesa.catch(...)`)
    // — hay que darle una vuelta al microtask queue antes de aserir el reporte.
    await Promise.resolve();
    await Promise.resolve();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ paso: 'foreground-activo-getCurrentPosition' }),
      }),
    );
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
