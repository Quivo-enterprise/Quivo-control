import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../shared/components/Button';
import { Card } from '../../shared/components/Card';
import { QuivoHeader } from '../../shared/components/quivo-header';
import { QuivoStepIndicator } from '../../shared/components/quivo-step-indicator';
import { Input } from '../../shared/components/Input';
import { quivoColors, quivoFonts, quivoSpacing } from '../../shared/theme/quivo-theme';

const vehicleLoginSchema = z.object({
  placa: z.string().regex(/^\d{4}-[A-Za-z]{3}$/, 'Formato esperado: 1234-ABC'),
  pin: z.string().regex(/^\d{6,12}$/, 'El PIN debe tener entre 6 y 12 números'),
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
  const [showPin, setShowPin] = useState(false);
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
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Remove dash before sending to backend to match DB seed format (e.g. 1001ABC)
      await onSubmit(data.placa.toUpperCase().replace('-', ''), data.pin);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <QuivoHeader
          title="Conecta tu vehículo"
          subtitle="Ingresa la credencial entregada por tu sindicato para comenzar la jornada."
        />
        <QuivoStepIndicator current={1} />
        <Card style={styles.form}>
          <Controller
            control={control}
            name="placa"
            render={({ field: { onChange, onBlur, value }, fieldState: { isDirty } }) => {
              const hasError = !!errors.placa;
              const isValidField = isDirty && !hasError && value.length === 8;
              return (
                <Input
                  label="Placa del vehículo"
                  placeholder="Ej. 1234-ABC"
                  helperText={errors.placa?.message ?? "Formato esperado: 1234-ABC"}
                  error={errors.placa?.message}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="next"
                  mask={placaMask}
                  value={value}
                  onChangeText={(masked) => onChange(masked.toUpperCase())}
                  onBlur={onBlur}
                  editable={!loading}
                  leftSlot={
                    <Ionicons 
                      name="car-outline" 
                      size={20} 
                      color={hasError ? quivoColors.danger : isValidField ? quivoColors.primary : quivoColors.textMuted} 
                    />
                  }
                  rightSlot={isValidField ? <Ionicons name="checkmark-circle" size={20} color={quivoColors.success} /> : undefined}
                />
              );
            }}
          />
          
          <View style={styles.divider} />
          
          <Controller
            control={control}
            name="pin"
            render={({ field: { onChange, onBlur, value }, fieldState: { isDirty } }) => {
              const hasError = !!errors.pin;
              const isValidField = isDirty && !hasError && value.length >= 6;
              return (
                <Input
                  label="PIN del vehículo"
                  placeholder="6 a 12 dígitos"
                  helperText={errors.pin?.message ?? "Este PIN identifica al vehículo, no al chofer."}
                  error={errors.pin?.message}
                  keyboardType="number-pad"
                  secureTextEntry={!showPin}
                  maxLength={12}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  editable={!loading}
                  leftSlot={
                    <Ionicons 
                      name="lock-closed-outline" 
                      size={20} 
                      color={hasError ? quivoColors.danger : isValidField ? quivoColors.primary : quivoColors.textMuted} 
                    />
                  }
                  rightSlot={
                    <Pressable onPress={() => setShowPin(!showPin)} disabled={loading} hitSlop={10}>
                      <Ionicons 
                        name={showPin ? "eye-off-outline" : "eye-outline"} 
                        size={20} 
                        color={quivoColors.textMuted} 
                      />
                    </Pressable>
                  }
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
            fullWidth
          >
            Validar vehículo
          </Button>
          
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: quivoColors.page },
  content: { padding: quivoSpacing.xl, gap: quivoSpacing.xl, paddingBottom: quivoSpacing.xxxl },
  form: { gap: quivoSpacing.lg },
  divider: {
    height: 1,
    backgroundColor: quivoColors.border,
    marginVertical: quivoSpacing.xs,
  },
  submitButton: {
    marginTop: quivoSpacing.sm,
  },
  error: {
    color: quivoColors.danger,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
});
