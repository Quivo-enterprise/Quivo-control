import { describe, expect, it } from 'vitest';
import {
  ESTADO_DETECCION_INICIAL,
  MIN_ENTRE_INTENTOS_MS,
  decidirAccionFila,
  estaCercaDeTerminal,
  type EstadoDeteccionFila,
  type FixFila,
  type TerminalZona,
} from './zona-terminal';

const T: TerminalZona = { lat: -17.39, lng: -66.16, radioM: 150 };
// ~1 grado de latitud = 111 km => 0.001 ≈ 111 m
const enMetrosNorte = (m: number): { lat: number; lng: number } => ({
  lat: T.lat + m / 111_195,
  lng: T.lng,
});
const fix = (m: number, accuracy = 20): FixFila => ({ ...enMetrosNorte(m), accuracy, ts: '2026-10-20T11:00:00.000Z' });

function paso(
  f: FixFila,
  o: { enFila?: boolean; desarmada?: boolean; estado?: EstadoDeteccionFila; ahoraMs?: number } = {},
) {
  return decidirAccionFila({
    fix: f,
    terminal: T,
    enFila: o.enFila ?? false,
    desarmada: o.desarmada ?? false,
    estado: o.estado ?? ESTADO_DETECCION_INICIAL,
    ahoraMs: o.ahoraMs ?? 1_000_000,
  });
}

describe('entrada', () => {
  it('fix preciso dentro del radio, sin fila => llegada', () => {
    expect(paso(fix(100)).accion).toBe('llegada');
  });
  it('fuera del radio => nada', () => {
    expect(paso(fix(200)).accion).toBeNull();
  });
  it('precisión > 100 m se ignora', () => {
    expect(paso(fix(10, 101)).accion).toBeNull();
    expect(paso(fix(10, 100)).accion).toBe('llegada');
  });
  it('con fila abierta no vuelve a pedir llegada', () => {
    expect(paso(fix(10), { enFila: true }).accion).toBeNull();
  });
  it('anti-rebote: no reintenta antes de 1 minuto, sí después', () => {
    const r1 = paso(fix(10), { ahoraMs: 1_000_000 });
    expect(r1.accion).toBe('llegada');
    expect(paso(fix(10), { estado: r1.estado, ahoraMs: 1_000_000 + MIN_ENTRE_INTENTOS_MS - 1 }).accion).toBeNull();
    expect(paso(fix(10), { estado: r1.estado, ahoraMs: 1_000_000 + MIN_ENTRE_INTENTOS_MS }).accion).toBe('llegada');
  });
  it('desarmada (acaba de salir de la fila): no se re-encola dentro del radio', () => {
    expect(paso(fix(10), { desarmada: true }).accion).toBeNull();
  });
});

describe('salida y re-armado', () => {
  it('2 fixes consecutivos a más de radio*1.5 estando en fila => salida', () => {
    const a = paso(fix(300), { enFila: true });
    expect(a.accion).toBeNull();
    const b = paso(fix(300), { enFila: true, estado: a.estado });
    expect(b.accion).toBe('salida');
  });
  it('un fix dentro de la histéresis (radio..radio*1.5) corta la racha', () => {
    const a = paso(fix(300), { enFila: true });
    const medio = paso(fix(200), { enFila: true, estado: a.estado });
    expect(medio.estado.fuerasConsecutivos).toBe(0);
    expect(paso(fix(300), { enFila: true, estado: medio.estado }).accion).toBeNull();
  });
  it('un fix impreciso no cuenta ni corta la racha', () => {
    const a = paso(fix(300), { enFila: true });
    const sinPrecision = paso(fix(10, 500), { enFila: true, estado: a.estado });
    expect(sinPrecision.estado).toEqual(a.estado);
    expect(paso(fix(300), { enFila: true, estado: sinPrecision.estado }).accion).toBe('salida');
  });
  it('si el POST de salida falló, no reintenta antes de 1 minuto', () => {
    const a = paso(fix(300), { enFila: true });
    const b = paso(fix(300), { enFila: true, estado: a.estado, ahoraMs: 1_000_000 });
    expect(b.accion).toBe('salida');
    expect(paso(fix(300), { enFila: true, estado: b.estado, ahoraMs: 1_010_000 }).accion).toBeNull();
  });
  it('entrar a la fila (llegada manual) reinicia la racha previa: no hay salida falsa', () => {
    // Racha de 2 fixes lejos ANTES de la llegada manual; enFila pasa a true.
    const racha = { fuerasConsecutivos: 2, ultimoIntentoMs: null, enFilaPrevio: false };
    const t0 = 1_000_000;
    const a = paso(fix(300), { enFila: true, estado: racha, ahoraMs: t0 });
    expect(a.accion).toBeNull();
    expect(a.estado.fuerasConsecutivos).toBe(1);
    const b = paso(fix(300), { enFila: true, estado: a.estado, ahoraMs: t0 + 2_000 });
    expect(b.accion).toBeNull();
    // Pasado el anti-rebote, 2 fixes lejos frescos sí disparan la salida.
    const c = paso(fix(300), { enFila: true, estado: b.estado, ahoraMs: t0 + MIN_ENTRE_INTENTOS_MS });
    expect(c.accion).toBe('salida');
  });
  it('estado inicial (arranque en frío) ya en fila: salida sin esperar el anti-rebote', () => {
    const a = paso(fix(300), { enFila: true });
    const b = paso(fix(300), { enFila: true, estado: a.estado });
    expect(b.accion).toBe('salida');
  });
  it('salir y volver a entrar con fixes imprecisos de por medio igual reinicia la racha', () => {
    const t0 = 1_000_000;
    const a = paso(fix(300), { enFila: true, ahoraMs: t0 });
    expect(a.estado.fuerasConsecutivos).toBe(1);
    const fuera = paso(fix(10, 500), { enFila: false, estado: a.estado, ahoraMs: t0 + 1_000 });
    expect(fuera.estado.enFilaPrevio).toBe(false);
    const b = paso(fix(300), { enFila: true, estado: fuera.estado, ahoraMs: t0 + 2_000 });
    expect(b.accion).toBeNull();
    expect(b.estado.fuerasConsecutivos).toBe(1);
  });
  it('desarmada: se re-arma tras 2 fixes lejos', () => {
    const a = paso(fix(300), { desarmada: true });
    expect(a.accion).toBeNull();
    expect(paso(fix(300), { desarmada: true, estado: a.estado }).accion).toBe('rearmar');
  });
});

describe('botón de respaldo', () => {
  it('cerca = hasta 2 x radio', () => {
    expect(estaCercaDeTerminal(enMetrosNorte(290), T)).toBe(true);
    expect(estaCercaDeTerminal(enMetrosNorte(310), T)).toBe(false);
  });
});
