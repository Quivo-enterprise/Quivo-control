import { ScrollView, StyleSheet, Text, View, Switch, Pressable, Platform, ToastAndroid, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { useOperacionSettings, useTextScale, type OperacionSettings } from './use-operacion-settings';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { useGpsContext } from '../operacion/gps-provider';
import logo from '../../../assets/images/logo.png';

export function AjustesScreen({ navigation }: NativeStackScreenProps<OperationStackParamList, 'Ajustes'>) {
  const { settings, isLoaded, updateSetting } = useOperacionSettings();
  const { gps } = useGpsContext();
  const scale = useTextScale();

  const handleToggle = (key: keyof OperacionSettings, value: boolean) => {
    // Regla especial: trabajarOffline requiere GPS activo (aunque en MVP asumiremos que está)
    if (key === 'trabajarOffline' && value === true && !gps.tracking) {
      showToast('Requiere GPS activo para funcionar offline completamente.');
    }
    updateSetting(key, value);
    showToast(`Preferencia actualizada.`);
  };

  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
    // En iOS se podría implementar una barra Toast global, omitido por MVP.
  };

  if (!isLoaded) return null; // Un esqueleto rápido o nulo es aceptable mientras AsyncStorage lee (suele tardar 5ms)

  return (
    <View style={styles.container}>
      <View style={styles.headerTop}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={20} color={quivoColors.primaryStrong} />
          <Text style={styles.backText}>Perfil</Text>
        </Pressable>
        <Image
          source={logo}
          style={styles.logo}
          resizeMode="contain"
        />
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.screenTitle, { fontSize: 20 * scale }]} allowFontScaling={!settings.textoGrande}>Ajustes de operación</Text>

        <View style={styles.cardBlock}>
          <SettingToggleRow
            icon="volume-high-outline"
            title="Navegación por voz"
            description="Indicaciones habladas durante el recorrido."
            helper="Requiere permisos de audio."
            value={settings.navegacionVoz}
            onToggle={(v) => handleToggle('navegacionVoz', v)}
          />
          <SettingToggleRow
            icon="shield-checkmark-outline"
            title="Registro automático de controles"
            description="El registro se realiza de forma automática y segura."
            helper="Próximamente: Validación manual."
            badge="AUTOMÁTICO"
            value={settings.registroAutomatico}
            onToggle={(v) => handleToggle('registroAutomatico', v)}
            disabled={true}
          />
          <SettingToggleRow
            icon="cellular-outline"
            title="Modo ahorro de datos"
            description="Reduce el consumo de datos móviles en segundo plano."
            helper="Útil con planes limitados."
            value={settings.ahorroDatos}
            onToggle={(v) => handleToggle('ahorroDatos', v)}
          />
          <SettingToggleRow
            icon="cloud-offline-outline"
            title="Trabajar offline"
            description="Permite operar sin conexión. Los datos se guardan para sincronizar después."
            helper="Requiere GPS activo."
            badge="ACTIVO"
            badgeColor={quivoColors.success}
            value={settings.trabajarOffline}
            onToggle={(v) => handleToggle('trabajarOffline', v)}
          />
          <SettingToggleRow
            icon="text-outline"
            title="Texto grande"
            description="Aumenta el tamaño del texto para mejor legibilidad."
            helper="Útil en condiciones de luz solar."
            value={settings.textoGrande}
            onToggle={(v) => handleToggle('textoGrande', v)}
            noBorder
          />
        </View>
      </ScrollView>
    </View>
  );
}

function SettingToggleRow({
  icon,
  title,
  description,
  helper,
  badge,
  badgeColor,
  value,
  onToggle,
  noBorder,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  helper?: string;
  badge?: string;
  badgeColor?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  noBorder?: boolean;
  disabled?: boolean;
}) {
  const { settings } = useOperacionSettings();
  const scale = useTextScale();
  return (
    <View style={[styles.row, !noBorder && styles.rowBorder, disabled && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={24} color={quivoColors.primaryStrong} style={styles.rowIcon} />
      <View style={styles.rowTextContent}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { fontSize: 15 * scale }]} allowFontScaling={!settings.textoGrande}>{title}</Text>
          {badge && (
            <View style={[styles.badge, badgeColor ? { backgroundColor: badgeColor + '20' } : null]}>
              <Text style={[styles.badgeText, badgeColor ? { color: badgeColor } : null]}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.description, { fontSize: 14 * scale }]} allowFontScaling={!settings.textoGrande}>{description}</Text>
        {helper && <Text style={[styles.helper, { fontSize: 12 * scale }]} allowFontScaling={!settings.textoGrande}>{helper}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: quivoColors.border, true: quivoColors.primaryStrong }}
        thumbColor={Platform.OS === 'android' ? quivoColors.white : undefined}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FE' },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: quivoSpacing.xl + quivoSpacing.lg,
    paddingHorizontal: quivoSpacing.md,
    paddingBottom: quivoSpacing.sm,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: quivoSpacing.xs,
    width: 80,
  },
  backText: {
    color: quivoColors.primaryStrong,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
    marginLeft: 4,
  },
  logo: {
    height: 20,
    width: 80,
  },
  scrollContent: { padding: quivoSpacing.lg, paddingBottom: 60 },
  screenTitle: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    color: quivoColors.primaryStrong,
    marginBottom: quivoSpacing.lg,
  },
  cardBlock: {
    backgroundColor: quivoColors.white,
    borderRadius: quivoRadius.lg,
    padding: quivoSpacing.sm,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: quivoSpacing.md,
    paddingHorizontal: quivoSpacing.xs,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: quivoColors.border,
  },
  rowIcon: {
    marginRight: quivoSpacing.sm,
  },
  rowTextContent: {
    flex: 1,
    paddingRight: quivoSpacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  title: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
    color: quivoColors.primaryStrong,
  },
  badge: {
    backgroundColor: quivoColors.primarySubtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 10,
    color: quivoColors.primary,
  },
  description: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 14,
    color: quivoColors.textSecondary,
    lineHeight: 18,
  },
  helper: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12,
    color: quivoColors.textMuted,
    marginTop: 2,
  }
});
