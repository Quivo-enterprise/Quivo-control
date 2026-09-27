import { useMemo } from 'react';
import type { PaqueteDia } from '@quivo/shared';
import type { usePaqueteDia } from '../features/operacion/use-paquete-dia';
import { LINEAS_MOCK } from './datos/datos';
import type { LineaMockId } from './datos/tipos';
import { idParadaDemo, uuidDemo } from './cuentas';
import { useDemo } from './demo-provider';

/**
 * Equivalente demo de `usePaqueteDia` (`../features/operacion/use-paquete-dia.ts`) — mismo
 * contrato (`ReturnType<typeof usePaqueteDia>`). Ignora el parámetro `obtenerAccessToken` (se
 * mantiene solo para que el swap en `gps-provider.tsx` sea un simple `MODO_DEMO ? demo : real`
 * sin tocar la firma del call site) y arma el `PaqueteDia` de la línea propia (leída de
 * `useDemo()`, que a su vez viene del `trufiPropioId` con el que se logueó — ver
 * `./use-auth-movil-demo.ts`) a partir de `LINEAS_MOCK`, sin red ni SQLite.
 *
 * Nunca está `cargando` ni `vencido`, y `error` siempre es `null` — el demo no tiene forma de
 * fallar acá (no hay fetch que pueda rechazar).
 */
export function usePaqueteDiaDemo(
  _obtenerAccessToken: () => Promise<string | null>,
): ReturnType<typeof usePaqueteDia> {
  const { estado } = useDemo();
  const paquete = useMemo(
    () => construirPaqueteDiaDemo(estado.lineaPropiaId),
    [estado.lineaPropiaId],
  );

  return useMemo(
    () => ({
      cargando: false,
      paquete,
      vencido: false,
      error: null,
      recargar: async () => {},
    }),
    [paquete],
  );
}

/**
 * Pura y exportada aparte para poder testearla con `PaqueteDiaSchema.parse` sin levantar el
 * hook (`use-paquete-dia-demo.test.ts`).
 */
export function construirPaqueteDiaDemo(lineaId: LineaMockId): PaqueteDia {
  const linea = LINEAS_MOCK[lineaId];
  const ahora = Date.now();
  const ultimoOrden = Math.max(...linea.paradas.map((p) => p.orden));

  return {
    asignacion: {
      id: uuidDemo(`paquete-asignacion-${lineaId}`),
      fecha: new Date(ahora).toISOString().slice(0, 10),
      horario: 'manana',
      horaSalida: null,
      horaPresentacion: null,
      venceAt: new Date(ahora + 24 * 60 * 60 * 1000).toISOString(),
    },
    ruta: {
      id: uuidDemo(`ruta-${lineaId}`),
      sentido: lineaId === 'z12' ? 'Circuito Villa Armonía' : 'Plaza Colón ⇄ La Cancha',
      // GeoJSON usa [lon, lat] — `LineaMock.polilinea` está en [lat, lng] (ver su docblock).
      geometria: {
        type: 'LineString',
        coordinates: linea.polilinea.map(([lat, lng]) => [lng, lat] as [number, number]),
      },
    },
    linea: {
      id: uuidDemo(`linea-${lineaId}`),
      codigo: linea.nombre,
      nombre: linea.nombre,
      color: linea.color,
      colorSecundario: null,
      colorTexto: lineaId === 'l120' ? '#0F1B5C' : '#ffffff',
      colorTerciario: null,
      colorFondo: lineaId === 'l120' ? '#ffffff' : null,
      nombreCorto: linea.nombre,
      lema: 'Puntual, todos los días',
      logoUrl: null,
      distintivoTipo: 'numero',
      distintivoValor: linea.nombre,
      cartelSuperior: linea.nombre,
    },
    paradas: linea.paradas.map((p) => ({
      id: idParadaDemo(lineaId, p.id),
      tipo: p.orden === 0 ? 'origen' : p.orden === ultimoOrden ? 'destino' : 'intermedia',
      orden: p.orden,
      coord: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
    puntosControl: linea.paradas
      .filter((p) => p.esPuntoControl)
      .map((p) => ({
        id: idParadaDemo(lineaId, p.id),
        orden: p.orden,
        coord: { type: 'Point', coordinates: [p.lng, p.lat] },
        radioToleranciaM: p.radioToleranciaM,
        obligatorio: true,
      })),
  };
}
