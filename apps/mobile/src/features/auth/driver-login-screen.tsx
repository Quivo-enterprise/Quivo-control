import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
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

interface DriverLoginScreenProps {
  placa: string;
  loading: boolean;
  error: string | null;
  onSubmit: (documento: string, pin: string) => Promise<void>;
  onBack: () => void;
}

export function DriverLoginScreen({
  placa,
  loading,
  error,
  onSubmit,
  onBack,
}: DriverLoginScreenProps) {
  const [documento, setDocumento] = useState('');
  const [pin, setPin] = useState('');
  const documentoValidado = DocumentoIdentidadBoliviaSchema.safeParse(documento);
  const documentoError =
    documento.length > 0 && !documentoValidado.success
      ? documentoValidado.error.issues[0]?.message
      : undefined;
  const puedeContinuar = documentoValidado.success && /^\d{6,12}$/.test(pin);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <QuivoHeader
          title="Identifícate como chofer"
          subtitle="Usaremos tu identidad para cargar la asignación activa de este vehículo."
        />
        <QuivoStepIndicator current={2} />
        <View style={styles.vehiclePill}>
          <Text style={styles.vehicleLabel}>VEHÍCULO VALIDADO</Text>
          <Text style={styles.vehiclePlate}>{placa}</Text>
        </View>
        <Card style={styles.form}>
          <Input
            label="CI boliviano"
            placeholder="Ej.: 1234567-1A LP"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={29}
            value={documento}
            onChangeText={setDocumento}
            onBlur={() => setDocumento(normalizarDocumentoIdentidadBolivia(documento))}
            error={documentoError}
            helperText="Incluye complemento y expedición solo si figuran en tu cédula."
          />
          <Input
            label="PIN personal"
            placeholder="6 a 12 dígitos"
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
            onPress={() => {
              if (documentoValidado.success) void onSubmit(documentoValidado.data, pin);
            }}
          >
            Ingresar a mi jornada
          </Button>
          <Button
            variant="secondary"
            disabled={loading}
            onPress={onBack}
          >
            Cambiar vehículo
          </Button>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: quivoSpacing.xl, gap: quivoSpacing.xl, paddingBottom: quivoSpacing.xxxl },
  form: { gap: quivoSpacing.xl },
  vehiclePill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    backgroundColor: quivoColors.successSoft,
    borderRadius: quivoRadius.pill,
    paddingVertical: quivoSpacing.sm,
    paddingHorizontal: quivoSpacing.lg,
  },
  vehicleLabel: {
    color: quivoColors.success,
    fontFamily: quivoFonts.displayBold,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  vehiclePlate: { color: quivoColors.text, fontFamily: quivoFonts.displayBold, fontSize: 15 },
  error: {
    color: quivoColors.danger,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    lineHeight: 20,
  },
});
