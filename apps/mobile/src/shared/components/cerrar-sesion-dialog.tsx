import { Modal, StyleSheet, Text, View, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

export interface CerrarSesionDialogProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Diálogo de confirmación para cerrar sesión según diseño de Figma con efecto glassmorphism.
 */
export function CerrarSesionDialog({ visible, onConfirm, onCancel }: CerrarSesionDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <BlurView intensity={85} tint="light" style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="warning-outline" size={20} color="#3127B1" style={styles.icon} />
            <Text style={styles.title}>¿Cerrar sesión?</Text>
          </View>

          <Text style={styles.message}>
            Deberas volver a ingresar tus datos para iniciar sesión
          </Text>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
              onPress={onCancel}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
            >
              <Text style={styles.cancelButtonText}>CANCELAR</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirmar"
              onPress={onConfirm}
              style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}
            >
              <Text style={styles.confirmButtonText}>CONFIRMAR</Text>
            </Pressable>
          </View>
        </BlurView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(25, 20, 60, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: quivoSpacing.lg,
  },
  card: {
    backgroundColor: 'rgba(236, 239, 244, 0.92)',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    width: '100%',
    maxWidth: 290,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  icon: {
    marginTop: -1,
  },
  title: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
    color: '#3127B1',
    letterSpacing: 0.2,
  },
  message: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16.5,
    color: '#475569',
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    height: 38,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#DCE0E8',
    borderWidth: 1.5,
    borderColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.6,
    color: '#3127B1',
  },
  confirmButton: {
    flex: 1,
    height: 38,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A0E70',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  confirmButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.6,
    color: quivoColors.white,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
