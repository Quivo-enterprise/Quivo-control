import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View, Pressable } from 'react-native';
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import type { ContextoOperativoMovil } from '@quivo/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { useGpsContext } from '../operacion/gps-provider';
import { useSyncStatus } from '../operacion/use-sync-status';
import { usePerfilQuery } from './use-perfil-query';
import { useOperacionSettings, useTextScale } from './use-operacion-settings';
import { CerrarSesionDialog } from '../../shared/components/cerrar-sesion-dialog';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { dsColors, dsElevation, dsRadius, dsSpace } from '../../shared/theme/design-system';
import { Avatar, Divider, Heading, Loader, Text } from '@quivo/design-system-native';
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
    isFetching,
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
  const [dialogoCambioClave, setDialogoCambioClave] = useState<'confirmar' | 'proximamente' | null>(
    null,
  );
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

  const confirmarCambioClave = () => {
    setDialogoCambioClave('confirmar');
  };

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
  const escalado = (fontSize: number) => ({ fontSize: fontSize * scale });
  const sinEscalaSistema = !settings.textoGrande;

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <PerfilHeader
          onBack={() => navigation.goBack()}
          scale={scale}
          textoGrande={settings.textoGrande}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, styles.profileCard]}>
          <FotoVehiculoSection
            placa={contexto.vehiculo.placa}
            sesionId={contextoInicial.sesionId}
            obtenerAccessToken={obtenerAccessToken}
            modeloVehiculo={modeloVehiculo}
            tipoVehiculo={contexto.vehiculo.tipo}
            embedded
            fotoOverlay={
              <View style={styles.avatarBurbuja}>
                <Avatar
                  name={contexto.conductor.nombre}
                  size="md"
                  status={gps.tracking ? 'online' : 'offline'}
                />
              </View>
            }
          />
          <Divider style={styles.profileDivider} />
          <View style={styles.conductorRow}>
            <View style={styles.conductorInfo}>
              <Heading
                size="sm"
                numberOfLines={2}
                style={escalado(16)}
                allowFontScaling={sinEscalaSistema}
              >
                {contexto.conductor.nombre}
              </Heading>
              <Text
                size="sm"
                variant="secondary"
                numberOfLines={1}
                style={escalado(14)}
                allowFontScaling={sinEscalaSistema}
              >
                CI {contexto.conductor.documentoIdentidad}
              </Text>
              <Text
                size="sm"
                variant="secondary"
                numberOfLines={1}
                style={escalado(14)}
                allowFontScaling={sinEscalaSistema}
              >
                {contexto.sindicato.nombre}
              </Text>
            </View>
            <View style={styles.conductorActions}>
              {gps.tracking ? (
                <View style={styles.estado}>
                  <Text
                    size="sm"
                    weight="bold"
                    numberOfLines={1}
                    style={[styles.estadoEnVivoTexto, escalado(14)]}
                    allowFontScaling={sinEscalaSistema}
                  >
                    EN VIVO
                  </Text>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cambiar clave"
                accessibilityHint="Abre una confirmación. El cambio de clave estará disponible próximamente."
                onPress={confirmarCambioClave}
                style={({ pressed }) => [styles.cambiarClaveButton, pressed && styles.pressed]}
              >
                <Ionicons name="key-outline" size={22} color={dsColors.primaryText} />
              </Pressable>
            </View>
          </View>
        </View>

        <SectionTitle label="Opciones" scale={scale} textoGrande={settings.textoGrande} />
        <View style={styles.card}>
          <NavigationItem
            icon="settings-outline"
            title="Ajustes de operación"
            description="Voz, texto grande y alertas"
            onPress={() => navigation.navigate('Ajustes')}
          />
          <View style={styles.optionSeparator}>
            <Divider />
          </View>
          <NavigationItem
            icon="sync-outline"
            title="Sincronización"
            description="Actualizar mis datos"
            busy={isFetching}
            onPress={() => refetch()}
          />
        </View>

        <SectionTitle label="Aplicación" scale={scale} textoGrande={settings.textoGrande} />
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
          <View style={styles.optionSeparator}>
            <Divider />
          </View>
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
          fullWidth
        >
          <Text
            weight="bold"
            style={[styles.logoutTexto, escalado(16)]}
            allowFontScaling={sinEscalaSistema}
          >
            Cerrar sesión
          </Text>
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
      <QuivoConfirmDialog
        visible={dialogoCambioClave !== null}
        title={
          dialogoCambioClave === 'proximamente'
            ? 'Próximamente'
            : 'Cambiar clave de inicio de sesión'
        }
        message={
          dialogoCambioClave === 'proximamente'
            ? 'El cambio de clave estará disponible pronto.'
            : '¿Quieres cambiar tu clave?'
        }
        confirmLabel={dialogoCambioClave === 'proximamente' ? 'Entendido' : 'Continuar'}
        cancelLabel={dialogoCambioClave === 'confirmar' ? 'Cancelar' : undefined}
        icon={null}
        onConfirm={() =>
          setDialogoCambioClave(dialogoCambioClave === 'confirmar' ? 'proximamente' : null)
        }
        onCancel={() => setDialogoCambioClave(null)}
      />
    </View>
  );
}

