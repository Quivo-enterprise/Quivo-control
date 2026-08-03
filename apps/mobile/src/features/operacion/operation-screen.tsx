import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import type { ContextoOperativoMovil, PaqueteDia } from '@quivo/shared';
import { abrirOutbox, encolarEvento } from '../../db/outbox';
import { QuivoGlassCard } from '../../shared/components/quivo-glass-card';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { MapErrorBoundary } from './map-error-boundary';
import { proximoPuntoControlPendiente } from './proximo-punto-control';
import { RouteMapView } from './route-map-view';
import { TripControlSheet } from './trip-control-sheet';
import { useGpsOperativo } from './use-gps-operativo';
import { usePaqueteDia } from './use-paquete-dia';
import { useSyncStatus } from './use-sync-status';

interface OperationScreenProps {
  contexto: ContextoOperativoMovil;
  deviceId: string;
  aviso: string | null;
  loading: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => Promise<void>;
}

export function OperationScreen(props: OperationScreenProps) {
  const paqueteDia = usePaqueteDia(props.obtenerAccessToken);
  const { pendientes, errorSync } = useSyncStatus(props.obtenerAccessToken);
  const puntosControl = useMemo(
    () => paqueteDia.paquete?.puntosControl ?? [],
    [paqueteDia.paquete],
  );
  const gps = useGpsOperativo(props.contexto.sesionId, props.deviceId, puntosControl);
  const [completados, setCompletados] = useState<Set<string>>(new Set());
  const [observacion, setObservacion] = useState('');
  const [enviandoObservacion, setEnviandoObservacion] = useState(false);
  const [observacionEnviada, setObservacionEnviada] = useState(false);

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

  return (
    <View style={styles.container}>
      <MapLayer
        loading={paqueteDia.cargando}
        paquete={paqueteDia.paquete}
        nextPointId={proximoPuntoControl?.id ?? null}
        position={gps.posicionActual}
        tracking={gps.tracking}
      />

      <View pointerEvents="box-none" style={styles.topOverlay}>
        <DriverRouteCard contexto={props.contexto} tracking={gps.tracking} />
        {props.aviso ? <Text style={styles.notice}>{props.aviso}</Text> : null}
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
        {gps.ultimaDeteccion?.cumplido ? (
          <Text accessibilityLiveRegion="polite" style={styles.successNotice}>
            Punto de control registrado
          </Text>
        ) : null}
      </View>

      <TripControlSheet
        contexto={props.contexto}
        tracking={gps.tracking}
        gpsPoints={gps.puntos}
        completedPoints={completados.size}
        totalPoints={puntosControl.length}
        nextPointOrder={proximoPuntoControl?.orden ?? null}
        pendingEvents={pendientes}
        canStart={!paqueteDia.vencido && Boolean(paqueteDia.paquete)}
        gpsError={gps.errorGps}
        syncError={errorSync}
        loading={props.loading}
        observation={observacion}
        sendingObservation={enviandoObservacion}
        observationSent={observacionEnviada}
        onObservationChange={(value) => {
          setObservacion(value);
          setObservacionEnviada(false);
        }}
        onSendObservation={() => void enviarObservacion()}
        onStart={() => void gps.iniciar()}
        onFinish={confirmarFinalizacion}
        onLogout={() => void props.onLogout()}
      />
    </View>
  );
}

function DriverRouteCard({
  contexto,
  tracking,
}: {
  contexto: ContextoOperativoMovil;
  tracking: boolean;
}) {
  return (
    <QuivoGlassCard style={styles.identityCard} contentStyle={styles.identityCardContent}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(contexto.conductor.nombre)}</Text>
      </View>
      <View style={styles.identityText}>
        <Text numberOfLines={2} style={styles.driverName}>
          {contexto.conductor.nombre}
        </Text>
        <Text numberOfLines={1} style={styles.vehicleText}>
          {contexto.vehiculo.placa} · {contexto.vehiculo.marca} {contexto.vehiculo.modelo}
        </Text>
      </View>
      <View style={styles.routeBadge}>
        <Text style={styles.lineCode}>{contexto.linea.codigo}</Text>
        <Text style={styles.gpsStatus}>{tracking ? 'GPS ACTIVO' : 'EN ESPERA'}</Text>
      </View>
    </QuivoGlassCard>
  );
}

function MapLayer({
  loading,
  paquete,
  nextPointId,
  position,
  tracking,
}: {
  loading: boolean;
  paquete: PaqueteDia | null;
  nextPointId: string | null;
  position: { lat: number; lng: number } | null;
  tracking: boolean;
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
    minHeight: 72,
  },
  identityCardContent: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    padding: quivoSpacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: quivoRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: quivoColors.primary,
  },
  avatarText: { color: quivoColors.white, fontFamily: quivoFonts.displayBold, fontSize: 15 },
  identityText: { flex: 1, minWidth: 0 },
  driverName: { color: quivoColors.text, fontFamily: quivoFonts.bodySemiBold, fontSize: 14 },
  vehicleText: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 10,
    marginTop: quivoSpacing.xs,
  },
  routeBadge: { alignItems: 'flex-end', justifyContent: 'center' },
  lineCode: { color: quivoColors.primary, fontFamily: quivoFonts.displayBold, fontSize: 23 },
  gpsStatus: {
    color: quivoColors.success,
    fontFamily: quivoFonts.displayBold,
    fontSize: 8,
    letterSpacing: 0.5,
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
});
