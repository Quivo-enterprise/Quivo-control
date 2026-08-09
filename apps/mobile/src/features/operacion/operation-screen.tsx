import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import { Svg, Circle, Line } from 'react-native-svg';
import { haversineMetros, type ContextoOperativoMovil, type PaqueteDia } from '@quivo/shared';
import { abrirOutbox, encolarEvento } from '../../db/outbox';
import { QuivoGlassCard } from '../../shared/components/quivo-glass-card';
import { Button } from '../../shared/components/Button';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { MapErrorBoundary } from './map-error-boundary';
import { proximoPuntoControlPendiente } from './proximo-punto-control';
import { RouteMapView } from './route-map-view';
import { NextControlSheet } from './next-control-sheet';
import { useGpsOperativo } from './use-gps-operativo';
import { usePaqueteDia } from './use-paquete-dia';
import { useSyncStatus } from './use-sync-status';
import { PerfilScreen } from '../perfil/perfil-screen';
import { formatearDistancia } from './format-distancia';
import { ruteoApi } from '../../shared/api/ruteo-api';
import { ControlFeedbackToast } from './control-feedback-toast';
import { OfflineBanner } from './offline-banner';

interface OperationScreenProps {
  contexto: ContextoOperativoMovil;
  deviceId: string;
  aviso: string | null;
  loading: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => Promise<void>;
}

