import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { Button } from '../../shared/components/Button';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { quivoColors, quivoFonts, quivoRadius } from '../../shared/theme/quivo-theme';
import { formatearDistancia } from './format-distancia';
import type { FaseControl } from '../jornada/fase-control';
import { subtituloJornada } from '../jornada/jornada-store-core';

const NUMERO_EMERGENCIAS = '911';

/** Separación (dp) entre el sheet y el borde inferior de la pantalla (`styles.sheet.bottom`). */
export const MARGEN_INFERIOR_SHEET = 12;

/** Aire (dp) bajo la cabecera cuando el sheet está colapsado: la franja visible es la cabecera
 * (asa + "Próximo Control" + distancia + "#N") más este respiro, así nada queda cortado a la mitad. */
const AIRE_BAJO_CABECERA = 14;

// Entrega 4 (`docs/plan-correccion-post-piloto-2026-09-09.md`, `docs/estados-red-vs-captura.md`):
// esta interfaz tenía `pendingEvents`/`isOffline`/`isSyncing` — ninguno se leía en el render
// de abajo (quedaron de un pasaje anterior sin uso real), y son señales de TRANSPORTE que el
// principio rector prohíbe en cualquier widget de la pantalla del chofer. Se sacan acá para
// que `operation-screen.tsx` no tenga que seguir calculándolas solo para pasarlas sin efecto.
export interface NextControlSheetProps {
  contexto: ContextoOperativoMovil;
  /** Fase del control principal: EMPEZAR DÍA → COMENZAR RUTA → FINALIZAR RUTA. */
  fase: FaseControl;
  /** Declara el día (`inicio_jornada`). No depende de GPS ni de `canStart`; nunca rechaza. */
  onEmpezarDia: () => Promise<void>;
  /** `true` mientras `onEmpezarDia` está en curso (spinner y botón bloqueado). */
  empezandoDia?: boolean;
  /** Error del último intento de empezar el día; se muestra junto al botón. */
  errorEmpezarDia?: string | null;
  /** `false` si la asignación no es la de hoy (vencida) o aún carga: el servidor rechazaría la
   * declaración, así que EMPEZAR DÍA se deshabilita. */
  puedeEmpezarDia?: boolean;
  /** `true` mientras se lee el almacenamiento local de la jornada: la zona de acción muestra un
   * placeholder neutro en vez de destellar EMPEZAR DÍA y luego COMENZAR RUTA. */
  jornadaCargando?: boolean;
  nextPointOrder: number | null;
  totalPoints: number;
  distanciaMetros: number | null;
  canStart: boolean;
  gpsError: string | null;
  onStart: () => void;
  onFinish: () => void;
  panY: Animated.Value;
  /** Alto (dp, redondeado) del sheet expandido, medido en el layout de su raíz. */
  onAlto?: (alto: number) => void;
  /** Alto (dp) que el sheet ocupa HOY medido desde el borde inferior de la pantalla, margen
   * incluido: expandido = alto completo + margen; colapsado = cabecera + aire + margen. Se avisa
   * al terminar cada snap (no cuadro a cuadro) y solo si cambió. La pantalla lo usa para que el
   * vehículo en navegación quede por encima del sheet. */
  onAltoVisible?: (alto: number) => void;
}

