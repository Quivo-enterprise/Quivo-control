import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import {
  haversineMetros,
  resolverMarcaLinea,
  type ContextoOperativoMovil,
  type PaqueteDia,
} from '@quivo/shared';
import { abrirOutbox, encolarEvento } from '../../db/outbox';
import { quivoBubble } from '../../shared/theme/quivo-theme';
import { dsColors, dsSpace, dsDuration, dsElevation } from '../../shared/theme/design-system';
import { Burbuja, BotonBurbuja, PildoraBurbuja } from '../../shared/components/burbuja';
import {
  Button as DsButton,
  Heading,
  Text as DsText,
  fontStyle,
} from '@quivo/design-system-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapErrorBoundary } from './map-error-boundary';
import { useProgresoVuelta } from './use-progreso-vuelta';
import { VueltaCompletadaBanner } from './vuelta-completada-banner';
import type { EstadoPuntoVuelta } from './progreso-vuelta';
import { RouteMap } from '../mapa/route-map';
import { MARGEN_INFERIOR_SHEET, NextControlSheet } from './next-control-sheet';
import { BrujulaMapa } from './brujula-mapa';
import { crearEmisorRumbo } from '../mapa/rumbo-mapa';
import { useModoCamara } from '../mapa/use-modo-camara';
import type { InsetsNavegacion, RouteMapProps } from '../mapa/tipos';
import { useSyncStatus } from './use-sync-status';
import { debePedirRuta, esFalloReintentable, respuestaRutaVigente } from './debe-pedir-ruta';
import { ruteoApi } from '../../shared/api/ruteo-api';
import { ControlFeedbackToast } from './control-feedback-toast';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { CerrarSesionDialog } from '../../shared/components/cerrar-sesion-dialog';
import { useGpsContext } from './gps-provider';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { useOperacionSettings } from '../perfil/use-operacion-settings';
import { DriverRouteCard } from './driver-route-card';
import { VecinosRutaPanel } from '../vecinos-ruta/vecinos-ruta-panel';
import { faseControl } from '../jornada/fase-control';
import { useJornada } from '../jornada/use-jornada';
import { AvisoFotoVehiculo } from '../vehiculo-foto/aviso-foto-vehiculo';
import { useVueltaActual } from '../vuelta-actual/use-vuelta-actual';
import { useFilaSalida } from '../fila-salida/use-fila-salida';
import { terminalDeLaRuta } from '../fila-salida/fila-salida-deteccion';
import { AvisoDesignacion, ContadorEsperaMolinos } from '../vuelta-actual/aviso-designacion';

/** Opciones fijas del modal "Reportar incidencia"; viajan como `categoria` (código estable) y `texto` (etiqueta). */
const OPCIONES_INCIDENCIA = [
  { categoria: 'bloqueo', etiqueta: 'Bloqueo', icono: 'close-circle-outline' },
  { categoria: 'salud', etiqueta: 'Salud', icono: 'medkit-outline' },
  { categoria: 'fantasma', etiqueta: 'Fantasma', icono: 'eye-off-outline' },
  { categoria: 'incidente', etiqueta: 'Incidente', icono: 'warning-outline' },
  { categoria: 'falla_tecnica', etiqueta: 'Falla técnica', icono: 'construct-outline' },
] as const;

// shortcut: número fijo del delegado, válido SOLO para la L16 (el botón se oculta en otras líneas) en el piloto; mover a un campo de Línea/Sindicato servido por la API después del piloto.
const WHATSAPP_DELEGADO = '59161604399';

interface OperationScreenProps {
  contexto: ContextoOperativoMovil;
  deviceId: string;
  aviso: string | null;
  /** A5 (hallazgo de revisión, alto): se agotó el backoff de revalidación de sesión
   * (`refrescarConReintentos` en `use-auth-movil.ts`) sin lograr un refresh válido — distinto
   * del `aviso` genérico de "sin red", que es engañoso acá si la sesión fue cerrada
   * server-side. Renderizado como alerta con CTA explícito más abajo. */
  sesionNoRevalidada: boolean;
  /** Rescope SESION_NO_VIGENTE, punto C (`use-auth-movil.ts`): corte de raíz con un recorrido
   * de GPS ACTIVO — a diferencia de `sesionNoRevalidada` (ambigua, puede recuperarse sola), acá
   * el servidor ya dio la sesión por muerta, pero borrarla/desmontar `GpsProvider` ahora mismo
   * mataría el tracking sin `fin_recorrido`. Bloquea con un aviso no descartable hasta que el
   * chofer confirme "Finalizar". */
  sesionNoVigente: boolean;
  loading: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => Promise<void>;
  /** Se llama cuando `gps.detener()` completa (best-effort `fin_recorrido` ya escrito, tracking
   * apagado) mientras `sesionNoVigente` estaba prendido — recién ahí es seguro borrar la sesión
   * local y volver al login. Ver el efecto que la dispara, abajo. */
  onSesionNoVigenteFinalizada: () => Promise<void>;
}

