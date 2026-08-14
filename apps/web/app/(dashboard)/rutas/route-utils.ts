import type { Ruta, TipoParada } from '@quivo/shared';

export type FiltroEstadoRuta = Ruta['estado'] | 'todos';

export function filtrarRutas(rutas: Ruta[], sentido: string, estado: FiltroEstadoRuta): Ruta[] {
  return rutas.filter(
    (ruta) =>
      (sentido === 'todos' || ruta.sentido === sentido) &&
      (estado === 'todos' || ruta.estado === estado),
  );
}

export function calcularDistanciaRutaKm(
  coordinates: ReadonlyArray<readonly [number, number]>,
): number {
  let distanciaKm = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const anterior = coordinates[index - 1];
    const actual = coordinates[index];
    if (!anterior || !actual) continue;
    distanciaKm += distanciaHaversineKm(anterior[1], anterior[0], actual[1], actual[0]);
  }
  return distanciaKm;
}

export function formatearDistancia(distanciaKm: number): string {
  if (distanciaKm < 1) return `${Math.round(distanciaKm * 1000)} m`;
  return `${distanciaKm.toFixed(1)} km`;
}

export function capitalizar(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

export function eliminarPuntoTrazado<T>(points: ReadonlyArray<T>, index: number): T[] {
  if (index < 0 || index >= points.length) return [...points];
  return points.filter((_, pointIndex) => pointIndex !== index);
}

export function moverPuntoTrazado<T>(
  points: ReadonlyArray<T>,
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= points.length ||
    toIndex < 0 ||
    toIndex >= points.length ||
    fromIndex === toIndex
  ) {
    return [...points];
  }
  const reordered = [...points];
  const [point] = reordered.splice(fromIndex, 1);
  if (point === undefined) return reordered;
  reordered.splice(toIndex, 0, point);
  return reordered;
}

export function invertirPuntosTrazado<T>(points: ReadonlyArray<T>): T[] {
  return [...points].reverse();
}

export function invertirElementosOrdenados<T extends { orden: number }>(
  elements: ReadonlyArray<T>,
): T[] {
  const ordered = [...elements].sort((a, b) => a.orden - b.orden);
  const orders = ordered.map((element) => element.orden);
  return ordered.reverse().map((element, index) => ({
    ...element,
    orden: orders[index] ?? element.orden,
  }));
}

export function invertirTipoParada(tipo: TipoParada): TipoParada {
  if (tipo === 'origen') return 'destino';
  if (tipo === 'destino') return 'origen';
  return tipo;
}

function distanciaHaversineKm(
  latitudA: number,
  longitudA: number,
  latitudB: number,
  longitudB: number,
): number {
  const radioTierraKm = 6371.0088;
  const aLatitud = gradosARadianes(latitudA);
  const bLatitud = gradosARadianes(latitudB);
  const deltaLatitud = gradosARadianes(latitudB - latitudA);
  const deltaLongitud = gradosARadianes(longitudB - longitudA);
  const haversine =
    Math.sin(deltaLatitud / 2) ** 2 +
    Math.cos(aLatitud) * Math.cos(bLatitud) * Math.sin(deltaLongitud / 2) ** 2;
  return radioTierraKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function gradosARadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}
