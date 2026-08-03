import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

interface QuivoTextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  help?: string;
}

export function QuivoTextField({ label, error, help, style, ...props }: QuivoTextFieldProps) {
  const description = error ?? help;
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={description}
        placeholderTextColor={quivoColors.textMuted}
        selectionColor={quivoColors.primary}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...props}
      />
      {description ? (
        <Text
          accessibilityLiveRegion={error ? 'polite' : 'none'}
          style={[styles.help, error ? styles.error : null]}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: quivoSpacing.sm },
  label: { color: quivoColors.text, fontFamily: quivoFonts.bodySemiBold, fontSize: 13 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: quivoColors.border,
    borderRadius: quivoRadius.md,
    backgroundColor: quivoColors.card,
    color: quivoColors.text,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 16,
    paddingHorizontal: quivoSpacing.lg,
    paddingVertical: quivoSpacing.md,
  },
  inputError: { borderColor: quivoColors.danger, backgroundColor: quivoColors.dangerSoft },
  help: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  error: { color: quivoColors.danger },
});
