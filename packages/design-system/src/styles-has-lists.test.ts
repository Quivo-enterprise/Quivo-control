import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Un selector con :has() sin soporte (Chrome < 105) anula la lista completa: no se mezclan.
describe('styles.css', () => {
  it('ninguna lista de selectores mezcla :has() con selectores sin :has()', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const mixed: string[] = [];
    for (const m of css.matchAll(/([^{};]+)\{/g)) {
      const prelude = m[1]!.trim();
      if (prelude.startsWith('@')) continue;
      const list = prelude.split(',').map((x) => x.trim());
      const withHas = list.filter((x) => x.includes(':has(')).length;
      if (withHas > 0 && withHas < list.length) mixed.push(prelude.replace(/\s+/g, ' '));
    }
    expect(mixed).toEqual([]);
  });
});
