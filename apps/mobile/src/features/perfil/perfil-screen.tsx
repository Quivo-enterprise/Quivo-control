import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View, Pressable } from 'react-native';
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
import { useOperacionSettings, useTextScale } from './use-operacion-settings';
import { CerrarSesionDialog } from '../../shared/components/cerrar-sesion-dialog';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { dsColors, dsElevation, dsRadius, dsSpace } from '../../shared/theme/design-system';
import { Avatar, Badge, Divider, Heading, Text } from '@quivo/design-system-native';
import { QuivoHeader } from '../../shared/components/quivo-header';
import { Button } from '../../shared/components/Button';
import {
  MENSAJE_SE_APLICARA_AL_CERRAR,
  estaInactivoAhora,
  estadoBotonActualizar,
  etiquetaVersion,
} from '../actualizaciones/actualizaciones-core';
import { reportarErrorActualizacion } from '../../shared/observability/reportar-actualizacion';
import { FotoVehiculoSection } from '../vehiculo-foto/foto-vehiculo-section';
import { createShimmerPlaceholder } from 'react-native-shimmer-placeholder';
import { LinearGradient } from 'expo-linear-gradient';

const ShimmerPlaceHolder = createShimmerPlaceholder(LinearGradient);

export interface PerfilScreenProps extends NativeStackScreenProps<
  OperationStackParamList,
  'Perfil'
> {
  contexto: ContextoOperativoMovil;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => void;
}

