import { StyleSheet, Text, View } from 'react-native';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

interface QuivoHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

export function QuivoHeader({ eyebrow = 'QUIVO CONTROL', title, subtitle }: QuivoHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.brandRow}>
        <View style={styles.mark} accessibilityElementsHidden>
          <Text style={styles.markText}>Q</Text>
        </View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: quivoSpacing.sm },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    marginBottom: quivoSpacing.sm,
  },
  mark: {
    width: 38,
    height: 38,
    borderRadius: quivoRadius.md,
    backgroundColor: quivoColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { color: quivoColors.text, fontFamily: quivoFonts.displayBold, fontSize: 23 },
  eyebrow: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.displayBold,
    fontSize: 13,
    letterSpacing: 1.4,
  },
  title: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 30,
    lineHeight: 37,
  },
  subtitle: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 14,
    lineHeight: 22,
  },
});