/** Flecha centrada en el círculo de 44 del patrón de navegación QUIVO. */
function PerfilHeader({
  onBack,
  scale,
  textoGrande,
}: {
  onBack: () => void;
  scale: number;
  textoGrande: boolean;
}) {
  return (
    <View style={styles.headerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver al mapa"
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Ionicons name="arrow-back" size={20} color={dsColors.primaryText} />
      </Pressable>
      <Heading
        size="xl"
        numberOfLines={1}
        style={[styles.headerTitle, { fontSize: 22 * scale }]}
        allowFontScaling={!textoGrande}
      >
        Perfil
      </Heading>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function SectionTitle({
  label,
  scale,
  textoGrande,
}: {
  label: string;
  scale: number;
  textoGrande: boolean;
}) {
  return (
    <Text
      size="sm"
      variant="secondary"
      style={{ fontSize: 14 * scale }}
      allowFontScaling={!textoGrande}
    >
      {label}
    </Text>
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
        style={[styles.itemLabel, { fontSize: 15 * scale }]}
        allowFontScaling={!settings.textoGrande}
      >
        {label}
      </Text>
      <Text
        size="sm"
        variant="secondary"
        numberOfLines={1}
        style={[styles.itemValue, { fontSize: 14 * scale }]}
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
  busy = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.infoItem,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={20} color={dsColors.primaryText} />
      </View>
      <View style={styles.navTextContainer}>
        <Text
          size="sm"
          weight="semibold"
          numberOfLines={1}
          style={{ fontSize: 15 * scale }}
          allowFontScaling={!settings.textoGrande}
        >
          {title}
        </Text>
        {description ? (
          <Text
            size="sm"
            variant="secondary"
            numberOfLines={2}
            style={{ fontSize: 14 * scale }}
            allowFontScaling={!settings.textoGrande}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <View style={styles.chevronSlot}>
        {busy ? (
          <Loader size="sm" />
        ) : (
          <Svg width={20} height={20} viewBox="0 0 20 20" accessible={false}>
            <Path
              d="M7 4 L13 10 L7 16"
              fill="none"
              stroke={dsColors.textSecondary}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        )}
      </View>
    </Pressable>
  );
}

function PerfilSkeleton({
  navigation,
}: {
  navigation: NativeStackScreenProps<OperationStackParamList, 'Perfil'>['navigation'];
}) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <PerfilHeader
          onBack={() => navigation.goBack()}
          scale={scale}
          textoGrande={settings.textoGrande}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <ShimmerPlaceHolder style={styles.photoPlaceholder} />
          <ShimmerPlaceHolder style={styles.rowPlaceholder} />
        </View>
        <View style={styles.card}>
          <ShimmerPlaceHolder style={styles.rowPlaceholder} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dsColors.surfaceSoft },
  // App.tsx ya aplica SafeAreaView arriba y abajo; aquí solo va el margen visual de la burbuja.
  headerBar: {
    paddingTop: quivoBubble.edge,
    paddingHorizontal: quivoBubble.edge,
    paddingBottom: dsSpace.xs,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backButton: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: dsRadius.full,
    borderWidth: 1,
    borderColor: dsColors.primarySoft,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: quivoBubble.touch },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: quivoBubble.edge,
    paddingTop: quivoBubble.edge,
    paddingBottom: quivoBubble.edge,
    gap: quivoBubble.gap,
  },
  card: {
    backgroundColor: quivoBubble.surface,
    borderRadius: quivoBubble.radius,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    padding: quivoBubble.padding,
    ...dsElevation(3),
  },
  // El hueco entre filas coincide con el relleno exterior de 8 dp; la línea va al centro.
  optionSeparator: { height: quivoBubble.gap, justifyContent: 'center' },
  profileCard: { gap: quivoBubble.gap },
  profileDivider: { marginHorizontal: dsSpace.xs },
  avatarBurbuja: {
    padding: dsSpace.xs,
    borderRadius: dsRadius.full,
    borderWidth: 1,
    borderColor: quivoBubble.border,
    backgroundColor: quivoBubble.surface,
    ...dsElevation(2),
  },
  conductorRow: { flexDirection: 'row', alignItems: 'center', gap: quivoBubble.gap },
  conductorInfo: { gap: dsSpace.xs, flex: 1, minWidth: 0 },
  conductorActions: { alignItems: 'flex-end' },
  cambiarClaveButton: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    borderWidth: 1,
    borderColor: dsColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  estado: {
    alignSelf: 'center',
    flexShrink: 1,
    borderRadius: dsRadius.full,
    paddingHorizontal: dsSpace.sm,
    paddingVertical: dsSpace.xs,
    backgroundColor: dsColors.successSoft,
  },
  estadoEnVivoTexto: { color: dsColors.success },
  infoItem: {
    // Círculo de 44 a 8 dp del borde: centro a 30 dp, concéntrico con radio exterior 30.
    minHeight: quivoBubble.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoBubble.gap,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  iconCircle: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.primarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronSlot: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: { flex: 1 },
  itemValue: { flexShrink: 1, maxWidth: '50%', textAlign: 'right' },
  navTextContainer: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  logoutButton: {
    // El gap exterior (8) más este margen (16) separa la salida 24 dp de la lista.
    marginTop: dsSpace.md,
    minHeight: 52,
    borderColor: dsColors.danger,
    borderRadius: dsRadius.full,
  },
  logoutTexto: { color: dsColors.danger },
  photoPlaceholder: { width: '100%', height: 180, borderRadius: quivoBubble.innerRadius },
  rowPlaceholder: {
    width: '100%',
    height: quivoBubble.touch,
    borderRadius: dsRadius.sm,
    marginVertical: dsSpace.xs,
  },
});
