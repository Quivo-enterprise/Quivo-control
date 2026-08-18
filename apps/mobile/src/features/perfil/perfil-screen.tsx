import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ContextoOperativoMovil } from '@quivo/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { useGpsContext } from '../operacion/gps-provider';
import { useSyncStatus } from '../operacion/use-sync-status';
import { usePerfilQuery } from './use-perfil-query';
import { useTextScale, useOperacionSettings } from './use-operacion-settings';
import { Button } from '../../shared/components/Button';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { createShimmerPlaceholder } from 'react-native-shimmer-placeholder';
import { LinearGradient } from 'expo-linear-gradient';
import logo from '../../../assets/images/logo.png';

const ShimmerPlaceHolder = createShimmerPlaceholder(LinearGradient);

export interface PerfilScreenProps extends NativeStackScreenProps<OperationStackParamList, 'Perfil'> {
  contexto: ContextoOperativoMovil;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => void;
}

export function PerfilScreen({ navigation, contexto: contextoInicial, obtenerAccessToken, onLogout }: PerfilScreenProps) {
  // isLoading solo será true si no hay contextoInicial (que por la arquitectura actual siempre existe).
  // Mantenemos la lógica de Skeletons intacta para cumplir con el requerimiento.
  const { data: contexto, isLoading, refetch } = usePerfilQuery(contextoInicial, obtenerAccessToken);
  const { gps } = useGpsContext();
  const { pendientes, isOffline } = useSyncStatus(obtenerAccessToken, contextoInicial.sesionId);
  const [confirmarLogoutVisible, setConfirmarLogoutVisible] = useState(false);
  const scale = useTextScale();
  const { settings } = useOperacionSettings();

  if (isLoading || !contexto) {
    return <PerfilSkeleton navigation={navigation} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerTop}>
        <Image
          source={logo}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <View style={styles.headerSub}>
        <View style={[styles.badge, gps.tracking ? styles.badgeActive : styles.badgeIdle]}>
          <Text style={[styles.badgeText, gps.tracking ? styles.badgeTextActive : null]}>
            {gps.tracking ? `Recorrido en curso · ${contexto.linea.codigo}` : 'EN ESPERA'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver al mapa"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>Volver al mapa</Text>
          <Ionicons name="location-sharp" size={16} color={quivoColors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(contexto.conductor.nombre)}</Text>
          </View>
          <View style={styles.heroTextContent}>
            <Text style={[styles.driverName, { fontSize: 16 * scale }]} allowFontScaling={!settings.textoGrande}>{contexto.conductor.nombre}</Text>
            <Text style={[styles.sindicatoText, { fontSize: 13 * scale }]} allowFontScaling={!settings.textoGrande}>{contexto.sindicato.nombre}</Text>
          </View>
          <View style={styles.heroBottomRow}>
            <Text style={[styles.largeLineText, { fontSize: 32 * scale }]} allowFontScaling={!settings.textoGrande}>{contexto.linea.codigo}</Text>
            <View style={styles.statusIndicator}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isOffline ? '#FF9500' : gps.tracking ? quivoColors.success : quivoColors.textMuted },
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: isOffline ? '#FF9500' : gps.tracking ? quivoColors.success : quivoColors.textMuted },
                ]}
              >
                {isOffline ? 'OFFLINE' : gps.tracking ? 'EN LÍNEA' : 'EN ESPERA'}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { fontSize: 14 * scale }]} allowFontScaling={!settings.textoGrande}>Navegación de perfil</Text>
        <View style={styles.cardBlock}>
          <MenuRow
            icon="shield-checkmark-outline"
            title="Ajustes de operación"
            description="Configura cómo opera la app"
            onPress={() => navigation.navigate('Ajustes')}
          />
          <MenuRow
            icon="sync-outline"
            title="Sincronización y soporte"
            description={
              pendientes > 0
                ? `${pendientes} eventos pendientes de sincronizar`
                : 'Revisa servicios y ayuda'
            }
            onPress={() => refetch()}
          />
          <MenuRow
            icon="lock-closed-outline"
            title="Seguridad y salida"
            description="Protege tu cuenta y tu sesión"
            onPress={() => setConfirmarLogoutVisible(true)}
            noBorder
          />
        </View>

        <Text style={[styles.sectionTitle, { fontSize: 14 * scale }]} allowFontScaling={!settings.textoGrande}>Información operativa</Text>
        <View style={styles.cardBlock}>
          <InfoRow
            icon="id-card-outline"
            label="Documento"
            value={contexto.conductor.documentoIdentidad}
          />
          <InfoRow
            icon="car-outline"
            label="Vehículo"
            value={`Placa ${contexto.vehiculo.placa}`}
          />
          <InfoRow
            icon="navigate-circle-outline"
            label="Sindicato"
            value={contexto.sindicato.nombre}
            noBorder
          />
        </View>
      </ScrollView>

      <View style={styles.floatingFooter}>
        <Text style={[styles.footerBreadcrumb, { fontSize: 13 * scale }]} allowFontScaling={!settings.textoGrande}>Desde la ruta, abre Perfil</Text>
        <View style={styles.footerActions}>
          <Button variant="outline" onPress={() => navigation.navigate('Ajustes')} style={styles.flex1}>
            Configura la app
          </Button>
          <Button variant="primary" onPress={() => navigation.goBack()} style={styles.flex1}>
            Volver a ruta
          </Button>
        </View>
      </View>

      <QuivoConfirmDialog
        visible={confirmarLogoutVisible}
        icon="log-out-outline"
        title="¿Cerrar sesión?"
        message="Deberás volver a validar el vehículo y tu identidad para iniciar un recorrido."
        cancelLabel="Cancelar"
        confirmLabel="Cerrar sesión"
        onCancel={() => setConfirmarLogoutVisible(false)}
        onConfirm={() => {
          setConfirmarLogoutVisible(false);
          onLogout();
        }}
      />
    </View>
  );
}

