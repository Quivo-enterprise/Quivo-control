import { StyleSheet, Text, View } from 'react-native';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

interface QuivoStepIndicatorProps {
  current: 1 | 2;
}

export function QuivoStepIndicator({ current }: QuivoStepIndicatorProps) {
  return (
    <View accessibilityLabel={`Paso ${current} de 2`} style={styles.row}>
      <Step number={1} label="Vehículo" active={current >= 1} />
      <View style={[styles.line, current >= 2 ? styles.lineActive : null]} />
      <Step number={2} label="Chofer" active={current >= 2} />
    </View>
  );
}

function Step({ number, label, active }: { number: number; label: string; active: boolean }) {
  return (
    <View style={styles.step}>
      <View style={[styles.circle, active ? styles.circleActive : null]}>
        <Text style={[styles.number, active ? styles.numberActive : null]}>{number}</Text>
      </View>
      <Text style={[styles.label, active ? styles.labelActive : null]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  step: { alignItems: 'center', width: 76, gap: quivoSpacing.xs },
  circle: {
    width: 32,
    height: 32,
    borderRadius: quivoRadius.pill,
    borderWidth: 2,
    borderColor: quivoColors.border,
    backgroundColor: quivoColors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleActive: { borderColor: quivoColors.primary, backgroundColor: quivoColors.primary },
  number: { color: quivoColors.textMuted, fontFamily: quivoFonts.displaySemiBold, fontSize: 13 },
  numberActive: { color: quivoColors.white },
  label: { color: quivoColors.textMuted, fontFamily: quivoFonts.bodyMedium, fontSize: 11 },
  labelActive: { color: quivoColors.primary },
  line: { width: 54, height: 2, marginTop: 15, backgroundColor: quivoColors.border },
  lineActive: { backgroundColor: quivoColors.primary },
});
