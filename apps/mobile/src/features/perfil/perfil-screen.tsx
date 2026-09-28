import { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Platform,
  Image,
  Modal,
  Linking,
  ToastAndroid,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { BlurView } from 'expo-blur';
import type { ContextoOperativoMovil } from '@quivo/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { useGpsTracking } from '../operacion/gps-provider';
import { useSyncStatus } from '../operacion/use-sync-status';
import { usePerfilQuery as usePerfilQueryReal } from './use-perfil-query';
import { useTextScale, useOperacionSettings } from './use-operacion-settings';
import { CerrarSesionDialog } from '../../shared/components/cerrar-sesion-dialog';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { createShimmerPlaceholder } from 'react-native-shimmer-placeholder';
import { LinearGradient } from 'expo-linear-gradient';
import { MODO_DEMO } from '../../demo/flag';
import { usePerfilDemo, usePerfilQueryDemo } from '../../demo/use-perfil-demo';
import { dataUriDemasiadoGrande } from './foto-perfil-limite';

const ShimmerPlaceHolder = createShimmerPlaceholder(LinearGradient);

// docs/plan-apk-demo-conductor.md (paso A): mismo patrón que `gps-provider.tsx` — elegido a
// nivel de módulo, sin el flag sigue siendo el hook real de siempre.
const usePerfilQuery = MODO_DEMO ? usePerfilQueryDemo : usePerfilQueryReal;

export interface PerfilScreenProps extends NativeStackScreenProps<OperationStackParamList, 'Perfil'> {
  contexto: ContextoOperativoMovil;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => void;
}

export function PerfilScreen({ navigation, contexto: contextoInicial, obtenerAccessToken, onLogout }: PerfilScreenProps) {
  const { data: contexto, isLoading, refetch } = usePerfilQuery(contextoInicial, obtenerAccessToken);
  // FIX POST-REVISIÓN (hallazgo de revisión — "Perfil re-renderiza cada segundo de tracking"):
  // `useGpsTracking()` en vez de `useGpsContext()` — esta pantalla solo lee `tracking` (ver
  // `statusLabel`/`statusColor` abajo), nunca `posicionActual`. Ver `gps-provider.tsx`.
  const { tracking } = useGpsTracking();
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

  if (isLoading || !contexto) {
    return <PerfilSkeleton navigation={navigation} />;
  }

  const modeloVehiculo = `${contexto.vehiculo.marca} ${contexto.vehiculo.modelo}`.trim() || 'Toyota Hiace';
  const statusLabel = tracking ? 'EN LINEA' : 'EN ESPERA';
  // En Figma: EN ESPERA es azul (#3127B1) y EN LINEA es naranja/ámbar (#FD9E15)
  const statusColor = tracking ? '#FD9E15' : '#3127B1';

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
          {MODO_DEMO ? (
            <AvatarPerfilDemo conductorId={contexto.conductor.id} nombreConductor={contexto.conductor.nombre} />
          ) : (
            <View style={styles.avatar} />
          )}

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

          {MODO_DEMO && (
            <>
              <View style={styles.divider} />
              <TelefonoRow conductorId={contexto.conductor.id} />
            </>
          )}
        </View>

        {/* Sección: Navegación del perfil */}
        <Text
          style={[styles.sectionTitle, { fontSize: 14 * scale }]}
          allowFontScaling={!settings.textoGrande}
        >
          Navegación del perfil
        </Text>
        <View style={styles.card}>
          {MODO_DEMO && (
            <>
              <NavigationItem
                icon="map-outline"
                title="Hoja de ruta"
                description="Turno, orden de salida y recorrido de hoy"
                onPress={() => navigation.navigate('HojaDeRuta')}
              />
              <View style={styles.divider} />
            </>
          )}

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

// ================================================================================================
// Demo: foto de perfil + teléfono (`docs/plan-apk-demo-conductor.md`, paso C, pedido del CTO).
// Montadas SOLO cuando `MODO_DEMO` es `true` (ver el gate en el render de arriba) — `MODO_DEMO`
// es una constante de build que nunca cambia en la vida de la app, así que estos componentes se
// montan o no se montan NUNCA a mitad de una sesión: es seguro que llamen hooks (`usePerfilDemo`)
// que no existen en la variante real, sin violar las reglas de hooks del árbol de `PerfilScreen`.
// ================================================================================================

type PermisoFaltante = 'camara' | 'galeria' | null;

/**
 * FIX POST-REVISIÓN (hallazgo de revisión — "foto de perfil rompe AsyncStorage"): antes se
 * guardaba el data URI base64 de la foto TAL CUAL (`quality: 0.5`, sin ningún tope) — un recorte
 * 1:1 de una cámara de 12 MP fácilmente supera 2 MB en base64, y Android corta la lectura de una
 * fila de `AsyncStorage`/SQLite (`CursorWindow`) bien por debajo de eso, lo que hacía fallar la
 * LECTURA del registro completo (foto + teléfono) — el perfil quedaba "vacío" sin ningún error
 * visible. Fix elegido sin sumar una dependencia nativa nueva: `expo-file-system` NO es
 * resoluble desde `apps/mobile` hoy (no es dependencia directa de este paquete — solo llega
 * transitivamente vía `expo`, y `pnpm` no lo hoistea) — agregarlo es un cambio de superficie más
 * grande de lo que amerita este fix. En su lugar: `quality: 0.3` (baja el peso típico bastante
 * por debajo del límite) MÁS un tope explícito (`TOPE_DATA_URI_BYTES`) que rechaza y pide
 * reintentar si el picker igual devuelve algo pesado (cámara de muy alta resolución) — nunca se
 * persiste un data URI que pueda romper la lectura. El contrato de `guardarFoto` (`./
 * ../../demo/use-perfil-demo.ts`) no cambia: sigue recibiendo un data URI ya armado, este
 * componente es el único que decide si vale la pena guardarlo.
 */

/** Avatar tocable — foto guardada (o iniciales del conductor) + badge de cámara. Al tocar, abre
 * una hoja de acciones (Tomar foto / Elegir de galería / Quitar foto / Cancelar). */
function AvatarPerfilDemo({ conductorId, nombreConductor }: { conductorId: string; nombreConductor: string }) {
  const { foto, guardarFoto, cargando } = usePerfilDemo(conductorId);
  const [hojaVisible, setHojaVisible] = useState(false);
  const [permisoFaltante, setPermisoFaltante] = useState<PermisoFaltante>(null);
  const [subiendo, setSubiendo] = useState(false);

  const guardarDesdeAsset = useCallback(
    async (resultado: ImagePicker.ImagePickerResult) => {
      if (resultado.canceled) return;
      const asset = resultado.assets?.[0];
      if (!asset?.base64) return;
      const dataUri = `data:image/jpeg;base64,${asset.base64}`;
      // Rechazo explícito ANTES de persistir — ver el docblock de `foto-perfil-limite.ts`.
      if (dataUriDemasiadoGrande(dataUri)) {
        if (Platform.OS === 'android') {
          ToastAndroid.show('La foto pesa demasiado. Probá de nuevo.', ToastAndroid.LONG);
        }
        return;
      }
      setSubiendo(true);
      try {
        await guardarFoto(dataUri);
      } finally {
        setSubiendo(false);
      }
    },
    [guardarFoto],
  );

  const tomarFoto = useCallback(async () => {
    setHojaVisible(false);
    try {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (permiso.status !== 'granted') {
        setPermisoFaltante('camara');
        return;
      }
      const resultado = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3,
        base64: true,
      });
      await guardarDesdeAsset(resultado);
    } catch (error) {
      // Best-effort (mismo patrón que `ajustes-screen.tsx`): un fallo acá (cámara ocupada,
      // picker nativo cancelado de forma anómala) no debe tumbar la pantalla — el chofer
      // simplemente sigue sin foto nueva y puede reintentar.
      console.error('[QUIVO][perfil-demo] No se pudo tomar la foto', error);
      if (Platform.OS === 'android') ToastAndroid.show('No se pudo tomar la foto.', ToastAndroid.SHORT);
    }
  }, [guardarDesdeAsset]);

  const elegirDeGaleria = useCallback(async () => {
    setHojaVisible(false);
    try {
      const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permiso.status !== 'granted') {
        setPermisoFaltante('galeria');
        return;
      }
      const resultado = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3,
        base64: true,
      });
      await guardarDesdeAsset(resultado);
    } catch (error) {
      console.error('[QUIVO][perfil-demo] No se pudo elegir la foto de galería', error);
      if (Platform.OS === 'android') ToastAndroid.show('No se pudo abrir la galería.', ToastAndroid.SHORT);
    }
  }, [guardarDesdeAsset]);

  const quitarFoto = useCallback(async () => {
    setHojaVisible(false);
    try {
      await guardarFoto('');
    } catch (error) {
      console.error('[QUIVO][perfil-demo] No se pudo quitar la foto', error);
    }
  }, [guardarFoto]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cambiar foto de perfil"
        onPress={() => setHojaVisible(true)}
        style={styles.avatarPressable}
        disabled={cargando}
      >
        {foto ? (
          <Image source={{ uri: foto }} style={styles.avatarImagen} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarIniciales}>{inicialesDe(nombreConductor)}</Text>
          </View>
        )}
        <View style={styles.avatarBadge}>
          {subiendo ? (
            <ActivityIndicator size="small" color={quivoColors.white} />
          ) : (
            <Ionicons name="camera" size={14} color={quivoColors.white} />
          )}
        </View>
      </Pressable>

      <Modal visible={hojaVisible} transparent animationType="fade" onRequestClose={() => setHojaVisible(false)}>
        <Pressable style={styles.hojaOverlay} onPress={() => setHojaVisible(false)}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <BlurView intensity={90} tint="light" style={styles.hojaSheet}>
              <Text style={styles.hojaTitulo}>Foto de perfil</Text>

              <HojaOpcion icon="camera-outline" label="Tomar foto" onPress={tomarFoto} />
              <HojaOpcion icon="images-outline" label="Elegir de galería" onPress={elegirDeGaleria} />
              {foto ? (
                <HojaOpcion icon="trash-outline" label="Quitar foto" destructivo onPress={quitarFoto} />
              ) : null}
              <HojaOpcion icon="close-outline" label="Cancelar" onPress={() => setHojaVisible(false)} />
            </BlurView>
          </Pressable>
        </Pressable>
      </Modal>

      <QuivoConfirmDialog
        visible={permisoFaltante !== null}
        title="Permiso necesario"
        message={
          permisoFaltante === 'camara'
            ? 'QUIVO Control necesita permiso de cámara para tomar tu foto de perfil. Podés habilitarlo en los ajustes del sistema.'
            : 'QUIVO Control necesita permiso para acceder a tus fotos. Podés habilitarlo en los ajustes del sistema.'
        }
        confirmLabel="Abrir ajustes"
        cancelLabel="Cerrar"
        onConfirm={() => {
          setPermisoFaltante(null);
          Linking.openSettings();
        }}
        onCancel={() => setPermisoFaltante(null)}
      />
    </>
  );
}

