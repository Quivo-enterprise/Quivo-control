import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regresión (spike ubicación fluida): `babel-preset-expo` solo inlinea `EXPO_PUBLIC_*` cuando el
 * código escribe literalmente `process.env.EXPO_PUBLIC_X`. Un acceso indirecto (`env.EXPO_PUBLIC_X`
 * con `env = process.env`, `process.env[...]`, desestructuración) funciona en dev pero devuelve
 * `undefined` en el bundle release. Este test recorre el código no-test de `src` y falla ante
 * cualquier acceso no literal.
 */
// vitest corre con cwd = apps/mobile (ver `pnpm test` en package.json).
const SRC = join(process.cwd(), 'src');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === 'node_modules' ? [] : archivos(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

/** Quita comentarios y strings-mensaje (con espacios, p. ej. 'Falta EXPO_PUBLIC_API_URL ...'). */
function codigo(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\w'"`])\/\/.*$/gm, '$1')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (str) => (/\s/.test(str) ? "''" : str));
}

describe('variables EXPO_PUBLIC_* en src', () => {
  const lista = archivos(SRC).map((ruta) => ({ ruta, codigo: codigo(readFileSync(ruta, 'utf8')) }));

  it('encuentra archivos para revisar', () => {
    expect(lista.length).toBeGreaterThan(20);
  });

  it('toda aparición de EXPO_PUBLIC_ va precedida de process.env.', () => {
    const malos = lista.flatMap(({ ruta, codigo: c }) =>
      [...c.matchAll(/EXPO_PUBLIC_\w+/g)]
        .filter((m) => !c.slice(0, m.index).endsWith('process.env.'))
        .map((m) => `${ruta}: ${m[0]}`),
    );
    expect(malos).toEqual([]);
  });

  it('no usa process.env[...] ni lo asigna/pasa como valor', () => {
    const malos = lista.flatMap(({ ruta, codigo: c }) =>
      [...c.matchAll(/process\.env\s*\[|=\s*process\.env\b(?!\.)|\(\s*process\.env\s*\)|=\s*process\.env\s*\)/g)].map(
        (m) => `${ruta}: ${m[0]}`,
      ),
    );
    expect(malos).toEqual([]);
  });
});
