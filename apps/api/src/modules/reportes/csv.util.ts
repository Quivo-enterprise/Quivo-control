import { Readable } from 'node:stream';

/** RFC 4180: solo hace falta escapar (comillas dobles envolventes + `"` duplicada adentro)
 * cuando el valor contiene coma, comilla o salto de línea — el resto pasa tal cual. */
function escaparCampoCsv(valor: string): string {
  if (/[",\n\r]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

export function filaACsv(valores: (string | number | boolean | null)[]): string {
  return valores.map((v) => escaparCampoCsv(v === null ? '' : String(v))).join(',') + '\r\n';
}

/**
 * RF-78..80 (QUI-249): "generación server-side con paginación/streaming para volúmenes
 * grandes" — `generarFilas` es un async generator que va rindiendo lotes de filas ya
 * paginados por el caller (LIMIT/OFFSET sobre la query real, ver `exportes.service.ts`), así
 * el CSV completo nunca queda materializado en memoria de una sola vez, sin importar cuántas
 * filas tenga el reporte.
 */
export function crearCsvStream(
  cabecera: string[],
  generarFilas: () => AsyncGenerator<(string | number | boolean | null)[]>,
): Readable {
  async function* lineas() {
    yield filaACsv(cabecera);
    for await (const fila of generarFilas()) {
      yield filaACsv(fila);
    }
  }
  return Readable.from(lineas());
}
