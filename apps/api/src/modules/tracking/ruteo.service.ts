import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RutaCalculada } from '@quivo/shared';

interface OsrmRouteResponse {
  code: string;
  routes?: Array<{
    geometry: { coordinates: [number, number][] };
    distance: number;
    duration: number;
  }>;
}

export interface PuntoLatLng {
  lat: number;
  lng: number;
}

/** Ruteo real sobre calles vía OSRM self-hosted (`scripts/setup-osrm.sh`, sin API key de
 * terceros) — usado por el mapa móvil para trazar "cómo llegar/volver a la ruta" en vez de
 * una línea recta. Devuelve `null` (no lanza) si OSRM no responde: el mapa cae a la línea
 * recta existente, el ruteo real es una mejora visual, no algo bloqueante para operar. */
@Injectable()
export class RuteoService {
  private readonly logger = new Logger(RuteoService.name);
  private readonly osrmUrl: string;

  // Ver comentario en retencion-gps.service.ts sobre @Inject(ConfigService) explícito
  // (tsx/esbuild no emite metadata de tipos para clases de paquetes externos en dev).
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.osrmUrl = (this.config.get<string>('OSRM_URL') ?? 'http://localhost:5001').replace(/\/$/, '');
  }

  async rutaEntrePuntos(origen: PuntoLatLng, destino: PuntoLatLng): Promise<RutaCalculada | null> {
    const url = `${this.osrmUrl}/route/v1/driving/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) return null;
      const data = (await response.json()) as OsrmRouteResponse;
      const ruta = data.routes?.[0];
      if (data.code !== 'Ok' || !ruta || ruta.geometry.coordinates.length < 2) return null;
      return {
        coordenadas: ruta.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
        distanciaM: ruta.distance,
        duracionS: ruta.duration,
      };
    } catch (error) {
      this.logger.warn(`No se pudo calcular ruta con OSRM (${this.osrmUrl}): ${String(error)}`);
      return null;
    }
  }
}
