import { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
import { formatearDistancia } from './format-distancia';

export interface NextControlSheetProps {
  contexto: ContextoOperativoMovil;
  tracking: boolean;
  nextPointOrder: number | null;
  totalPoints: number;
  distanciaMetros: number | null;
  pendingEvents: number;
  canStart: boolean;
  gpsError: string | null;
  onStart: () => void;
  onFinish: () => void;
  panY: Animated.Value;
}

export function NextControlSheet(props: NextControlSheetProps) {
  const sinPuntosControl = props.totalPoints === 0;
  const isFinished = props.tracking && !sinPuntosControl && props.nextPointOrder === null;

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
        <Text style={styles.title}>
          {isFinished
            ? 'Recorrido finalizado'
            : sinPuntosControl
              ? 'Recorrido en curso'
              : `Próximo control · #${(props.nextPointOrder ?? 0) + 1}`}
        </Text>

        {props.pendingEvents > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{props.pendingEvents} pendientes</Text>
          </View>
        )}
      </View>

      {!isFinished && !sinPuntosControl && (
        <View style={styles.locationContainer}>
          <Ionicons name="location" size={20} color={quivoColors.primary} style={styles.locationIcon} />
          <View style={styles.locationTextContainer}>
            <Text style={styles.address}>Punto de control · #{(props.nextPointOrder ?? 0) + 1}</Text>
            <Text style={styles.distance}>
              {props.distanciaMetros === null
                ? 'Calculando distancia…'
                : `A ${formatearDistancia(props.distanciaMetros)} de tu ubicación`}
            </Text>
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
});
