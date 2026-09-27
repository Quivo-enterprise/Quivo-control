import { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../shared/components/Button';
import { Input } from '../../shared/components/Input';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { TRUFIS_MOCK } from '../datos/datos';
import { FOTOS_TRUFI } from '../datos/fotos.generated';
import type { LineaMockId } from '../datos/tipos';
import { ETIQUETAS_TIPO_REPORTE_DEMO, type EstadoSenalDemo, type TipoReporteDemo } from '../motor';
import { DemoAvatarRedondo } from './demo-avatar';

export interface ReportarModalDemoProps {
  visible: boolean;
  onClose: () => void;
  lineaPropiaId: LineaMockId;
  trufiPropioId: string;
  colorLinea: string;
  senal: EstadoSenalDemo;
  onEnviar: (entrada: { tipo: TipoReporteDemo; placaReportada?: string; nota?: string }) => void;
}

/** `ETIQUETAS_TIPO_REPORTE_DEMO` está definido en `../motor.ts` con `fuera_de_orden` primero —
 * `Object.entries` preserva ese orden de inserción, así que los chips salen en el mismo orden sin
 * tener que repetir la lista acá (evita que las dos listas se desincronicen). */
const TIPOS_REPORTE = Object.entries(ETIQUETAS_TIPO_REPORTE_DEMO) as [TipoReporteDemo, string][];

/**
 * Modal "Reportar" (guion E06 03:36: "si encuentra algún vehículo trabajando fuera de orden,
 * puede reportarlo") — reemplazo demo del modal de "Registrar observación" de texto libre
 * (`operation-screen.tsx` sigue mostrando el modal real fuera de demo, sin tocarlo). Reusa la
 * estructura visual (glass card, overlay, pill buttons) del modal de observación existente. Ver
 * `docs/plan-apk-demo-conductor.md`, paso B.
 */
export function ReportarModalDemo({
  visible,
  onClose,
  lineaPropiaId,
  trufiPropioId,
  colorLinea,
  senal,
  onEnviar,
}: ReportarModalDemoProps) {
  const [tipo, setTipo] = useState<TipoReporteDemo>('fuera_de_orden');
  const [placaSeleccionada, setPlacaSeleccionada] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [enviado, setEnviado] = useState(false);

  const otrasUnidades = TRUFIS_MOCK.filter((t) => t.lineaId === lineaPropiaId && t.id !== trufiPropioId);

  const resetear = useCallback(() => {
    setTipo('fuera_de_orden');
    setPlacaSeleccionada(null);
    setNota('');
    setEnviado(false);
  }, []);

  const cerrar = useCallback(() => {
    onClose();
    resetear();
  }, [onClose, resetear]);

  const trufiSeleccionado = otrasUnidades.find((t) => t.id === placaSeleccionada);
  const puedeEnviar = tipo !== 'fuera_de_orden' || Boolean(trufiSeleccionado);

  const enviar = useCallback(() => {
    if (!puedeEnviar) return;
    onEnviar({
      tipo,
      placaReportada: tipo === 'fuera_de_orden' ? trufiSeleccionado?.placa : undefined,
      nota: nota.trim() || undefined,
    });
    setEnviado(true);
  }, [puedeEnviar, tipo, trufiSeleccionado, nota, onEnviar]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cerrar}>
      <View style={styles.overlay}>
        <BlurView intensity={85} tint="light" style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="flag-outline" size={20} color="#3127B1" />
            <Text style={styles.title}>Reportar</Text>
          </View>

          {enviado ? (
            <>
              <Text style={styles.mensajeExito}>
                {senal === 'ok' ? 'Enviado al delegado' : 'Guardado · se enviará al recuperar señal'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Listo"
                onPress={cerrar}
                style={({ pressed }) => [styles.pillButton, pressed && styles.pressed]}
              >
                <Text style={styles.pillButtonText}>LISTO</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                {TIPOS_REPORTE.map(([valor, etiqueta]) => {
                  const activo = valor === tipo;
                  return (
                    <Pressable
                      key={valor}
                      accessibilityRole="button"
                      accessibilityLabel={etiqueta}
                      accessibilityState={{ selected: activo }}
                      onPress={() => setTipo(valor)}
                      style={[styles.chip, activo && styles.chipActivo]}
                    >
                      <Text style={[styles.chipTexto, activo && styles.chipTextoActivo]}>{etiqueta}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {tipo === 'fuera_de_orden' ? (
                <>
                  <Text style={styles.subtitulo}>¿Cuál unidad?</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.unidadesRow}
                  >
                    {otrasUnidades.map((trufi) => {
                      const seleccionado = trufi.id === placaSeleccionada;
                      return (
                        <Pressable
                          key={trufi.id}
                          accessibilityRole="button"
                          accessibilityLabel={trufi.placa}
                          accessibilityState={{ selected: seleccionado }}
                          onPress={() => setPlacaSeleccionada(trufi.id)}
                          style={[styles.unidadItem, seleccionado && styles.unidadItemActiva]}
                        >
                          <DemoAvatarRedondo
                            fotoUri={FOTOS_TRUFI[trufi.id]}
                            colorAnillo={colorLinea}
                            tamano={30}
                          />
                          <Text numberOfLines={1} style={styles.unidadPlaca}>
                            {trufi.placa}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              ) : null}

              <Input
                controlSize="lg"
                multiline
                numberOfLines={2}
                value={nota}
                onChangeText={setNota}
                placeholder="Nota (opcional)…"
                inputShellStyle={styles.notaShell}
                accessibilityLabel="Nota del reporte"
              />

              <View style={styles.acciones}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={cerrar}
                  style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                >
                  <Text style={styles.cancelButtonText}>CANCELAR</Text>
                </Pressable>
                <Button
                  variant="primary"
                  onPress={enviar}
                  disabled={!puedeEnviar}
                  style={styles.enviarButton}
                >
                  ENVIAR
                </Button>
              </View>
            </>
          )}
        </BlurView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(25, 20, 60, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: quivoSpacing.lg,
  },
  card: {
    backgroundColor: 'rgba(236, 239, 244, 0.92)',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  title: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
    color: '#3127B1',
    letterSpacing: 0.2,
    flex: 1,
  },
  chipsRow: {
    gap: 8,
    paddingBottom: 4,
  },
  chip: {
    borderRadius: quivoRadius.pill,
    borderWidth: 1.5,
    borderColor: quivoColors.primarySoft,
    backgroundColor: quivoColors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActivo: {
    backgroundColor: '#3127B1',
    borderColor: '#3127B1',
  },
  chipTexto: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 12,
    color: '#3127B1',
  },
  chipTextoActivo: {
    color: quivoColors.white,
  },
  subtitulo: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11.5,
    color: quivoColors.textSecondary,
    marginTop: 12,
    marginBottom: 6,
  },
  unidadesRow: {
    gap: 10,
    paddingBottom: 4,
  },
  unidadItem: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  unidadItemActiva: {
    borderColor: '#3127B1',
    backgroundColor: 'rgba(49, 39, 177, 0.08)',
  },
  unidadPlaca: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 10,
    color: '#334155',
  },
  notaShell: {
    backgroundColor: '#DCE0E8',
    borderRadius: 14,
    borderWidth: 0,
    marginTop: 14,
  },
  acciones: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  cancelButton: {
    flex: 1,
    height: 38,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#DCE0E8',
    borderWidth: 1.5,
    borderColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.6,
    color: '#3127B1',
  },
  enviarButton: {
    flex: 1,
    height: 38,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#3127B1',
    borderColor: '#3127B1',
  },
  mensajeExito: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    color: '#475569',
    marginBottom: 16,
  },
  pillButton: {
    height: 38,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A0E70',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  pillButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 13,
    letterSpacing: 0.8,
    color: quivoColors.white,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