export function OperationScreen(props: OperationScreenProps) {
  useKeepAwake();
  const paqueteDia = usePaqueteDia(props.obtenerAccessToken);
  const { pendientes, errorSync, isOffline, isSyncing } = useSyncStatus(props.obtenerAccessToken);
  const puntosControl = useMemo(
    () => paqueteDia.paquete?.puntosControl ?? [],
    [paqueteDia.paquete],
  );
  const gps = useGpsOperativo(props.contexto.sesionId, props.deviceId, puntosControl);
  const [completados, setCompletados] = useState<Set<string>>(new Set());
  const [observacion, setObservacion] = useState('');
  const [enviandoObservacion, setEnviandoObservacion] = useState(false);
  const [observacionEnviada, setObservacionEnviada] = useState(false);
  const [recenterTick, setRecenterTick] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const sheetPanY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!gps.ultimaDeteccion) return;
    setCompletados((actual) => new Set(actual).add(gps.ultimaDeteccion!.puntoControlId));
  }, [gps.ultimaDeteccion]);
  useEffect(() => {
    if (!gps.tracking) setCompletados(new Set());
  }, [gps.tracking]);

  const proximoPuntoControl = useMemo(
    () => proximoPuntoControlPendiente(puntosControl, completados),
    [puntosControl, completados],
  );

  const distanciaProximoPunto = useMemo(() => {
    if (!proximoPuntoControl || !gps.posicionActual) return null;
    const actual: [number, number] = [gps.posicionActual.lng, gps.posicionActual.lat];
    return haversineMetros(actual, proximoPuntoControl.coord.coordinates);
  }, [proximoPuntoControl, gps.posicionActual]);

  // Ruta real siguiendo calles (OSRM self-hosted) hacia el próximo punto de control, o
  // hacia el final del recorrido si no hay ninguno cargado — reemplaza la línea recta que
  // dibuja el mapa mientras esta petición está en curso o si falla (offline / OSRM caído).
  // Throttleada por distancia/tiempo para no golpear el backend en cada lectura de GPS.
  const [rutaCalculada, setRutaCalculada] = useState<[number, number][] | null>(null);
  const ultimoFetchRuta = useRef<{ ts: number; lat: number; lng: number } | null>(null);
  const destinoRuteo = proximoPuntoControl?.coord.coordinates ??
    paqueteDia.paquete?.ruta.geometria.coordinates.at(-1) ??
    null;
  useEffect(() => {
    if (!gps.tracking || !gps.posicionActual || !destinoRuteo) {
      setRutaCalculada(null);
      return;
    }
    const posicion = gps.posicionActual;
    const anterior = ultimoFetchRuta.current;
    const ahora = Date.now();
    const distanciaDesdeUltimoFetch = anterior
      ? haversineMetros([posicion.lng, posicion.lat], [anterior.lng, anterior.lat])
      : Infinity;
    if (anterior && distanciaDesdeUltimoFetch < 50 && ahora - anterior.ts < 15_000) return;

    ultimoFetchRuta.current = { ts: ahora, lat: posicion.lat, lng: posicion.lng };
    let cancelado = false;
    void (async () => {
      const token = await props.obtenerAccessToken();
      if (!token || cancelado) return;
      const resultado = await ruteoApi.rutaAPunto(
        posicion,
        { lat: destinoRuteo[1], lng: destinoRuteo[0] },
        token,
      );
      if (!cancelado) setRutaCalculada(resultado?.coordenadas ?? null);
    })();
    return () => {
      cancelado = true;
    };
  }, [gps.tracking, gps.posicionActual, destinoRuteo, props.obtenerAccessToken]);

  const enviarObservacion = useCallback(async () => {
    const texto = observacion.trim();
    if (!texto) return;
    setEnviandoObservacion(true);
    try {
      const db = await abrirOutbox();
      await encolarEvento(db, {
        deviceId: props.deviceId,
        tipo: 'observacion',
        payload: { sesionId: props.contexto.sesionId, texto },
      });
      setObservacion('');
      setObservacionEnviada(true);
    } finally {
      setEnviandoObservacion(false);
    }
  }, [observacion, props.contexto.sesionId, props.deviceId]);

  const confirmarFinalizacion = useCallback(() => {
    Alert.alert(
      '¿Finalizar el recorrido?',
      'El GPS dejará de registrar la jornada. Esta acción requiere confirmación.',
      [
        { text: 'Seguir recorriendo', style: 'cancel' },
        { text: 'Finalizar', style: 'destructive', onPress: () => void gps.detener() },
      ],
    );
  }, [gps]);

  const confirmarCierreSesion = useCallback(() => {
    Alert.alert('¿Cerrar sesión?', 'Deberás volver a validar el vehículo y tu identidad.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesión',
        style: 'destructive',
        onPress: () => {
          setShowProfile(false);
          void props.onLogout();
        },
      },
    ]);
  }, [props]);

  if (showProfile) {
    return (
      <PerfilScreen
        contexto={props.contexto}
        tracking={gps.tracking}
        pendingEvents={pendientes}
        onBack={() => setShowProfile(false)}
        onLogout={confirmarCierreSesion}
      />
    );
  }

  return (
    <View style={styles.container}>
      <MapLayer
        loading={paqueteDia.cargando}
        paquete={paqueteDia.paquete}
        nextPointId={proximoPuntoControl?.id ?? null}
        position={gps.posicionActual}
        tracking={gps.tracking}
        recenterTick={recenterTick}
        rutaCalculada={rutaCalculada}
      />

      <View pointerEvents="box-none" style={styles.topOverlay}>
        <View style={{ flexDirection: 'column', gap: quivoSpacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: quivoSpacing.md }}>
            <Pressable
              style={{ flex: 1 }}
              accessibilityRole="button"
              accessibilityLabel="Perfil y configuración"
              onPress={() => setShowProfile(true)}
            >
              <DriverRouteCard contexto={props.contexto} tracking={gps.tracking} isOffline={isOffline} />
            </Pressable>
          </View>
          <OfflineBanner isOffline={isOffline} />
        </View>
        
        {gps.tracking && proximoPuntoControl && (
          <NavigationInstructionCard distanciaMetros={distanciaProximoPunto} />
        )}

        {props.aviso ? <Text style={styles.notice}>{props.aviso}</Text> : null}
        {pendientes >= 800 ? (
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            Almacenamiento local casi lleno (80%). Conéctate pronto para sincronizar.
          </Text>
        ) : null}
        {paqueteDia.vencido ? (
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            Asignación vencida. Reconecta antes de iniciar otro recorrido.
          </Text>
        ) : null}
        {paqueteDia.error ? (
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            {paqueteDia.error}
          </Text>
        ) : null}
      </View>

      <Animated.View style={[styles.fabsContainer, { transform: [{ translateY: sheetPanY }] }]}>
        {gps.tracking && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Información de registro"
            style={styles.recenterButton}
            onPress={() => setShowInfo(true)}
          >
            <Ionicons name="information" size={24} color={quivoColors.primary} />
          </Pressable>
        )}
        {gps.tracking && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Registrar observación"
            style={styles.recenterButton}
            onPress={() => {}}
          >
            <Ionicons name="chatbubble-ellipses" size={24} color={quivoColors.primary} />
          </Pressable>
        )}
        {__DEV__ && gps.tracking && proximoPuntoControl && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Simular detección (Debug)"
            style={[styles.recenterButton, { backgroundColor: quivoColors.accentSoft }]}
            onPress={() => gps.simularDeteccion(proximoPuntoControl.id)}
          >
            <Ionicons name="bug" size={24} color={quivoColors.accentStrong} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Centrar en mi ubicación"
          style={styles.recenterButton}
          onPress={() => setRecenterTick(t => t + 1)}
        >
          <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={quivoColors.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <Circle cx="12" cy="12" r="7" />
            <Line x1="12" y1="1" x2="12" y2="5" />
            <Line x1="12" y1="19" x2="12" y2="23" />
            <Line x1="1" y1="12" x2="5" y2="12" />
            <Line x1="19" y1="12" x2="23" y2="12" />
          </Svg>
        </Pressable>
      </Animated.View>

      <NextControlSheet
        contexto={props.contexto}
        nextPointOrder={proximoPuntoControl?.orden ?? null}
        totalPoints={puntosControl.length}
        distanciaMetros={distanciaProximoPunto}
        tracking={gps.tracking}
        canStart={!paqueteDia.vencido && !paqueteDia.cargando && !paqueteDia.error}
        pendingEvents={pendientes}
        isOffline={isOffline}
        isSyncing={isSyncing}
        onStart={() => void gps.iniciar()}
        onFinish={confirmarFinalizacion}
        panY={sheetPanY}
        gpsError={gps.errorGps}
      />

      <Modal visible={showInfo} transparent={true} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="information-circle" size={32} color={quivoColors.primary} />
              <Text style={styles.modalTitle}>Registro Automático</Text>
            </View>
            <Text style={styles.modalText}>
              Al entrar al radio del punto de control, se registrará automáticamente en el sistema sin necesidad de intervención manual.
            </Text>
            <Button variant="primary" onPress={() => setShowInfo(false)} style={{ marginTop: quivoSpacing.xl }}>
              Entendido
            </Button>
          </View>
        </View>
      </Modal>

      <ControlFeedbackToast ultimaDeteccion={gps.ultimaDeteccion} />
    </View>
  );
}

