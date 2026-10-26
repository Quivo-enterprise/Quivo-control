import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Heading, Text, colors, elevation, space } from '@quivo/design-system-native';
import { Button } from './Button';
import { quivoBubble } from '../theme/quivo-theme';

export interface QuivoConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  /** `null` oculta el icono; sin prop se conserva el icono predeterminado. */
  icon?: keyof typeof Ionicons.glyphMap | null;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmDisabled?: boolean;
}
const c = colors.light;
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
  const { width } = useWindowDimensions();
  const stacked = width < 360 || confirmLabel.length + (cancelLabel?.length ?? 0) > 28;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            {icon !== null ? (
              <Ionicons
                name={
                  icon ?? (variant === 'danger' ? 'warning-outline' : 'checkmark-circle-outline')
                }
                size={24}
                color={variant === 'danger' ? c.danger : c.primary}
              />
            ) : null}
            <Heading
              size="lg"
              style={[styles.title, { color: variant === 'danger' ? c.danger : c.textPrimary }]}
            >
              {title}
            </Heading>
          </View>
          <Text size="sm" style={styles.message}>
            {message}
          </Text>
          <View style={[styles.actions, stacked && styles.stacked]}>
            {cancelLabel && onCancel ? (
              <Button variant="outline" onPress={onCancel} style={styles.action}>
                {cancelLabel}
              </Button>
            ) : null}
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              disabled={confirmDisabled}
              onPress={onConfirm}
              style={styles.action}
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
    backgroundColor: quivoBubble.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.md,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: c.surfaceRaised,
    borderRadius: quivoBubble.radius,
    padding: space.md,
    gap: space.md,
    ...elevation(3),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1 },
  message: { lineHeight: 22 },
  actions: { flexDirection: 'row', gap: space.sm },
  stacked: { flexDirection: 'column' },
  action: { flex: 1, minHeight: quivoBubble.touch },
});
