import { describe, expect, it } from 'vitest';
import { PayloadGpsPointSchema, resolverTsFix } from './evento.js';

const PAYLOAD_BASE = { sesionId: 'sesion-1', lat: -17.78, lng: -63.18, accuracy: 5, speed: 10 };

describe('PayloadGpsPointSchema', () => {
  it('acepta un payload sin `tsFix` — retrocompatibilidad con eventos ya encolados', () => {
    expect(PayloadGpsPointSchema.safeParse(PAYLOAD_BASE).success).toBe(true);
  });

  it('acepta un `tsFix` ISO-8601 y rechaza uno que no lo sea', () => {
    expect(
      PayloadGpsPointSchema.safeParse({ ...PAYLOAD_BASE, tsFix: '2026-08-14T12:00:00.000Z' })
        .success,
    ).toBe(true);
    expect(PayloadGpsPointSchema.safeParse({ ...PAYLOAD_BASE, tsFix: 'ayer' }).success).toBe(false);
  });
});

describe('resolverTsFix', () => {
  const tsEncolado = '2026-08-14T12:30:00.000Z';

  it('prefiere el timestamp del fix GPS sobre el de encolado (evidencia RF-67..73)', () => {
    // Caso headless: el SDK entrega en ráfaga al salir de Doze — el fix es de 25 min antes.
    const ts = resolverTsFix(
      { ...PAYLOAD_BASE, tsFix: '2026-08-14T12:05:00.000Z' },
      tsEncolado,
    );
    expect(ts).toBe('2026-08-14T12:05:00.000Z');
  });

  it('cae al ts de encolado cuando el payload no trae `tsFix` (evento de una app anterior)', () => {
    expect(resolverTsFix(PAYLOAD_BASE, tsEncolado)).toBe(tsEncolado);
  });

  it('cae al ts de encolado cuando el `tsFix` es ilegible o no es un string', () => {
    expect(resolverTsFix({ ...PAYLOAD_BASE, tsFix: 'ayer' }, tsEncolado)).toBe(tsEncolado);
    expect(resolverTsFix({ ...PAYLOAD_BASE, tsFix: 1_760_000_000 }, tsEncolado)).toBe(
      tsEncolado,
    );
    expect(resolverTsFix(null, tsEncolado)).toBe(tsEncolado);
  });

  it('ignora un `tsFix` posterior al encolado (reloj del dispositivo corrido)', () => {
    // El fix siempre precede al encolado: un tsFix "del futuro" es dato corrupto.
    expect(
      resolverTsFix({ ...PAYLOAD_BASE, tsFix: '2026-08-14T14:00:00.000Z' }, tsEncolado),
    ).toBe(tsEncolado);
  });

  it('tolera un adelanto de hasta un minuto (jitter de NTP)', () => {
    expect(
      resolverTsFix({ ...PAYLOAD_BASE, tsFix: '2026-08-14T12:30:30.000Z' }, tsEncolado),
    ).toBe('2026-08-14T12:30:30.000Z');
  });

  it('tolera un atraso de hasta 7 días (buffer headless extendido)', () => {
    const tsFix = new Date(Date.parse(tsEncolado) - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(resolverTsFix({ ...PAYLOAD_BASE, tsFix }, tsEncolado)).toBe(tsFix);
  });

  it('ignora un `tsFix` de más de 7 días antes del encolado (RTC descargado / dato corrupto)', () => {
    // Un `tsFix` así de viejo no puede venir de un buffer headless legítimo (el buffer de
    // Doze se mide en horas) — cae al `ts` de encolado en vez de arriesgar un `23514 no
    // partition of relation` que tumbe el lote de 500 entero.
    const tsFix = new Date(Date.parse(tsEncolado) - 7 * 24 * 60 * 60 * 1000 - 1).toISOString();
    expect(resolverTsFix({ ...PAYLOAD_BASE, tsFix }, tsEncolado)).toBe(tsEncolado);
  });

  it('normaliza el `tsFix` a ISO-8601 UTC aunque venga con offset', () => {
    expect(
      resolverTsFix({ ...PAYLOAD_BASE, tsFix: '2026-08-14T08:05:00.000-04:00' }, tsEncolado),
    ).toBe('2026-08-14T12:05:00.000Z');
  });

  it('es agnóstico del tipo de evento: sirve igual para el payload de cumplimiento_punto_control', () => {
    // La función solo mira `payload.tsFix` (`TsFixSchema` descarta el resto de las claves) —
    // por eso `procesarCumplimientoEnTx` (ingesta-worker.service.ts) la reusa tal cual para
    // el `ts` de `cumplimientos_pc` (RF-64..66), no solo para `gps_point`.
    const payloadCumplimiento = {
      sesionId: 'sesion-1',
      puntoControlId: 'pc-1',
      lat: -17.78,
      lng: -63.18,
      tsFix: '2026-08-14T12:05:00.000Z',
    };
    expect(resolverTsFix(payloadCumplimiento, tsEncolado)).toBe('2026-08-14T12:05:00.000Z');
  });
});
