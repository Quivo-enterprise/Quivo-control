import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../shared/components/Button';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import type { FilaSalidaUi } from './use-fila-salida';

/**
 * Tarjeta de la fila de salida dentro del sheet de operación. Con fila abierta: posición, trufi de
 * adelante, hora de salida, cuenta regresiva y SALIR (deshabilitado con la cuenta hasta el turno).
 * Sin fila: solo el botón de respaldo "Estoy en la fila" cuando la detección no lo hizo y el trufi
 * está cerca de la terminal. FINALIZAR RUTA no depende de esto.
 */
export function FilaSalidaCard({ fila }: { fila: FilaSalidaUi }) {
  const { vista, ocupado, error, puedeEstoyEnLaFila, salir, estoyEnLaFila } = fila;

  if (!vista) {
    if (!puedeEstoyEnLaFila && !error) return null;
    return (
      <View style={styles.contenedor}>
        {puedeEstoyEnLaFila ? (
          <Button
            variant="ghost"
            loading={ocupado}
            onPress={estoyEnLaFila}
            style={styles.respaldo}
            textStyle={styles.respaldoTexto}
            leftIcon={<Ionicons name="flag-outline" size={20} color={quivoColors.white} />}
            accessibilityHint="Te anota en la fila de salida si la app no lo hizo sola"
            fullWidth
          >
            Estoy en la fila
          </Button>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.contenedor}>
      <View style={styles.tarjeta}>
        <View style={styles.fila}>
          <Ionicons name="people-outline" size={18} color={quivoColors.white} />
          <Text style={styles.posicion}>{vista.posicionTexto}</Text>
        </View>
        {/* Región viva con granularidad de minuto: el lector no recita la cuenta segundo a segundo. */}
        <Text
          style={styles.hora}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${vista.horaSalidaTexto ?? 'Fila de salida'}. ${vista.anuncioAccesible}`}
        >
          {vista.horaSalidaTexto ?? ' '}
        </Text>
        <View style={styles.fila}>
          <Text
            style={[styles.turno, vista.habilitado && styles.turnoListo]}
            accessible={false}
            importantForAccessibility="no"
          >
            {vista.turnoTexto}
          </Text>
          {vista.demorado ? (
            <View style={styles.insignia}>
              <Text style={styles.insigniaTexto}>Demorado</Text>
            </View>
          ) : null}
        </View>
        <Button
          variant="accent"
          loading={ocupado}
          disabled={!vista.habilitado || ocupado}
          onPress={salir}
          style={styles.salir}
          textStyle={styles.salirTexto}
          accessibilityHint={
            vista.habilitado ? 'Registra tu salida de la terminal' : 'Se habilita cuando sea tu turno'
          }
          fullWidth
        >
          {vista.botonTexto}
        </Button>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { marginBottom: quivoSpacing.sm },
  tarjeta: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: quivoRadius.lg,
    padding: quivoSpacing.md,
    gap: quivoSpacing.xs,
  },
  fila: { flexDirection: 'row', alignItems: 'center', gap: quivoSpacing.sm },
  posicion: {
    color: quivoColors.white,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 13,
    flexShrink: 1,
  },
  hora: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
  },
  turno: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 22,
  },
  turnoListo: { color: '#7FE3B5' },
  insignia: {
    backgroundColor: quivoColors.warningSoft,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  insigniaTexto: {
    color: quivoColors.warningText,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11.5,
  },
  salir: {
    backgroundColor: quivoColors.accent,
    borderColor: quivoColors.accent,
    borderRadius: quivoRadius.pill,
    height: 52,
    marginTop: quivoSpacing.xs,
  },
  salirTexto: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
    letterSpacing: 1,
  },
  respaldo: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderWidth: 1.5,
    borderRadius: quivoRadius.pill,
    height: 48,
  },
  respaldoTexto: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 14.5,
    letterSpacing: 0.8,
  },
  error: {
    color: '#FFB4B4',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});