function HojaOpcion({
  icon,
  label,
  onPress,
  destructivo,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructivo?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.hojaOpcion, pressed && styles.navItemPressed]}
    >
      <Ionicons name={icon} size={20} color={destructivo ? quivoColors.danger : '#3127B1'} />
      <Text style={[styles.hojaOpcionTexto, destructivo && { color: quivoColors.danger }]}>{label}</Text>
    </Pressable>
  );
}

/** Fila "Teléfono" — muestra el número guardado (formato `+591 7123 4567`) o una invitación a
 * agregarlo. Al tocar abre un modal chico con teclado numérico, prefijo `+591` fijo y validación
 * (8 dígitos, empieza con 6 o 7 — celular boliviano). */
function TelefonoRow({ conductorId }: { conductorId: string }) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();
  const { telefono, guardarTelefono } = usePerfilDemo(conductorId);
  const [modalVisible, setModalVisible] = useState(false);
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const abrir = () => {
    setValor(telefono ?? '');
    setError(null);
    setModalVisible(true);
  };

  const guardar = useCallback(async () => {
    if (!/^[67]\d{7}$/.test(valor)) {
      setError('Ingresá 8 dígitos, empezando con 6 o 7.');
      return;
    }
    setGuardando(true);
    try {
      await guardarTelefono(valor);
      setModalVisible(false);
      if (Platform.OS === 'android') {
        ToastAndroid.show('Teléfono guardado.', ToastAndroid.SHORT);
      }
    } catch (errorGuardado) {
      console.error('[QUIVO][perfil-demo] No se pudo guardar el teléfono', errorGuardado);
      setError('No se pudo guardar. Probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }, [guardarTelefono, valor]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Editar teléfono"
        style={styles.infoItem}
        onPress={abrir}
      >
        <Text style={[styles.infoLabel, { fontSize: 11.5 * scale }]} allowFontScaling={!settings.textoGrande}>
          Teléfono
        </Text>
        <Text
          style={[styles.infoValue, { fontSize: 14.5 * scale }, !telefono && styles.infoValueVacio]}
          allowFontScaling={!settings.textoGrande}
        >
          {telefono ? formatearTelefonoBoliviano(telefono) : 'Agregar teléfono'}
        </Text>
      </Pressable>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.hojaOverlay}>
          <BlurView intensity={90} tint="light" style={styles.telefonoModal}>
            <Text style={styles.hojaTitulo}>Teléfono</Text>

            <View style={styles.telefonoInputRow}>
              <Text style={styles.telefonoPrefijo}>+591</Text>
              <View style={styles.telefonoInputDivider} />
              <Text style={styles.telefonoInputTexto} accessibilityLabel="Número de teléfono">
                {valor || '••••••••'}
              </Text>
            </View>

            {error ? <Text style={styles.telefonoError}>{error}</Text> : null}

            <PadNumerico
              valor={valor}
              maxLength={8}
              onChange={(v) => {
                setValor(v);
                setError(null);
              }}
            />

            <View style={styles.telefonoAcciones}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancelar"
                onPress={() => setModalVisible(false)}
                style={({ pressed }) => [styles.telefonoBotonSecundario, pressed && styles.navItemPressed]}
              >
                <Text style={styles.telefonoBotonSecundarioTexto}>CANCELAR</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Guardar teléfono"
                onPress={guardar}
                disabled={guardando}
                style={({ pressed }) => [
                  styles.telefonoBotonPrimario,
                  guardando && styles.disabled,
                  pressed && styles.navItemPressed,
                ]}
              >
                {guardando ? (
                  <ActivityIndicator size="small" color={quivoColors.white} />
                ) : (
                  <Text style={styles.telefonoBotonPrimarioTexto}>GUARDAR</Text>
                )}
              </Pressable>
            </View>
          </BlurView>
        </View>
      </Modal>
    </>
  );
}

/** Teclado numérico simple (0-9 + borrar) — evita depender del teclado del sistema para un
 * campo tan corto y mantiene el modal chico y filmable (un solo dato a la vez). */
function PadNumerico({
  valor,
  maxLength,
  onChange,
}: {
  valor: string;
  maxLength: number;
  onChange: (v: string) => void;
}) {
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'borrar', '0', 'ok'] as const;
  return (
    <View style={styles.padNumerico}>
      {teclas.map((tecla) => {
        if (tecla === 'ok') return <View key="ok" style={styles.padTecla} />;
        if (tecla === 'borrar') {
          return (
            <Pressable
              key="borrar"
              accessibilityRole="button"
              accessibilityLabel="Borrar dígito"
              onPress={() => onChange(valor.slice(0, -1))}
              style={({ pressed }) => [styles.padTecla, pressed && styles.padTeclaPressed]}
            >
              <Ionicons name="backspace-outline" size={20} color="#3127B1" />
            </Pressable>
          );
        }
        return (
          <Pressable
            key={tecla}
            accessibilityRole="button"
            accessibilityLabel={`Dígito ${tecla}`}
            disabled={valor.length >= maxLength}
            onPress={() => onChange((valor + tecla).slice(0, maxLength))}
            style={({ pressed }) => [styles.padTecla, pressed && styles.padTeclaPressed]}
          >
            <Text style={styles.padTeclaTexto}>{tecla}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Iniciales del conductor (hasta 2 letras) para el placeholder del avatar sin foto. */
function inicialesDe(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const iniciales = partes.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '');
  return iniciales.join('') || '?';
}

/** `71234567` (8 dígitos guardados) -> `+591 7123 4567`, mismo formato que usa el guion de
 * grabación para leer el número en cámara. */
function formatearTelefonoBoliviano(telefono: string): string {
  if (telefono.length !== 8) return `+591 ${telefono}`;
  return `+591 ${telefono.slice(0, 4)} ${telefono.slice(4)}`;
}

function NavigationItem({
  icon,
  title,
  description,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
}) {
  const scale = useTextScale();
  const { settings } = useOperacionSettings();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.navItem, pressed && styles.navItemPressed]}
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

  // Demo — avatar tocable (`AvatarPerfilDemo`).
  avatarPressable: {
    width: 66,
    height: 66,
    marginBottom: 12,
    position: 'relative',
  },
  avatarImagen: {
    width: 66,
    height: 66,
    borderRadius: 33,
  },
  avatarPlaceholder: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIniciales: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 22,
    letterSpacing: 0.5,
  },
  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: quivoColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F4F6F8',
  },

  // Demo — hoja de acciones (foto) y modal de teléfono, mismo lenguaje visual que
  // `quivo-confirm-dialog.tsx` (BlurView + overlay oscuro).
  hojaOverlay: {
    flex: 1,
    backgroundColor: 'rgba(25, 20, 60, 0.32)',
    justifyContent: 'flex-end',
  },
  hojaSheet: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 32 : 22,
    overflow: 'hidden',
  },
  hojaTitulo: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
    color: '#3127B1',
    marginBottom: 12,
    textAlign: 'center',
  },
  hojaOpcion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#E8ECF2',
  },
  hojaOpcionTexto: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
    color: '#1A1A2E',
  },
  infoValueVacio: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyRegular,
  },

  // Demo — modal de teléfono con teclado numérico propio.
  telefonoModal: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 24,
    padding: 20,
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
  },
  telefonoInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F4F6F8',
    borderRadius: quivoRadius.md,
    paddingVertical: 14,
    marginBottom: 8,
  },
  telefonoPrefijo: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 18,
    color: quivoColors.textMuted,
  },
  telefonoInputDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#D9D9E8',
  },
  telefonoInputTexto: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    letterSpacing: 2,
    color: '#3127B1',
  },
  telefonoError: {
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 12.5,
    color: quivoColors.danger,
    textAlign: 'center',
    marginBottom: 8,
  },
  telefonoAcciones: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  telefonoBotonSecundario: {
    flex: 1,
    height: 44,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#DCE0E8',
    borderWidth: 1.5,
    borderColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  telefonoBotonSecundarioTexto: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.6,
    color: '#3127B1',
  },
  telefonoBotonPrimario: {
    flex: 1,
    height: 44,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  telefonoBotonPrimarioTexto: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.6,
    color: quivoColors.white,
  },
  disabled: {
    opacity: 0.6,
  },

  // Demo — teclado numérico propio del modal de teléfono.
  padNumerico: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  padTecla: {
    width: 64,
    height: 48,
    borderRadius: quivoRadius.md,
    backgroundColor: '#F4F6F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  padTeclaPressed: {
    backgroundColor: '#E8ECF2',
  },
  padTeclaTexto: {
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 18,
    color: '#1A1A2E',
  },
});
