import { StyleSheet, View, type ViewProps } from 'react-native';
import { quivoColors, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

export function QuivoCard({ style, ...props }: ViewProps) {
  return <View style={[styles.card, style]} {...props} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: quivoColors.card,
    borderRadius: quivoRadius.lg,
    borderWidth: 1,
    borderColor: quivoColors.border,
    padding: quivoSpacing.xl,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
});
