import { describe, expect, it } from 'vitest';
import { crearCsvStream, filaACsv } from './csv.util.js';

async function leerStream(readable: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

describe('filaACsv', () => {
  it('une valores simples con coma y termina en CRLF', () => {
    expect(filaACsv(['a', 'b', 1, true])).toBe('a,b,1,true\r\n');
  });

  it('null se serializa como campo vacío', () => {
    expect(filaACsv(['a', null, 'c'])).toBe('a,,c\r\n');
  });

  it('escapa valores con coma envolviendo en comillas', () => {
    expect(filaACsv(['Línea 1, ida'])).toBe('"Línea 1, ida"\r\n');
  });

  it('escapa comillas dobles duplicándolas', () => {
    expect(filaACsv(['dijo "hola"'])).toBe('"dijo ""hola"""\r\n');
  });

  it('escapa saltos de línea', () => {
    expect(filaACsv(['a\nb'])).toBe('"a\nb"\r\n');
  });

  it('no escapa valores sin caracteres especiales', () => {
    expect(filaACsv(['simple'])).toBe('simple\r\n');
  });
});

describe('crearCsvStream', () => {
  it('emite la cabecera seguida de cada lote de filas del generator', async () => {
    async function* generador() {
      yield ['1', 'uno'];
      yield ['2', 'dos'];
    }
    const stream = crearCsvStream(['id', 'nombre'], generador);
    const csv = await leerStream(stream);
    expect(csv).toBe('id,nombre\r\n1,uno\r\n2,dos\r\n');
  });

  it('un generator vacío produce solo la cabecera', async () => {
    async function* generador() {}
    const stream = crearCsvStream(['id'], generador);
    const csv = await leerStream(stream);
    expect(csv).toBe('id\r\n');
  });
});
