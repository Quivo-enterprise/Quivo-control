import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { FaseControl } from '../jornada/fase-control';
import { subtituloJornada } from '../jornada/jornada-store-core';
import type { EstadoPuntoVuelta } from './progreso-vuelta';
import { FilaSalidaCard } from '../fila-salida/fila-salida-card';
import type { FilaSalidaUi } from '../fila-salida/use-fila-salida';

const NUMERO_EMERGENCIAS = '911';

/** Separación (dp) entre el sheet y el borde inferior de la pantalla (`styles.sheet.bottom`). */
export const MARGEN_INFERIOR_SHEET = 12;

/** Aire (dp) bajo la cabecera, DENTRO del contenedor táctil de la cabecera: la franja visible al
 * colapsar es la cabecera (asa + "Próximo Control" + distancia + "#N") más este respiro, y toda ella
 * es zona de arrastre/toque. */
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
  /** Estado de cada punto en el orden ROTADO de la vuelta (inicio primero), para el stepper
   * (`ordenEfectivoPuntos` → `derivarProgresoEstaticoEnOrden` → `conProximo`, RF-GPS-054). */
  estadosPuntos: readonly EstadoPuntoVuelta[];
  /** Vuelta en curso ("Vuelta N"). */
  vueltaActual: number;
  /** Puntos pasados / omitidos: solo alimentan la etiqueta accesible del stepper (no se muestran). */
  puntosPasados: number;
  puntosOmitidos: number;
  /** Hay designación a Molinos vigente: muestra la píldora "Vía Molinos" bajo el título. */
  viaMolinos?: boolean;
  canStart: boolean;
  gpsError: string | null;
  onStart: () => void;
  /** Termina el día (cierre completo: recorrido, envío y logout, tras confirmar). Con la ruta en curso es la acción secundaria. */
  onFinish: () => void;
  /** Inicio (ISO) de la pausa del recorrido; `null` = en marcha. */
  pausadoDesde?: string | null;
  onPause?: () => void;
  onResume?: () => void;
  /** Fila de salida de la terminal (tarjeta + SALIR); solo se dibuja con el recorrido activo. */
  filaSalida?: FilaSalidaUi;
  panY: Animated.Value;
  /** Alto (dp, redondeado) del sheet expandido, medido en el layout de su raíz. */
  onAlto?: (alto: number) => void;
  /** Alto (dp) que el sheet ocupa HOY medido desde el borde inferior de la pantalla, margen
   * incluido: expandido = alto completo + margen; colapsado = cabecera con su aire (el sheet baja
   * hasta dejar justo esa franja sobre el borde de la pantalla). Se avisa con el DESTINO al ARRANCAR
   * cada snap (no cuadro a cuadro, no al terminar) y solo si cambió, así la cámara del mapa se
   * mueve junto con el sheet. La pantalla lo usa para que el vehículo en navegación quede por
   * encima del sheet. */
  onAltoVisible?: (alto: number) => void;
}