function MenuRow({
  icon,
  title,
  description,
  onPress,
  noBorder,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  noBorder?: boolean;
}) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[styles.menuRow, !noBorder && styles.rowBorder]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={24} color={quivoColors.primaryStrong} />
      <View style={{ flex: 1, paddingLeft: quivoSpacing.sm }}>
        <Text style={[styles.menuTitle, { fontSize: 14 * scale }]} allowFontScaling={!settings.textoGrande}>{title}</Text>
        <Text style={[styles.menuDescription, { fontSize: 12 * scale }]} allowFontScaling={!settings.textoGrande}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={quivoColors.textMuted} />
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
  noBorder,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  noBorder?: boolean;
}) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  return (
    <View style={[styles.menuRow, !noBorder && styles.rowBorder]}>
      <Ionicons name={icon} size={24} color={quivoColors.primaryStrong} />
      <View style={{ flex: 1, paddingLeft: quivoSpacing.sm }}>
        <Text style={[styles.menuTitle, { fontSize: 14 * scale }]} allowFontScaling={!settings.textoGrande}>{label}</Text>
        <Text style={[styles.menuDescription, { fontSize: 12 * scale }]} allowFontScaling={!settings.textoGrande}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={quivoColors.textMuted} />
    </View>
  );
}

function PerfilSkeleton({
  navigation,
}: {
  navigation: NativeStackScreenProps<OperationStackParamList, 'Perfil'>['navigation'];
}) {
  return (
    <View style={styles.container}>
      <View style={styles.headerTop}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
      </View>
      <View style={styles.headerSub}>
        <ShimmerPlaceHolder style={[styles.badge, { width: 120, height: 28 }]} />
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Volver al mapa</Text>
          <Ionicons name="location-sharp" size={16} color={quivoColors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <ShimmerPlaceHolder style={styles.avatar} />
          <View style={styles.heroTextContent}>
            <ShimmerPlaceHolder style={{ width: 150, height: 20, marginBottom: 8 }} />
            <ShimmerPlaceHolder style={{ width: 100, height: 16 }} />
          </View>
          <View style={styles.heroBottomRow}>
            <ShimmerPlaceHolder style={{ width: 60, height: 32 }} />
            <ShimmerPlaceHolder style={{ width: 80, height: 16 }} />
          </View>
        </View>

        <ShimmerPlaceHolder style={{ width: 150, height: 20, marginBottom: 12 }} />
        <View style={[styles.cardBlock, { padding: quivoSpacing.md, gap: 16 }]}>
          <ShimmerPlaceHolder style={{ width: '100%', height: 40 }} />
          <ShimmerPlaceHolder style={{ width: '100%', height: 40 }} />
          <ShimmerPlaceHolder style={{ width: '100%', height: 40 }} />
        </View>
      </ScrollView>
    </View>
  );
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FE' },
  headerTop: {
    paddingTop: quivoSpacing.xl + quivoSpacing.xl,
    paddingHorizontal: quivoSpacing.lg,
    paddingBottom: quivoSpacing.md,
  },
  brandText: {
    color: quivoColors.primaryStrong,
    fontFamily: quivoFonts.displayBold,
    fontSize: 24,
    letterSpacing: -0.5,
  },
  logo: {
    height: 28,
    width: 110,
  },
  headerSub: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: quivoSpacing.lg,
    paddingBottom: quivoSpacing.md,
  },
  badge: {
    paddingHorizontal: quivoSpacing.md,
    paddingVertical: 6,
    borderRadius: quivoRadius.md,
  },
  badgeActive: { backgroundColor: quivoColors.successSoft },
  badgeIdle: { backgroundColor: quivoColors.primarySubtle },
  badgeText: { fontFamily: quivoFonts.bodySemiBold, fontSize: 13, color: quivoColors.textMuted },
  badgeTextActive: { color: quivoColors.success },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: quivoColors.white,
    paddingHorizontal: quivoSpacing.md,
    paddingVertical: 8,
    borderRadius: quivoRadius.pill,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    gap: 4,
  },
  backButtonText: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 13,
  },
  scrollContent: { padding: quivoSpacing.lg, paddingBottom: 140 },
  heroCard: {
    backgroundColor: quivoColors.white,
    borderRadius: quivoRadius.xl,
    padding: quivoSpacing.lg,
    shadowColor: quivoColors.primaryStrong,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
    marginBottom: quivoSpacing.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: quivoColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: quivoSpacing.lg,
    left: quivoSpacing.lg,
  },
  avatarText: { color: quivoColors.white, fontFamily: quivoFonts.displayBold, fontSize: 24 },
  heroTextContent: {
    marginLeft: 80,
    minHeight: 64,
    justifyContent: 'center',
  },
  driverName: { color: quivoColors.primaryStrong, fontFamily: quivoFonts.displayBold, fontSize: 16 },
  sindicatoText: { color: quivoColors.textSecondary, fontFamily: quivoFonts.bodyMedium, fontSize: 13, marginTop: 2 },
  heroBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: quivoSpacing.lg,
  },
  largeLineText: {
    color: quivoColors.primary,
    fontFamily: quivoFonts.displayBold,
    fontSize: 32,
    lineHeight: 36,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: quivoFonts.displayBold, fontSize: 12, letterSpacing: 0.5 },
  sectionTitle: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14,
    color: quivoColors.primaryStrong,
    marginBottom: quivoSpacing.sm,
    paddingLeft: quivoSpacing.xs,
  },
  cardBlock: {
    backgroundColor: quivoColors.white,
    borderRadius: quivoRadius.lg,
    padding: quivoSpacing.sm,
    marginBottom: quivoSpacing.xl,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: quivoSpacing.md,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: quivoColors.border,
  },
  menuTitle: { fontFamily: quivoFonts.bodySemiBold, fontSize: 14, color: quivoColors.primaryStrong },
  menuDescription: { fontFamily: quivoFonts.bodyRegular, fontSize: 12, color: quivoColors.textMuted, marginTop: 2 },
  floatingFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(248, 249, 254, 0.9)', // Mismo color de fondo pero translúcido
    paddingTop: quivoSpacing.sm,
    paddingHorizontal: quivoSpacing.lg,
    paddingBottom: quivoSpacing.xxl,
    borderTopWidth: 1,
    borderTopColor: quivoColors.border,
    alignItems: 'center',
  },
  footerActions: {
    flexDirection: 'row',
    width: '100%',
    gap: quivoSpacing.sm,
    marginTop: quivoSpacing.xs,
  },
  flex1: {
    flex: 1,
  },
  footerBreadcrumb: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    color: quivoColors.textSecondary,
    marginBottom: quivoSpacing.xs,
  },
});
