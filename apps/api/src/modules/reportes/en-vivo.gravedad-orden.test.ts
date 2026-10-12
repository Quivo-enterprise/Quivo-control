import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRAVEDAD_ORDEN } from '@quivo/shared';
import { describe, expect, it } from 'vitest';
import { nivelDeOrden } from './en-vivo.service.js';

describe('orden de gravedad: única fuente GRAVEDAD_ORDEN', () => {
  it('nivelDeOrden es el inverso exacto de GRAVEDAD_ORDEN', () => {
    for (const [gravedad, orden] of Object.entries(GRAVEDAD_ORDEN)) {
      expect(nivelDeOrden(orden)).toBe(gravedad);
    }
    expect(nivelDeOrden(null)).toBeNull();
    expect(nivelDeOrden(undefined)).toBeNull();
    expect(nivelDeOrden(0)).toBeNull();
    expect(nivelDeOrden(99)).toBeNull();
  });

  it('el CASE SQL de obtenerPosiciones usa los mismos valores que GRAVEDAD_ORDEN', () => {
    const fuente = readFileSync(fileURLToPath(new URL('./en-vivo.service.ts', import.meta.url)), 'utf8');
    const caso = /max\(CASE i\.gravedad([^]*?)END\)/.exec(fuente)?.[1];
    expect(caso, 'no se encontró el CASE de gravedad en en-vivo.service.ts').toBeDefined();
    const cuando = [...caso!.matchAll(/WHEN '(\w+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])] as const);
    const sinElse = Object.fromEntries(cuando);
    const porElse = /ELSE (\d+)/.exec(caso!)?.[1];
    // Las gravedades con WHEN explícito coinciden; la restante es el ELSE.
    const restantes = Object.keys(GRAVEDAD_ORDEN).filter((g) => !(g in sinElse));
    expect(restantes).toHaveLength(1);
    const resultado = { ...sinElse, [restantes[0]!]: Number(porElse) };
    expect(resultado).toEqual(GRAVEDAD_ORDEN);
  });
});
