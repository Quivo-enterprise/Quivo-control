import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { ContextoOperativoMovil } from '@quivo/shared';
import { Button, Heading, Text } from '@quivo/design-system-native';
import { Button as LocalButton } from '../../shared/components/Button';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HojaBurbuja, PildoraBurbuja } from '../../shared/components/burbuja';
import { dsColors, dsRadius, dsSpace } from '../../shared/theme/design-system';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import type { FaseControl } from '../jornada/fase-control';
import type { EstadoPuntoVuelta } from './progreso-vuelta';
import { FilaSalidaCard } from '../fila-salida/fila-salida-card';
import type { FilaSalidaUi } from '../fila-salida/use-fila-salida';
import { formatearDistancia } from './format-distancia';

const NUMERO_EMERGENCIAS = '911';

/** Separación (dp) entre el sheet y el borde inferior de la pantalla (`styles.sheet.bottom`). */
export const MARGEN_INFERIOR_SHEET = quivoBubble.edge;

/** La hoja queda a `edge` del borde visible del mapa en todas las fases, igual que a los costados
 * (reglas-burbujas §2). La zona segura inferior no se suma: el mapa ya termina antes de la barra de
 * gestos, y sumarla dejaba bajo el botón el triple de aire que a los costados. Se conservan los
 * parámetros para no tocar a los llamadores. */
export function calcularMargenInferiorSheet(_fase: FaseControl, _insetInferior: number): number {
  return MARGEN_INFERIOR_SHEET;
}

/** Aire (dp) bajo la cabecera; al colapsar queda visible el bloque de parada o la fila de salida,
 * más este respiro. El contenido informativo de la cabecera conserva la zona de arrastre/toque. */
