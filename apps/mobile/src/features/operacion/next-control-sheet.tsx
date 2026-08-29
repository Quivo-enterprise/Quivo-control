import { useRef, useState } from 'react';
import { Animated, Linking, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolverMarcaLinea, type ContextoOperativoMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { formatHoraBolivia } from '../../shared/format-hora';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { formatearDistancia } from './format-distancia';

const NUMERO_EMERGENCIAS = '911';

export interface NextControlSheetProps {
  contexto: ContextoOperativoMovil;
  tracking: boolean;
  nextPointOrder: number | null;
  totalPoints: number;
  distanciaMetros: number | null;
  pendingEvents: number;
  isOffline?: boolean;
  isSyncing?: boolean;
  canStart: boolean;
  gpsError: string | null;
  onStart: () => void;
  onFinish: () => void;
  panY: Animated.Value;
}

export function NextControlSheet(props: NextControlSheetProps) {
  const sinPuntosControl = props.totalPoints === 0;
  const isFinished = props.tracking && !sinPuntosControl && props.nextPointOrder === null;
  const listoParaIniciar = !props.tracking && props.canStart;
  const turno = labelTurno(props.contexto.asignacion.horario);
  const sentido = labelSentido(props.contexto.ruta.sentido);
  const horaSalida = formatHoraBolivia(props.contexto.asignacion.horaSalida);
  const horaPresentacion = formatHoraBolivia(props.contexto.asignacion.horaPresentacion);
  const marca = resolverMarcaLinea(props.contexto.linea);

  const { panY } = props;
  const [minimized, setMinimized] = useState(false);
  const [confirmarEmergencia, setConfirmarEmergencia] = useState(false);
  const snapOffset = 80; // Adjusted so the title is still visible when minimized

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderMove: (_, gestureState) => {
        if (!minimized && gestureState.dy > 0) {
          panY.setValue(Math.min(gestureState.dy, snapOffset));
        } else if (minimized && gestureState.dy < 0) {
          panY.setValue(Math.max(snapOffset + gestureState.dy, 0));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (!minimized && gestureState.dy > 50) {
          Animated.spring(panY, {
            toValue: snapOffset,
            useNativeDriver: true,
          }).start(() => setMinimized(true));
        } else if (minimized && gestureState.dy < -50) {
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
          }).start(() => setMinimized(false));
        } else {
          Animated.spring(panY, {
            toValue: minimized ? snapOffset : 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.sheet, { borderTopColor: marca.primary, transform: [{ translateY: panY }] }]}
    >
      <View style={styles.dragArea} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
      </View>

      <View style={styles.headerRow}>
        <Text
          style={[styles.title, { color: marca.primary }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {isFinished
            ? 'Recorrido finalizado'
            : listoParaIniciar
              ? 'Ruta lista para iniciar'
              : sinPuntosControl
                ? 'Recorrido en curso'
                : props.tracking
                  ? `Próximo control · #${(props.nextPointOrder ?? 0) + 1}`
                  : 'Preparando tu ruta'}
        </Text>

        {props.pendingEvents > 0 && (
          <View
            style={[
              styles.badge,
              props.isOffline ? styles.badgeOffline : null,
              props.isSyncing ? styles.badgeSyncing : null,
            ]}
          >
            <Text style={styles.badgeText} numberOfLines={1}>
              {props.isSyncing
                ? `Sincronizando...`
                : props.isOffline
                  ? `${props.pendingEvents} pendientes (local)`
                  : `${props.pendingEvents} pendientes`}
            </Text>
          </View>
        )}
      </View>

      {listoParaIniciar && (
        <View
          accessibilityRole="text"
          accessibilityLabel={`Ruta lista. ${turno}. Línea ${props.contexto.linea.codigo}, sentido ${sentido}.${horaSalida ? ` Salida programada a las ${horaSalida}.` : ''}`}
          style={[styles.readyCard, { borderColor: marca.secondary }]}
        >
          <View style={styles.readyIcon}>
            <Ionicons name="checkmark-circle" size={30} color={quivoColors.success} />
          </View>
          <View style={styles.readyCopy}>
            <Text style={[styles.readyEyebrow, { color: marca.primary }]}>
              RUTA CARGADA · {turno.toUpperCase()}
            </Text>
            <Text style={styles.readyTitle}>Es hora de iniciar tu recorrido</Text>
            {horaSalida ? (
              <Text style={styles.readySchedule}>
                {horaPresentacion ? `Preséntate ${horaPresentacion} · ` : ''}Salida programada{' '}
                {horaSalida}
              </Text>
            ) : null}
            <Text style={styles.readyDescription}>
              {props.contexto.linea.codigo} · {sentido}. Presiona el botón para activar el GPS.
            </Text>
          </View>
        </View>
      )}

      {props.tracking && !isFinished && !sinPuntosControl && (
        <View style={styles.locationContainer}>
          <Ionicons name="location" size={20} color={marca.primary} style={styles.locationIcon} />
          <View style={styles.locationTextContainer}>
            <Text style={styles.address}>
              Punto de control · #{(props.nextPointOrder ?? 0) + 1}
            </Text>
            <View style={styles.distanceRow}>
              <Text style={styles.distance}>
                {props.distanciaMetros === null
                  ? 'Calculando distancia…'
                  : `A ${formatearDistancia(props.distanciaMetros)} de tu ubicación`}
              </Text>
              <MiniStepper
                currentOrder={(props.nextPointOrder ?? 0) + 1}
                totalPoints={props.totalPoints}
              />
            </View>
          </View>
        </View>
      )}

      {props.gpsError && <Text style={styles.error}>{props.gpsError}</Text>}

      <View style={styles.actions}>
        <Button
          variant={props.tracking ? 'danger' : 'primary'}
          disabled={!props.tracking && !props.canStart}
          onPress={props.tracking ? props.onFinish : props.onStart}
          style={[
            styles.mainButton,
            !props.tracking ? { backgroundColor: marca.primary, borderColor: marca.primary } : {},
          ]}
        >
          {props.tracking ? 'Finalizar recorrido' : 'Iniciar recorrido'}
        </Button>
        {props.tracking && (
          <Pressable
            style={styles.emergencyIconButton}
            onPress={() => setConfirmarEmergencia(true)}
            accessibilityLabel="Llamada de emergencia"
            accessibilityRole="button"
          >
            <Ionicons name="call" size={20} color={quivoColors.danger} />
          </Pressable>
        )}
      </View>

      <QuivoConfirmDialog
        visible={confirmarEmergencia}
        variant="danger"
        icon="call"
        title="¿Llamar a emergencias?"
        message={`Se abrirá el marcador de tu teléfono con el número de emergencias (${NUMERO_EMERGENCIAS}).`}
        cancelLabel="Cancelar"
        confirmLabel="Llamar"
        onCancel={() => setConfirmarEmergencia(false)}
        onConfirm={() => {
          setConfirmarEmergencia(false);
          void Linking.openURL(`tel:${NUMERO_EMERGENCIAS}`);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: quivoSpacing.sm,
    right: quivoSpacing.sm,
    bottom: quivoSpacing.sm,
    backgroundColor: quivoColors.white,
    borderTopWidth: 4,
    borderRadius: quivoRadius.xl,
    paddingHorizontal: quivoSpacing.lg,
    paddingBottom: quivoSpacing.lg,
    paddingTop: quivoSpacing.sm,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 16,
    gap: quivoSpacing.md,
  },
  dragArea: {
    paddingVertical: quivoSpacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -quivoSpacing.md,
    marginBottom: -quivoSpacing.xs,
  },
  dragHandle: {
    width: 40,
    height: 5,
    backgroundColor: quivoColors.border,
    borderRadius: 2.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
  },
  readyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    backgroundColor: quivoColors.successSoft,
    borderColor: '#B6E6D0',
    borderRadius: quivoRadius.lg,
    borderWidth: 1,
    padding: quivoSpacing.md,
  },
  readyIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyCopy: {
    flex: 1,
    gap: quivoSpacing.xs,
  },
  readyEyebrow: {
    color: quivoColors.success,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  readyTitle: {
    color: quivoColors.text,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
  },
  readySchedule: {
    color: quivoColors.success,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 12,
  },
  readyDescription: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
  },
  badge: {
    backgroundColor: '#FFF0E5',
    paddingHorizontal: quivoSpacing.md,
    paddingVertical: 6,
    borderRadius: quivoRadius.pill,
    flexShrink: 1,
  },
  badgeOffline: {
    backgroundColor: '#FFE5C5',
    borderWidth: 1,
    borderColor: '#FFC480',
  },
  badgeSyncing: {
    backgroundColor: '#E5F6FF',
    borderWidth: 1,
    borderColor: '#99DBFF',
  },
  badgeText: {
    color: quivoColors.text,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 12,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: quivoSpacing.md,
  },
  locationIcon: {
    marginTop: 2,
  },
  locationTextContainer: {
    flex: 1,
  },
  address: {
    color: quivoColors.text,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
    marginBottom: 2,
  },
  distance: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: quivoSpacing.md,
    gap: quivoSpacing.sm,
  },
  mainButton: {
    flex: 1,
  },
  emergencyIconButton: {
    width: 48,
    height: 48,
    borderRadius: quivoRadius.md,
    backgroundColor: '#FFE5E5', // Soft red background
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyButton: {
    paddingVertical: quivoSpacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyButtonText: {
    color: quivoColors.danger,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 15,
  },
  error: {
    color: quivoColors.danger,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    textAlign: 'center',
  },
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperNodeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperLine: {
    width: 12,
    height: 2,
    backgroundColor: 'rgba(50, 38, 180, 0.2)',
  },
  stepperLineActive: {
    backgroundColor: quivoColors.success,
  },
  stepperDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(50, 38, 180, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperDotActive: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: quivoColors.success,
    shadowColor: quivoColors.success,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
});

function labelTurno(turno: ContextoOperativoMovil['asignacion']['horario']): string {
  return { manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }[turno];
}

function labelSentido(sentido: string): string {
  if (sentido === 'ida') return 'Ida';
  if (sentido === 'vuelta') return 'Vuelta';
  return sentido.charAt(0).toUpperCase() + sentido.slice(1);
}

function MiniStepper({ currentOrder, totalPoints }: { currentOrder: number; totalPoints: number }) {
  if (totalPoints === 0) return null;

  // currentOrder viene del backend en base-1 (1, 2, 3...)
  // Lo convertimos a base-0 para lógica de arrays internos
  const zeroBasedCurrent = Math.max(0, currentOrder - 1);

  const maxNodes = 4;
  // Paginación: avanzamos de a 4 nodos para que el usuario vea cómo se llenan las bolitas
  let startIdx = Math.floor(zeroBasedCurrent / maxNodes) * maxNodes;

  // Evitamos el problema de la "bolita solitaria"
  // Si la última página solo tendría 1 bolita, la fusionamos con la página anterior
  if (totalPoints - startIdx === 1 && startIdx > 0) {
    startIdx -= maxNodes;
  }

  const nodes = [];
  let limit = Math.min(totalPoints - startIdx, maxNodes);

  // Si fusionamos la página, el límite será maxNodes + 1 (ej: 5 bolitas en vez de 4)
  if (totalPoints - startIdx === maxNodes + 1) {
    limit = maxNodes + 1;
  }

  for (let i = 0; i < limit; i++) {
    const pointIdx = startIdx + i;
    nodes.push({
      idx: pointIdx,
      isPassed: pointIdx < zeroBasedCurrent,
    });
  }

  return (
    <View style={styles.stepperContainer}>
      {nodes.map((node, i) => (
        <View key={node.idx} style={styles.stepperNodeWrapper}>
          {i > 0 && (
            <View style={[styles.stepperLine, node.isPassed ? styles.stepperLineActive : null]} />
          )}
          <View style={[styles.stepperDot, node.isPassed ? styles.stepperDotActive : null]}>
            {node.isPassed && (
              <Ionicons
                name="checkmark"
                size={12}
                color={quivoColors.white}
                style={{ marginLeft: 1, marginTop: 1 }}
              />
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