export function NextControlSheet(props: NextControlSheetProps) {
  const { panY, onAlto, onAltoVisible } = props;
  const [confirmarEmergencia, setConfirmarEmergencia] = useState(false);
  const { fase, onEmpezarDia, empezandoDia = false, puedeEmpezarDia = true } = props;
  const tracking = fase === 'recorrido';
  // Con `tracking` la fase 'recorrido' manda de inmediato; si no, mientras se lee la jornada
  // no se sabe aún si toca EMPEZAR DÍA o COMENZAR RUTA.
  const cargandoJornada = Boolean(props.jornadaCargando) && !tracking;
  const cabeceraJornada = fase === 'jornada' && !cargandoJornada;

  // El sheet arranca EXPANDIDO y solo se colapsa cuando el conductor lo arrastra hacia abajo (no
  // hay colapso automático al iniciar la ruta: cortaba FINALIZAR RUTA a la mitad). Todo el estado
  // del snap vive en refs porque el `PanResponder` se crea UNA vez y cerraría sobre valores viejos:
  // - `minimizedRef`: ¿está colapsado? (se confirma al terminar el spring).
  // - `altoSheetRef` / `altoCabeceraRef`: medidas reales (onLayout).
  // - `offsetRef`: cuánto baja el sheet colapsado = alto del sheet - (cabecera + aire), de modo que
  //   quede visible exactamente la franja de la cabecera.
  const minimizedRef = useRef(false);
  // - `objetivoColapsadoRef`: snap DESTINO del último `animarA` (se fija al arrancar el spring, no
  //   al terminar). Sirve para reajustar el offset si las medidas cambian con un spring en vuelo.
  const objetivoColapsadoRef = useRef(false);
  const altoSheetRef = useRef(0);
  const altoCabeceraRef = useRef(0);
  const offsetRef = useRef(0);
  const altoVisibleEmitidoRef = useRef<number | null>(null);
  const onAltoVisibleRef = useRef(onAltoVisible);
  onAltoVisibleRef.current = onAltoVisible;

  const emitirAltoVisible = useCallback(() => {
    if (altoSheetRef.current <= 0) return;
    const visible = Math.max(
      0,
      altoSheetRef.current + MARGEN_INFERIOR_SHEET - (minimizedRef.current ? offsetRef.current : 0),
    );
    if (visible === altoVisibleEmitidoRef.current) return;
    altoVisibleEmitidoRef.current = visible;
    onAltoVisibleRef.current?.(visible);
  }, []);

  // Anima al snap y, SOLO si el spring terminó (no fue interrumpido por otro gesto), confirma el
  // estado y avisa el alto visible.
  const animarA = useCallback(
    (destino: number, minimizado: boolean) => {
      objetivoColapsadoRef.current = minimizado;
      Animated.spring(panY, { toValue: destino, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        minimizedRef.current = minimizado;
        emitirAltoVisible();
      });
    },
    [panY, emitirAltoVisible],
  );

  // Recalcula el offset colapsado con las medidas actuales. Si el destino es colapsado (spring en
  // vuelo o ya terminado) y el offset cambió (p. ej. apareció una línea de error y el sheet creció), vuelve a hacer snap al offset
  // nuevo; si no, solo reporta el alto visible.
  const recalcularSnap = useCallback(() => {
    const alto = altoSheetRef.current;
    const cabecera = altoCabeceraRef.current;
    if (alto <= 0 || cabecera <= 0) return;
    const nuevo = Math.max(0, Math.round(alto - (cabecera + AIRE_BAJO_CABECERA)));
    const cambio = nuevo !== offsetRef.current;
    offsetRef.current = nuevo;
    if (objetivoColapsadoRef.current && cambio) animarA(nuevo, true);
    else emitirAltoVisible();
  }, [animarA, emitirAltoVisible]);

  const onLayoutSheet = (e: LayoutChangeEvent) => {
    const alto = Math.round(e.nativeEvent.layout.height);
    if (alto === altoSheetRef.current) return;
    altoSheetRef.current = alto;
    onAlto?.(alto);
    recalcularSnap();
  };

  // Cabecera = asa + título/distancia/"#N", medida desde el borde superior del sheet (incluye su
  // padding superior): `y + height` es todo lo que debe seguir visible al colapsar.
  const onLayoutCabecera = (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    const alto = Math.round(y + height);
    if (alto === altoCabeceraRef.current) return;
    altoCabeceraRef.current = alto;
    recalcularSnap();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderMove: (_, gestureState) => {
        const offset = offsetRef.current;
        if (!minimizedRef.current && gestureState.dy > 0) {
          panY.setValue(Math.min(gestureState.dy, offset));
        } else if (minimizedRef.current && gestureState.dy < 0) {
          panY.setValue(Math.max(offset + gestureState.dy, 0));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const offset = offsetRef.current;
        const minimizado = minimizedRef.current;
        if (offset <= 0) return; // sin medidas todavía: nada que colapsar.
        if (!minimizado && gestureState.dy > 40) {
          animarA(offset, true);
        } else if (minimizado && gestureState.dy < -40) {
          animarA(0, false);
        } else if (minimizado && Math.abs(gestureState.dy) < 8 && Math.abs(gestureState.dx) < 8) {
          // Toque simple sobre la franja colapsada: expande (la franja es chica y arrastrar es difícil).
          animarA(0, false);
        } else {
          animarA(minimizado ? offset : 0, minimizado);
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
      onLayout={onLayoutSheet}
      style={[
        styles.sheet,
        {
          transform: [{ translateY: panY }],
        },
      ]}
    >
      {/* Cabecera: asa + título. Es lo único que queda visible al colapsar y la zona de arrastre. */}
      <View onLayout={onLayoutCabecera} {...panResponder.panHandlers}>
        <View style={styles.dragArea}>
          <View style={styles.dragHandle} />
        </View>

        {cabeceraJornada ? (
          <View style={styles.headerRow}>
            <View style={styles.jornadaIcono}>
              <Ionicons name="sunny-outline" size={22} color={quivoColors.warningText} />
            </View>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Día sin iniciar</Text>
              <Text style={styles.subtitle}>
                {subtituloJornada(props.contexto.linea.codigo, props.totalPoints)}
              </Text>
            </View>
          </View>
        ) : (
          // Title + Distance on left, Control Number on right
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Próximo Control</Text>
              <Text style={styles.subtitle}>Se encuentra a {distanceText}</Text>
            </View>

            <Text style={styles.controlNumber}>#{currentControlNumber}</Text>
          </View>
        )}
      </View>

      {/* Puntos restantes Stepper */}
      {!cabeceraJornada && (
        <View style={styles.stepperSection}>
          <Text style={styles.puntosLabel}>Puntos restantes</Text>
          <MiniStepper
            currentOrder={currentControlNumber}
            totalPoints={props.totalPoints || 6}
            tracking={tracking}
          />
        </View>
      )}

      {props.gpsError && <Text style={styles.error}>{props.gpsError}</Text>}

      {/* Action Button Row */}
      <View style={styles.actionsRow}>
        {cargandoJornada ? (
          <View style={styles.cargandoJornada}>
            <ActivityIndicator color={quivoColors.white} size="small" />
          </View>
        ) : fase === 'jornada' ? (
          <>
            <Button
              variant="accent"
              loading={empezandoDia}
              disabled={!puedeEmpezarDia || empezandoDia}
              onPress={() => void onEmpezarDia()}
              style={styles.empezarButton}
              textStyle={styles.empezarButtonText}
              leftIcon={<Ionicons name="sunny" size={22} color={quivoColors.text} />}
              accessibilityHint="Avisa a tu delegado que hoy trabajas"
              fullWidth
            >
              EMPEZAR DÍA
            </Button>
            {props.errorEmpezarDia ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {props.errorEmpezarDia}
              </Text>
            ) : null}
            <View style={styles.hintRow}>
              <Ionicons name="notifications-outline" size={16} color="#FFD28A" />
              <Text style={styles.hintText}>Avisa a tu delegado que hoy trabajas</Text>
            </View>
            <Button
              variant="ghost"
              disabled
              style={styles.lockedButton}
              textStyle={styles.lockedButtonText}
              leftIcon={<Ionicons name="lock-closed" size={18} color="rgba(255, 255, 255, 0.82)" />}
              accessibilityHint="Disponible después de empezar el día"
              fullWidth
            >
              COMENZAR RUTA
            </Button>
          </>
        ) : fase === 'listo' ? (
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
            variant="ghost"
            onPress={props.onFinish}
            style={styles.finishButton}
            textStyle={styles.finishButtonText}
            leftIcon={<Ionicons name="stop-circle-outline" size={20} color={quivoColors.white} />}
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
    bottom: MARGEN_INFERIOR_SHEET,
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
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
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
    backgroundColor: 'transparent',
    borderColor: 'rgba(255, 255, 255, 0.6)',
    borderWidth: 2,
    borderRadius: quivoRadius.pill,
    height: 46,
  },
  finishButtonText: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 14.5,
    letterSpacing: 0.8,
  },
  jornadaIcono: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: quivoColors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  empezarButton: {
    backgroundColor: quivoColors.accent,
    borderColor: quivoColors.accent,
    borderRadius: quivoRadius.pill,
    height: 56,
    shadowColor: quivoColors.accentStrong,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  empezarButtonText: {
    color: quivoColors.text,
    fontFamily: quivoFonts.displayBold,
    fontSize: 17,
    letterSpacing: 1,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 10,
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
  },
  lockedButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderStyle: 'dashed',
    borderWidth: 1.5,
    borderRadius: quivoRadius.pill,
    height: 48,
  },
  lockedButtonText: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontFamily: quivoFonts.displayBold,
    fontSize: 14.5,
    letterSpacing: 0.8,
  },
  cargandoJornada: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#FFB4B4',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});