export function OperationScreen(
  props: OperationScreenProps & NativeStackScreenProps<OperationStackParamList, 'Map'>,
) {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const { gps, paqueteDia } = useGpsContext();
  // Entrega 4 (`docs/plan-correccion-post-piloto-2026-09-09.md`, `docs/estados-red-vs-captura.md`):
  // `pendientes`/`errorSync`/`isSyncing` YA NO se leen acá — eran exactamente los widgets de
  // "N pendientes / error de sincronización" que el principio rector prohíbe en esta pantalla
  // (transporte, no captura: el outbox sigue creciendo y drenando solo, sin que el chofer
  // tenga que saberlo ni pueda hacer nada al respecto). `useSyncStatus` se sigue llamando
  // igual — drena el outbox y calcula `isOffline`, que acá SÍ sigue en uso, pero solo como
  // insumo del gate de política `settings.trabajarOffline` (una configuración explícita del
  // dispositivo, no un widget espontáneo de estado de red) — nunca para pintar un badge de
  // "conectado/desconectado".
  const { isOffline } = useSyncStatus(props.obtenerAccessToken, props.contexto.sesionId);
  const { settings } = useOperacionSettings();
  const lineaBrand = useMemo(
    () => resolverMarcaLinea(props.contexto.linea),
    [props.contexto.linea],
  );
  const puntosControl = useMemo(
    () => paqueteDia.paquete?.puntosControl ?? [],
    [paqueteDia.paquete],
  );
  // Designación a Molinos (aviso + mapa + contador de espera). El estado viene de SQLite y de la
  // consulta de la vuelta actual; los errores de red son silenciosos (ver `use-vuelta-actual.ts`).
  const vueltaActual = useVueltaActual({
    sesionId: props.contexto.sesionId,
    tracking: gps.tracking,
    obtenerAccessToken: props.obtenerAccessToken,
  });
  // Fila de salida de la terminal: sale del mismo cache (sin polling propio).
  const terminalZona = useMemo(() => terminalDeLaRuta(puntosControl), [puntosControl]);
  const filaSalida = useFilaSalida({
    sesionId: props.contexto.sesionId,
    fila: vueltaActual.fila,
    sinActualizar: vueltaActual.filaSinActualizar,
    desfaseMs: vueltaActual.desfaseFilaMs,
    desarmada: vueltaActual.filaDesarmada,
    tracking: gps.tracking,
    terminal: terminalZona,
    posicion: gps.posicionActual,
    obtenerAccessToken: props.obtenerAccessToken,
    confirmarLlegadaTerminal: gps.confirmarLlegadaTerminal,
  });
  // Progreso de la vuelta (RF-GPS-054): pasos en cualquier orden, omitidos en rojo, vuelta al
  // cerrar en el punto de inicio. Lo escribe el registro de cumplimientos (foreground y headless);
  // acá solo se lee (hidrata al montar y al volver a `active`).
  const progreso = useProgresoVuelta(
    props.contexto.sesionId,
    puntosControl,
    gps.posicionActual,
    gps.tracking,
    vueltaActual.designacionActiva,
  );
  // Número del PC en el orden efectivo (igual que la voz); `undefined` si no está en él.
  const numeroDePuntoControl = useCallback(
    (puntoControlId: string): number | undefined => {
      const idx = progreso.ordenEfectivo.findIndex((p) => p.id === puntoControlId);
      return idx >= 0 ? idx + 1 : undefined;
    },
    [progreso.ordenEfectivo],
  );
  const [altoBannerVuelta, setAltoBannerVuelta] = useState(0);
  const [observacion, setObservacion] = useState('');
  const [enviandoObservacion, setEnviandoObservacion] = useState(false);
  const [observacionEnviada, setObservacionEnviada] = useState(false);
  const [errorObservacion, setErrorObservacion] = useState<string | null>(null);
  const [observacionModalVisible, setObservacionModalVisible] = useState(false);
  const sheetPanY = useRef(new Animated.Value(0)).current;
  const { camara, onPanUsuario, recentrar, alternarOrientacion } = useModoCamara(gps.tracking);
  // Canal mapa -> brújula del rumbo de la cámara: no pasa por estado de React (llega a ~30 Hz).
  const emisorRumbo = useRef(crearEmisorRumbo()).current;
  const jornada = useJornada({
    vehiculoId: props.contexto.vehiculo.id,
    conductorId: props.contexto.conductor.id,
    sesionId: props.contexto.sesionId,
    deviceId: props.deviceId,
  });
  const fase = faseControl({ jornadaIniciada: jornada.jornadaIniciada, tracking: gps.tracking });

  // Lo que tapa el mapa en navegación (`paddingNavegacion`): borde inferior de la tarjeta
  // superior y lo que ocupa el sheet VISIBLE (expandido o colapsado) desde abajo. Solo se setea si
  // el valor redondeado cambia, para no re-renderizar la pantalla por cada layout.
  // `altoSheet` = alto del sheet expandido (ancla los FABs); `altoSheetVisible` = lo que asoma hoy
  // desde el borde inferior, margen incluido (el sheet lo avisa al terminar cada snap).
  const [insetSuperior, setInsetSuperior] = useState(0);
  const [altoSheet, setAltoSheet] = useState(0);
  const [altoSheetVisible, setAltoSheetVisible] = useState(0);
  const onLayoutTopOverlay = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    setInsetSuperior(Math.round(y + height));
  }, []);
  // Getter estable de la posición para el panel de vecinos: así el GPS a 1 Hz no cambia sus props.
  const posicionVecinosRef = useRef(gps.posicionActual);
  posicionVecinosRef.current = gps.posicionActual;
  const obtenerPosicionVecinos = useCallback(() => posicionVecinosRef.current, []);
  // Fase por ref, igual que la posición: que cambie no re-renderiza el panel ni reinicia su intervalo.
  const faseVecinosRef = useRef(progreso.fase);
  faseVecinosRef.current = progreso.fase;
  const obtenerFaseVecinos = useCallback(() => faseVecinosRef.current, []);
  const insetsNavegacion = useMemo(
    () => ({
      superior: insetSuperior,
      inferior: Math.max(0, altoSheetVisible),
    }),
    [insetSuperior, altoSheetVisible],
  );
  // Base de los FABs y del botón "Centrar": justo encima del sheet EXPANDIDO (no del colapsado, así
  // nunca quedan tapados); se mueven con el sheet por `translateY: sheetPanY`. 180 mientras el
  // sheet no se midió.
  const fabsBottom =
    altoSheet > 0
      ? altoSheet + MARGEN_INFERIOR_SHEET + insets.bottom + dsSpace.ms
      : 180 + insets.bottom;

  // Rescope SESION_NO_VIGENTE, punto C: dispara `onSesionNoVigenteFinalizada` cuando
  // `sesionNoVigente` está prendido y `gps.tracking` está en `false` — la señal de que
  // `gps.detener()` (llamado desde el diálogo de "Finalizar" de abajo, el mismo que el chofer ve
  // reflejado en el banner) ya completó, haya salido bien o mal la escritura de `fin_recorrido`
  // (ver el docblock de `detener()` en `use-gps-operativo.ts`, invariante "nativo OK ⇒ tracking
  // SIEMPRE false al final").
  //
  // FIX POST-REVISIÓN (hallazgo ALTO, Entrega 28 — "disparo por nivel, no por flanco"): antes
  // disparaba solo en el FLANCO true→false de `gps.tracking` (comparando contra un ref del
  // `tracking` anterior). Con la corrección de `useGpsOperativo` que ahora publica solo
  // veredictos reales (`estado-recorrido-activo.ts`), existe una carrera legítima donde
  // `gps.tracking` puede llegar a `false` ANTES de que `use-auth-movil.ts` termine de prender
  // `sesionNoVigente` (p. ej. el chofer mata la app en medio de un recorrido activo y la reabre:
  // el re-enganche puede resolver `tracking: false` — sin recorrido — antes de que la
  // suscripción a `estado-recorrido-activo.ts` decida `esperar_finalizar` y recién ENTONCES
  // `sesionNoVigente` se prenda). En ese orden, el flanco true→false de `tracking` ya pasó y
  // nunca vuelve a repetirse: el banner quedaba prendido para siempre y "Finalizar" (que llama
  // `gps.detener()` sin ningún flanco que producir, porque ya estaba en `false`) nunca
  // destrababa la sync. Disparo por NIVEL en su lugar (`sesionNoVigente && !gps.tracking`), una
  // sola vez por cada vez que `sesionNoVigente` se prende, con un ref-guard que se resetea
  // cuando `sesionNoVigente` vuelve a `false` (login nuevo/sesión distinta).
  const disparadoSesionNoVigente = useRef(false);
  useEffect(() => {
    if (!props.sesionNoVigente) {
      disparadoSesionNoVigente.current = false;
      return;
    }
    if (!gps.tracking && !disparadoSesionNoVigente.current) {
      disparadoSesionNoVigente.current = true;
      void props.onSesionNoVigenteFinalizada();
    }
  }, [gps.tracking, props.sesionNoVigente, props.onSesionNoVigenteFinalizada]);

  const proximoPuntoControl = progreso.proximo;
  // Posición (0-indexada) del próximo en el orden efectivo: el PC de espera fuera de la base no
  // cuenta, así que `orden` crudo desfasaría el "punto N de M".
  const ordenProximoEfectivo = useMemo(() => {
    if (!proximoPuntoControl) return null;
    const idx = progreso.ordenEfectivo.findIndex((p) => p.id === proximoPuntoControl.id);
    return idx >= 0 ? idx : null;
  }, [proximoPuntoControl, progreso.ordenEfectivo]);
  const estadosPuntosControl = useMemo(
    () =>
      Object.fromEntries(progreso.puntos.map((p) => [p.punto.id, p.estado])) as Record<
        string,
        EstadoPuntoVuelta
      >,
    [progreso.puntos],
  );
  const estadosStepper = useMemo(() => progreso.puntos.map((p) => p.estado), [progreso.puntos]);

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
  const ultimoFetchRuta = useRef<{
    ts: number;
    lat: number;
    lng: number;
    destino: [number, number];
    fallo?: boolean;
  } | null>(null);
  // Cada pedido lleva un id: la respuesta se aplica solo si sigue siendo el último (todo cambio
  // de destino, de tracking o desmontaje lo incrementa). La posición cambia a 1 Hz, así que no
  // se cancela el pedido en cada cambio.
  const idPedidoRuta = useRef(0);
  const trackingAnterior = useRef(gps.tracking);
  const destinoRuteo =
    proximoPuntoControl?.coord.coordinates ??
    paqueteDia.paquete?.ruta.geometria.coordinates.at(-1) ??
    null;
  useEffect(
    () => () => {
      idPedidoRuta.current += 1; // al desmontar, ninguna respuesta en vuelo se aplica
    },
    [],
  );
  useEffect(() => {
    const acabaDeIniciar = gps.tracking && !trackingAnterior.current;
    trackingAnterior.current = gps.tracking;
    // `posicionActual` NO se anula al detener (use-gps-operativo.ts), así que el id se invalida aquí.
    if (!gps.tracking) idPedidoRuta.current += 1;

    if (!gps.posicionActual || !destinoRuteo) {
      idPedidoRuta.current += 1;
      setRutaCalculada(null);
      return;
    }
    const posicion = gps.posicionActual;
    const anterior = ultimoFetchRuta.current;
    const ahora = Date.now();
    // Si el destino cambió (se completó un punto de control y avanzamos al siguiente),
    // el throttle no aplica: sin esto, el mapa seguía mostrando la ruta OSRM del punto
    // anterior. Con el mismo destino se re-pide solo si pasaron >=15 s Y se movió >=50 m.
    const mismoDestino =
      anterior?.destino[0] === destinoRuteo[0] && anterior?.destino[1] === destinoRuteo[1];
    const distanciaDesdeUltimoFetch = anterior
      ? haversineMetros([posicion.lng, posicion.lat], [anterior.lng, anterior.lat])
      : Infinity;
    if (
      !debePedirRuta({
        acabaDeIniciar,
        anterior,
        mismoDestino,
        ahoraMs: ahora,
        distanciaM: distanciaDesdeUltimoFetch,
      })
    ) {
      return;
    }

    const pedido = {
      ts: ahora,
      lat: posicion.lat,
      lng: posicion.lng,
      destino: destinoRuteo,
      fallo: false,
    };
    ultimoFetchRuta.current = pedido;
    const id = ++idPedidoRuta.current;
    const vigente = () => respuestaRutaVigente({ idPedido: id, idUltimo: idPedidoRuta.current });
    void (async () => {
      try {
        const token = await props.obtenerAccessToken();
        if (!token) {
          pedido.fallo = true;
          if (vigente()) setRutaCalculada(null);
          return;
        }
        const resultado = await ruteoApi.rutaAPunto(
          posicion,
          { lat: destinoRuteo[1], lng: destinoRuteo[0] },
          token,
        );
        if (vigente()) setRutaCalculada(resultado?.coordenadas ?? null);
      } catch (error) {
        // Solo el fallo de transporte (red/timeout/5xx) o el límite 429 reintenta pasados 15 s aunque
        // el conductor esté quieto; cualquier otro error se reporta y se trata como respuesta sin ruta.
        const transporte = esFalloReintentable(error);
        pedido.fallo = transporte;
        if (!transporte) {
          Sentry.captureException(error, {
            tags: { contexto: 'operation-screen', paso: 'ruta-a-punto' },
          });
        }
        // Sin ruta vigente el mapa vuelve a la línea recta: no deja la ruta al punto anterior.
        if (vigente()) setRutaCalculada(null);
      }
    })();
  }, [gps.tracking, gps.posicionActual, destinoRuteo, props.obtenerAccessToken]);

  const abrirWhatsAppDelegado = useCallback(() => {
    const { conductor, vehiculo, linea } = props.contexto;
    const msg = `Hola, soy ${conductor.nombre} (${vehiculo.placa}), Línea ${linea.codigo}.`;
    Linking.openURL(`https://wa.me/${WHATSAPP_DELEGADO}?text=${encodeURIComponent(msg)}`).catch(
      (error) => {
        Sentry.captureException(error, {
          tags: { contexto: 'operation-screen', paso: 'abrir-whatsapp-delegado' },
        });
        Alert.alert(
          'No se pudo abrir WhatsApp',
          'Revisa que WhatsApp esté instalado o escribe al delegado al 61604399.',
        );
      },
    );
  }, [props.contexto]);

  const enviarObservacion = useCallback(async () => {
    const texto = observacion; // etiqueta de la opción elegida
    const categoria = OPCIONES_INCIDENCIA.find((o) => o.etiqueta === texto)?.categoria;
    if (!texto || !categoria) return;
    setEnviandoObservacion(true);
    setErrorObservacion(null);
    try {
      const db = await abrirOutbox();
      await encolarEvento(db, {
        deviceId: props.deviceId,
        tipo: 'observacion',
        payload: { sesionId: props.contexto.sesionId, texto, categoria },
      });
      setObservacion('');
      setObservacionEnviada(true);
    } catch (error) {
      // Hallazgo 4 (MEDIO, code review de este cambio): antes este `try/finally` no tenía
      // `catch` — daba igual mientras el botón fue un no-op, pero el cambio que lo conectó
      // (arriba, hallazgo 3 del plan) lo hizo alcanzable por primera vez. Si `abrirOutbox()` o
      // `encolarEvento` lanzan (la regresión de `expo-sqlite@16.0.10` documentada en todo
      // este repo), la promesa rechazaba sin manejar: `observacionEnviada` se quedaba en
      // `false` y el modal no reaccionaba al toque de "Enviar" — el conductor volvía a tocar
      // creyendo que se perdió. Con esto el modal muestra un error legible y deja reintentar.
      console.error('[QUIVO][observacion] No se pudo encolar la observación', error);
      Sentry.captureException(error, {
        tags: { contexto: 'operation-screen', paso: 'enviar-observacion' },
      });
      setErrorObservacion('No se pudo guardar el reporte. Vuelve a intentarlo.');
    } finally {
      setEnviandoObservacion(false);
    }
  }, [observacion, props.contexto.sesionId, props.deviceId]);

  // Hallazgo 3 (MEDIO, ver docs/plan-v2-app-y-mapa-en-vivo.md §2.4): cierra el modal y
  // resetea el formulario — se usa tanto al cancelar como después de confirmar el envío
  // ("Listo"). No cierra mientras `enviandoObservacion` está en curso (ver `onRequestClose`
  // del modal de abajo), para no perder el toque de "Enviar" que sigue en vuelo.
  const cerrarModalObservacion = useCallback(() => {
    setObservacionModalVisible(false);
    setObservacion('');
    setObservacionEnviada(false);
    setErrorObservacion(null);
  }, []);

  // Hallazgo 8 (BAJO, code review de este cambio): `gps.abrirAjustesPermisoGps` termina en
  // `await Linking.openSettings()` cuando el camino de `sendIntent` no aplica o falla — y ese
  // `openSettings()` puede rechazar en dispositivos donde esa actividad no se resuelve. El
  // `onPress` de abajo antes descartaba la promesa con `void`: el conductor tocaba el botón
  // rojo, no se abría nada, y no quedaba ningún rastro — a diferencia del camino de
  // `sendIntent` en `use-gps-operativo.ts`, que sí reporta a Sentry su propio fallo. Este
  // wrapper solo agrega el `.catch` que faltaba en el call site (no se toca
  // `use-gps-operativo.ts`, a cargo de otro cambio en curso).
  const manejarAbrirAjustesPermisoGps = useCallback(() => {
    gps.abrirAjustesPermisoGps(gps.permisoGps.accion).catch((error: unknown) => {
      console.error('[QUIVO][permiso-gps] No se pudo abrir los ajustes de permiso', error);
      Sentry.captureException(error, {
        tags: { contexto: 'operation-screen', paso: 'abrir-ajustes-permiso-gps' },
      });
    });
  }, [gps]);

  const [confirmarFinVisible, setConfirmarFinVisible] = useState(false);
  const [confirmarLogoutVisible, setConfirmarLogoutVisible] = useState(false);

  const confirmarFinalizacion = useCallback(() => setConfirmarFinVisible(true), []);
  const confirmarCierreSesion = useCallback(() => setConfirmarLogoutVisible(true), []);

  return (
    <View style={styles.container}>
      <MapLayer
        loading={paqueteDia.cargando}
        paquete={paqueteDia.paquete}
        vehiculo={props.contexto.vehiculo}
        estadosPuntosControl={estadosPuntosControl}
        position={gps.posicionActual}
        tracking={gps.tracking}
        camara={camara}
        onPanUsuario={onPanUsuario}
        insetsNavegacion={insetsNavegacion}
        rutaCalculada={rutaCalculada}
        emisorRumbo={emisorRumbo}
        designacion={vueltaActual.designacionActiva}
        ordenEfectivo={progreso.ordenEfectivo}
        fase={progreso.fase}
      />

      <View
        pointerEvents="box-none"
        style={[styles.topOverlay, { top: insets.top + quivoBubble.edge }]}
        onLayout={onLayoutTopOverlay}
      >
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Línea ${props.contexto.linea.codigo}, ${!gps.tracking ? 'en espera' : gps.pausadoDesde ? 'en pausa' : 'en ruta'}. Abrir perfil`}
          onPress={() => props.navigation.navigate('Perfil')}
          style={styles.cabeceraBoton}
        >
          <DriverRouteCard
            contexto={props.contexto}
            brand={lineaBrand}
            tracking={gps.tracking}
            pausadoDesde={gps.pausadoDesde}
            compacta={camara.modo !== 'general'}
          />
        </Pressable>

        {gps.tracking && gps.senalGpsDebil ? <SenalGpsDebilChip /> : null}

        {props.aviso ? (
          <AvisoBurbuja icono="information-circle-outline" mensaje={props.aviso} />
        ) : null}
        {/* QUI-338 (reportado desde la calle: Samsung Galaxy A71, Android 10-13 — conductor
            sin ubicación y sin ningún mensaje que le dijera qué tocar): antes, "Iniciar
            recorrido" quedaba habilitado sin importar el permiso y `iniciar()` fallaba en
            silencio contra un mensaje genérico sin acción. Se oculta mientras `gps.tracking`
            porque el permiso ya estaba en orden cuando arrancó — mismo criterio que el resto
            de los banners de esta pantalla, uno por causa raíz, sin duplicar alarmas. Reusa
            el patrón exacto de `sesionNoRevalidada` de abajo (texto `dangerNotice` + botón de
            acción a todo el ancho). */}
        {!gps.tracking && gps.permisoGps.bloqueante ? (
          <AvisoBurbuja
            icono="location-outline"
            mensaje={gps.permisoGps.mensaje}
            accion={
              gps.permisoGps.accion ? (gps.permisoGps.etiquetaAccion ?? undefined) : undefined
            }
            onAccion={gps.permisoGps.accion ? manejarAbrirAjustesPermisoGps : undefined}
          />
        ) : null}
        {props.sesionNoRevalidada ? (
          <AvisoBurbuja
            icono="alert-circle-outline"
            mensaje="No se pudo revalidar tu sesión. El recorrido se sigue grabando, pero no va a sincronizar hasta que vuelvas a iniciar sesión."
            accion="Vuelve a iniciar sesión para sincronizar"
            onAccion={confirmarCierreSesion}
          />
        ) : null}
        {props.sesionNoVigente ? (
          <AvisoBurbuja
            icono="alert-circle-outline"
            mensaje="Tu sesión venció. Toca Finalizar y vuelve a iniciar sesión."
            accion="Finalizar recorrido"
            onAccion={confirmarFinalizacion}
          />
        ) : null}
        {/* Entrega 4 (`docs/plan-correccion-post-piloto-2026-09-09.md`): acá vivían el banner
            de `errorSync` ("no se pudo sincronizar") y el de `pendientes >= 800`
            ("almacenamiento casi lleno") — los dos eran TRANSPORTE puro: el primero es un
            fallo de red retransmisible sin acción posible del chofer (el outbox sigue
            reteniendo y reintentando solo), y el segundo usaba el tamaño de la cola de sync
            como proxy de espacio en disco, que en realidad depende de cuánto tarda la red en
            drenar, no de cuánto espacio queda de verdad. Ambos se sacaron de pantalla — ver
            `docs/estados-red-vs-captura.md`. La detección REAL de disco lleno (escritura
            canaria / `SQLITE_FULL`) queda para la Entrega 26 (preflight), que si corresponde
            sí debe mostrarse porque ESA es una falla de captura. */}
        {paqueteDia.vencido ? (
          <AvisoBurbuja
            icono="alert-circle-outline"
            mensaje="Asignación vencida. Reconecta antes de iniciar otro recorrido."
          />
        ) : null}
        {paqueteDia.error ? (
          <AvisoBurbuja icono="alert-circle-outline" mensaje={paqueteDia.error} />
        ) : null}
        <AvisoFotoVehiculo
          sesionId={props.contexto.sesionId}
          tracking={gps.tracking}
          obtenerAccessToken={props.obtenerAccessToken}
        />
        {!settings.trabajarOffline && isOffline ? (
          <AvisoBurbuja
            icono="cloud-offline-outline"
            mensaje="Modo offline desactivado en tus Ajustes. Conéctate a internet para iniciar."
          />
        ) : null}
      </View>

      {/* Vecinos de ruta: overlay propio FUERA del `topOverlay` medido, para que su montaje tardío
          no cambie `insetSuperior` (padding de la cámara de navegación). */}
      <VecinosRutaPanel
        tracking={gps.tracking}
        online={!isOffline}
        obtenerAccessToken={props.obtenerAccessToken}
        hayPosicion={gps.posicionActual !== null}
        obtenerPosicion={obtenerPosicionVecinos}
        obtenerFase={obtenerFaseVecinos}
        topBase={insetSuperior}
      />

      <Animated.View
        style={[
          styles.fabsContainer,
          { bottom: fabsBottom, transform: [{ translateY: sheetPanY }] },
        ]}
      >
        <Burbuja direction="column">
          <BotonBurbuja
            icono="alert-circle-outline"
            variante="activo"
            accessibilityLabel="Reportar incidencia"
            onPress={() => setObservacionModalVisible(true)}
          />
          {String(props.contexto.linea.codigo).trim() === '16' ? (
            <BotonBurbuja
              icono="logo-whatsapp"
              accessibilityLabel="Escribir al delegado por WhatsApp"
              onPress={abrirWhatsAppDelegado}
            />
          ) : null}
          {__DEV__ && gps.tracking && proximoPuntoControl ? (
            <BotonBurbuja
              icono="bug"
              accessibilityLabel="Simular detección (Debug)"
              onPress={() => gps.simularDeteccion(proximoPuntoControl.id, distanciaProximoPunto)}
            />
          ) : null}
          {camara.modo === 'navegacion' ? (
            <BrujulaMapa
              emisor={emisorRumbo}
              style={styles.brujula}
              norteFijo={camara.orientacion === 'norte'}
              accessibilityLabel={
                camara.orientacion === 'norte'
                  ? 'Brújula: orientar el mapa según tu rumbo'
                  : 'Brújula: fijar el norte arriba'
              }
              onPress={alternarOrientacion}
            />
          ) : null}
          {camara.modo === 'general' ? (
            <BotonBurbuja
              icono="locate"
              accessibilityLabel="Ver ruta completa"
              onPress={recentrar}
            />
          ) : null}
        </Burbuja>
      </Animated.View>

      {gps.tracking ? (
        <Animated.View
          style={[
            styles.velocidadContenedor,
            { bottom: fabsBottom, transform: [{ translateY: sheetPanY }] },
          ]}
        >
          {camara.modo === 'libre' ? (
            <PildoraBurbuja icono="navigate" accessibilityLabel="Recentrar" onPress={recentrar}>
              Centrar
            </PildoraBurbuja>
          ) : null}
          <PildoraBurbuja icono="speedometer-outline">
            {Math.round(gps.posicionActual?.speedKmh ?? 0)} km/h
          </PildoraBurbuja>
        </Animated.View>
      ) : null}
      {!gps.tracking && camara.modo === 'libre' ? (
        <Animated.View
          style={[
            styles.velocidadContenedor,
            { bottom: fabsBottom, transform: [{ translateY: sheetPanY }] },
          ]}
        >
          <PildoraBurbuja icono="navigate" accessibilityLabel="Recentrar" onPress={recentrar}>
            Centrar
          </PildoraBurbuja>
        </Animated.View>
      ) : null}

      <NextControlSheet
        contexto={props.contexto}
        nextPointOrder={ordenProximoEfectivo}
        nombreProximaParada={null}
        totalPoints={progreso.total}
        estadosPuntos={estadosStepper}
        vueltaActual={progreso.vueltaActual}
        puntosPasados={progreso.pasados}
        puntosOmitidos={progreso.omitidos}
        viaMolinos={vueltaActual.designacionActiva !== null}
        fase={fase}
        onEmpezarDia={jornada.empezarDia}
        empezandoDia={jornada.empezando}
        errorEmpezarDia={jornada.errorEmpezarDia}
        // El servidor descarta `inicio_jornada` si la asignación no es la de hoy.
        puedeEmpezarDia={!paqueteDia.vencido && !paqueteDia.cargando}
        jornadaCargando={jornada.cargando}
        canStart={
          Boolean(paqueteDia.paquete) &&
          !paqueteDia.vencido &&
          !paqueteDia.cargando &&
          !paqueteDia.error &&
          !(!settings.trabajarOffline && isOffline) &&
          // QUI-338 (brief punto 5): "Iniciar recorrido" tiene que reflejar la realidad del
          // permiso — `no_solicitado` NO bloquea a propósito (dispara el pedido explícito al
          // tocar el botón, ver `iniciar()` en `use-gps-operativo.ts`); los otros cuatro
          // estados sí, porque tocar el botón en esos casos no hacía nada.
          !gps.permisoGps.bloqueante
        }
        onStart={() => void gps.iniciar()}
        onFinish={confirmarFinalizacion}
        pausadoDesde={gps.pausadoDesde}
        onPause={() => void gps.pausar()}
        onResume={() => void gps.reanudar()}
        filaSalida={filaSalida}
        panY={sheetPanY}
        onAlto={setAltoSheet}
        onAltoVisible={setAltoSheetVisible}
        gpsError={gps.errorGps}
      />

      {/* Reportar incidencia: opciones fijas, sin texto libre */}
      <Modal
        visible={observacionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!enviandoObservacion) cerrarModalObservacion();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="alert-circle-outline" size={24} color={dsColors.primary} />
              <Heading size="lg" style={styles.modalTitle}>
                Reportar incidencia
              </Heading>
            </View>
            {observacionEnviada ? (
              <>
                <DsText size="sm" style={styles.modalText}>
                  Incidencia reportada. Se sincroniza junto con tu recorrido.
                </DsText>
                <DsButton variant="primary" onPress={cerrarModalObservacion}>
                  Listo
                </DsButton>
              </>
            ) : (
              <>
                {errorObservacion ? (
                  <DsText
                    accessibilityRole="alert"
                    style={[styles.dangerNotice, styles.observacionError]}
                  >
                    {errorObservacion}
                  </DsText>
                ) : null}
                <View accessibilityRole="radiogroup" style={styles.motivos}>
                  {OPCIONES_INCIDENCIA.map(({ etiqueta, icono }) => {
                    const elegida = observacion === etiqueta;
                    return (
                      <PildoraBurbuja
                        key={etiqueta}
                        icono={icono}
                        interior
                        accessibilityLabel={etiqueta}
                        onPress={enviandoObservacion ? undefined : () => setObservacion(etiqueta)}
                        style={elegida ? styles.motivoElegido : undefined}
                      >
                        {etiqueta}
                      </PildoraBurbuja>
                    );
                  })}
                </View>
                <View style={styles.observacionActions}>
                  <DsButton
                    variant="outline"
                    onPress={cerrarModalObservacion}
                    disabled={enviandoObservacion}
                    style={styles.modalAction}
                  >
                    Cancelar
                  </DsButton>
                  <DsButton
                    variant="primary"
                    onPress={() => void enviarObservacion()}
                    disabled={!observacion || enviandoObservacion}
                    style={styles.modalAction}
                  >
                    {enviandoObservacion ? 'Enviando…' : 'Enviar'}
                  </DsButton>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <ControlFeedbackToast
        ultimaDeteccion={gps.ultimaDeteccion}
        numeroDePuntoControl={numeroDePuntoControl}
      />
      <ContadorEsperaMolinos
        pastilla={vueltaActual.pastillaEspera}
        bottom={altoSheetVisible + dsSpace.md}
      />
      <AvisoDesignacion
        designada={vueltaActual.designacionPendiente !== null}
        esperaMin={vueltaActual.designacionPendiente?.puntoEspera.esperaMin ?? null}
        cancelada={vueltaActual.cancelacionPendiente}
        sinActualizar={vueltaActual.sinActualizar}
        // Si el banner de vuelta completada está visible, la tarjeta se apila debajo (el banner es
        // pasivo y la tarjeta tiene el botón: no se pueden superponer).
        top={
          insetSuperior + dsSpace.sm + (altoBannerVuelta > 0 ? altoBannerVuelta + dsSpace.sm : 0)
        }
        onEntenderDesignacion={vueltaActual.entenderDesignacion}
        onEntenderCancelacion={vueltaActual.entenderCancelacion}
      />
      <VueltaCompletadaBanner
        resumen={progreso.avisoVuelta}
        top={insetSuperior + dsSpace.sm}
        onTerminar={progreso.descartarAvisoVuelta}
        onAlto={setAltoBannerVuelta}
      />

      <QuivoConfirmDialog
        visible={confirmarFinVisible}
        variant="danger"
        title="¿Finalizar el recorrido?"
        message="El GPS dejará de registrar la jornada. Esta acción requiere confirmación."
        cancelLabel="Seguir recorriendo"
        confirmLabel="Finalizar"
        onCancel={() => setConfirmarFinVisible(false)}
        onConfirm={() => {
          setConfirmarFinVisible(false);
          void gps.detener();
        }}
      />

      <CerrarSesionDialog
        visible={confirmarLogoutVisible}
        onCancel={() => setConfirmarLogoutVisible(false)}
        onConfirm={() => {
          setConfirmarLogoutVisible(false);
          void props.onLogout();
        }}
      />
    </View>
  );
}

function AvisoBurbuja({
  icono,
  mensaje,
  accion,
  onAccion,
}: {
  icono: React.ComponentProps<typeof Ionicons>['name'];
  mensaje: ReactNode;
  accion?: string;
  onAccion?: () => void;
}) {
  return (
    <Burbuja direction="column" style={styles.avisoBurbuja}>
      <View style={styles.avisoFila}>
        <Ionicons name={icono} size={20} color={dsColors.danger} />
        <DsText size="sm" variant="error" accessibilityRole="alert" style={styles.avisoTexto}>
          {mensaje}
        </DsText>
      </View>
      {accion && onAccion ? (
        <DsButton
          variant="danger"
          size="md"
          onPress={onAccion}
          style={styles.avisoAccion}
          fullWidth
        >
          {accion}
        </DsButton>
      ) : null}
    </Burbuja>
  );
}

/** Chip calmo bajo el pill de distancia/velocidad: el 408 de ubicación es transitorio y no tiene
 * acción para el conductor, así que se informa sin alarma (paleta warning, sin animación más
 * allá de un fade-in) en vez de un error. Se monta solo mientras hay tracking + señal débil. */
function SenalGpsDebilChip() {
  const opacidad = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacidad, {
      toValue: 1,
      duration: dsDuration.fast,
      useNativeDriver: true,
    }).start();
  }, [opacidad]);
  return (
    <Animated.View
      style={[styles.senalDebilChip, { opacity: opacidad }]}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel="Señal GPS débil: los puntos pueden registrarse con retraso"
    >
      <Ionicons name="cellular-outline" size={14} color={dsColors.warningText} />
      <Text style={styles.senalDebilTexto}>Señal GPS débil</Text>
    </Animated.View>
  );
}

function MapLayer({
  loading,
  paquete,
  vehiculo,
  estadosPuntosControl,
  position,
  tracking,
  camara,
  onPanUsuario,
  insetsNavegacion,
  rutaCalculada,
  emisorRumbo,
  designacion,
  ordenEfectivo,
  fase,
}: {
  loading: boolean;
  paquete: PaqueteDia | null;
  vehiculo: ContextoOperativoMovil['vehiculo'];
  estadosPuntosControl: Readonly<Record<string, EstadoPuntoVuelta>>;
  position: { lat: number; lng: number } | null;
  tracking: boolean;
  camara: RouteMapProps['camara'];
  onPanUsuario: RouteMapProps['onPanUsuario'];
  insetsNavegacion: InsetsNavegacion;
  rutaCalculada: [number, number][] | null;
  emisorRumbo: RouteMapProps['emisorRumbo'];
  designacion: RouteMapProps['designacion'];
  ordenEfectivo: RouteMapProps['ordenEfectivo'];
  fase: RouteMapProps['fase'];
}) {
  if (loading) {
    return (
      <View style={styles.mapFallback}>
        <ActivityIndicator color={dsColors.primary} />
        <Text style={styles.mapFallbackText}>Preparando tu ruta…</Text>
      </View>
    );
  }
  if (!paquete) return <View style={styles.mapFallback} />;
  return (
    <MapErrorBoundary>
      <RouteMap
        paquete={paquete}
        vehiculo={vehiculo}
        estadosPuntosControl={estadosPuntosControl}
        posicionActual={position}
        tracking={tracking}
        camara={camara}
        onPanUsuario={onPanUsuario}
        insetsNavegacion={insetsNavegacion}
        rutaCalculada={rutaCalculada}
        emisorRumbo={emisorRumbo}
        designacion={designacion}
        ordenEfectivo={ordenEfectivo}
        fase={fase}
        style={styles.fullMap}
      />
    </MapErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: dsColors.surfacePage },
  fullMap: { flex: 1, height: undefined, borderRadius: 0 },
  mapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: dsSpace.sm,
    paddingBottom: 180,
  },
  mapFallbackText: {
    color: dsColors.textSecondary,
    ...fontStyle('body', '500'),
    fontSize: 12,
  },
  topOverlay: {
    position: 'absolute',
    left: quivoBubble.edge,
    right: quivoBubble.edge,
    gap: dsSpace.sm,
  },
  cabeceraBoton: { alignSelf: 'flex-start', minHeight: quivoBubble.touch },
  avisoBurbuja: { alignItems: 'stretch', alignSelf: 'stretch' },
  avisoFila: { flexDirection: 'row', alignItems: 'flex-start', gap: dsSpace.sm },
  avisoTexto: { flex: 1 },
  avisoAccion: { borderRadius: quivoBubble.innerRadius },
  senalDebilChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: dsSpace.sm,
    minHeight: quivoBubble.touch,
    paddingHorizontal: dsSpace.md,
    borderRadius: quivoBubble.innerRadius,
    backgroundColor: dsColors.warningSoft,
    borderWidth: 1,
    borderColor: dsColors.warning,
  },
  senalDebilTexto: {
    color: dsColors.warningText,
    ...fontStyle('body', '600'),
    fontSize: 14,
  },
  fabsContainer: { position: 'absolute', right: quivoBubble.edge },
  brujula: {
    width: quivoBubble.touch,
    height: quivoBubble.touch,
    borderRadius: quivoBubble.innerRadius,
  },
  velocidadContenedor: {
    position: 'absolute',
    left: quivoBubble.edge,
    gap: dsSpace.sm,
    alignItems: 'flex-start',
  },
  notice: {
    color: dsColors.warningText,
    backgroundColor: dsColors.warningSoft,
    borderRadius: quivoBubble.innerRadius,
    padding: dsSpace.md,
    fontSize: 14,
  },
  dangerNotice: {
    color: dsColors.danger,
    backgroundColor: dsColors.dangerSoft,
    borderRadius: quivoBubble.innerRadius,
    padding: dsSpace.md,
    fontSize: 14,
  },
  sesionNoRevalidadaContainer: { gap: dsSpace.sm },
  sesionNoRevalidadaButton: { alignSelf: 'stretch' },
  permisoGpsContainer: { gap: dsSpace.sm },
  permisoGpsButton: { alignSelf: 'stretch' },
  modalOverlay: {
    flex: 1,
    backgroundColor: quivoBubble.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: dsSpace.md,
  },
  modalContent: {
    backgroundColor: dsColors.surfaceRaised,
    borderRadius: quivoBubble.radius,
    padding: dsSpace.md,
    gap: dsSpace.md,
    width: '100%',
    maxWidth: 400,
    ...dsElevation(3),
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: dsSpace.sm },
  modalTitle: { flex: 1, color: dsColors.textPrimary },
  modalText: { color: dsColors.textSecondary },
  motivos: { flexDirection: 'row', flexWrap: 'wrap', gap: dsSpace.sm },
  motivoElegido: { backgroundColor: dsColors.primarySoft, borderColor: dsColors.primary },
  observacionError: { marginBottom: dsSpace.sm },
  observacionActions: { flexDirection: 'row', gap: dsSpace.sm },
  modalAction: { flex: 1, minHeight: quivoBubble.touch },
});
