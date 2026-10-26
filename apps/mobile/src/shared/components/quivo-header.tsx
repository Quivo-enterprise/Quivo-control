import { Pressable, StyleSheet, View } from 'react-native';
import { Heading, Text, colors, radius, space } from '@quivo/design-system-native';
import { quivoBubble } from '../theme/quivo-theme';
interface QuivoHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
}
export function QuivoHeader({ title, subtitle, onBack, backLabel = 'Volver' }: QuivoHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
        ) : (
          <View
            style={styles.backButton}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.backIcon}>‹</Text>
          </View>
        )}
        <Heading size="xl" style={styles.title}>
          {title}
        </Heading>
        <View style={styles.spacer} />
      </View>
      {subtitle ? (
        <Text size="sm" variant="secondary" style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  backButton: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.light.borderSubtle,
    backgroundColor: colors.light.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { color: colors.light.primaryText, fontSize: 30, lineHeight: 32 },
  spacer: { width: quivoBubble.touch, height: quivoBubble.touch },
  title: { flex: 1, textAlign: 'center', color: colors.light.textPrimary },
  subtitle: { textAlign: 'center' },
});
