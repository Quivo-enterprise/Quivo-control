import { describe, expect, it, vi } from 'vitest';
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
});

describe('crearManejadorReafirmarMovimiento', () => {
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
});
