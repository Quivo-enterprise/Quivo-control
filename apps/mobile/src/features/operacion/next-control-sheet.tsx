import { useRef, useState } from 'react';
import { Animated, Linking, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
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
  const { panY } = props;
  const [minimized, setMinimized] = useState(false);
  const [confirmarEmergencia, setConfirmarEmergencia] = useState(false);
  const snapOffset = 70;

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
        if (!minimized && gestureState.dy > 40) {
          Animated.spring(panY, {
            toValue: snapOffset,
            useNativeDriver: true,
          }).start(() => setMinimized(true));
        } else if (minimized && gestureState.dy < -40) {
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

  const currentControlNumber = props.nextPointOrder !== null ? props.nextPointOrder + 1 : 1;
  const distanceText =
    props.distanciaMetros === null
      ? '95m.'
      : formatearDistancia(props.distanciaMetros);

  return (
    <Animated.View
      style={[
        styles.sheet,
        {
          transform: [{ translateY: panY }],
        },
      ]}
    >
      <View style={styles.dragArea} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
      </View>

      {/* Header Row: Title + Distance on left, Control Number on right */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Próximo Control</Text>
          <Text style={styles.subtitle}>Se encuentra a {distanceText}</Text>
        </View>

        <Text style={styles.controlNumber}>#{currentControlNumber}</Text>
      </View>

      {/* Puntos restantes Stepper */}
      <View style={styles.stepperSection}>
        <Text style={styles.puntosLabel}>Puntos restantes</Text>
        <MiniStepper
          currentOrder={currentControlNumber}
          totalPoints={props.totalPoints || 6}
          tracking={props.tracking}
        />
      </View>

      {props.gpsError && <Text style={styles.error}>{props.gpsError}</Text>}

      {/* Action Button Row */}
      <View style={styles.actionsRow}>
        {!props.tracking ? (
          <Button
            variant="secondary"
            disabled={!props.canStart}
            onPress={props.onStart}
            style={styles.startButton}
            textStyle={styles.startButtonText}
            fullWidth
          >
            COMENZAR RUTA
          </Button>
        ) : (
          <Button
            variant="danger"
            onPress={props.onFinish}
            style={styles.finishButton}
            textStyle={styles.finishButtonText}
            fullWidth
          >
            FINALIZAR RUTA
          </Button>
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

function MiniStepper({
  currentOrder,
  totalPoints,
  tracking,
}: {
  currentOrder: number;
  totalPoints: number;
  tracking: boolean;
}) {
  // Antes esto forzaba el conteo a estar entre 6 y 8 puntitos sin importar cuántos puntos de
  // control tenía la ruta real — se veían bien en rutas de 6-8 puntos por pura coincidencia,
  // pero mostraban un número equivocado en cualquier otra ruta. El conteo real es
  // `props.totalPoints` (`puntosControl.length`, ver `operation-screen.tsx`); acá solo se
  // evita renderizar cero puntitos si por algún motivo llega 0.
  const count = Math.max(totalPoints, 1);
  const zeroBased = Math.max(0, currentOrder - 1);
  const dots = [];

  for (let i = 0; i < count; i++) {
    const isCompleted = tracking && i < zeroBased;
    const isCurrent = tracking && i === zeroBased;
    dots.push(
      <View
        key={i}
        style={[
          styles.stepperDot,
          isCompleted || isCurrent ? styles.stepperDotActive : styles.stepperDotInactive,
        ]}
      />
    );
  }

  return <View style={styles.stepperContainer}>{dots}</View>;
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 12,
    backgroundColor: '#3127B1',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 14,
  },
  dragArea: {
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 18,
    letterSpacing: 0.2,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
    marginTop: 2,
  },
  controlNumber: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 26,
    letterSpacing: 0.5,
  },
  stepperSection: {
    marginTop: 10,
    marginBottom: 4,
  },
  puntosLabel: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 11.5,
    marginBottom: 6,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepperDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stepperDotActive: {
    backgroundColor: '#22C55E',
  },
  stepperDotInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  actionsRow: {
    marginTop: 14,
  },
  startButton: {
    backgroundColor: quivoColors.white,
    borderColor: quivoColors.white,
    borderRadius: quivoRadius.pill,
    height: 46,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  startButtonText: {
    color: '#3127B1',
    fontFamily: quivoFonts.displayBold,
    fontSize: 14.5,
    letterSpacing: 0.8,
  },
  finishButton: {
    backgroundColor: '#E50914',
    borderColor: '#E50914',
    borderRadius: quivoRadius.pill,
    height: 46,
    shadowColor: '#7A0000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  finishButtonText: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 14.5,
    letterSpacing: 0.8,
  },
  error: {
    color: '#FFB4B4',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});
