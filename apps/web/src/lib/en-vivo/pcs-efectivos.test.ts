import { describe, expect, it } from 'vitest';
import type { ContextoEnVivo } from '@quivo/shared';
import { pcsEfectivos } from './pcs-efectivos';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pc = (n: number, orden: number, rol: 'terminal' | 'retorno' | 'espera' | null = null) => ({
  id: id(n),
  orden,
  rol,
  coord: { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
  radioToleranciaM: 30,
});
const ctx = (puntosControl: ReturnType<typeof pc>[], puntoEsperaPorVariante: Record<string, string> = {}) =>
  ({ puntosControl, puntoEsperaPorVariante }) as Pick<ContextoEnVivo, 'puntosControl' | 'puntoEsperaPorVariante'>;
const ids = (l: { id: string }[]) => l.map((p) => p.id);

describe('pcsEfectivos', () => {
  const c = ctx([pc(1, 0, 'terminal'), pc(2, 1), pc(3, 2, 'espera'), pc(4, 3, 'retorno')], { [id(90)]: id(3) });

  it('excluye el PC de espera sin variante designada', () => {
    expect(ids(pcsEfectivos(c, null))).toEqual([id(1), id(2), id(4)]);
    expect(ids(pcsEfectivos(c, id(91)))).toEqual([id(1), id(2), id(4)]);
  });

  it('lo incluye tras el retorno si su orden es menor que el del retorno', () => {
    expect(ids(pcsEfectivos(c, id(90)))).toEqual([id(1), id(2), id(4), id(3)]);
  });

  it('con orden posterior al retorno queda en su orden; numeración = índice + 1', () => {
    const n = ctx([pc(1, 0, 'terminal'), pc(4, 1, 'retorno'), pc(3, 2, 'espera')], { [id(90)]: id(3) });
    expect(ids(pcsEfectivos(n, id(90)))).toEqual([id(1), id(4), id(3)]);
  });

  it('sin ningún rol espera devuelve todo ordenado por orden', () => {
    expect(ids(pcsEfectivos(ctx([pc(2, 1), pc(1, 0)]), null))).toEqual([id(1), id(2)]);
  });
});
