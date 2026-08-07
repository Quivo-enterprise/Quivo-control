import { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

export interface InputProps extends Omit<TextInputProps, 'size'> {
  label?: string;
  helperText?: string;
  error?: string;
  controlSize?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  containerStyle?: ViewStyle | ViewStyle[];
}

export function Input({
  label,
  helperText,
  error,
  controlSize = 'md',
  fullWidth = true,
  leftSlot,
  rightSlot,
  style,
  containerStyle,
  ...props
}: InputProps) {
  const description = error ?? helperText;
  
  return (
    <View style={[styles.group, fullWidth && styles.fullWidth, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      
      <View
        style={[
          styles.inputShell,
          styles[`shell_${controlSize}` as keyof typeof styles] || styles.shell_md,
          error ? styles.inputShellError : null,
        ] as any}
      >
        {leftSlot ? <View style={styles.slot}>{leftSlot}</View> : null}
        
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={description}
          placeholderTextColor={quivoColors.textMuted}
          selectionColor={quivoColors.primary}
          style={[
            styles.input,
            styles[`input_${controlSize}` as keyof typeof styles] || styles.input_md,
            style
          ] as any}
          {...props}
        />
        
        {rightSlot ? <View style={styles.slot}>{rightSlot}</View> : null}
      </View>
      
      {description ? (
        <Text
          accessibilityLiveRegion={error ? 'polite' : 'none'}
          style={([styles.help, error ? styles.error : null]) as any}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { 
    gap: quivoSpacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  label: { 
    color: quivoColors.text, 
    fontFamily: quivoFonts.bodySemiBold, 
    fontSize: 13 
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: quivoColors.border,
    borderRadius: quivoRadius.md,
    backgroundColor: quivoColors.card,
  },
  inputShellError: { 
    borderColor: quivoColors.danger, 
    backgroundColor: quivoColors.dangerSoft 
  },
  slot: {
    paddingHorizontal: quivoSpacing.md,
  },
  input: {
    flex: 1,
    color: quivoColors.text,
    fontFamily: quivoFonts.bodyMedium,
  },
  
  // Control Sizes
  shell_sm: { minHeight: 40 },
  shell_md: { minHeight: 52 },
  shell_lg: { minHeight: 60 },

  input_sm: { fontSize: 14, paddingHorizontal: quivoSpacing.md, paddingVertical: quivoSpacing.sm },
  input_md: { fontSize: 16, paddingHorizontal: quivoSpacing.lg, paddingVertical: quivoSpacing.md },
  input_lg: { fontSize: 18, paddingHorizontal: quivoSpacing.xl, paddingVertical: quivoSpacing.lg },
  
  help: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  error: { color: quivoColors.danger },
});
