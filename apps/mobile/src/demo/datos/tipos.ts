/**
 * portado desde apps/web/src/lib/mock-flota/tipos.ts — mantener sincronizado
 *
 * Solo el subconjunto que necesita el APK demo del conductor: las 2 líneas mockeadas y sus 8
 * trufis. El resto del contrato del web (infracciones, novedades, demanda, config editable) no
 * aplica acá — el motor del APK demo (`../motor.ts`) tiene su propio estado de simulación.
 */

/** Las 2 líneas mockeadas. Los ids son literales exactos usados en toda la UI. */
export type LineaMockId = 'z12' | 'l120';

export interface ParadaMock {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  /** Posición dentro de `LineaMock.paradas`, en el orden real de recorrido del circuito. */
  orden: number;
  /** `true` en 3-4 paradas por línea — punto de control del recorrido. */
  esPuntoControl: boolean;
  /** Radio de tolerancia en metros (50-80) para contar un cumplimiento al cruzar este punto. */
  radioToleranciaM: number;
  /** Avance `[0,1)` PRECALCULADO sobre `LineaMock.polilinea` (ver `avancesDeParadas` en
   * `geometria.ts`). */
  avance: number;
}

export interface LineaMock {
  id: LineaMockId;
  nombre: 'Z12' | 'Línea 120';
  /** Color de borde de los marcadores de esta línea. */
  color: string;
  /** `[lat, lng]` — orden inverso del GeoJSON `[lon, lat]` de donde salen los datos. Usar para
   * MOVER trufis (`posicionEnPolilinea`) — para DIBUJAR el trazo en el mapa usar `trazoRuta`. */
  polilinea: [number, number][];
  /** Tramo a DIBUJAR en el mapa — igual a `polilinea` salvo que la línea sea de ida y vuelta
   * sobre las mismas calles (la 120), donde es solo la ida (`trazoVisibleDe`, `geometria.ts`). */
  trazoRuta: [number, number][];
  paradas: ParadaMock[];
}

export interface TrufiMock {
  id: string;
  placa: string;
  numeroInterno: string;
  conductorNombre: string;
  lineaId: LineaMockId;
  fotoUrl: string;
  /** Solo dígitos, formato E.164 sin `+` (p. ej. `59170000001`). */
  whatsapp: string;
}
