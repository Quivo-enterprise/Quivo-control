import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../shared/components/Button';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { quivoColors, quivoFonts, quivoRadius } from '../../shared/theme/quivo-theme';
import type { AccionesDemo } from '../demo-provider';
import type { EstadoMotorDemo } from '../motor';

export interface PanelDemoOcultoProps {
  visible: boolean;
  onClose: () => void;
  estado: EstadoMotorDemo;
  acciones: AccionesDemo;
}

/**
 * Panel demo oculto — equivalente a la tecla `S` del panel web mockeado. Se abre con una
 * pulsación larga (1.5 s, ver `delayLongPress` en `operation-screen.tsx`) sobre el FAB de centrar
 * mapa; NO aparece en ninguna toma del guion (`docs/plan-apk-demo-conductor.md`, "Panel demo
 * oculto"). Toque corto del mismo FAB sigue centrando el mapa, sin cambios.
 */
export function PanelDemoOculto({ visible, onClose, estado, acciones }: PanelDemoOcultoProps) {
  const [confirmarReiniciar, setConfirmarReiniciar] = useState(false);

  const etiquetaSenal =
    estado.senal === 'ok' ? 'Señal OK' : estado.senal === 'sin_senal' ? 'Sin señal' : 'Sincronizando…';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()}>
          <BlurView intensity={90} tint="light" style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Ionicons name="construct-outline" size={18} color="#3127B1" />
              <Text style={styles.title}>Demo</Text>
            </View>
            <Text style={styles.estadoActual}>
              {etiquetaSenal} · {estado.tracking ? 'en recorrido' : 'sin recorrido'} · ×{estado.velocidadDemo}
            </Text>

            <View style={styles.botones}>
              {estado.senal === 'sin_senal' ? (
                <Button variant="secondary" onPress={acciones.recuperarSenal} fullWidth>
                  Recuperar señal
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onPress={acciones.perderSenal}
                  disabled={estado.senal === 'sincronizando'}
                  fullWidth
                >
                  Perder señal
                </Button>
              )}

              <Button variant="secondary" onPress={acciones.alternarVelocidad} fullWidth>
                Velocidad ×{estado.velocidadDemo === 1 ? '4' : '1'}
              </Button>

              <Button
                variant="secondary"
                onPress={acciones.saltarAlProximoPunto}
                disabled={!estado.tracking}
                fullWidth
              >
                Saltar al próximo punto de control
              </Button>

              <Button variant="secondary" onPress={acciones.acercarAdelante} disabled={!estado.tracking} fullWidth>
                Acercar trufi de adelante
              </Button>

              <Button variant="danger" onPress={() => setConfirmarReiniciar(true)} fullWidth>
                Reiniciar demo
              </Button>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar panel demo"
              onPress={onClose}
              style={({ pressed }) => [styles.cerrarButton, pressed && styles.pressed]}
            >
              <Text style={styles.cerrarButtonText}>CERRAR</Text>
            </Pressable>
          </BlurView>
        </Pressable>
      </Pressable>

      <QuivoConfirmDialog
        visible={confirmarReiniciar}
        variant="danger"
        title="¿Reiniciar la demo?"
        message="Todas las unidades vuelven al escenario inicial. Esto no se ve en ninguna toma del guion."
        cancelLabel="Cancelar"
        confirmLabel="Reiniciar"
        onCancel={() => setConfirmarReiniciar(false)}
        onConfirm={() => {
          setConfirmarReiniciar(false);
          acciones.reiniciar();
          onClose();
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(25, 20, 60, 0.32)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'rgba(236, 239, 244, 0.95)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(49, 39, 177, 0.18)',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  title: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
    color: '#3127B1',
  },
  estadoActual: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 11.5,
    color: quivoColors.textSecondary,
    marginBottom: 14,
  },
  botones: {
    gap: 10,
  },
  cerrarButton: {
    marginTop: 14,
    height: 36,
    borderRadius: quivoRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cerrarButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12,
    letterSpacing: 0.6,
    color: quivoColors.textSecondary,
  },
  pressed: {
    opacity: 0.7,
  },
});
