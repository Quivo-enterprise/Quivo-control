export type VarianteSilueta = 'bus' | 'minibus' | 'micro';

/** Variante de carrocería según el tipo del vehículo (los desconocidos usan minibús). */
export function variantePorTipo(tipo: string): VarianteSilueta {
  switch (tipo) {
    case 'omnibus':
    case 'bus_urbano':
      return 'bus';
    case 'taxi_trufi':
    case 'trufi':
      return 'micro';
    default:
      return 'minibus';
  }
}
