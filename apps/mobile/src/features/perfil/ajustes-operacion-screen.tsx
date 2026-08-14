import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import {
  cargarPreferenciasOperacion,
  guardarPreferenciasOperacion,
  PREFERENCIAS_DEFAULT,
  type PreferenciasOperacion,
} from './preferencias-store';

export interface AjustesOperacionScreenProps {
  onBack: () => void;
}

interface ToggleConfig {
  key: keyof PreferenciasOperacion;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  helper?: string;
  badge?: string;
}

const TOGGLES: ToggleConfig[] = [
  {
    key: 'navegacionVoz',
    icon: 'volume-high-outline',
    title: 'Navegación por voz',
    description: 'Indicaciones habladas durante el recorrido',
    helper: 'Requiere permisos de audio',
  },
  {
    key: 'registroAutomatico',
    icon: 'checkmark-done-outline',
    title: 'Registro automático de controles',
    description: 'El registro se realiza de forma automática y segura',
    helper: 'Desactiva solo si necesitas validación manual',
  },
  {
    key: 'ahorroDatos',
    icon: 'cellular-outline',
    title: 'Modo ahorro de datos',
    description: 'Reduce el consumo de datos móviles en segundo plano',
    helper: 'Útil con planes limitados',
  },
  {
    key: 'trabajarOffline',
    icon: 'cloud-offline-outline',
    title: 'Trabajar offline',
    description: 'Permite operar sin conexión. Los datos se guardan para sincronizar después',
    helper: 'Requiere GPS activo',
    badge: 'ACTIVO',
  },
  {
    key: 'textoGrande',
    icon: 'text-outline',
    title: 'Texto grande',
    description: 'Aumenta el tamaño del texto para mejor legibilidad',
    helper: 'Útil en condiciones de luz solar',
  },
];

export function AjustesOperacionScreen({ onBack }: AjustesOperacionScreenProps) {
  const [preferencias, setPreferencias] = useState<PreferenciasOperacion>(PREFERENCIAS_DEFAULT);
  const [cargando, setCargando] = useState(true);
  const [guardado, setGuardado] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let activo = true;
    void cargarPreferenciasOperacion().then((cargadas) => {
      if (activo) {
        setPreferencias(cargadas);
        setCargando(false);
      }
    });
    return () => {
      activo = false;
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const alternar = (key: keyof PreferenciasOperacion) => (valor: boolean) => {
    const siguiente = { ...preferencias, [key]: valor };
    setPreferencias(siguiente);
    void guardarPreferenciasOperacion(siguiente);
    setGuardado(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setGuardado(false), 1500);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver a Perfil"
          onPress={onBack}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={quivoColors.white} />
        </Pressable>
        <Text style={styles.headerTitle}>Ajustes de operación</Text>
        {guardado ? (
          <View accessibilityLiveRegion="polite" style={styles.savedPill}>
            <Ionicons name="checkmark" size={12} color={quivoColors.white} />
            <Text style={styles.savedText}>Guardado</Text>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {cargando ? (
          <Text style={styles.loadingText}>Cargando ajustes…</Text>
        ) : (
          <View style={styles.list}>
            {TOGGLES.map((toggle, index) => (
              <View
                key={toggle.key}
                style={[styles.row, index === TOGGLES.length - 1 ? styles.rowLast : null]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={toggle.icon} size={20} color={quivoColors.primary} />
                </View>
                <View style={styles.rowText}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowTitle}>{toggle.title}</Text>
                    {toggle.badge && preferencias[toggle.key] ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{toggle.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.rowDescription}>{toggle.description}</Text>
                  {toggle.helper ? <Text style={styles.rowHelper}>{toggle.helper}</Text> : null}
                </View>
                <Switch
                  accessibilityRole="switch"
                  accessibilityLabel={toggle.title}
                  accessibilityHint={toggle.description}
                  value={preferencias[toggle.key]}
                  onValueChange={alternar(toggle.key)}
                  trackColor={{ false: quivoColors.border, true: quivoColors.primary }}
                  thumbColor={quivoColors.white}
                />
              </View>
            ))}
          </View>
        )}
        <Text style={styles.footerNote}>
          Los cambios se guardan automáticamente en este dispositivo.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: quivoColors.page },
  header: {
    backgroundColor: quivoColors.primaryStrong,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    paddingHorizontal: quivoSpacing.lg,
    paddingVertical: quivoSpacing.lg,
  },
  backButton: { padding: quivoSpacing.xs },
  headerTitle: {
    flex: 1,
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 18,
  },
  savedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: quivoColors.success,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: quivoSpacing.sm,
    paddingVertical: 4,
  },
  savedText: { color: quivoColors.white, fontFamily: quivoFonts.bodySemiBold, fontSize: 11 },
  content: { padding: quivoSpacing.lg, paddingBottom: quivoSpacing.xxl },
  loadingText: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    textAlign: 'center',
    marginTop: quivoSpacing.xl,
  },
  list: {
    backgroundColor: quivoColors.card,
    borderRadius: quivoRadius.lg,
    borderWidth: 1,
    borderColor: quivoColors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: quivoSpacing.md,
    padding: quivoSpacing.md,
    borderBottomWidth: 1,
    borderBottomColor: quivoColors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: quivoRadius.md,
    backgroundColor: quivoColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: quivoSpacing.sm },
  rowTitle: { fontFamily: quivoFonts.bodySemiBold, fontSize: 14, color: quivoColors.text },
  rowDescription: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12,
    color: quivoColors.textSecondary,
    lineHeight: 17,
  },
  rowHelper: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 11,
    color: quivoColors.textMuted,
  },
  badge: {
    backgroundColor: quivoColors.successSoft,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: quivoSpacing.sm,
    paddingVertical: 1,
  },
  badgeText: {
    color: quivoColors.success,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  footerNote: {
    marginTop: quivoSpacing.lg,
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 11,
    textAlign: 'center',
  },
});
