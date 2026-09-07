/**
 * Catálogo de ciudades y coordenadas centrales de Bolivia para foco y geoposicionamiento en QUIVO.
 */
export interface CiudadBolivia {
  id: string;
  nombre: string;
  departamento: string;
  lat: number;
  lng: number;
  zoomDefault: number;
}

export const CIUDAD_DEFAULT: CiudadBolivia = {
  id: 'cochabamba',
  nombre: 'Cochabamba',
  departamento: 'Cochabamba',
  lat: -17.3895,
  lng: -66.1568,
  zoomDefault: 13,
};

export const CIUDADES_BOLIVIA: Record<string, CiudadBolivia> = {
  cochabamba: CIUDAD_DEFAULT,
  'la-paz': {
    id: 'la-paz',
    nombre: 'La Paz',
    departamento: 'La Paz',
    lat: -16.5,
    lng: -68.15,
    zoomDefault: 13,
  },
  'el-alto': {
    id: 'el-alto',
    nombre: 'El Alto',
    departamento: 'La Paz',
    lat: -16.5048,
    lng: -68.1632,
    zoomDefault: 13,
  },
  'santa-cruz': {
    id: 'santa-cruz',
    nombre: 'Santa Cruz de la Sierra',
    departamento: 'Santa Cruz',
    lat: -17.7833,
    lng: -63.1821,
    zoomDefault: 13,
  },
  sucre: {
    id: 'sucre',
    nombre: 'Sucre',
    departamento: 'Chuquisaca',
    lat: -19.0429,
    lng: -65.2554,
    zoomDefault: 13,
  },
  tarija: {
    id: 'tarija',
    nombre: 'Tarija',
    departamento: 'Tarija',
    lat: -21.5355,
    lng: -64.7296,
    zoomDefault: 13,
  },
  oruro: {
    id: 'oruro',
    nombre: 'Oruro',
    departamento: 'Oruro',
    lat: -17.9647,
    lng: -67.106,
    zoomDefault: 13,
  },
  potosi: {
    id: 'potosi',
    nombre: 'Potosí',
    departamento: 'Potosí',
    lat: -19.5836,
    lng: -65.7531,
    zoomDefault: 13,
  },
  trinidad: {
    id: 'trinidad',
    nombre: 'Trinidad',
    departamento: 'Beni',
    lat: -14.8333,
    lng: -64.9,
    zoomDefault: 13,
  },
  cobija: {
    id: 'cobija',
    nombre: 'Cobija',
    departamento: 'Pando',
    lat: -11.0267,
    lng: -68.7692,
    zoomDefault: 13,
  },
};

/**
 * Resuelve la ciudad y coordenadas según el identificador de ciudad (ej. 'cochabamba', 'la-paz').
 */
export function resolverCiudadBolivia(cityId?: string | null): CiudadBolivia {
  if (!cityId) return CIUDAD_DEFAULT;
  const normalizada = cityId.toLowerCase().trim().replace(/\s+/g, '-');
  return CIUDADES_BOLIVIA[normalizada] ?? CIUDAD_DEFAULT;
}

/**
 * Encuentra la ciudad más cercana de Bolivia dadas unas coordenadas GPS del navegador.
 */
export function encontrarCiudadMasCercana(lat: number, lng: number): CiudadBolivia {
  let ciudadCercana = CIUDAD_DEFAULT;
  let menorDistancia = Number.POSITIVE_INFINITY;

  for (const ciudad of Object.values(CIUDADES_BOLIVIA)) {
    const dLat = ciudad.lat - lat;
    const dLng = ciudad.lng - lng;
    const distCuadrada = dLat * dLat + dLng * dLng;
    if (distCuadrada < menorDistancia) {
      menorDistancia = distCuadrada;
      ciudadCercana = ciudad;
    }
  }

  return ciudadCercana;
}
