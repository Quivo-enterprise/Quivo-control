import { PaqueteDiaSchema, type PaqueteDia } from '@quivo/shared';
import { ApiError as PaqueteDiaApiError, parseResponse, request } from './http-client';

export { PaqueteDiaApiError };



const USE_MOCK = process.env.EXPO_PUBLIC_USE_MOCK_ROUTE === 'true';

export const paqueteDiaApi = {
  async obtenerAsignacionDelDia(accessToken: string): Promise<PaqueteDia> {
    if (USE_MOCK) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return {
        asignacion: {
          id: '11111111-1111-1111-1111-111111111111',
          fecha: new Date().toISOString().substring(0, 10),
          horario: 'manana' as const,
          venceAt: new Date(Date.now() + 8 * 3600000).toISOString(),
        },
        ruta: {
          id: '66666666-6666-6666-6666-666666666666',
          sentido: 'Ida',
          geometria: {
            type: 'LineString',
            coordinates: [
              [-68.130283, -16.502931],
              [-68.129333, -16.503433],
              [-68.128383, -16.503936]
            ]
          }
        },
        linea: {
          id: '55555555-5555-5555-5555-555555555555',
          codigo: 'L1',
          nombre: 'Línea 1',
          color: '#0F1B5C',
        },
        paradas: [
          {
            id: '77777777-7777-7777-7777-777777777777',
            tipo: 'intermedia' as const,
            orden: 1,
            coord: { type: 'Point', coordinates: [-68.129333, -16.503433] }
          }
        ],
        puntosControl: [
          {
            id: '88888888-8888-8888-8888-888888888888',
            orden: 1,
            coord: { type: 'Point', coordinates: [-68.128383, -16.503936] },
            radioToleranciaM: 50,
            obligatorio: true
          },
          {
            id: '88888888-8888-8888-8888-888888888889',
            orden: 2,
            coord: { type: 'Point', coordinates: [-68.127383, -16.504936] },
            radioToleranciaM: 50,
            obligatorio: true
          },
          {
            id: '88888888-8888-8888-8888-88888888888A',
            orden: 3,
            coord: { type: 'Point', coordinates: [-68.126383, -16.505936] },
            radioToleranciaM: 50,
            obligatorio: true
          },
          {
            id: '88888888-8888-8888-8888-88888888888B',
            orden: 4,
            coord: { type: 'Point', coordinates: [-68.125383, -16.506936] },
            radioToleranciaM: 50,
            obligatorio: true
          },
          {
            id: '88888888-8888-8888-8888-88888888888C',
            orden: 5,
            coord: { type: 'Point', coordinates: [-68.124383, -16.507936] },
            radioToleranciaM: 50,
            obligatorio: true
          }
        ]
      };
    }

    const payload = await request('/v1/mobile/asignacion-del-dia', {
      method: 'GET',
      accessToken,
    });
    return parseResponse(PaqueteDiaSchema, payload);
  },
};
