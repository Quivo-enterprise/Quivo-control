/** Concatenador mínimo de clases — evita traer `clsx`/`classnames` como dependencia para un
 * paquete que ya declara "sin Tailwind, CSS propio". Ignora falsy (`false`, `undefined`, `''`). */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
