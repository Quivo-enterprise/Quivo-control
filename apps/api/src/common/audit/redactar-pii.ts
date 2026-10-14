/**
 * Enmascara los últimos 8 dígitos de un valor tipo teléfono dejando visibles solo los 2
 * finales (`+59171234567` -> `+591******67`). Prefijo y separadores no se tocan. `''`/`null`
 * se conservan tal cual (significan "limpiar el valor", no son un dato personal).
 */
export function enmascararTelefono(valor: unknown): unknown {
  if (valor === null || valor === undefined || valor === '') return valor;
  if (typeof valor !== 'string') return '[redactado]';
  let vistos = 0;
  let resultado = '';
  for (let i = valor.length - 1; i >= 0; i -= 1) {
    const c = valor[i] as string;
    if (/\d/.test(c)) {
      vistos += 1;
      resultado = (vistos <= 2 || vistos > 8 ? c : '*') + resultado;
    } else {
      resultado = c + resultado;
    }
  }
  return resultado;
}

/** Claves de primer nivel del body con PII y cómo se enmascaran en `audit_log.diff`. Agregar acá más claves. */
const REDACTORES_PII: Record<string, (valor: unknown) => unknown> = {
  telefono: enmascararTelefono,
};

/**
 * Devuelve una copia del `diff` con las claves PII de primer nivel enmascaradas; el resto
 * (y los diffs que no son objetos planos) pasa intacto. No muta el body original.
 */
export function redactarPii(diff: unknown): unknown {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return diff;
  const copia: Record<string, unknown> = { ...(diff as Record<string, unknown>) };
  for (const [clave, redactor] of Object.entries(REDACTORES_PII)) {
    if (clave in copia) copia[clave] = redactor(copia[clave]);
  }
  return copia;
}
