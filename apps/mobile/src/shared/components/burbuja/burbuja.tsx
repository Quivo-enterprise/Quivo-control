import { useRef, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@quivo/design-system-native';
import { dsColors, dsDuration, dsElevation, dsRadius, dsSpace } from '../../theme/design-system';
import { quivoBubble } from '../../theme/quivo-theme';

type Icono = React.ComponentProps<typeof Ionicons>['name'];

/** Superficie flotante con radios concéntricos para agrupar controles. */
export function Burbuja({
  children,
  direction = 'row',
  style,
}: {
  children: ReactNode;
  direction?: 'row' | 'column';
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.burbuja, { flexDirection: direction }, style]}>{children}</View>;
}

/** Control de icono con objetivo táctil de 44 dp. */
export function BotonBurbuja({
  icono,
  accessibilityLabel,
  onPress,
  variante = 'neutral',
  size = 24,
  style,
}: {
  icono: Icono;
  accessibilityLabel: string;
  onPress: () => void;
  variante?: 'neutral' | 'activo';
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const escala = useRef(new Animated.Value(1)).current;
  const animar = (valor: number) =>
    Animated.timing(escala, {
      toValue: valor,
      duration: dsDuration.fast,
      useNativeDriver: true,
    }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={() => animar(0.96)}
      onPressOut={() => animar(1)}
    >
      <Animated.View
        style={[
          styles.boton,
          variante === 'activo' && styles.activo,
          style,
          { transform: [{ scale: escala }] },
        ]}
      >
        <Ionicons
          name={icono}
          size={size}
          color={variante === 'activo' ? dsColors.accentStrong : dsColors.primaryText}
        />
      </Animated.View>
    </Pressable>
  );
}

/** Píldora informativa o acción breve; dentro de burbuja conserva el radio interior. */
export function PildoraBurbuja({
  icono,
  children,
  onPress,
  accessibilityLabel,
  interior = false,
  style,
}: {
  icono: Icono;
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  interior?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const contenido = (
    <View
      style={[
        styles.pildora,
        { borderRadius: interior ? quivoBubble.innerRadius : dsRadius.full },
        style,
      ]}
    >
      <Ionicons name={icono} size={20} color={dsColors.primaryText} />
      <Text size="sm" weight="semibold" style={styles.pildoraTexto}>
        {children}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}>
      {contenido}
    </Pressable>
  ) : (
    contenido
  );
}

/** Superficie de la hoja; el gesto permanece en su componente consumidor. */
export function HojaBurbuja({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.hoja, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  burbuja: {
    alignItems: 'center',
    gap: quivoBubble.gap,
    padding: quivoBubble.padding,
    borderRadius: quivoBubble.radius,
    backgroundColor: quivoBubble.surface,
    borderColor: quivoBubble.border,
    borderWidth: 1,
    ...dsElevation(3),
  },
  boton: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activo: { backgroundColor: dsColors.accentSoft },
  pildora: {
    minHeight: quivoBubble.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: dsSpace.sm,
    paddingHorizontal: dsSpace.md,
    backgroundColor: quivoBubble.surface,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    ...dsElevation(2),
  },
  pildoraTexto: { color: dsColors.textPrimary },
  hoja: {
    padding: quivoBubble.padding,
    borderRadius: quivoBubble.radius,
    backgroundColor: quivoBubble.surface,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    ...dsElevation(4),
  },
});
