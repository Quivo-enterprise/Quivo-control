import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

export interface QuivoConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  /** Sin `cancelLabel`/`onCancel` el diálogo se comporta como un aviso de un solo botón. */
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
  onConfirm: () => void;
  onCancel?: () => void;
}

/** Reemplazo con la identidad visual de QUIVO para `Alert.alert` (diálogo nativo del SO,
 * sin marca). Se usa para toda confirmación/aviso operativo: cancelar, finalizar recorrido,
 * cerrar sesión, etc. */
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
}: QuivoConfirmDialogProps) {
  const iconoNombre = icon ?? (variant === 'danger' ? 'alert-circle' : 'information-circle');
  const iconoColor = variant === 'danger' ? quivoColors.danger : quivoColors.primary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name={iconoNombre} size={28} color={iconoColor} />
            <Text style={styles.title}>{title}</Text>
          </View>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            {cancelLabel && onCancel && (
              <Button variant="outline" onPress={onCancel} style={styles.actionButton}>
                {cancelLabel}
              </Button>
            )}
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              onPress={onConfirm}
              style={styles.actionButton}
            >
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: quivoSpacing.xl,
  },
  card: {
    backgroundColor: quivoColors.white,
    borderRadius: quivoRadius.xl,
    padding: quivoSpacing.xl,
    width: '100%',
    maxWidth: 400,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    marginBottom: quivoSpacing.md,
  },
  title: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    color: quivoColors.text,
    flex: 1,
  },
  message: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 15,
    color: quivoColors.textSecondary,
    lineHeight: 22,
    marginBottom: quivoSpacing.lg,
  },
  actions: {
    flexDirection: 'row',
    gap: quivoSpacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
