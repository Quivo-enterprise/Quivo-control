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
      <Burbuja direction="column" style={styles.tarjeta}>
        <View style={styles.fila}>
          <Ionicons name="flag-outline" size={18} color={dsColors.primary} />
          <Text size="sm" style={styles.etiqueta}>
            Fila de salida · {vista.posicion} de {vista.total}
          </Text>
          <Badge
            variant={vista.demorado ? 'warning' : vista.habilitado ? 'success' : 'neutral'}
            size="sm"
          >
            {vista.demorado ? 'Demorado' : vista.turnoTexto}
          </Badge>
        </View>
        {/* Lo que el chofer necesita de un vistazo en la terminal: a quién sigue. */}
        <Heading
          size="lg"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${tituloFila(vista)}. ${vista.horaSalidaTexto ?? ''}. ${vista.anuncioAccesible}`}
        >
          {tituloFila(vista)}
        </Heading>
        <ColaSalida posicion={vista.posicion} total={vista.total} />
        {vista.horaSalidaTexto ? (
          <Text size="md" variant="secondary">
            {vista.horaSalidaTexto}
            {vista.sinActualizar ? ' · sin actualizar' : ''}
          </Text>
        ) : vista.sinActualizar ? (
          <Text size="sm" variant="secondary">
            Sin actualizar
          </Text>
        ) : null}
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
          fullWidth
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

/** "Sales detrás de 1234ABC"; el primero ya no sigue a nadie. */
function tituloFila(vista: { posicion: number; delantePlaca: string | null }): string {
  if (vista.posicion === 1) return 'Eres el primero en salir';
  return vista.delantePlaca
    ? `Sales detrás de ${vista.delantePlaca}`
    : `Posición ${vista.posicion}`;
}

/** Hasta este total se dibuja un punto por trufi; con más, la fila se resume alrededor del chofer. */
const MAX_PUNTOS_COLA = 8;

/**
 * La fila dibujada de izquierda (sale primero) a derecha: los de adelante en gris, el chofer
 * resaltado. Decorativa para el lector de pantalla (el título y la etiqueta ya dicen la posición).
 */
function ColaSalida({ posicion, total }: { posicion: number; total: number }) {
  if (total < 2) return null;
  const puntos: (number | 'mas')[] =
    total <= MAX_PUNTOS_COLA
      ? Array.from({ length: total }, (_, i) => i + 1)
      : [
          1,
          ...(posicion > 3 ? ['mas' as const] : []),
          ...[posicion - 1, posicion, posicion + 1].filter((n) => n > 1 && n < total),
          ...(posicion < total - 2 ? ['mas' as const] : []),
          total,
        ];
  return (
    <View
      style={styles.cola}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Ionicons name="chevron-back" size={16} color={dsColors.textTertiary} />
      {puntos.map((n, i) =>
        n === 'mas' ? (
          <Text key={`mas-${i}`} size="sm" style={styles.colaMas}>
            …
          </Text>
        ) : (
          <View
            key={n}
            style={[
              styles.colaPunto,
              n < posicion && styles.colaAdelante,
              n === posicion && styles.colaYo,
            ]}
          >
            {n === posicion ? (
              <Text size="xs" weight="bold" style={styles.colaYoTexto}>
                Tú
              </Text>
            ) : null}
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { marginBottom: dsSpace.sm },
  tarjeta: { alignItems: 'stretch' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm, flexWrap: 'wrap' },
  etiqueta: { color: dsColors.textSecondary, flex: 1 },
  cola: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.xs, flexWrap: 'wrap' },
  colaPunto: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: dsColors.borderSubtle,
  },
  colaAdelante: { backgroundColor: dsColors.borderSubtle },
  colaYo: {
    width: 32,
    height: 24,
    borderRadius: 12,
    borderWidth: 0,
    backgroundColor: dsColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colaYoTexto: { color: dsColors.textInverse },
  colaMas: { color: dsColors.textTertiary },
  accion: { minHeight: 48, borderRadius: quivoBubble.innerRadius },
  error: { color: dsColors.danger, marginTop: dsSpace.sm },
});
