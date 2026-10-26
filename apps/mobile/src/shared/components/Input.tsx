import type { ReactNode, Ref } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import MaskInput, { type Mask } from 'react-native-mask-input';
import {
  Input as DSInput,
  fontStyle,
  Text,
  colors,
  fontSize,
  radius,
  space,
} from '@quivo/design-system-native';
import { quivoBubble } from '../theme/quivo-theme';

export interface InputProps extends Omit<TextInputProps, 'size'> {
  label?: string;
  helperText?: string;
  error?: string;
  controlSize?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  containerStyle?: ViewStyle | ViewStyle[];
  inputShellStyle?: ViewStyle | ViewStyle[];
  labelStyle?: TextStyle | TextStyle[];
  mask?: Mask;
  /** React 19: llega como prop y viaja en `...props` hasta el `TextInput` (foco programático). */
  ref?: Ref<TextInput>;
}
const c = colors.light;
const heights = { sm: 44, md: 48, lg: 52 };
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
  inputShellStyle,
  labelStyle,
  mask,
  multiline,
  ...props
}: InputProps) {
  const description = error ?? helperText;
  if (
    !mask &&
    !inputShellStyle &&
    !containerStyle &&
    !labelStyle &&
    !multiline &&
    controlSize !== 'sm'
  ) {
    return (
      <DSInput
        label={label}
        helperText={helperText}
        error={error}
        controlSize={controlSize}
        fullWidth={fullWidth}
        leftSlot={leftSlot}
        rightSlot={rightSlot}
        style={style}
        {...props}
      />
    );
  }
  const inputStyle = [
    styles.input,
    { fontSize: controlSize === 'lg' ? fontSize.lg : fontSize.md },
    style,
  ];
  const inputProps = {
    ...props,
    multiline,
    accessibilityLabel: props.accessibilityLabel ?? label,
    accessibilityHint: props.accessibilityHint ?? description,
    placeholderTextColor: props.placeholderTextColor ?? c.textTertiary,
    selectionColor: props.selectionColor ?? c.primary,
    style: inputStyle,
  };
  return (
    <View style={[styles.group, fullWidth && styles.fullWidth, containerStyle]}>
      {label ? (
        <Text weight="bold" size="sm" style={labelStyle}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.shell,
          {
            minHeight: heights[controlSize],
            borderRadius: multiline ? quivoBubble.innerRadius : radius.full,
            borderColor: error ? c.danger : c.borderSubtle,
          },
          inputShellStyle,
        ]}
      >
        {leftSlot ? <View style={styles.slot}>{leftSlot}</View> : null}
        {mask ? <MaskInput mask={mask} {...inputProps} /> : <TextInput {...inputProps} />}
        {rightSlot ? <View style={styles.slot}>{rightSlot}</View> : null}
      </View>
      {description ? (
        <Text
          size="sm"
          variant={error ? 'error' : 'secondary'}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: space.sm },
  fullWidth: { width: '100%' },
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surfaceCard,
    borderWidth: 1,
    paddingHorizontal: space.ms,
  },
  slot: { paddingHorizontal: space.sm },
  input: { ...fontStyle('body'), flex: 1, color: c.textPrimary, paddingVertical: space.sm },
});
