import { useEffect, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { normalizarPlacaVehiculo } from '@quivo/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../shared/components/Button';
import { Card } from '../../shared/components/Card';
import { Input } from '../../shared/components/Input';
import { colors, radius, space, fontSize, fontStyle } from '@quivo/design-system-native';
import logoWhite from '../../../assets/images/logo-white.png';
import { vehicleLoginSchema, type VehicleLoginFormValues } from './vehicle-login-schema';

interface VehicleLoginScreenProps {
  loading: boolean;
  error: string | null;
  onSubmit: (placa: string, pin: string) => Promise<void>;
}

export function VehicleLoginScreen({
  loading: parentLoading,
  error: serverError,
  onSubmit,
}: VehicleLoginScreenProps) {
  const [isSimulating, setIsSimulating] = useState(false);
  const [verPin, setVerPin] = useState(false);
  const pinRef = useRef<TextInput>(null);

  const loading = parentLoading || isSimulating;

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isValid, errors },
  } = useForm<VehicleLoginFormValues>({
    resolver: zodResolver(vehicleLoginSchema),
    mode: 'onChange',
    defaultValues: {
      placa: '',
      pin: '',
    },
  });

  // PIN rechazado: se vacía y vuelve el foco para reintentar sin borrar a mano (la placa queda).
  useEffect(() => {
    if (!serverError) return;
    setValue('pin', '', { shouldValidate: true });
    pinRef.current?.focus();
  }, [serverError, setValue]);

  const onSubmitForm = async (data: VehicleLoginFormValues) => {
    setIsSimulating(true);
    try {
      await onSubmit(normalizarPlacaVehiculo(data.placa), data.pin);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={['#E78A1B', '#8B5962', '#3D2EA5', '#A3654F', '#F08F14']}
        locations={[0, 0.22, 0.5, 0.78, 1]}
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
              Ingresa la placa del vehículo y el credencial proporcionado por tu sindicato para
              comenzar la jornada.
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
                      placeholder="1234ABC o 123ABC"
                      placeholderTextColor={colors.light.textTertiary}
                      error={errors.placa?.message}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="next"
                      submitBehavior="submit"
                      onSubmitEditing={() => pinRef.current?.focus()}
                      maxLength={20}
                      value={value}
                      onChangeText={(text) => onChange(text.toUpperCase())}
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
                      ref={pinRef}
                      label="PIN del conductor"
                      labelStyle={styles.inputLabel}
                      placeholder="6 a 12 dígitos"
                      placeholderTextColor={colors.light.textTertiary}
                      error={errors.pin?.message}
                      keyboardType="number-pad"
                      secureTextEntry={!verPin}
                      autoComplete="off"
                      importantForAutofill="no"
                      returnKeyType="go"
                      onSubmitEditing={() => {
                        if (isValid && !loading) void handleSubmit(onSubmitForm)();
                      }}
                      rightSlot={
                        <Pressable
                          onPress={() => setVerPin((v) => !v)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={verPin ? 'Ocultar PIN' : 'Mostrar PIN'}
                          style={styles.ojo}
                        >
                          <Ionicons
                            name={verPin ? 'eye-off-outline' : 'eye-outline'}
                            size={22}
                            color={c.textSecondary}
                          />
                        </Pressable>
                      }
                      maxLength={12}
                      value={value}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      editable={!loading}
                      inputShellStyle={styles.inputShell}
                      style={[styles.inputText, !verPin && value ? styles.pinOculto : null]}
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
                Ingresar
              </Button>
              <View style={styles.infoNotice}>
                <Ionicons name="information-circle-outline" size={20} color={c.info} />
                <Text style={styles.infoNoticeText}>
                  ¿No tienes tu PIN? Solicítalo a tu sindicato antes de comenzar.
                </Text>
              </View>
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

const c = colors.light;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.primary },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    paddingTop: Platform.OS === 'ios' ? space['2xl'] : space.xl,
    paddingBottom: space.lg,
    justifyContent: 'space-between',
  },
  header: { gap: space.sm, alignItems: 'center', marginBottom: space.lg, marginTop: space.md },
  title: {
    color: c.textInverse,
    fontSize: fontSize['2xl'],
    ...fontStyle('display', '700'),
    textAlign: 'center',
  },
  subtitle: {
    ...fontStyle('body'),
    color: c.textInverse,
    fontSize: fontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: space.xs,
  },
  card: {
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 0,
    overflow: 'hidden',
  },
  formContainer: { padding: space.lg, gap: space.md },
  inputLabel: { color: c.textPrimary, fontSize: fontSize.sm },
  inputShell: {
    backgroundColor: c.surfaceCard,
    borderColor: c.borderSubtle,
    borderRadius: radius.full,
    minHeight: 48,
  },
  inputText: { color: c.textPrimary, fontSize: fontSize.md },
  // Los puntos del PIN oculto, separados para poder contarlos.
  pinOculto: { letterSpacing: 4, fontSize: fontSize['2xl'] },
  ojo: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -space.sm,
  },
  submitButton: { marginTop: space.sm, minHeight: 48 },
  submitButtonText: { fontSize: fontSize.md },
  infoNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: c.infoSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
  infoNoticeText: {
    ...fontStyle('body'),
    flex: 1,
    color: c.primaryText,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  error: {
    ...fontStyle('body'),
    color: c.danger,
    fontSize: fontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
  },
  footerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
    paddingBottom: space.xs,
  },
  footerLogo: { width: 115, height: 46 },
});
