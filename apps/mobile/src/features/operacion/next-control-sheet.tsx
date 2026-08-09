import { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';

export interface NextControlSheetProps {
  contexto: ContextoOperativoMovil;
  tracking: boolean;
  nextPointOrder: number | null;
  totalPoints: number;
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
  const isFinished = props.nextPointOrder === null && props.tracking;
  
  const { panY } = props;
  const [minimized, setMinimized] = useState(false);
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
    })
  ).current;
  
  return (
    <Animated.View style={[styles.sheet, { transform: [{ translateY: panY }] }]}>
      <View style={styles.dragArea} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
      </View>
      
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
          {isFinished
            ? 'Recorrido finalizado'
            : `Próximo control · #${props.nextPointOrder ?? 1}`}
        </Text>
        
        {props.pendingEvents > 0 && (
          <View style={[styles.badge, props.isOffline ? styles.badgeOffline : null, props.isSyncing ? styles.badgeSyncing : null]}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {props.isSyncing 
                ? `Sincronizando...`
                : props.isOffline 
                  ? `${props.pendingEvents} pendientes (local)`
                  : `${props.pendingEvents} pendientes`
              }
            </Text>
          </View>
        )}
      </View>
      
      {!isFinished && (
        <View style={styles.locationContainer}>
          <Ionicons name="location" size={20} color={quivoColors.primary} style={styles.locationIcon} />
          <View style={styles.locationTextContainer}>
            <Text style={styles.address}>Av. 6 de Agosto & Héroes del Acre</Text>
            <View style={styles.distanceRow}>
              <Text style={styles.distance}>
                {props.tracking ? 'A 120 m · ~3 min aprox.' : 'A 120 m de tu ubicación'}
              </Text>
              <MiniStepper currentOrder={props.nextPointOrder ?? 0} totalPoints={props.totalPoints} />
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
          style={styles.mainButton}
        >
          {props.tracking ? 'Finalizar recorrido' : 'Iniciar recorrido'}
        </Button>
        {props.tracking && (
          <Pressable
            style={styles.emergencyIconButton}
            onPress={() => {}}
            accessibilityLabel="Llamada de emergencia"
            accessibilityRole="button"
          >
            <Ionicons name="call" size={20} color={quivoColors.danger} />
          </Pressable>
        )}
      </View>
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
          {i > 0 && <View style={[styles.stepperLine, node.isPassed ? styles.stepperLineActive : null]} />}
          <View style={[
            styles.stepperDot,
            node.isPassed ? styles.stepperDotActive : null
          ]}>
            {node.isPassed && (
              <Ionicons name="checkmark" size={12} color={quivoColors.white} style={{ marginLeft: 1, marginTop: 1 }} />
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
