import { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { quivoColors, quivoRadius, quivoSpacing } from '../theme/quivo-theme';

export type CardVariant = 'surface' | 'soft' | 'brand' | 'glass' | 'accent' | 'outline' | 'elevated' | 'interactive';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends ViewProps {
  variant?: CardVariant;
  padding?: CardPadding;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Card({
  variant = 'surface',
  padding = 'md',
  header,
  footer,
  style,
  children,
  ...props
}: CardProps) {
  return (
    <View 
      style={[
        styles.card, 
        styles[`variant_${variant}` as keyof typeof styles] || styles.variant_surface,
        style
      ] as any} 
      {...props}
    >
      {header ? (
        <View style={([styles.header, styles[`padding_${padding}` as keyof typeof styles] || styles.padding_md]) as any}>
          {header}
        </View>
      ) : null}
      
      <View style={([styles.body, styles[`padding_${padding}` as keyof typeof styles] || styles.padding_md]) as any}>
        {children}
      </View>
      
      {footer ? (
        <View style={([styles.footer, styles[`padding_${padding}` as keyof typeof styles] || styles.padding_md]) as any}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: quivoRadius.lg,
    overflow: 'hidden',
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: quivoColors.border,
  },
  body: {
    flex: 1,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: quivoColors.border,
  },

  // Paddings
  padding_none: { padding: 0 },
  padding_sm: { padding: quivoSpacing.sm },
  padding_md: { padding: quivoSpacing.md },
  padding_lg: { padding: quivoSpacing.xl },

  // Variants
  variant_surface: {
    backgroundColor: quivoColors.card,
    borderWidth: 1,
    borderColor: quivoColors.border,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  variant_soft: {
    backgroundColor: quivoColors.primarySubtle,
    borderWidth: 0,
  },
  variant_brand: {
    backgroundColor: quivoColors.primary,
    borderWidth: 0,
  },
  variant_glass: {
    backgroundColor: quivoColors.glassSurface,
    borderColor: quivoColors.glassBorder,
    borderWidth: 1,
  },
  variant_accent: {
    backgroundColor: quivoColors.accentSoft,
    borderWidth: 0,
  },
  variant_outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: quivoColors.border,
  },
  variant_elevated: {
    backgroundColor: quivoColors.card,
    borderWidth: 0,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 5,
  },
  variant_interactive: {
    backgroundColor: quivoColors.card,
    borderWidth: 1,
    borderColor: quivoColors.border,
  }
});
