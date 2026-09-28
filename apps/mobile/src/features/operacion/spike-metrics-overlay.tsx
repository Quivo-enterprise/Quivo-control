import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BackgroundGeolocation from 'react-native-background-geolocation';
import { calcularCadenciaMediaMs, formatearCadencia, registrarMuestraCadencia } from './spike-metricas';

/**
 * Spike `ubicación fluida` (S1, `docs/plan-ubicacion-fluida.md`, Fase B): overlay de métricas,
 * montado SOLO por `operation-screen.tsx` detrás de `EXPO_PUBLIC_SPIKE === '1'` — ver el docblock
 * del módulo `spike-motor-mapa.ts` para el invariante ("fuera del spike, cero cambio de
 * comportamiento": este archivo ni se importa en ese caso, tree-shaking aparte).
 *
 * Verifica en vivo los criterios (a)-(e) del spike S1 del plan:
 * - (a) fixes visuales recibidos (`leerFixesVisuales`, prop — getter barato sobre el ref
 *   `visualFixesRecibidos` de `use-gps-operativo.ts`; NO es un `useState` a propósito — hallazgo
 *   de revisión: espejarlo a estado re-renderizaba `operation-screen.tsx` a 1Hz y ensuciaba la
 *   propia medición de fluidez del spike. Este overlay lo lee con su propio polling, mismo
 *   intervalo que (b)/(c) `BackgroundGeolocation.getCount()` — si sube al mismo ritmo que los
 *   fixes visuales, el canal visual se está colando en la evidencia nativa (BUG). Debe
 *   mantenerse estable mientras solo corre el canal visual.
 * - fixes de evidencia recibidos (`fixesEvidencia`, prop — `gps.puntos`, ya expuesto por el hook
 *   de siempre, sin cambios).
 * - (d) cadencia de evidencia: media de los deltas entre incrementos de `fixesEvidencia`,
 *   calculada acá mismo (no hay un timestamp de evidencia expuesto aparte — ver `spike-
 *   metricas.ts`).
 * - Batería: OMITIDA a propósito — no hay ninguna API de batería ya instalada en el proyecto
 *   (`expo-battery` no es una dependencia) y el brief de esta tarea pide explícitamente no
 *   agregar deps nuevas solo para esto. Medir batería delta (e) queda para el CTO, a mano
 *   (ajustes del sistema, antes/después de la prueba en calle).
 * - `gps_point` en el outbox: OMITIDO — no hay una función barata que cuente SOLO `gps_point`
 *   (`contarEventosPendientes`, en `db/outbox.ts`, cuenta TODOS los tipos pendientes, no filtra
 *   por tipo) y agregar una query nueva a ese archivo (ruta de evidencia legal) para esto queda
 *   fuera del alcance conservador de este spike.
 */

const INTERVALO_POLL_GETCOUNT_MS = 5000;

interface SpikeMetricsOverlayProps {
  leerFixesVisuales: () => number;
  fixesEvidencia: number;
}

export function SpikeMetricsOverlay({ leerFixesVisuales, fixesEvidencia }: SpikeMetricsOverlayProps) {
  const [fixesVisuales, setFixesVisuales] = useState(0);
  const [getCountNativo, setGetCountNativo] = useState<number | null>(null);
  const [muestrasCadencia, setMuestrasCadencia] = useState<number[]>([]);
  const ultimoFixesEvidenciaRef = useRef(fixesEvidencia);

  useEffect(() => {
    let cancelado = false;
    const poll = () => {
      // Hallazgo de revisión (bajo): lee `leerFixesVisuales()` en el MISMO poll que
      // `getCount()` — el único estado que este overlay actualiza a la cadencia del canal
      // visual (1Hz) es el suyo propio, nunca `use-gps-operativo.ts`.
      setFixesVisuales(leerFixesVisuales());
      void BackgroundGeolocation.getCount()
        .then((n) => {
          if (!cancelado) setGetCountNativo(n);
        })
        .catch(() => {
          // Best-effort — el overlay muestra "—" si getCount() falla, no debe romper la pantalla.
        });
    };
    poll();
    const id = setInterval(poll, INTERVALO_POLL_GETCOUNT_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [leerFixesVisuales]);

  useEffect(() => {
    if (fixesEvidencia === ultimoFixesEvidenciaRef.current) return;
    ultimoFixesEvidenciaRef.current = fixesEvidencia;
    setMuestrasCadencia((actual) => registrarMuestraCadencia(actual, Date.now()));
  }, [fixesEvidencia]);

  const cadenciaMs = calcularCadenciaMediaMs(muestrasCadencia);

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.titulo}>SPIKE S1</Text>
      <Text style={styles.linea}>Fixes visuales: {fixesVisuales}</Text>
      <Text style={styles.linea}>Fixes evidencia: {fixesEvidencia}</Text>
      <Text style={styles.linea}>getCount() nativo: {getCountNativo ?? '—'}</Text>
      <Text style={styles.linea}>Cadencia evidencia: {formatearCadencia(cadenciaMs)}</Text>
      <Text style={styles.notaOmitida}>Batería y gps_point del outbox: ver reporte (omitidos)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    maxWidth: 200,
  },
  titulo: { color: '#FE9B0B', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  linea: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  notaOmitida: { color: '#94A3B8', fontSize: 8, marginTop: 4 },
});