export function PerfilScreen({
  navigation,
  contexto: contextoInicial,
  obtenerAccessToken,
  onLogout,
}: PerfilScreenProps) {
  const {
    data: contexto,
    isLoading,
    refetch,
  } = usePerfilQuery(contextoInicial, obtenerAccessToken);
  const { gps } = useGpsContext();
  // "Texto grande" de Ajustes: la escala propia reemplaza a la del sistema (sin sumarse).
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  // Entrega 4 (`docs/plan-correccion-post-piloto-2026-09-09.md`, `docs/estados-red-vs-captura.md`):
  // el llamado a `useSyncStatus` se CONSERVA — drena el outbox también mientras esta pantalla
  // está abierta (ver el comentario M5 en `sync-outbox.ts` sobre el doble montaje con
  // `operation-screen.tsx`) — pero ya no se usa su `isOffline` para cambiar el status pill de
  // abajo: "sin conexión" es el estado normal de un chofer manejando, no algo que deba
  // alarmar con un color distinto.
  useSyncStatus(obtenerAccessToken, contextoInicial.sesionId);
  const [confirmarLogoutVisible, setConfirmarLogoutVisible] = useState(false);
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

  const botonActualizar = estadoBotonActualizar({
    isDev: __DEV__,
    updatesHabilitado: Updates.isEnabled,
  });

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

  const modeloVehiculo =
    `${contexto.vehiculo.marca} ${contexto.vehiculo.modelo}`.trim() || 'Toyota Hiace';
  const statusLabel = gps.tracking ? 'EN VIVO' : 'EN ESPERA';

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <QuivoHeader title="Perfil" onBack={() => navigation.goBack()} backLabel="Volver al mapa" />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Avatar & Driver Hero Section */}
        <View style={styles.heroSection}>
          <Avatar
            name={contexto.conductor.nombre}
            size="xl"
            status={gps.tracking ? 'online' : 'offline'}
          />
          <Heading
            size="xl"
            style={[styles.driverName, { fontSize: 24 * scale }]}
            allowFontScaling={!settings.textoGrande}
          >
            {contexto.conductor.nombre}
          </Heading>
          <Text
            variant="secondary"
            style={{ fontSize: 14 * scale }}
            allowFontScaling={!settings.textoGrande}
          >
            CI {contexto.conductor.documentoIdentidad} · {contexto.sindicato.nombre}
          </Text>
          <Badge variant={gps.tracking ? 'success' : 'primary'} style={styles.estado}>
            {statusLabel}
          </Badge>
        </View>

        {/* Sección: Información del usuario */}
        <Text
          size="sm"
          variant="secondary"
          style={[styles.sectionTitle, { fontSize: 14 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          Vehículo
        </Text>
        <View style={styles.card}>
          <InfoItem icon="car-outline" label="Modelo" value={modeloVehiculo} />
          <Divider />
          <InfoItem icon="pricetag-outline" label="Placa" value={contexto.vehiculo.placa} />
        </View>

        {/* Sección: Foto del vehículo (PR D) */}
        <Text
          size="sm"
          variant="secondary"
          style={[styles.sectionTitle, { fontSize: 14 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          Foto del vehículo
        </Text>
        <FotoVehiculoSection
          placa={contexto.vehiculo.placa}
          sesionId={contextoInicial.sesionId}
          obtenerAccessToken={obtenerAccessToken}
        />

        {/* Sección: Navegación del perfil */}
        <Text
          size="sm"
          variant="secondary"
          style={[styles.sectionTitle, { fontSize: 14 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          Opciones
        </Text>
        <View style={styles.card}>
          <NavigationItem
            icon="settings-outline"
            title="Ajustes de operación"
            onPress={() => navigation.navigate('Ajustes')}
          />
          <Divider />
          <NavigationItem icon="sync-outline" title="Sincronización" onPress={() => refetch()} />
        </View>

        {/* Sección: Versión y actualizaciones (OTA, expo-updates) */}
        <Text
          size="sm"
          variant="secondary"
          style={[styles.sectionTitle, { fontSize: 14 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          Aplicación
        </Text>
        <View style={styles.card}>
          <InfoItem
            icon="information-circle-outline"
            label="Versión"
            value={etiquetaVersion(
              Application.nativeApplicationVersion,
              Updates.updateId,
              Updates.isEmbeddedLaunch,
            )}
          />
          <Divider />
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
        <Button
          variant="outline"
          onPress={() => setConfirmarLogoutVisible(true)}
          style={styles.logoutButton}
          textStyle={styles.logoutTexto}
        >
          Cerrar sesión
        </Button>
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

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  return (
    <View style={styles.infoItem}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={20} color={dsColors.primaryText} />
      </View>
      <Text
        size="sm"
        variant="secondary"
        style={[styles.itemLabel, { fontSize: 14 * scale }]}
        allowFontScaling={!settings.textoGrande}
      >
        {label}
      </Text>
      <Text
        size="sm"
        weight="semibold"
        style={[styles.itemValue, { fontSize: 14.5 * scale }]}
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
  description?: string;
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
      onPress={onPress}
      style={({ pressed }) => [styles.infoItem, pressed && styles.pressed]}
    >
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={20} color={dsColors.primaryText} />
      </View>
      <View style={styles.navTextContainer}>
        <Text
          size="sm"
          weight="semibold"
          style={{ fontSize: 15 * scale }}
          allowFontScaling={!settings.textoGrande}
        >
          {title}
        </Text>
        {description ? (
          <Text
            size="sm"
            variant="secondary"
            style={{ fontSize: 13 * scale }}
            allowFontScaling={!settings.textoGrande}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={dsColors.textSecondary} />
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
        <QuivoHeader title="Perfil" onBack={() => navigation.goBack()} backLabel="Volver al mapa" />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroSection}>
          <ShimmerPlaceHolder style={styles.avatarPlaceholder} />
          <ShimmerPlaceHolder style={styles.namePlaceholder} />
        </View>
        <View style={styles.card}>
          <ShimmerPlaceHolder style={styles.rowPlaceholder} />
          <ShimmerPlaceHolder style={styles.rowPlaceholder} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dsColors.surfaceSoft },
  headerBar: { paddingTop: dsSpace.lg, paddingHorizontal: dsSpace.md, paddingBottom: dsSpace.sm },
  scrollContent: { paddingHorizontal: dsSpace.md, paddingBottom: dsSpace['3xl'] },
  heroSection: { alignItems: 'center', gap: dsSpace.sm, paddingVertical: dsSpace.lg },
  driverName: { color: dsColors.textPrimary, textAlign: 'center' },
  sectionTitle: { marginTop: dsSpace.lg, marginBottom: dsSpace.sm },
  card: {
    backgroundColor: dsColors.surfaceRaised,
    borderRadius: quivoBubble.radius,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    padding: quivoBubble.padding,
    ...dsElevation(2),
  },
  infoItem: {
    minHeight: quivoBubble.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: dsSpace.sm,
    paddingVertical: dsSpace.xs,
    // Valor de la derecha separado del borde curvo de la tarjeta.
    paddingRight: dsSpace.md,
  },
  iconCircle: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: { flex: 1 },
  itemValue: { flexShrink: 1, textAlign: 'right' },
  navTextContainer: { flex: 1 },
  pressed: { opacity: 0.7 },
  logoutButton: { marginTop: dsSpace.lg, borderColor: dsColors.danger },
  logoutTexto: { color: dsColors.danger },
  // La pastilla de estado va centrada bajo el nombre, no estirada al ancho del bloque.
  estado: { alignSelf: 'center' },
  avatarPlaceholder: { width: 72, height: 72, borderRadius: 36 },
  namePlaceholder: { width: 160, height: 24, borderRadius: dsRadius.sm },
  rowPlaceholder: {
    width: '100%',
    height: 44,
    borderRadius: dsRadius.sm,
    marginVertical: dsSpace.xs,
  },
});
