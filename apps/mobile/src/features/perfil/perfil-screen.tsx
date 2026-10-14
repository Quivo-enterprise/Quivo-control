import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View, Pressable, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { ContextoOperativoMovil } from '@quivo/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { useGpsContext } from '../operacion/gps-provider';
import { useSyncStatus } from '../operacion/use-sync-status';
import { usePerfilQuery } from './use-perfil-query';
import { useTextScale, useOperacionSettings } from './use-operacion-settings';
import { CerrarSesionDialog } from '../../shared/components/cerrar-sesion-dialog';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import {
  MENSAJE_SE_APLICARA_AL_CERRAR,
  estaInactivoAhora,
  estadoBotonActualizar,
  etiquetaVersion,
} from '../actualizaciones/actualizaciones-core';
import { reportarErrorActualizacion } from '../../shared/observability/reportar-actualizacion';
import { createShimmerPlaceholder } from 'react-native-shimmer-placeholder';
import { LinearGradient } from 'expo-linear-gradient';

const ShimmerPlaceHolder = createShimmerPlaceholder(LinearGradient);

export interface PerfilScreenProps extends NativeStackScreenProps<OperationStackParamList, 'Perfil'> {
  contexto: ContextoOperativoMovil;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => void;
}

export function PerfilScreen({ navigation, contexto: contextoInicial, obtenerAccessToken, onLogout }: PerfilScreenProps) {
  const { data: contexto, isLoading, refetch } = usePerfilQuery(contextoInicial, obtenerAccessToken);
  const { gps } = useGpsContext();
  // Entrega 4 (`docs/plan-correccion-post-piloto-2026-09-09.md`, `docs/estados-red-vs-captura.md`):
  // el llamado a `useSyncStatus` se CONSERVA — drena el outbox también mientras esta pantalla
  // está abierta (ver el comentario M5 en `sync-outbox.ts` sobre el doble montaje con
  // `operation-screen.tsx`) — pero ya no se usa su `isOffline` para cambiar el status pill de
  // abajo: "sin conexión" es el estado normal de un chofer manejando, no algo que deba
  // alarmar con un color distinto.
  useSyncStatus(obtenerAccessToken, contextoInicial.sesionId);
  const [confirmarLogoutVisible, setConfirmarLogoutVisible] = useState(false);
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  const [estadoActualizacion, setEstadoActualizacion] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  // Guardas en refs (no estado): el closure de `onPress` del Alert queda viejo y `setBuscando`
  // no es síncrono, así que dos toques seguidos podrían lanzar dos búsquedas.
  const buscandoRef = useRef(false);
  const montadoRef = useRef(true);
  const enfocado = useIsFocused();
  const enfocadoRef = useRef(enfocado);
  enfocadoRef.current = enfocado;
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);
  const pantallaViva = () => montadoRef.current && enfocadoRef.current;

  const botonActualizar = estadoBotonActualizar({ isDev: __DEV__, updatesHabilitado: Updates.isEnabled });

  const buscarActualizacion = async () => {
    if (buscandoRef.current) return;
    buscandoRef.current = true;
    setBuscando(true);
    setEstadoActualizacion('Buscando…');
    try {
      const chequeo = await Updates.checkForUpdateAsync();
      if (!chequeo.isAvailable) {
        if (montadoRef.current) setEstadoActualizacion('Ya tenés la última versión');
        return;
      }
      await Updates.fetchUpdateAsync();
      // Estado EN VIVO del recorrido (no `gps.tracking`: closure viejo y falso hasta que el
      // re-enganche nativo resuelve). Con recorrido activo o sin lectura real NO se ofrece
      // reiniciar: la actualización queda descargada y se aplica en el próximo arranque.
      if (!estaInactivoAhora()) {
        if (montadoRef.current) setEstadoActualizacion(MENSAJE_SE_APLICARA_AL_CERRAR);
        return;
      }
      if (!pantallaViva()) {
        // Sin alerta flotando sobre otra pantalla; el estado queda legible al volver.
        if (montadoRef.current) setEstadoActualizacion(MENSAJE_SE_APLICARA_AL_CERRAR);
        return;
      }
      setEstadoActualizacion('Actualización lista');
      Alert.alert('Actualización lista', '¿Reiniciar ahora?', [
        {
          text: 'Después',
          style: 'cancel',
          onPress: () => {
            if (montadoRef.current) setEstadoActualizacion(MENSAJE_SE_APLICARA_AL_CERRAR);
          },
        },
        {
          text: 'Reiniciar',
          onPress: () => {
            void (async () => {
              // El chofer pudo iniciar un recorrido mientras el diálogo estaba abierto.
              if (!estaInactivoAhora()) {
                if (montadoRef.current) setEstadoActualizacion(MENSAJE_SE_APLICARA_AL_CERRAR);
                return;
              }
              try {
                await Updates.reloadAsync();
              } catch (error) {
                reportarErrorActualizacion(error, 'reload');
                if (montadoRef.current) {
                  setEstadoActualizacion(`No se pudo reiniciar. ${MENSAJE_SE_APLICARA_AL_CERRAR}`);
                }
              }
            })();
          },
        },
      ]);
    } catch (error) {
      reportarErrorActualizacion(error, 'fetch');
      if (montadoRef.current) setEstadoActualizacion('No se pudo buscar la actualización');
    } finally {
      buscandoRef.current = false;
      if (montadoRef.current) setBuscando(false);
    }
  };

  if (isLoading || !contexto) {
    return <PerfilSkeleton navigation={navigation} />;
  }

  const modeloVehiculo = `${contexto.vehiculo.marca} ${contexto.vehiculo.modelo}`.trim() || 'Toyota Hiace';
  const statusLabel = gps.tracking ? 'EN LINEA' : 'EN ESPERA';
  // En Figma: EN ESPERA es azul (#3127B1) y EN LINEA es naranja/ámbar (#FD9E15)
  const statusColor = gps.tracking ? '#FD9E15' : '#3127B1';

  return (
    <View style={styles.container}>
      {/* Top Header Bar */}
      <View style={styles.headerBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver al mapa"
          onPress={() => navigation.goBack()}
          style={styles.headerBackPressable}
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={22} color={quivoColors.white} />
          <Text style={styles.headerTitle}>Perfil</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Avatar & Driver Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.avatar} />

          <Text
            style={[styles.driverName, { fontSize: 24 * scale }]}
            allowFontScaling={!settings.textoGrande}
          >
            {contexto.conductor.nombre}
          </Text>

          <Text
            style={[styles.sindicatoText, { fontSize: 13 * scale }]}
            allowFontScaling={!settings.textoGrande}
          >
            {contexto.sindicato.nombre}
          </Text>

          <View style={styles.statusIndicator}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </View>

        {/* Sección: Información del usuario */}
        <Text
          style={[styles.sectionTitle, { fontSize: 14 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          Información del usuario
        </Text>
        <View style={styles.card}>
          <InfoItem
            label="Cédula de identidad"
            value={contexto.conductor.documentoIdentidad}
          />
          <View style={styles.divider} />

          <InfoItem
            label="Modelo del vehículo"
            value={modeloVehiculo}
          />
          <View style={styles.divider} />

          <InfoItem
            label="Placa del vehículo"
            value={contexto.vehiculo.placa}
          />
          <View style={styles.divider} />

          <InfoItem
            label="Sindicato"
            value={contexto.sindicato.nombre}
          />
        </View>

        {/* Sección: Navegación del perfil */}
        <Text
          style={[styles.sectionTitle, { fontSize: 14 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          Navegación del perfil
        </Text>
        <View style={styles.card}>
          <NavigationItem
            icon="settings-sharp"
            title="Ajustes de operación"
            description="Configura como opera la app"
            onPress={() => navigation.navigate('Ajustes')}
          />
          <View style={styles.divider} />

          <NavigationItem
            icon="sync-outline"
            title="Sincronización"
            description="Sincroniza los servicios activos"
            onPress={() => refetch()}
          />
          <View style={styles.divider} />

          <NavigationItem
            icon="log-out-outline"
            title="Cerrar Sesión"
            description="Salir de tu cuenta en este dispositivo"
            onPress={() => setConfirmarLogoutVisible(true)}
          />
        </View>

        {/* Sección: Versión y actualizaciones (OTA, expo-updates) */}
        <Text
          style={[styles.sectionTitle, { fontSize: 14 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          Aplicación
        </Text>
        <View style={styles.card}>
          <InfoItem
            label="Versión"
            value={etiquetaVersion(
              Application.nativeApplicationVersion,
              Updates.updateId,
              Updates.isEmbeddedLaunch,
            )}
          />
          <View style={styles.divider} />
          <NavigationItem
            icon="cloud-download-outline"
            title="Buscar actualización"
            description={
              botonActualizar.habilitado
                ? (estadoActualizacion ?? 'Descarga la última versión disponible')
                : botonActualizar.motivo
            }
            disabled={!botonActualizar.habilitado || buscando}
            onPress={() => void buscarActualizacion()}
          />
        </View>
      </ScrollView>

      {/* Modal de confirmación seguro de cierre de sesión */}
      <CerrarSesionDialog
        visible={confirmarLogoutVisible}
        onCancel={() => setConfirmarLogoutVisible(false)}
        onConfirm={() => {
          setConfirmarLogoutVisible(false);
          onLogout();
        }}
      />
    </View>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();

  return (
    <View style={styles.infoItem}>
      <Text
        style={[styles.infoLabel, { fontSize: 11.5 * scale }]}
        allowFontScaling={!settings.textoGrande}
      >
        {label}
      </Text>
      <Text
        style={[styles.infoValue, { fontSize: 14.5 * scale }]}
        allowFontScaling={!settings.textoGrande}
      >
        {value}
      </Text>
    </View>
  );
}

function NavigationItem({
  icon,
  title,
  description,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [styles.navItem, (pressed || disabled) && styles.navItemPressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={25} color="#3127B1" style={styles.navIcon} />
      <View style={styles.navTextContainer}>
        <Text
          style={[styles.navTitle, { fontSize: 14.5 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          {title}
        </Text>
        <Text
          style={[styles.navDescription, { fontSize: 11.5 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

function PerfilSkeleton({
  navigation,
}: {
  navigation: NativeStackScreenProps<OperationStackParamList, 'Perfil'>['navigation'];
}) {
  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Pressable onPress={() => navigation.goBack()} style={styles.headerBackPressable}>
          <Ionicons name="arrow-back" size={22} color={quivoColors.white} />
          <Text style={styles.headerTitle}>Perfil</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          <ShimmerPlaceHolder style={styles.avatar} />
          <ShimmerPlaceHolder style={{ width: 160, height: 24, borderRadius: 6, marginVertical: 8 }} />
          <ShimmerPlaceHolder style={{ width: 180, height: 16, borderRadius: 4 }} />
        </View>

        <ShimmerPlaceHolder style={{ width: 150, height: 18, borderRadius: 4, marginVertical: 12 }} />
        <View style={[styles.card, { gap: 12 }]}>
          <ShimmerPlaceHolder style={{ width: '100%', height: 36, borderRadius: 4 }} />
          <ShimmerPlaceHolder style={{ width: '100%', height: 36, borderRadius: 4 }} />
          <ShimmerPlaceHolder style={{ width: '100%', height: 36, borderRadius: 4 }} />
          <ShimmerPlaceHolder style={{ width: '100%', height: 36, borderRadius: 4 }} />
        </View>

        <ShimmerPlaceHolder style={{ width: 150, height: 18, borderRadius: 4, marginVertical: 12 }} />
        <View style={[styles.card, { gap: 12 }]}>
          <ShimmerPlaceHolder style={{ width: '100%', height: 44, borderRadius: 4 }} />
          <ShimmerPlaceHolder style={{ width: '100%', height: 44, borderRadius: 4 }} />
          <ShimmerPlaceHolder style={{ width: '100%', height: 44, borderRadius: 4 }} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6F8',
  },
  headerBar: {
    backgroundColor: '#3127B1',
    paddingTop: Platform.OS === 'ios' ? 12 : 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerBackPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    color: quivoColors.white,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 18,
    letterSpacing: 0.2,
  },
  scrollContent: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 48,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: 4,
  },
  avatar: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#3127B1',
    marginBottom: 12,
  },
  driverName: {
    color: '#3127B1',
    fontFamily: quivoFonts.displayBold,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  sindicatoText: {
    color: '#334155',
    fontFamily: quivoFonts.bodySemiBold,
    textAlign: 'center',
    marginTop: 3,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  sectionTitle: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14,
    color: '#334155',
    marginTop: 22,
    marginBottom: 8,
    paddingLeft: 4,
  },
  card: {
    backgroundColor: quivoColors.white,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  divider: {
    height: 1,
    backgroundColor: '#E8ECF2',
    marginVertical: 8,
  },
  infoItem: {
    paddingVertical: 3,
  },
  infoLabel: {
    color: '#8A94A6',
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 11.5,
  },
  infoValue: {
    color: '#3127B1',
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14.5,
    marginTop: 2,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  navItemPressed: {
    opacity: 0.7,
  },
  navIcon: {
    width: 28,
    textAlign: 'center',
  },
  navTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  navTitle: {
    color: '#3127B1',
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14.5,
  },
  navDescription: {
    color: '#8A94A6',
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 11.5,
    marginTop: 1,
  },
});
