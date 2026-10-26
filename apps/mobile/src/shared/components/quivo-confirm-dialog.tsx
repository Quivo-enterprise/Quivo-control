import type { ReactNode } from 'react';
import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Heading, Text } from '@quivo/design-system-native';
import { Button } from './Button';
import { quivoBubble } from '../theme/quivo-theme';
import { dsColors, dsElevation, dsRadius, dsSpace } from '../theme/design-system';

export interface QuivoConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  /** Contenido personalizado entre el título y las acciones (p. ej. opciones de incidencia). */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  /** `null` oculta el icono; sin prop se conserva el icono predeterminado. */
  icon?: keyof typeof Ionicons.glyphMap | null;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmDisabled?: boolean;
}
export function QuivoConfirmDialog({
  visible,
  title,
  message,
  children,
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
              <View
                style={[
                  styles.icono,
                  variant === 'danger' ? styles.iconoDanger : styles.iconoDefault,
                ]}
              >
                <Ionicons
                  name={
                    icon ?? (variant === 'danger' ? 'warning-outline' : 'checkmark-circle-outline')
                  }
                  size={20}
                  color={variant === 'danger' ? dsColors.danger : dsColors.primary}
                />
              </View>
            ) : null}
            <Heading size="md" style={styles.title}>
              {title}
            </Heading>
          </View>
          {children ??
            (message ? (
              <Text size="md" variant="secondary" style={styles.message}>
                {message}
              </Text>
            ) : null)}
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
    padding: quivoBubble.edge,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: dsColors.surfaceRaised,
    borderRadius: quivoBubble.radius,
    padding: dsSpace.lg,
    gap: dsSpace.md,
    ...dsElevation(3),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm },
  icono: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: dsRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconoDefault: { backgroundColor: dsColors.primarySubtle },
  iconoDanger: { backgroundColor: dsColors.dangerSoft },
  title: { flex: 1 },
  message: { lineHeight: dsSpace.xl },
  actions: { flexDirection: 'row', gap: dsSpace.sm },
  stacked: { flexDirection: 'column' },
  action: { flex: 1, minHeight: 52, borderRadius: quivoBubble.innerRadius },
});
