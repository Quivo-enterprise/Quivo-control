import { useMemo } from 'react';
import type { PaqueteDia } from '@quivo/shared';
import type { usePaqueteDia } from '../features/operacion/use-paquete-dia';
import { LINEAS_MOCK } from './datos/datos';
import type { LineaMockId } from './datos/tipos';
import { fechaLocalDemo, idParadaDemo, turnoDesdeHoraLocal, uuidDemo } from './cuentas';
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
  const paqueteBase = useMemo(
    () => construirPaqueteDiaDemo(estado.lineaPropiaId),
    [estado.lineaPropiaId],
  );

  // FIX POST-REVISIÓN (hallazgo de revisión — "fecha/horario congelados por un memo keyed solo
  // en lineaPropiaId"): `paqueteBase` (arriba) memoiza TODO el `PaqueteDia` por línea — correcto
  // para la geometría/paradas (no cambian nunca para la misma línea dentro de una sesión), pero
  // `asignacion.fecha`/`horario` (calculados adentro de `construirPaqueteDiaDemo` con su propio
  // `Date.now()`) quedaban pegados al momento del PRIMER cálculo para siempre — si la demo sigue
  // corriendo horas (o cruza medianoche) sin que `lineaPropiaId` cambie, ese memo nunca vuelve a
  // ejecutarse y estos dos campos quedan desincronizados del reloj real. Se recalculan ACÁ en
  // cada render (barato: solo lectura de reloj + comparaciones, no la geometría pesada) y entran
  // en su propio `useMemo` con dependencias por VALOR (`fecha`/`horario` son strings) — la
  // referencia de `paquete` solo cambia cuando el VALOR de verdad cambia (nunca dentro del mismo
  // minuto/hora), así que esto no reintroduce el problema de referencia inestable por tick que
  // corrigieron otros hallazgos de esta ronda.
  const ahora = Date.now();
  const horario = turnoDesdeHoraLocal(ahora);
  const fecha = fechaLocalDemo(ahora);
  const paquete = useMemo(
    () => ({ ...paqueteBase, asignacion: { ...paqueteBase.asignacion, fecha, horario } }),
    [paqueteBase, fecha, horario],
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
      // FIX POST-REVISIÓN: mismo bug que `contextoDeCuenta` (`cuentas.ts`) — `toISOString()`
      // devuelve la fecha en UTC, no la local del teléfono. `fecha`/`horario` de este `PaqueteDia`
      // no se muestran hoy en ninguna pantalla (solo `contexto.asignacion.*`, que sí viene de
      // `cuentas.ts`), pero se corrige igual para no dejar la misma trampa sembrada acá. Nota:
      // `usePaqueteDiaDemo` (arriba) SOBRESCRIBE estos dos campos en cada render con un `ahora`
      // fresco — acá quedan igual de correctos para quien llame a esta función pura directo
      // (como el test), sin depender de ese hook.
      fecha: fechaLocalDemo(ahora),
      horario: turnoDesdeHoraLocal(ahora),
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
