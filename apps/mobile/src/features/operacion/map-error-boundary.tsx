import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';

interface MapErrorBoundaryProps {
  children: ReactNode;
}

interface MapErrorBoundaryState {
  crasho: boolean;
}

/**
 * `react-native-maps` crashea de forma sincrónica (no una excepción atrapable con
 * try/catch normal) cuando falta la API key real de Google Maps en `app.json`
 * (`android.config.googleMaps.apiKey`, hoy vacía — RNF externo, mismo tipo de bloqueo que
 * la licencia Transistorsoft) — confirmado en un Moto E13 real. Sin este error boundary,
 * ese crash tumbaba toda la pantalla de operación (inicio/fin de recorrido, sync,
 * observaciones), no solo el mapa. El resto de la pantalla no depende de que el mapa
 * renderice, así que el mapa queda aislado acá.
 */
export class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { crasho: false };

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { crasho: true };
  }

  render() {
    if (this.state.crasho) {
      return (
        <View style={styles.container}>
          <Text style={styles.text}>
            No se pudo cargar el mapa. El recorrido y la sincronización funcionan igual.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    minHeight: 120,
    borderRadius: quivoRadius.lg,
    backgroundColor: quivoColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
    padding: quivoSpacing.lg,
  },
  text: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
