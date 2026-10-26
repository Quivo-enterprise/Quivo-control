import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Heading, Text } from '@quivo/design-system-native';
import { Burbuja } from '../../shared/components/burbuja';
import { dsColors, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
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
          variant="outline"
          loading={ocupado}
          onPress={estoyEnLaFila}
          accessibilityHint="Te anota en la fila de salida si la app no lo hizo sola"
          style={styles.accion}
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
      <Burbuja direction="column" style={styles.tarjeta}>
        <View style={styles.fila}>
          <Ionicons name="people-outline" size={20} color={dsColors.primary} />
          <Text size="sm" weight="semibold" style={styles.posicion}>
            {vista.posicionTexto}
          </Text>
          <Badge variant={vista.demorado ? 'warning' : 'neutral'} size="sm">
            {vista.demorado ? 'Demorado' : 'En fila'}
          </Badge>
        </View>
        {/* Región viva con granularidad de minuto: el lector no recita la cuenta segundo a segundo. */}
        <Heading
          size="lg"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${vista.horaSalidaTexto ?? 'Fila de salida'}. ${vista.anuncioAccesible}`}
        >
          {vista.horaSalidaTexto ?? 'Fila de salida'}
        </Heading>
        {vista.sinActualizar ? (
          <Text size="sm" variant="secondary">
            Sin actualizar
          </Text>
        ) : null}
        <Text size="md" weight="semibold" style={vista.habilitado && styles.turnoListo}>
          {vista.turnoTexto}
        </Text>
        <Button
          variant="primary"
          loading={ocupado}
          disabled={ocupado}
          onPress={vista.habilitado ? salir : () => setConfirmarAnticipada(true)}
          accessibilityHint={
            vista.habilitado
              ? 'Registra tu salida de la terminal'
              : 'Aún no es tu turno: pide confirmar la salida anticipada'
          }
          style={styles.accion}
        >
          {vista.botonTexto}
        </Button>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </Burbuja>
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
  contenedor: { marginBottom: dsSpace.sm },
  tarjeta: { alignItems: 'stretch' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm, flexWrap: 'wrap' },
  posicion: { color: dsColors.textSecondary, flexShrink: 1 },
  turnoListo: { color: dsColors.success },
  accion: { minHeight: 48, borderRadius: quivoBubble.innerRadius },
  error: { color: dsColors.danger, marginTop: dsSpace.sm },
});
