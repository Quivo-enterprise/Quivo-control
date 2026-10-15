/**
 * Espera `promesa` como máximo `topeMs`. Si el tope vence, devuelve `false` y deja de esperar (la
 * promesa original SIGUE corriendo; no se cancela). Nunca rechaza: si `promesa` rechaza, resuelve
 * `true` (terminó, aunque mal) — el llamador ya trató su propio error. Se usa en el headless, donde
 * la tarea no debe quedar colgada de la red por una consulta no crítica.
 */
export async function esperarConTope(promesa: Promise<unknown>, topeMs: number): Promise<boolean> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<false>((resolve) => {
    temporizador = setTimeout(() => resolve(false), topeMs);
  });
  try {
    return await Promise.race([promesa.then(() => true as const, () => true as const), vencido]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}