function DriverRouteCard({
  contexto,
  tracking,
  isOffline,
}: {
  contexto: ContextoOperativoMovil;
  tracking: boolean;
  isOffline: boolean;
}) {
  return (
    <View style={styles.identityCard}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(contexto.conductor.nombre)}</Text>
      </View>
      <View style={styles.identityText}>
        <Text numberOfLines={1} style={styles.driverName}>
          {contexto.conductor.nombre}
        </Text>
        <Text numberOfLines={1} style={styles.sindicatoText}>
          ({contexto.sindicato.nombre})
        </Text>
        <Text numberOfLines={1} style={styles.vehicleText}>
          {contexto.vehiculo.placa} - {contexto.vehiculo.marca} {contexto.vehiculo.modelo}
        </Text>
      </View>
      <View style={styles.routeBadge}>
        <Text style={styles.lineCode}>{contexto.linea.codigo}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          {tracking && !isOffline && <Ionicons name="wifi" size={10} color={quivoColors.success} />}
          {isOffline && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF9500' }} />}
          <Text style={[
            styles.gpsStatus, 
            tracking && !isOffline ? styles.gpsStatusActive : null,
            isOffline ? { color: '#FF9500' } : null
          ]}>
            {isOffline ? 'OFFLINE' : tracking ? 'EN LÍNEA' : 'EN ESPERA'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function NavigationInstructionCard({ distanciaMetros }: { distanciaMetros: number | null }) {
  return (
    <View style={styles.navInstructionCard}>
      <View style={styles.navIconContainer}>
        <Ionicons name="arrow-up" size={36} color={quivoColors.white} />
      </View>
      <View style={styles.navInstructionText}>
        <Text style={styles.navDistance}>
          {distanciaMetros === null ? '—' : formatearDistancia(distanciaMetros)}
        </Text>
        <Text style={styles.navAction}>Dirígete al punto de control</Text>
      </View>
    </View>
  );
}

function MapLayer({
  loading,
  paquete,
  nextPointId,
  position,
  tracking,
  recenterTick,
  rutaCalculada,
}: {
  loading: boolean;
  paquete: PaqueteDia | null;
  nextPointId: string | null;
  position: { lat: number; lng: number } | null;
  tracking: boolean;
  recenterTick: number;
  rutaCalculada: [number, number][] | null;
}) {
  if (loading) {
    return (
      <View style={styles.mapFallback}>
        <ActivityIndicator color={quivoColors.primary} />
        <Text style={styles.mapFallbackText}>Preparando tu ruta…</Text>
      </View>
    );
  }
  if (!paquete) return <View style={styles.mapFallback} />;
  return (
    <MapErrorBoundary>
      <RouteMapView
        paquete={paquete}
        proximoPuntoControlId={nextPointId}
        posicionActual={position}
        tracking={tracking}
        recenterTick={recenterTick}
        rutaCalculada={rutaCalculada}
        style={styles.fullMap}
      />
    </MapErrorBoundary>
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
  container: { flex: 1, backgroundColor: quivoColors.page },
  fullMap: { flex: 1, height: undefined, borderRadius: 0 },
  mapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: quivoSpacing.sm,
    paddingBottom: 180,
  },
  mapFallbackText: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
  },
  topOverlay: {
    position: 'absolute',
    top: quivoSpacing.lg,
    left: quivoSpacing.lg,
    right: quivoSpacing.lg,
    gap: quivoSpacing.sm,
  },
  identityCard: {
    backgroundColor: quivoColors.white,
    borderRadius: quivoRadius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    padding: quivoSpacing.md,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: quivoRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: quivoColors.primary,
  },
  avatarText: { color: quivoColors.white, fontFamily: quivoFonts.displayBold, fontSize: 16 },
  identityText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  driverName: { color: quivoColors.text, fontFamily: quivoFonts.bodySemiBold, fontSize: 13 },
  sindicatoText: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 11,
    marginTop: 2,
  },
  vehicleText: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 10,
    marginTop: 4,
  },
  routeBadge: { alignItems: 'flex-end', justifyContent: 'center', paddingLeft: quivoSpacing.xs },
  lineCode: { color: quivoColors.primary, fontFamily: quivoFonts.displayBold, fontSize: 24 },
  gpsStatus: {
    color: quivoColors.success,
    fontFamily: quivoFonts.displayBold,
    fontSize: 9,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  gpsStatusActive: {
    color: quivoColors.success,
  },
  navInstructionCard: {
    backgroundColor: 'rgba(50, 38, 180, 0.95)',
    borderRadius: quivoRadius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: quivoSpacing.lg,
    gap: quivoSpacing.md,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  navIconContainer: {
    width: 44,
    alignItems: 'center',
  },
  navInstructionText: {
    flex: 1,
    justifyContent: 'center',
  },
  navDistance: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 28,
  },
  navAction: {
    color: quivoColors.white,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 16,
    opacity: 0.9,
    marginTop: -4,
  },

  notice: {
    color: quivoColors.accentStrong,
    backgroundColor: quivoColors.accentSoft,
    borderRadius: quivoRadius.md,
    padding: quivoSpacing.md,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 11,
  },
  dangerNotice: {
    color: quivoColors.danger,
    backgroundColor: quivoColors.dangerSoft,
    borderRadius: quivoRadius.md,
    padding: quivoSpacing.md,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11,
  },
  successNotice: {
    alignSelf: 'center',
    color: quivoColors.success,
    backgroundColor: quivoColors.successSoft,
    borderRadius: quivoRadius.pill,
    paddingHorizontal: quivoSpacing.lg,
    paddingVertical: quivoSpacing.sm,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11,
  },
  fabsContainer: {
    position: 'absolute',
    right: quivoSpacing.md,
    bottom: 280,
    zIndex: 1000,
    gap: quivoSpacing.md,
  },
  recenterButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: quivoColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: quivoSpacing.xl,
  },
  modalContent: {
    backgroundColor: quivoColors.white,
    borderRadius: quivoRadius.xl,
    padding: quivoSpacing.xl,
    width: '100%',
    maxWidth: 400,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    marginBottom: quivoSpacing.md,
  },
  modalTitle: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    color: quivoColors.text,
    flex: 1,
  },
  modalText: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 15,
    color: quivoColors.textSecondary,
    lineHeight: 22,
  },
});
