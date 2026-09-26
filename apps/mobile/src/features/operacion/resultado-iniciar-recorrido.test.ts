import { describe, expect, it } from 'vitest';
import {
  MENSAJE_ERROR_NATIVO,
  MENSAJE_ERROR_OUTBOX,
  resolverResultadoIniciar,
} from './resultado-iniciar-recorrido';

/**
 * G2 (merge post-drenado, Entrega 31a — gap de revisión sobre esta misma entrega): antes,
 * `tracking` solo se marcaba `true` DESPUÉS de que el outbox local (semilla + `abrirOutbox` +
 * `inicio_recorrido`) terminara con éxito. Con el nativo (`start()` +
 * `iniciarSeguimientoContinuo`) ya arrancado y el outbox fallando, `tracking` quedaba en
 * `false` para siempre — el SDK seguía grabando de verdad, pero `next-control-sheet.tsx` solo
 * ofrece "COMENZAR RUTA" con `tracking: false`, nunca "FINALIZAR RUTA": el chofer quedaba sin
 * forma de cerrar un recorrido que sí estaba grabando. Estos tests fijan la invariante central
 * del fix.
 */
describe('resolverResultadoIniciar', () => {
  it('nativo OK + outbox OK: tracking=true, sin error', () => {
    expect(resolverResultadoIniciar(true, true)).toEqual({ tracking: true, errorGps: null });
  });

  it('nativo OK + outbox FALLA: tracking sigue true — el SDK ya está grabando, "Finalizar" debe seguir disponible', () => {
    expect(resolverResultadoIniciar(true, false)).toEqual({
      tracking: true,
      errorGps: MENSAJE_ERROR_OUTBOX,
    });
  });

  it('nativo FALLA: tracking=false — acá sí no hay nada grabándose todavía', () => {
    expect(resolverResultadoIniciar(false, false)).toEqual({
      tracking: false,
      errorGps: MENSAJE_ERROR_NATIVO,
    });
  });

  // Contraparte explícita del gap: un `nativoOk: false` NUNCA debe poder producir
  // `tracking: true`, sin importar qué reciba como segundo argumento — no hay escenario real
  // donde el outbox se ejecute sin que el nativo haya arrancado primero (`iniciar()` corta con
  // `return` en ese catch, ver `use-gps-operativo.ts`), pero la función no debe depender de
  // que el caller respete ese orden para mantener la invariante.
  it('nativo FALLA, sin importar outbox: tracking nunca puede terminar en true', () => {
    expect(resolverResultadoIniciar(false, true).tracking).toBe(false);
    expect(resolverResultadoIniciar(false, false).tracking).toBe(false);
  });

  // El mensaje de error de outbox NUNCA debe confundirse con el de fallo nativo — uno dice
  // "no se pudo activar el GPS" (falso si el nativo ya está grabando), el otro es correcto.
  it('los dos mensajes de error son distintos entre sí', () => {
    expect(MENSAJE_ERROR_NATIVO).not.toEqual(MENSAJE_ERROR_OUTBOX);
  });
});
