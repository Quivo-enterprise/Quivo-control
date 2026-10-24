import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../shared/components/Button';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import type { FilaSalidaUi } from './use-fila-salida';

/**
 * Tarjeta de la fila de salida dentro del sheet de operación. Con fila abierta: posición, trufi de
 * adelante, hora de salida, cuenta regresiva y SALIR (antes del turno pide confirmación: salida anticipada).
 * Sin fila: solo el botón de respaldo "Estoy en la fila" cuando la detección no lo hizo y el trufi
 * está cerca de la terminal. FINALIZAR RUTA no depende de esto.
 */
export function FilaSalidaCard({ fila }: { fila: FilaSalidaUi }) {
  const { vista, ocupado, error, puedeEstoyEnLaFila, salir, estoyEnLaFila } = fila;
  const [confirmarAnticipada, setConfirmarAnticipada] = useState(false);
  // La confirmación solo tiene sentido con fila y antes del turno: si desaparece o llega el turno, se cierra.
  const sinAnticipada = !vista || vista.habilitado;
  useEffect(() => {
    if (sinAnticipada) setConfirmarAnticipada(false);
  }, [sinAnticipada]);

  if (!vista) {
    // Un error suelto, sin botón ni fila que lo expliquen, no se muestra.
    if (!puedeEstoyEnLaFila) return null;
    return (
      <View style={styles.contenedor}>
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
        {vista.sinActualizar ? <Text style={styles.sinActualizar}>Sin actualizar</Text> : null}
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
          disabled={ocupado}
          onPress={vista.habilitado ? salir : () => setConfirmarAnticipada(true)}
          style={styles.salir}
          textStyle={styles.salirTexto}
          accessibilityHint={
            vista.habilitado
              ? 'Registra tu salida de la terminal'
              : 'Aún no es tu turno: pide confirmar la salida anticipada'
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
      <QuivoConfirmDialog
        visible={confirmarAnticipada}
        variant="danger"
        icon="alert-circle"
        title="¿Salir antes de tu turno?"
        message="Solo si el delegado te autorizó. Quedará registrada como salida anticipada."
        cancelLabel="Cancelar"
        confirmLabel="Salir"
        onCancel={() => setConfirmarAnticipada(false)}
        onConfirm={() => {
          setConfirmarAnticipada(false);
          salir();
        }}
      />
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
  sinActualizar: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 11.5,
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
