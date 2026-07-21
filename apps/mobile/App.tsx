import { useCallback, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import BackgroundGeolocation, { Location } from 'react-native-background-geolocation';
import { abrirOutbox, insertarEventoOutbox, contarEventosOutbox } from './src/db/outbox.js';
import { gpsSpikeConfig } from './src/gps/background-geolocation.config.js';
import {
  bateriaConsumidaPorcentaje,
  detectarHuecos,
  evaluarCriteriosGo,
  type MuestraBateria,
} from './src/gps/battery-gap-monitor.js';

/**
 * Pantalla única del spike GPS (QUI-216): iniciar/detener tracking, ver puntos
 * acumulados y calcular el veredicto GO/NO-GO al final de la medición de 8h.
 * No es la app de producto (esa llega en QUI-235) — solo el arnés de medición.
 */
export default function App() {
  const [tracking, setTracking] = useState(false);
  const [puntos, setPuntos] = useState(0);
  const [resultado, setResultado] = useState<string | null>(null);

  const timestamps = useRef<number[]>([]);
  const bateria = useRef<MuestraBateria[]>([]);
  const inicioMs = useRef<number | null>(null);

  const onLocation = useCallback(async (location: Location) => {
    const ts = new Date(location.timestamp).getTime();
    timestamps.current.push(ts);
    bateria.current.push({ ts, nivel: (location.battery?.level ?? -1) * 100 });
    setPuntos((n) => n + 1);

    const db = await abrirOutbox();
    await insertarEventoOutbox(db, {
      eventId: `spike-${ts}-${Math.random().toString(36).slice(2)}`,
      deviceId: 'spike-device',
      ts: new Date(location.timestamp).toISOString(),
      tipo: 'gps_point',
      payload: JSON.stringify({ lat: location.coords.latitude, lng: location.coords.longitude }),
    });
  }, []);

  const iniciar = useCallback(async () => {
    inicioMs.current = Date.now();
    timestamps.current = [];
    bateria.current = [];
    setPuntos(0);
    setResultado(null);

    BackgroundGeolocation.onLocation(onLocation);
    await BackgroundGeolocation.ready(gpsSpikeConfig);
    await BackgroundGeolocation.start();
    setTracking(true);
  }, [onLocation]);

  const detener = useCallback(async () => {
    await BackgroundGeolocation.stop();
    setTracking(false);

    const duracionHoras = inicioMs.current ? (Date.now() - inicioMs.current) / 3_600_000 : 0;
    const reporteHuecos = detectarHuecos(timestamps.current);
    const consumo = bateriaConsumidaPorcentaje(bateria.current);
    const veredicto = evaluarCriteriosGo({
      bateriaConsumidaPorcentaje: consumo,
      reporteHuecos,
      duracionMedicionHoras: duracionHoras,
    });

    const totalOutbox = await contarEventosOutbox(await abrirOutbox());

    setResultado(
      [
        `Duración: ${duracionHoras.toFixed(2)} h`,
        `Puntos GPS: ${puntos} (outbox: ${totalOutbox})`,
        `Batería consumida (medición): ${consumo.toFixed(1)}%`,
        `Batería estimada / jornada 8h: ${veredicto.bateriaEstimadaPorJornada8h.toFixed(1)}%`,
        `Huecos > 2 min: ${reporteHuecos.cantidad} (máximo: ${(reporteHuecos.huecoMaximoMs / 60_000).toFixed(1)} min)`,
        `Veredicto: ${veredicto.go ? 'GO' : 'NO-GO'}`,
        ...veredicto.motivos,
        '',
        'Copiar estos números a docs/spike-gps.md al terminar la medición de 8h.',
      ].join('\n'),
    );
  }, [puntos]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>QUIVO — Spike GPS (QUI-216)</Text>
        <Text>Estado: {tracking ? 'tracking activo' : 'detenido'}</Text>
        <Text>Puntos registrados en esta sesión: {puntos}</Text>
        <View style={styles.actions}>
          <Text onPress={tracking ? detener : iniciar} style={styles.button}>
            {tracking ? 'Detener y calcular veredicto' : 'Iniciar tracking'}
          </Text>
        </View>
        {resultado ? <Text style={styles.resultado}>{resultado}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  actions: { marginVertical: 16 },
  button: {
    padding: 12,
    backgroundColor: '#1d4ed8',
    color: '#fff',
    textAlign: 'center',
    borderRadius: 8,
  },
  resultado: { marginTop: 16, fontFamily: 'monospace' },
});
