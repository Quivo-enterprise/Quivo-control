import { Modal, StyleSheet, Text, View, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

export interface QuivoConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmDisabled?: boolean;
}

/** Reemplazo con la identidad visual de QUIVO para diálogos de confirmación / avisos */
export function QuivoConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel,
  variant = 'default',
  icon,
  onConfirm,
  onCancel,
  confirmDisabled = false,
}: QuivoConfirmDialogProps) {
  const iconoNombre = icon ?? (variant === 'danger' ? 'warning-outline' : 'checkmark-circle-outline');
  const iconoColor = variant === 'danger' ? '#E50914' : '#3127B1';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <BlurView intensity={85} tint="light" style={styles.card}>
          <View style={styles.header}>
            <Ionicons name={iconoNombre} size={20} color={iconoColor} />
            <Text style={[styles.title, { color: variant === 'danger' ? '#E50914' : '#3127B1' }]}>
              {title}
            </Text>
          </View>

          <Text style={styles.message}>{message}</Text>

          <View style={styles.actions}>
            {cancelLabel && onCancel && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
                onPress={onCancel}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              >
                <Text style={styles.cancelButtonText}>{cancelLabel.toUpperCase()}</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              onPress={onConfirm}
              disabled={confirmDisabled}
              style={({ pressed }) => [
                styles.confirmButton,
                variant === 'danger' && styles.dangerButton,
                confirmDisabled && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.confirmButtonText}>{confirmLabel.toUpperCase()}</Text>
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
  title: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
    color: '#3127B1',
    letterSpacing: 0.2,
    flex: 1,
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
  dangerButton: {
    backgroundColor: '#E50914',
    shadowColor: '#7A0000',
  },
  confirmButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.6,
    color: quivoColors.white,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
