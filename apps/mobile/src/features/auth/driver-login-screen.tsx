import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, FadeInDown, Easing } from 'react-native-reanimated';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Ionicons } from '@expo/vector-icons';
import {
  DocumentoIdentidadBoliviaSchema,
  normalizarDocumentoIdentidadBolivia,
} from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { Card } from '../../shared/components/Card';
import { QuivoHeader } from '../../shared/components/quivo-header';
import { QuivoStepIndicator } from '../../shared/components/quivo-step-indicator';
import { Input } from '../../shared/components/Input';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';

const driverLoginSchema = z.object({
  documento: z.string().min(1, 'El documento es requerido').superRefine((val, ctx) => {
    const res = DocumentoIdentidadBoliviaSchema.safeParse(val);
    if (!res.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: res.error.issues[0]?.message || 'Documento inválido',
      });
    }
  }),
  pin: z.string().regex(/^\d{4,6}$/, 'El PIN debe tener entre 4 y 6 números'),
});

type DriverLoginFormValues = z.infer<typeof driverLoginSchema>;

interface DriverLoginScreenProps {
  vehiculo: { placa: string; tipo: string; marca: string; modelo: string; };
  loading: boolean;
  error: string | null;
  onSubmit: (documento: string, pin: string) => Promise<void>;
  onBack: () => void;
}

