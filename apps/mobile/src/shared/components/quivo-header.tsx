import { StyleSheet, Text, View, Image } from 'react-native';
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
        <Image 
          source={require('../../../assets/images/logo.png')} 
          style={styles.logo} 
          resizeMode="contain" 
        />
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
  logo: {
    height: 38,
    width: 150, // adjust width based on aspect ratio
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
