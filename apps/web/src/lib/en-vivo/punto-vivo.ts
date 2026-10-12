/** Estructural, igual que `PuntoAnimable` de `vehicle-marker-animation.ts` (design-system). */
export interface PuntoConTs {
  lat: number;
  lng: number;
  ts: string;
}

/**
 * Agrega a la traza de la sesión seleccionada el último fix que trajo el poll de
 * `/posiciones` (2 s), para que el vehículo seleccionado no espere al poll de traza (10 s).
 *
 * Anti-duplicado / anti-salto: solo se agrega si su `ts` es ESTRICTAMENTE posterior al último
 * punto de la traza. `encolarNuevosPuntos` detecta puntos nuevos comparando `ts` contra el
 * cursor `lastConsumedTs` (no por índice), así que cuando la traza llegue después con el
 * mismo fix, o con fixes intermedios más viejos que el que ya se animó, quedan por debajo del
 * cursor y se ignoran: no hay doble animación ni saltos hacia atrás (a lo sumo se omiten
 * vértices intermedios, que el marcador ya sobrepasó). Los `ts` de ambas fuentes son ISO-8601
 * serializados de `Date` por la API (mismo formato), por eso se comparan igual que allá.
 */
export function conPuntoVivo(
  puntos: PuntoConTs[],
  vivo: { lat: number | null; lng: number | null; ultimoFixTs: string | null } | null | undefined,
): PuntoConTs[] {
  if (!vivo || vivo.lat === null || vivo.lng === null || vivo.ultimoFixTs === null) {
    return puntos;
  }
  const ultimo = puntos.at(-1);
  if (ultimo && vivo.ultimoFixTs <= ultimo.ts) return puntos;
  return [...puntos, { lat: vivo.lat, lng: vivo.lng, ts: vivo.ultimoFixTs }];
}