export function DriverLoginScreen({
  vehiculo,
  loading: parentLoading,
  error: serverError,
  onSubmit,
  onBack,
}: DriverLoginScreenProps) {
  const [showTransition, setShowTransition] = useState(true);
  const [showPin, setShowPin] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const loading = parentLoading || isSimulating;

  useEffect(() => {
    if (showTransition) {
      const timer = setTimeout(() => {
        setShowTransition(false);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [showTransition]);

  const {
    control,
    handleSubmit,
    formState: { isValid, errors },
  } = useForm<DriverLoginFormValues>({
    resolver: zodResolver(driverLoginSchema),
    mode: 'onChange',
    defaultValues: {
      documento: '',
      pin: '',
    },
  });

  const onSubmitForm = async (data: DriverLoginFormValues) => {
    setIsSimulating(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await onSubmit(data.documento, data.pin);
    } finally {
      setIsSimulating(false);
    }
  };

  if (showTransition) {
    return (
      <Pressable style={styles.flex} onPress={() => setShowTransition(false)}>
        <Animated.View style={styles.transitionContainer} exiting={FadeOut.duration(300)}>
          <Animated.View entering={ZoomIn.duration(600).easing(Easing.out(Easing.back(1.5)))} style={styles.checkmarkContainer}>
            <Ionicons name="checkmark-circle" size={80} color="#4CAF50" />
          </Animated.View>
          
          <Animated.Text entering={FadeIn.delay(200)} style={styles.transitionTitle}>
            Vehículo validado
          </Animated.Text>
          
          <Animated.View entering={FadeInDown.delay(400)} style={styles.vehicleCardWrapper}>
            <View style={styles.vehicleCard}>
              <View style={styles.vehicleCardContent}>
                <Ionicons name="car-outline" size={28} color={quivoColors.textSecondary} />
                <View style={styles.vehicleCardText}>
                  <Text style={styles.vehicleCardBrand}>
                    {vehiculo.tipo} • {vehiculo.marca} {vehiculo.modelo} ({vehiculo.placa})
                  </Text>
                </View>
              </View>
            </View>
          </Animated.View>

          <View style={styles.transitionDivider} />
          
          <Animated.View entering={FadeIn.delay(800)} style={styles.nextSectionPreview}>
            <Text style={styles.nextSectionTitle}>Confirma tu identidad</Text>
            <Text style={styles.nextSectionSub}>Ingresa tu cédula y PIN personal</Text>
          </Animated.View>
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <Animated.View style={styles.flex} entering={FadeIn.duration(400)}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <Pressable
              onPress={onBack}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Volver a validar vehículo"
              hitSlop={10}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={24} color={quivoColors.text} />
            </Pressable>
            <View style={styles.headerRowContent}>
              <QuivoHeader
                title="Confirma tu identidad"
                subtitle="Ingresa tu cédula y PIN personal."
              />
            </View>
          </View>
          <QuivoStepIndicator current={2} />
          
          <View style={styles.vehiclePill}>
            <View style={styles.vehiclePillIcon}>
               <Ionicons name="checkmark-circle" size={24} color={quivoColors.success} />
            </View>
            <View>
              <Text style={styles.vehicleLabel}>Vehículo validado</Text>
              <Text style={styles.vehiclePlate}>{vehiculo.placa} • Unidad Operativa</Text>
            </View>
          </View>

          <Card style={styles.form}>
            <Controller
              control={control}
              name="documento"
              render={({ field: { onChange, onBlur, value }, fieldState: { isDirty } }) => {
                const hasError = !!errors.documento;
                const isValidField = isDirty && !hasError;
                return (
                  <Input
                    label="Cédula de identidad"
                    placeholder="Ej. 1234567 LP"
                    helperText="Tu número de identidad"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={15}
                    value={value}
                    onChangeText={onChange}
                    onBlur={() => {
                      onChange(normalizarDocumentoIdentidadBolivia(value));
                      onBlur();
                    }}
                    error={errors.documento?.message}
                    editable={!loading}
                    leftSlot={
                      <Ionicons 
                        name="id-card-outline" 
                        size={20} 
                        color={hasError ? quivoColors.danger : isValidField ? quivoColors.primary : quivoColors.textMuted} 
                      />
                    }
                  />
                );
              }}
            />
            
            <Controller
              control={control}
              name="pin"
              render={({ field: { onChange, onBlur, value }, fieldState: { isDirty } }) => {
                const hasError = !!errors.pin;
                const isValidField = isDirty && !hasError && value.length >= 6;
                return (
                  <Input
                    label="PIN personal"
                    placeholder=""
                    helperText="Solo para esta jornada"
                    keyboardType="number-pad"
                    secureTextEntry={!showPin}
                    maxLength={6}
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.pin?.message}
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
            
            <View style={styles.securityNote}>
              <Ionicons name="shield-checkmark-outline" size={16} color={quivoColors.textMuted} />
              <Text style={styles.securityNoteText}>
                Tus datos están protegidos{'\n'}y solo se usan para esta jornada.
              </Text>
            </View>

            {serverError ? <Text style={styles.error}>{serverError}</Text> : null}
            
            <Button
              variant="primary"
              loading={loading}
              disabled={!isValid || loading}
              onPress={handleSubmit(onSubmitForm)}
              style={styles.submitButton}
              fullWidth
            >
              Continuar
            </Button>
          </Card>
          
          <View style={styles.footerNote}>
            <View style={styles.footerIconLeft}>
              <Ionicons name="arrow-forward-outline" size={18} color={quivoColors.primaryStrong} />
            </View>
            <Text style={styles.footerNoteText}>
              Después irás directo al mapa de ruta{'\n'}para iniciar tu operación.
            </Text>
            <Ionicons name="map-outline" size={24} color={quivoColors.primaryStrong} />
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: quivoColors.page },
  content: { padding: quivoSpacing.xl, gap: quivoSpacing.xl, paddingBottom: quivoSpacing.xxxl },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: quivoSpacing.sm },
  backButton: { paddingTop: quivoSpacing.xs },
  headerRowContent: { flex: 1 },
  form: { gap: quivoSpacing.lg },
  
  // Transition styles
  transitionContainer: {
    flex: 1,
    backgroundColor: quivoColors.page,
    alignItems: 'center',
    justifyContent: 'center',
    padding: quivoSpacing.xl,
  },
  checkmarkContainer: {
    marginBottom: quivoSpacing.md,
  },
  transitionTitle: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 20,
    color: quivoColors.text,
    marginBottom: quivoSpacing.xl,
  },
  vehicleCardWrapper: {
    width: '100%',
    marginBottom: quivoSpacing.xl,
  },
  vehicleCard: {
    backgroundColor: '#F5F7FA',
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
    padding: quivoSpacing.lg,
    borderRadius: quivoRadius.md,
  },
  vehicleCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
  },
  vehicleCardText: {
    flex: 1,
  },
  vehicleCardBrand: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 15,
    color: quivoColors.text,
  },
  vehicleCardPlate: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 16,
    color: quivoColors.textSecondary,
    marginTop: 2,
  },
  transitionDivider: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: quivoColors.border,
    marginBottom: quivoSpacing.xl,
  },
  nextSectionPreview: {
    alignItems: 'center',
  },
  nextSectionTitle: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 16,
    color: quivoColors.text,
    marginBottom: 4,
  },
  nextSectionSub: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 14,
    color: quivoColors.textSecondary,
  },

  // Form styles
  vehiclePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    backgroundColor: quivoColors.successSoft,
    borderRadius: quivoRadius.lg,
    paddingVertical: quivoSpacing.md,
    paddingHorizontal: quivoSpacing.lg,
  },
  vehiclePillIcon: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  vehicleLabel: {
    color: quivoColors.success,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14,
  },
  vehiclePlate: { 
    color: quivoColors.textSecondary, 
    fontFamily: quivoFonts.bodyRegular, 
    fontSize: 12,
    marginTop: 2,
  },

  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    paddingHorizontal: quivoSpacing.md,
    paddingVertical: quivoSpacing.sm,
    backgroundColor: '#E3F2FD',
    borderRadius: quivoRadius.sm,
  },
  securityNoteText: {
    color: '#0F1B5C',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
  },

  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    paddingHorizontal: quivoSpacing.sm,
    marginTop: quivoSpacing.md,
  },
  footerIconLeft: {
    backgroundColor: quivoColors.primarySoft,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerNoteText: {
    flex: 1,
    color: quivoColors.primaryStrong,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    lineHeight: 18,
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
