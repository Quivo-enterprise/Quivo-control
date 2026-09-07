import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from '../../shared/components/Button';
import { Card } from '../../shared/components/Card';
import { Input } from '../../shared/components/Input';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import logoWhite from '../../../assets/images/logo-white.png';

const vehicleLoginSchema = z.object({
  placa: z.string().regex(/^\d{4}-[A-Za-z]{3}$/, 'Formato esperado: 1234-ABC'),
  pin: z.string().min(4, 'Ingresa el PIN del vehículo').max(12, 'PIN demasiado largo'),
});

type VehicleLoginFormValues = z.infer<typeof vehicleLoginSchema>;

const placaMask = [
  /\d/, /\d/, /\d/, /\d/, '-', /[A-Za-z]/, /[A-Za-z]/, /[A-Za-z]/
];

interface VehicleLoginScreenProps {
  loading: boolean;
  error: string | null;
  onSubmit: (placa: string, pin: string) => Promise<void>;
}

export function VehicleLoginScreen({ loading: parentLoading, error: serverError, onSubmit }: VehicleLoginScreenProps) {
  const [isSimulating, setIsSimulating] = useState(false);

  const loading = parentLoading || isSimulating;

  const {
    control,
    handleSubmit,
    formState: { isValid, errors },
  } = useForm<VehicleLoginFormValues>({
    resolver: zodResolver(vehicleLoginSchema),
    mode: 'onChange',
    defaultValues: {
      placa: '',
      pin: '',
    },
  });

  const onSubmitForm = async (data: VehicleLoginFormValues) => {
    setIsSimulating(true);
    try {
      // Remove dash before sending to backend to match DB seed format (e.g. 1001ABC)
      await onSubmit(data.placa.toUpperCase().replace('-', ''), data.pin);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={['#E78A1B', '#8B5962', '#3D2EA5', '#A3654F', '#F08F14']}
        locations={[0, 0.22, 0.50, 0.78, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              Conecta tu vehículo
            </Text>
            <Text style={styles.subtitle}>
              Ingresa la placa del vehículo y el credencial proporcionado por tu sindicato para comenzar la jornada.
            </Text>
          </View>

          <Card style={styles.card} padding="none">
            <View style={styles.formContainer}>
              <Controller
                control={control}
                name="placa"
                render={({ field: { onChange, onBlur, value } }) => {
                  return (
                    <Input
                      label="Placa del vehículo"
                      labelStyle={styles.inputLabel}
                      placeholder="1234-ABC"
                      placeholderTextColor="#94A3B8"
                      error={errors.placa?.message}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="next"
                      mask={placaMask}
                      value={value}
                      onChangeText={(masked) => onChange(masked.toUpperCase())}
                      onBlur={onBlur}
                      editable={!loading}
                      inputShellStyle={styles.inputShell}
                      style={styles.inputText}
                    />
                  );
                }}
              />

              <Controller
                control={control}
                name="pin"
                render={({ field: { onChange, onBlur, value } }) => {
                  return (
                    <Input
                      label="PIN del vehículo"
                      labelStyle={styles.inputLabel}
                      placeholder="1234"
                      placeholderTextColor="#94A3B8"
                      error={errors.pin?.message}
                      keyboardType="numeric"
                      maxLength={12}
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      editable={!loading}
                      inputShellStyle={styles.inputShell}
                      style={styles.inputText}
                    />
                  );
                }}
              />

              {serverError ? <Text style={styles.error}>{serverError}</Text> : null}

              <Button
                variant="primary"
                loading={loading}
                disabled={!isValid || loading}
                onPress={handleSubmit(onSubmitForm)}
                style={styles.submitButton}
                textStyle={styles.submitButtonText}
                fullWidth
              >
                SIGUIENTE
              </Button>
            </View>
          </Card>

          <View style={styles.footerContainer}>
            <Image source={logoWhite} style={styles.footerLogo} resizeMode="contain" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#3D2EA5' },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 44 : 32,
    paddingBottom: 28,
    justifyContent: 'space-between',
  },
  header: {
    gap: quivoSpacing.sm,
    alignItems: 'center',
    marginBottom: quivoSpacing.xl,
    marginTop: quivoSpacing.md,
  },
  title: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 27,
    lineHeight: 33,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.90)',
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: quivoSpacing.xs,
  },
  card: {
    backgroundColor: quivoColors.white,
    borderRadius: 28,
    borderWidth: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
  },
  formContainer: {
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 24,
    gap: 16,
  },
  inputLabel: {
    color: '#334155',
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14.5,
    marginBottom: 2,
  },
  inputShell: {
    backgroundColor: '#DCE0E8',
    borderColor: 'transparent',
    borderWidth: 0,
    borderRadius: 13,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  inputText: {
    color: '#1E293B',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 15,
  },
  submitButton: {
    marginTop: 8,
    backgroundColor: '#3127B1',
    borderColor: '#3127B1',
    borderRadius: quivoRadius.pill,
    minHeight: 50,
    shadowColor: '#1A0E70',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 15.5,
    letterSpacing: 0.8,
    color: quivoColors.white,
  },
  error: {
    color: quivoColors.danger,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  footerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: quivoSpacing.xl,
    paddingBottom: quivoSpacing.xs,
  },
  footerLogo: {
    width: 115,
    height: 46,
  },
});