export function NextControlSheet(props: NextControlSheetProps) {
  const { panY, onAlto, onAltoVisible } = props;
  const [confirmarEmergencia, setConfirmarEmergencia] = useState(false);
  const [confirmarPausa, setConfirmarPausa] = useState(false);
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
  // - `offsetRef`: cuánto baja el sheet colapsado = alto del sheet + margen inferior - cabecera (con
  //   su aire), de modo que quede visible desde el borde de la pantalla exactamente la franja de la
  //   cabecera y nada de lo que hay debajo (stepper) asome.
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

  // Alto visible del DESTINO (`minimizado`), no del estado confirmado: se avisa al arrancar el snap.
  const emitirAltoVisible = useCallback((minimizado: boolean) => {
    if (altoSheetRef.current <= 0) return;
    const visible = Math.max(
      0,
      altoSheetRef.current + MARGEN_INFERIOR_SHEET - (minimizado ? offsetRef.current : 0),
    );
    if (visible === altoVisibleEmitidoRef.current) return;
    altoVisibleEmitidoRef.current = visible;
    onAltoVisibleRef.current?.(visible);
  }, []);

  // Anima al snap y avisa el alto visible del destino ya al arrancar; SOLO si el spring terminó (no
  // fue interrumpido por otro gesto) confirma `minimizedRef` para los handlers del arrastre.
  const animarA = useCallback(
    (destino: number, minimizado: boolean) => {
      objetivoColapsadoRef.current = minimizado;
      emitirAltoVisible(minimizado);
      Animated.spring(panY, { toValue: destino, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        minimizedRef.current = minimizado;
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
    const nuevo = Math.max(0, Math.round(alto + MARGEN_INFERIOR_SHEET - cabecera));
    const cambio = nuevo !== offsetRef.current;
    offsetRef.current = nuevo;
    if (objetivoColapsadoRef.current && cambio) animarA(nuevo, true);
    else emitirAltoVisible(objetivoColapsadoRef.current);
  }, [animarA, emitirAltoVisible]);

  const onLayoutSheet = (e: LayoutChangeEvent) => {
    const alto = Math.round(e.nativeEvent.layout.height);
    if (alto === altoSheetRef.current) return;
    altoSheetRef.current = alto;
    onAlto?.(alto);
    recalcularSnap();
  };

  // Cabecera = asa + título/distancia/"#N" + aire, medida desde el borde superior del sheet (incluye
  // su padding superior): `y + height` es todo lo que debe seguir visible al colapsar.
  const onLayoutCabecera = (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    const alto = Math.round(y + height);
    if (alto === altoCabeceraRef.current) return;
    altoCabeceraRef.current = alto;
    recalcularSnap();
  };

  // Última posición (`panY`) fijada por el arrastre en curso; `null` si aún no se movió.
  const ultimoYRef = useRef<number | null>(null);

  // Si la fase cambia (ruta terminada de cualquier forma: FINALIZAR, error de GPS, remount) y el sheet
  // está colapsado o colapsando, vuelve a expandirse: el control principal tiene que quedar a la
  // vista. Nunca se colapsa solo.
  useEffect(() => {
    if (objetivoColapsadoRef.current || minimizedRef.current) animarA(0, false);
  }, [fase, animarA]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        ultimoYRef.current = null;
      },
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderMove: (_, gestureState) => {
        const offset = offsetRef.current;
        if (!minimizedRef.current && gestureState.dy > 0) {
          ultimoYRef.current = Math.min(gestureState.dy, offset);
          panY.setValue(ultimoYRef.current);
        } else if (minimizedRef.current && gestureState.dy < 0) {
          ultimoYRef.current = Math.max(offset + gestureState.dy, 0);
          panY.setValue(ultimoYRef.current);
        }
      },
      // Otro responder (p. ej. el sistema) le quita el gesto: sin esto el sheet quedaría a medio
      // camino. Hace snap al estado más cercano a donde quedó.
      onPanResponderTerminationRequest: () => true,
      onPanResponderTerminate: () => {
        const offset = offsetRef.current;
        if (offset <= 0) return;
        const y = ultimoYRef.current ?? (objetivoColapsadoRef.current ? offset : 0);
        if (y > offset / 2) animarA(offset, true);
        else animarA(0, false);
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
      <View style={styles.cabecera} onLayout={onLayoutCabecera} {...panResponder.panHandlers}>
        <View style={styles.dragArea}>
          <View style={styles.dragHandle} />
        </View>

        {cabeceraJornada ? (
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Día sin iniciar</Text>
              <Text style={styles.subtitle}>
                {subtituloJornada(props.contexto.linea.codigo, props.totalPoints)}
              </Text>
            </View>
          </View>
        ) : (
          // Title on left, Control Number on right
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.tituloRow}>
                <Text style={styles.title}>Siguiente parada</Text>
                {tracking && (
                  <View style={styles.vueltaPill}>
                    <Text style={styles.vueltaPillTexto}>Vuelta {props.vueltaActual}</Text>
                  </View>
                )}
              </View>
              {props.viaMolinos ? (
                <View
                  style={styles.viaMolinosPill}
                  accessible
                  accessibilityLabel="Vía Molinos: Honduras, Molinos, Salomón Romero"
                >
                  <Ionicons name="trail-sign" size={13} color={quivoColors.primary} />
                  <Text numberOfLines={1} style={styles.viaMolinosPillText}>
                    Vía Molinos
                  </Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.controlNumber}>#{currentControlNumber}</Text>
          </View>
        )}
      </View>

      {/* Puntos restantes Stepper */}
      {!cabeceraJornada && (
        <View style={styles.stepperSection}>
          <MiniStepper
            estados={props.estadosPuntos}
            tracking={tracking}
            pasados={props.puntosPasados}
            omitidos={props.puntosOmitidos}
          />
        </View>
      )}

      {props.gpsError && <Text style={styles.error}>{props.gpsError}</Text>}

      {tracking && props.filaSalida ? <FilaSalidaCard fila={props.filaSalida} /> : null}

      {/* Action Button Row */}
      <View style={[styles.actionsRow, cabeceraJornada && styles.actionsRowSinStepper]}>
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
          </>
        ) : fase === 'listo' ? (
          <>
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
            <Button
              variant="ghost"
              onPress={props.onFinish}
              style={styles.finishButton}
              textStyle={styles.finishButtonText}
              leftIcon={<Ionicons name="stop-circle-outline" size={20} color={quivoColors.white} />}
              fullWidth
            >
              Terminar el día
            </Button>
          </>
        ) : (
          <>
            {props.pausadoDesde ? (
              <>
                <Text style={styles.hintText}>
                  En pausa desde{' '}
                  {new Date(props.pausadoDesde).toLocaleTimeString('es-BO', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </Text>
                <Button
                  variant="secondary"
                  onPress={props.onResume}
                  style={styles.startButton}
                  textStyle={styles.startButtonText}
                  accessibilityHint="Vuelves a aparecer como en recorrido"
                  fullWidth
                >
                  REANUDAR
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                // `vista` refleja el último estado conocido de la fila del propio trufi (se actualiza con la respuesta de llegada/salida y con el refresco); no es garantía.
                onPress={() => (props.filaSalida?.vista ? setConfirmarPausa(true) : props.onPause?.())}
                style={styles.finishButton}
                textStyle={styles.finishButtonText}
                leftIcon={<Ionicons name="pause-circle-outline" size={20} color={quivoColors.white} />}
                accessibilityHint="Pausa el recorrido; el GPS sigue activo"
                fullWidth
              >
                PAUSAR
              </Button>
            )}
            {props.pausadoDesde ? (
              <Button
                variant="ghost"
                onPress={props.onFinish}
                style={styles.finishButton}
                textStyle={styles.finishButtonText}
                leftIcon={<Ionicons name="stop-circle-outline" size={20} color={quivoColors.white} />}
                fullWidth
              >
                Terminar el día
              </Button>
            ) : null}
          </>
        )}
      </View>

      <QuivoConfirmDialog
        visible={confirmarPausa}
        variant="danger"
        icon="pause-circle"
        title="¿Pausar el recorrido?"
        message="Si pausás, perdés tu lugar en la fila. ¿Pausar igual?"
        cancelLabel="Cancelar"
        confirmLabel="Pausar"
        onCancel={() => setConfirmarPausa(false)}
        onConfirm={() => {
          setConfirmarPausa(false);
          props.onPause?.();
        }}
      />

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
  estados,
  tracking,
  pasados,
  omitidos,
}: {
  estados: readonly EstadoPuntoVuelta[];
  tracking: boolean;
  pasados: number;
  omitidos: number;
}) {
  // Un puntito por punto de control REAL de la ruta, en el orden rotado de la vuelta (el punto
  // donde arrancó va primero). Sin recorrido en curso todos se ven pendientes (ruta "virgen").
  // Con rutas largas los puntitos pasan a otra fila (`flexWrap`) en vez de salirse del sheet.
  const dots = estados.map((estado, i) => {
    const efectivo = tracking ? estado : 'pendiente';
    return (
      <View
        key={i}
        style={[
          styles.stepperDot,
          efectivo === 'pasado' && styles.stepperDotPasado,
          efectivo === 'omitido' && styles.stepperDotOmitido,
          efectivo === 'proximo' && styles.stepperDotProximo,
          efectivo === 'pendiente' && styles.stepperDotInactive,
        ]}
      />
    );
  });

  const etiqueta = tracking
    ? `${pasados} de ${estados.length} puntos${omitidos > 0 ? `, ${omitidos} omitidos` : ''}`
    : `${estados.length} puntos`;

  return (
    <View style={styles.stepperContainer} accessible accessibilityLabel={etiqueta}>
      {dots}
    </View>
  );
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
  // Contenedor táctil de la cabecera; su `paddingBottom` es el aire visible al colapsar.
  cabecera: {
    paddingBottom: AIRE_BAJO_CABECERA,
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
    // 10 de antes menos el aire que ahora vive dentro de la cabecera: el layout expandido no cambia.
    marginTop: 10 - AIRE_BAJO_CABECERA,
    marginBottom: 4,
  },
  tituloRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  vueltaPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: quivoRadius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  vueltaPillTexto: {
    color: quivoColors.white,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 11.5,
  },
  viaMolinosPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: quivoRadius.pill,
    backgroundColor: quivoColors.primarySubtle,
  },
  viaMolinosPillText: {
    flexShrink: 1,
    color: quivoColors.primary,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 10.5,
  },
  stepperContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    rowGap: 6,
  },
  stepperDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stepperDotPasado: {
    backgroundColor: '#22C55E',
  },
  // Rojo más claro que el del mapa (#C53B4A): sobre el índigo del sheet el otro casi no contrasta.
  stepperDotOmitido: {
    backgroundColor: '#FF5C6C',
  },
  // Próximo punto: blanco y más grande, el único que "pesa" entre los puntitos.
  stepperDotProximo: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: quivoColors.white,
  },
  stepperDotInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  actionsRow: {
    marginTop: 14,
  },
  // Sin stepper, el aire de la cabecera ya separa las acciones (14 + 14 se veía el doble).
  actionsRowSinStepper: {
    marginTop: 14 - AIRE_BAJO_CABECERA,
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
  hintText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 13,
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
