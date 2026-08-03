/** De los `event_id` que se mandaron en un lote, cuáles NO vinieron en el acuse del
 * servidor — esos vuelven a `pendiente` para reintentar (QUI-240, RNF-36). Módulo separado
 * y sin dependencias nativas para poder probarlo sin arrastrar `expo-sqlite`/`netinfo`/
 * `pako` en el árbol de imports del test. */
export function idsNoAcusados(enviados: string[], aceptados: string[]): string[] {
  const aceptadosSet = new Set(aceptados);
  return enviados.filter((id) => !aceptadosSet.has(id));
}
