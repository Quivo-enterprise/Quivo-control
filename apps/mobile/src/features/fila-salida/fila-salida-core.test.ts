import { describe, expect, it } from 'vitest';
import type { EstadoFilaSalida } from '@quivo/shared';
import {
  DEMORA_VISIBLE_MS,
  debeAvisar,
  desfaseReloj,
  estaDemorado,
  formatearCuenta,
  habilitadoLocal,
  idAvisoFila,
  momentoLocalAviso,
  restanteMs,
  textoAccesible,
  textoBoton,
  textoHoraSalida,
  textoPosicion,
  textoTurno,
} from './fila-salida-core';

const SERVIDOR = Date.parse('2026-10-20T11:00:00.000Z');
function fila(parcial: Partial<EstadoFilaSalida> = {}): EstadoFilaSalida {
  return {
    posicion: 3,
    total: 7,
    delantePlaca: '1234ABC',
    etaTs: new Date(SERVIDOR + 130_000).toISOString(),
    esperaMs: 130_000,
    habilitado: false,
    demorado: false,
    servidorTs: new Date(SERVIDOR).toISOString(),
    ...parcial,
  };
}

describe('reloj', () => {
  it('desfase = servidor - recepción local, y la cuenta usa el reloj corregido', () => {
    const recibido = SERVIDOR - 90_000; // el teléfono va 90 s atrasado
    const d = desfaseReloj(fila(), recibido);
    expect(d).toBe(90_000);
    // 10 s después de recibir, faltan 120 s
    expect(restanteMs(fila(), recibido + 10_000 + d)).toBe(120_000);
  });
  it('servidorTs inválido => desfase 0', () => {
    expect(desfaseReloj(fila({ servidorTs: 'x' }), 5)).toBe(0);
  });
  it('momento local del aviso = eta - desfase - 60 s', () => {
    const recibido = SERVIDOR - 90_000;
    const d = desfaseReloj(fila(), recibido);
    expect(momentoLocalAviso(fila(), d)).toBe(SERVIDOR + 130_000 - 90_000 - 60_000);
    expect(momentoLocalAviso(fila({ etaTs: 'x' }), d)).toBeNull();
  });
});

describe('habilitado / demorado', () => {
  it('respeta el flag del servidor', () => {
    expect(habilitadoLocal(fila({ habilitado: true }), SERVIDOR)).toBe(true);
  });
  it('el primero se habilita al llegar su hora aunque el servidor no lo sepa aún', () => {
    const f = fila({ posicion: 1, delantePlaca: null });
    expect(habilitadoLocal(f, SERVIDOR + 129_000)).toBe(false);
    expect(habilitadoLocal(f, SERVIDOR + 130_000)).toBe(true);
  });
  it('un trufi que no es el primero NO se habilita por reloj', () => {
    expect(habilitadoLocal(fila({ posicion: 2 }), SERVIDOR + 999_000)).toBe(false);
  });
  it('demorado solo pasado DEMORA_VISIBLE_MS de la hora (el flag del servidor se ignora)', () => {
    expect(estaDemorado(fila({ demorado: true }), SERVIDOR)).toBe(false);
    const f = fila({ posicion: 1 });
    expect(estaDemorado(f, SERVIDOR + 131_000)).toBe(false); // recién pasó la hora
    expect(estaDemorado(f, SERVIDOR + 130_000 + DEMORA_VISIBLE_MS)).toBe(false);
    expect(estaDemorado(f, SERVIDOR + 130_000 + DEMORA_VISIBLE_MS + 1)).toBe(true);
  });
});

describe('debeAvisar', () => {
  const f = fila({ posicion: 1, delantePlaca: null });
  it('solo cuando faltan <= 60 s y > 0', () => {
    expect(debeAvisar(f, SERVIDOR + 69_000, null)).toBe(false); // faltan 61 s
    expect(debeAvisar(f, SERVIDOR + 70_000, null)).toBe(true); // faltan 60 s
    expect(debeAvisar(f, SERVIDOR + 129_999, null)).toBe(true);
    expect(debeAvisar(f, SERVIDOR + 130_000, null)).toBe(false); // ya es la hora
  });
  it('una sola vez por etaTs; un etaTs nuevo avisa de nuevo', () => {
    expect(debeAvisar(f, SERVIDOR + 100_000, f.etaTs)).toBe(false);
    expect(debeAvisar(f, SERVIDOR + 100_000, 'otro')).toBe(true);
  });
  it('no avisa a quien no es el primero', () => {
    expect(debeAvisar(fila({ posicion: 2 }), SERVIDOR + 100_000, null)).toBe(false);
  });
  it('no avisa si el servidor ya la trae habilitada', () => {
    expect(debeAvisar(fila({ posicion: 1, habilitado: true }), SERVIDOR + 100_000, null)).toBe(
      false,
    );
  });
});

describe('textos', () => {
  it('cuenta mm:ss, redondea hacia arriba y no baja de 0:00', () => {
    expect(formatearCuenta(130_000)).toBe('2:10');
    expect(formatearCuenta(129_001)).toBe('2:10');
    expect(formatearCuenta(-5)).toBe('0:00');
    expect(formatearCuenta(NaN)).toBe('0:00');
    expect(formatearCuenta(3_725_000)).toBe('1:02:05');
  });
  it('posición, turno, botón', () => {
    expect(textoPosicion(fila())).toBe('Posición 3 de 7 · delante 1234ABC');
    expect(textoPosicion(fila({ delantePlaca: null, posicion: 1 }))).toBe('Posición 1 de 7');
    expect(textoTurno(false)).toBe('En espera');
    expect(textoTurno(true)).toBe('Es tu turno');
    expect(textoBoton(false, 130_000)).toBe('SALIR · 2:10');
    expect(textoBoton(true, 0)).toBe('SALIR');
    expect(textoBoton(true, -500)).toBe('SALIR');
    expect(textoBoton(true, -135_000)).toBe('SALIR · −2:15');
  });
  it('hora de salida en Bolivia (UTC-4)', () => {
    expect(textoHoraSalida({ etaTs: '2026-10-20T11:24:00.000Z' })).toBe('Salís a las 07:24');
    expect(textoHoraSalida({ etaTs: 'x' })).toBeNull();
  });
  it('texto accesible cambia por minuto, no por segundo', () => {
    expect(textoAccesible(false, 130_000)).toBe('Te toca en 3 minutos');
    expect(textoAccesible(false, 121_000)).toBe('Te toca en 3 minutos');
    expect(textoAccesible(false, 59_000)).toBe('Te toca en 1 minuto');
    expect(textoAccesible(true, 0)).toBe('Es tu turno. Ya podés salir');
  });
  it('id del aviso depende del etaTs', () => {
    expect(idAvisoFila('a')).not.toBe(idAvisoFila('b'));
  });
});