const AIRE_BAJO_CABECERA = dsSpace.sm;

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
  nombreProximaParada?: string | null;
  /** Distancia ya calculada por la pantalla al próximo control; solo se presenta en ruta. */
  distanciaProximaParadaM?: number | null;
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
  /** Termina el día (`gps.detener()` tras confirmar). Con la ruta en curso es la acción secundaria. */
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
  const insets = useSafeAreaInsets();
  const [confirmarEmergencia, setConfirmarEmergencia] = useState(false);
  const [confirmarPausa, setConfirmarPausa] = useState(false);
  const { fase, onEmpezarDia, empezandoDia = false, puedeEmpezarDia = true } = props;
  const margenInferior = calcularMargenInferiorSheet(fase, insets.bottom);
  const tracking = fase === 'recorrido';
  const reemplazaParadaPorFila =
    tracking && (Boolean(props.filaSalida?.vista) || Boolean(props.filaSalida?.puedeEstoyEnLaFila));
  // Con `tracking` la fase 'recorrido' manda de inmediato; si no, mientras se lee la jornada
  // no se sabe aún si toca EMPEZAR DÍA o COMENZAR RUTA.
  const cargandoJornada = Boolean(props.jornadaCargando) && !tracking;

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
  const emitirAltoVisible = useCallback(
    (minimizado: boolean) => {
      if (altoSheetRef.current <= 0) return;
      const visible = Math.max(
        0,
        altoSheetRef.current + margenInferior - (minimizado ? offsetRef.current : 0),
      );
      if (visible === altoVisibleEmitidoRef.current) return;
      altoVisibleEmitidoRef.current = visible;
      onAltoVisibleRef.current?.(visible);
    },
    [margenInferior],
  );

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
    const nuevo = Math.max(0, Math.round(alto + margenInferior - cabecera));
    const cambio = nuevo !== offsetRef.current;
    offsetRef.current = nuevo;
    if (objetivoColapsadoRef.current && cambio) animarA(nuevo, true);
    else emitirAltoVisible(objetivoColapsadoRef.current);
  }, [animarA, emitirAltoVisible, margenInferior]);

  const onLayoutSheet = (e: LayoutChangeEvent) => {
    const alto = Math.round(e.nativeEvent.layout.height);
    if (alto === altoSheetRef.current) return;
    altoSheetRef.current = alto;
    onAlto?.(alto);
    // En jornada no hay cabecera para medir: la hoja muestra solo la acción principal.
    if (fase === 'jornada') emitirAltoVisible(false);
    else recalcularSnap();
  };

  // Cabecera = bloque de parada o fila de salida + aire, medida desde el borde superior del sheet
  // (incluye su padding superior): `y + height` es todo lo que debe seguir visible al colapsar.
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

  return (
    <Animated.View
      onLayout={onLayoutSheet}
      style={[styles.sheet, { bottom: margenInferior, transform: [{ translateY: panY }] }]}
    >
      <HojaBurbuja>
        {fase !== 'jornada' ? (
          <View style={styles.cabecera} onLayout={onLayoutCabecera}>
            {reemplazaParadaPorFila && props.filaSalida ? (
              <FilaSalidaCard fila={props.filaSalida} panHandlers={panResponder.panHandlers} />
            ) : (
              <View style={styles.headerLeft} {...panResponder.panHandlers}>
                <View style={tracking ? styles.paradaEnRuta : undefined}>
                  <Heading
                    size={tracking ? 'lg' : 'xl'}
                    numberOfLines={1}
                    style={tracking ? styles.nombreParadaEnRuta : undefined}
                  >
                    {props.nombreProximaParada || `Punto de control ${props.nextPointOrder ?? 1}`}
                  </Heading>
                  {tracking && props.distanciaProximaParadaM != null ? (
                    <Heading size="lg" numberOfLines={1} style={styles.distanciaParada}>
                      a {formatearDistancia(props.distanciaProximaParadaM)}
                    </Heading>
                  ) : null}
                </View>
                {props.viaMolinos ? (
                  <View
                    accessible
                    accessibilityLabel="Vía Molinos: Honduras, Molinos, Salomón Romero"
                  >
                    <PildoraBurbuja icono="trail-sign" style={styles.viaMolinos}>
                      Vía Molinos
                    </PildoraBurbuja>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        ) : null}
        {fase !== 'jornada' && !reemplazaParadaPorFila ? (
          <View style={[styles.stepperSection, tracking && styles.stepperAligned]}>
            <MiniStepper
              estados={props.estadosPuntos}
              tracking={tracking}
              pasados={props.puntosPasados}
              omitidos={props.puntosOmitidos}
              vuelta={props.vueltaActual}
              proximo={props.nextPointOrder}
            />
          </View>
        ) : null}
        {tracking && !reemplazaParadaPorFila && props.filaSalida ? (
          <FilaSalidaCard fila={props.filaSalida} />
        ) : null}
        <View style={styles.actionsRow}>
          {cargandoJornada ? (
            <View style={styles.cargandoJornada}>
              <ActivityIndicator color={dsColors.primary} size="small" />
            </View>
          ) : fase === 'jornada' ? (
            <>
              <Button
                variant="primary"
                size="lg"
                loading={empezandoDia}
                disabled={!puedeEmpezarDia || empezandoDia}
                onPress={() => void onEmpezarDia()}
                accessibilityHint="Avisa a tu delegado que hoy trabajas"
                fullWidth
                style={styles.botonJornada}
              >
                Empezar día
              </Button>
              {props.errorEmpezarDia ? (
                <Text size="sm" variant="error" accessibilityRole="alert">
                  {props.errorEmpezarDia}
                </Text>
              ) : null}
            </>
          ) : fase === 'listo' ? (
            <Button
              variant="primary"
              size="lg"
              disabled={!props.canStart}
              onPress={props.onStart}
              fullWidth
            >
              Iniciar ruta
            </Button>
          ) : (
            <>
              {props.pausadoDesde ? (
                <Text size="md" variant="secondary">
                  En pausa desde{' '}
                  {new Date(props.pausadoDesde).toLocaleTimeString('es-BO', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </Text>
              ) : null}
              <View style={styles.accionesRecorrido}>
                {/* Cada acción en su mitad exacta: el Button del DS y el local no reparten `flex` igual. */}
                <View style={styles.mitad}>
                  {props.pausadoDesde ? (
                    <Button
                      variant="primary"
                      size="lg"
                      onPress={props.onResume}
                      accessibilityHint="Vuelves a aparecer como en recorrido"
                      style={styles.accionMedia}
                      fullWidth
                    >
                      Reanudar
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="lg"
                      onPress={() =>
                        props.filaSalida?.vista ? setConfirmarPausa(true) : props.onPause?.()
                      }
                      accessibilityHint="Pausa el recorrido; el GPS sigue activo"
                      style={styles.accionMedia}
                      fullWidth
                    >
                      Pausar
                    </Button>
                  )}
                </View>
                <View style={styles.mitad}>
                  <LocalButton
                    variant="outline"
                    size="lg"
                    onPress={props.onFinish}
                    style={[styles.accionMedia, styles.finalizarOutline]}
                    fullWidth
                    textStyle={styles.finalizarTexto}
                  >
                    Finalizar
                  </LocalButton>
                </View>
              </View>
            </>
          )}
        </View>
      </HojaBurbuja>
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
  vuelta,
  proximo,
}: {
  estados: readonly EstadoPuntoVuelta[];
  tracking: boolean;
  pasados: number;
  omitidos: number;
  vuelta: number;
  proximo: number | null;
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
    ? `Vuelta ${vuelta}, punto ${(proximo ?? pasados) + 1} de ${estados.length}${omitidos > 0 ? `, ${omitidos} omitidos` : ''}`
    : `${estados.length} puntos`;

  return (
    <View style={styles.stepperContainer} accessible accessibilityLabel={etiqueta}>
      {dots}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: quivoBubble.edge, right: quivoBubble.edge },
  cabecera: { paddingBottom: AIRE_BAJO_CABECERA },
  headerLeft: { gap: dsSpace.xs, marginHorizontal: quivoBubble.padding },
  paradaEnRuta: { flexDirection: 'row', alignItems: 'center', gap: quivoBubble.gap },
  nombreParadaEnRuta: { flex: 1, minWidth: 0 },
  distanciaParada: { flexShrink: 0, color: dsColors.textPrimary, fontVariant: ['tabular-nums'] },
  viaMolinos: { alignSelf: 'flex-start' },
  stepperSection: { marginBottom: dsSpace.sm },
  stepperAligned: { marginHorizontal: quivoBubble.padding },
  stepperContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: dsSpace.sm,
  },
  stepperDot: {
    width: dsSpace.ms,
    height: dsSpace.ms,
    borderRadius: dsSpace.sm,
    borderWidth: 1,
    borderColor: dsColors.borderStrong,
  },
  stepperDotPasado: { backgroundColor: dsColors.success, borderRadius: dsSpace.sm },
  stepperDotOmitido: {
    backgroundColor: dsColors.dangerSoft,
    borderColor: dsColors.danger,
    borderRadius: 0,
  },
  stepperDotProximo: {
    backgroundColor: dsColors.accent,
    borderColor: dsColors.warningText,
    borderWidth: 2,
    borderRadius: dsSpace.sm,
  },
  stepperDotInactive: { backgroundColor: dsColors.surfaceRaised },
  actionsRow: { gap: dsSpace.sm },
  accionesRecorrido: { flexDirection: 'row', gap: quivoBubble.gap },
  mitad: { flex: 1, minWidth: 0 },
  accionMedia: { minHeight: 52, borderRadius: quivoBubble.innerRadius },
  finalizarOutline: { borderColor: dsColors.danger },
  finalizarTexto: { color: dsColors.danger },
  // La acción de marca conserva la píldora completa y usa solo la sombra exterior de la hoja.
  botonJornada: {
    borderRadius: dsRadius.full,
    elevation: 0,
    shadowOpacity: 0,
  },
  cargandoJornada: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
});
