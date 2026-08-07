import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../shared/components/Button';
import { Card } from '../../shared/components/Card';
import { QuivoHeader } from '../../shared/components/quivo-header';
import { QuivoStepIndicator } from '../../shared/components/quivo-step-indicator';
import { Input } from '../../shared/components/Input';
import { quivoColors, quivoFonts, quivoSpacing } from '../../shared/theme/quivo-theme';

interface VehicleLoginScreenProps {
  loading: boolean;
  error: string | null;
  onSubmit: (placa: string, pin: string) => Promise<void>;
}

export function VehicleLoginScreen({ loading, error, onSubmit }: VehicleLoginScreenProps) {
  const [placa, setPlaca] = useState('');
  const [pin, setPin] = useState('');
  const puedeContinuar = placa.trim().length >= 3 && /^\d{6,12}$/.test(pin);

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
          <Input
            label="Placa del vehículo"
            placeholder="Ej. 1234-ABC"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="next"
            value={placa}
            onChangeText={setPlaca}
          />
          <Input
            label="PIN del vehículo"
            placeholder="6 a 12 dígitos"
            helperText="Este PIN identifica al vehículo, no al chofer."
            keyboardType="number-pad"
            secureTextEntry
            maxLength={12}
            value={pin}
            onChangeText={setPin}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            loading={loading}
            disabled={!puedeContinuar}
            onPress={() => void onSubmit(placa, pin)}
          >
            Validar vehículo
          </Button>
        </Card>
        <View style={styles.security}>
          <Text style={styles.securityTitle}>ACCESO OPERATIVO SEGURO</Text>
          <Text style={styles.securityText}>
            Después validarás tu identidad personal como chofer.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: quivoSpacing.xl, gap: quivoSpacing.xl, paddingBottom: quivoSpacing.xxxl },
  form: { gap: quivoSpacing.xl },
  error: {
    color: quivoColors.danger,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    lineHeight: 20,
  },
  security: { alignItems: 'center', gap: quivoSpacing.xs, paddingHorizontal: quivoSpacing.lg },
  securityTitle: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.displayBold,
    fontSize: 11,
    letterSpacing: 1,
  },
  securityText: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12,
    textAlign: 'center',
  },
});
