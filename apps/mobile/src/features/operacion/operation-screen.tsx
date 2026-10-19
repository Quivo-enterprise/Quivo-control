import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Sentry from '@sentry/react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import {
  haversineMetros,
  resolverMarcaLinea,
  type ContextoOperativoMovil,
  type LineaBrand,
  type PaqueteDia,
} from '@quivo/shared';
import { abrirOutbox, encolarEvento } from '../../db/outbox';
import { Button } from '../../shared/components/Button';
import { Input } from '../../shared/components/Input';
import { quivoColors, quivoFonts, quivoRadius, quivoSpacing } from '../../shared/theme/quivo-theme';
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
import { formatearDistancia } from './format-distancia';
import { debePedirRuta, respuestaRutaVigente } from './debe-pedir-ruta';
import { ApiError } from '../../shared/api/http-client';
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
import { AvisoDesignacion, ContadorEsperaMolinos } from '../vuelta-actual/aviso-designacion';

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
  const [altoBannerVuelta, setAltoBannerVuelta] = useState(0);
  const [observacion, setObservacion] = useState('');
  const [enviandoObservacion, setEnviandoObservacion] = useState(false);
  const [observacionEnviada, setObservacionEnviada] = useState(false);
  const [errorObservacion, setErrorObservacion] = useState<string | null>(null);
  const [observacionModalVisible, setObservacionModalVisible] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
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
  const fabsBottom = altoSheet > 0 ? altoSheet + MARGEN_INFERIOR_SHEET + 12 : 180;

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

    const pedido = { ts: ahora, lat: posicion.lat, lng: posicion.lng, destino: destinoRuteo, fallo: false };
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
        // Solo el fallo de transporte (red/timeout/5xx) reintenta pasados 15 s aunque el conductor
        // esté quieto; cualquier otro error se reporta y se trata como respuesta sin ruta.
        const transporte =
          error instanceof ApiError &&
          (error.kind === 'network' || (error.kind === 'http' && (error.status ?? 0) >= 500));
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

  const enviarObservacion = useCallback(async () => {
    const texto = observacion.trim();
    if (!texto) return;
    setEnviandoObservacion(true);
    setErrorObservacion(null);
    try {
      const db = await abrirOutbox();
      await encolarEvento(db, {
        deviceId: props.deviceId,
        tipo: 'observacion',
        payload: { sesionId: props.contexto.sesionId, texto },
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
      setErrorObservacion('No se pudo guardar la observación. Vuelve a intentarlo.');
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

      <View pointerEvents="box-none" style={styles.topOverlay} onLayout={onLayoutTopOverlay}>
        <View style={{ flexDirection: 'column', gap: quivoSpacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: quivoSpacing.md }}>
            <Pressable
              style={{ flex: 1 }}
              accessibilityRole="button"
              accessibilityLabel="Perfil y configuración"
              onPress={() => props.navigation.navigate('Perfil')}
            >
              <DriverRouteCard
                contexto={props.contexto}
                brand={lineaBrand}
                tracking={gps.tracking}
                jornadaIniciada={jornada.jornadaIniciada}
                inicioTs={jornada.inicioTs}
                compacta={camara.modo !== 'general'}
                viaMolinos={vueltaActual.designacionActiva !== null}
              />
            </Pressable>
          </View>
        </View>

        {gps.tracking && proximoPuntoControl && (
          <NavigationInstructionCard
            distanciaMetros={distanciaProximoPunto}
            velocidadKmh={gps.posicionActual?.speedKmh ?? null}
            brand={lineaBrand}
          />
        )}

        {gps.tracking && gps.senalGpsDebil ? <SenalGpsDebilChip /> : null}

        {props.aviso ? <Text style={styles.notice}>{props.aviso}</Text> : null}
        {/* QUI-338 (reportado desde la calle: Samsung Galaxy A71, Android 10-13 — conductor
            sin ubicación y sin ningún mensaje que le dijera qué tocar): antes, "Iniciar
            recorrido" quedaba habilitado sin importar el permiso y `iniciar()` fallaba en
            silencio contra un mensaje genérico sin acción. Se oculta mientras `gps.tracking`
            porque el permiso ya estaba en orden cuando arrancó — mismo criterio que el resto
            de los banners de esta pantalla, uno por causa raíz, sin duplicar alarmas. Reusa
            el patrón exacto de `sesionNoRevalidada` de abajo (texto `dangerNotice` + botón de
            acción a todo el ancho). */}
        {!gps.tracking && gps.permisoGps.bloqueante ? (
          <View style={styles.permisoGpsContainer}>
            <Text accessibilityRole="alert" style={styles.dangerNotice}>
              {gps.permisoGps.mensaje}
            </Text>
            {gps.permisoGps.accion ? (
              <Button
                variant="danger"
                onPress={manejarAbrirAjustesPermisoGps}
                style={styles.permisoGpsButton}
              >
                {gps.permisoGps.etiquetaAccion}
              </Button>
            ) : null}
          </View>
        ) : null}
        {props.sesionNoRevalidada ? (
          <View style={styles.sesionNoRevalidadaContainer}>
            <Text accessibilityRole="alert" style={styles.dangerNotice}>
              No se pudo revalidar tu sesión. El recorrido se sigue grabando, pero no va a
              sincronizar hasta que vuelvas a iniciar sesión.
            </Text>
            <Button
              variant="danger"
              onPress={confirmarCierreSesion}
              style={styles.sesionNoRevalidadaButton}
            >
              Vuelve a iniciar sesión para sincronizar
            </Button>
          </View>
        ) : null}
        {/* Rescope SESION_NO_VIGENTE, punto C: bloqueante y NO descartable a propósito — sin
            botón para cerrarlo, distinto del banner de `sesionNoRevalidada` de arriba (que sí
            puede ignorarse, esto no: el servidor ya dio la sesión por muerta). El único botón
            abre el MISMO diálogo de confirmación de "Finalizar" que ya usa `NextControlSheet`
            (`confirmarFinalizacion`) — al confirmar, `gps.detener()` escribe `fin_recorrido` y
            recién ahí el efecto de arriba dispara `onSesionNoVigenteFinalizada`. */}
        {props.sesionNoVigente ? (
          <View style={styles.sesionNoRevalidadaContainer}>
            <Text accessibilityRole="alert" style={styles.dangerNotice}>
              Tu sesión venció. Toca Finalizar y vuelve a iniciar sesión.
            </Text>
            <Button
              variant="danger"
              onPress={confirmarFinalizacion}
              style={styles.sesionNoRevalidadaButton}
            >
              Finalizar recorrido
            </Button>
          </View>
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
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            Asignación vencida. Reconecta antes de iniciar otro recorrido.
          </Text>
        ) : null}
        {paqueteDia.error ? (
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            {paqueteDia.error}
          </Text>
        ) : null}
        <AvisoFotoVehiculo
          sesionId={props.contexto.sesionId}
          tracking={gps.tracking}
          obtenerAccessToken={props.obtenerAccessToken}
        />
        {!settings.trabajarOffline && isOffline ? (
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            Modo offline desactivado en tus Ajustes. Conéctate a internet para iniciar.
          </Text>
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
        style={[styles.fabsContainer, { bottom: fabsBottom, transform: [{ translateY: sheetPanY }] }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Registrar observación"
          style={styles.recenterButton}
          onPress={() => setObservacionModalVisible(true)}
        >
          <Ionicons name="alert-circle-outline" size={24} color="#3127B1" />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Información de registro"
          style={styles.recenterButton}
          onPress={() => setShowInfo(true)}
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={24}
            color={gps.tracking ? '#FD9E15' : '#3127B1'}
          />
        </Pressable>

        {__DEV__ && gps.tracking && proximoPuntoControl && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Simular detección (Debug)"
            style={[styles.recenterButton, { backgroundColor: quivoColors.accentSoft }]}
            onPress={() => gps.simularDeteccion(proximoPuntoControl.id, distanciaProximoPunto)}
          >
            <Ionicons name="bug" size={22} color={quivoColors.accentStrong} />
          </Pressable>
        )}

        {/* Brújula propia (la nativa está apagada). Solo en navegación: alterna rumbo arriba / norte
            arriba. En libre el único control de recentrado es el pill "Centrar"; en la vista general
            (norte fijo) no hace falta. */}
        {camara.modo === 'navegacion' && (
          <BrujulaMapa
            emisor={emisorRumbo}
            style={styles.recenterButton}
            norteFijo={camara.orientacion === 'norte'}
            accessibilityLabel={
              camara.orientacion === 'norte'
                ? 'Brújula: orientar el mapa según tu rumbo'
                : 'Brújula: fijar el norte arriba'
            }
            onPress={alternarOrientacion}
          />
        )}

        {camara.modo === 'general' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ver ruta completa"
            style={styles.recenterButton}
            onPress={recentrar}
          >
            <Ionicons name="locate" size={24} color="#3127B1" />
          </Pressable>
        )}
      </Animated.View>

      {/* "Centrar": solo en modo libre, bien visible (estilo Google Maps) abajo a la izquierda,
          encima del sheet y siguiéndolo al arrastrar. */}
      {camara.modo === 'libre' && (
        <Animated.View
          style={[styles.centrarContenedor, { bottom: fabsBottom, transform: [{ translateY: sheetPanY }] }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Recentrar"
            style={styles.centrarPill}
            onPress={recentrar}
          >
            <Ionicons name="navigate" size={20} color="#3127B1" />
            <Text style={styles.centrarTexto}>Centrar</Text>
          </Pressable>
        </Animated.View>
      )}

      <NextControlSheet
        contexto={props.contexto}
        nextPointOrder={ordenProximoEfectivo}
        totalPoints={progreso.total}
        estadosPuntos={estadosStepper}
        vueltaActual={progreso.vueltaActual}
        puntosPasados={progreso.pasados}
        puntosOmitidos={progreso.omitidos}
        distanciaMetros={distanciaProximoPunto}
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
        panY={sheetPanY}
        onAlto={setAltoSheet}
        onAltoVisible={setAltoSheetVisible}
        gpsError={gps.errorGps}
      />

      <Modal
        visible={showInfo}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowInfo(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={85} tint="light" style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="checkmark-circle-outline" size={20} color="#3127B1" />
              <Text style={styles.modalTitle}>Registro automatico</Text>
            </View>
            <Text style={styles.modalText}>
              Al entrar al radio del punto de control, este se registra automáticamente en el sistema
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Entendido"
              onPress={() => setShowInfo(false)}
              style={({ pressed }) => [styles.modalPillButton, pressed && styles.pressedButton]}
            >
              <Text style={styles.modalPillButtonText}>ENTENDIDO</Text>
            </Pressable>
          </BlurView>
        </View>
      </Modal>

      {/* Observación modal */}
      <Modal
        visible={observacionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!enviandoObservacion) cerrarModalObservacion();
        }}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={85} tint="light" style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="alert-circle-outline" size={20} color="#3127B1" />
              <Text style={styles.modalTitle}>Registrar observación</Text>
            </View>
            {observacionEnviada ? (
              <>
                <Text style={styles.modalText}>
                  Observación enviada. Se sincroniza junto con tu recorrido.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Listo"
                  onPress={cerrarModalObservacion}
                  style={({ pressed }) => [styles.modalPillButton, pressed && styles.pressedButton]}
                >
                  <Text style={styles.modalPillButtonText}>LISTO</Text>
                </Pressable>
              </>
            ) : (
              <>
                {errorObservacion ? (
                  <Text accessibilityRole="alert" style={[styles.dangerNotice, styles.observacionError]}>
                    {errorObservacion}
                  </Text>
                ) : null}
                <Input
                  controlSize="lg"
                  multiline
                  numberOfLines={3}
                  value={observacion}
                  onChangeText={setObservacion}
                  placeholder="Describe lo que pasó…"
                  editable={!enviandoObservacion}
                  inputShellStyle={styles.observacionShell}
                  accessibilityLabel="Texto de la observación"
                />
                <View style={styles.observacionActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancelar"
                    onPress={cerrarModalObservacion}
                    disabled={enviandoObservacion}
                    style={({ pressed }) => [styles.modalCancelButton, pressed && styles.pressedButton]}
                  >
                    <Text style={styles.modalCancelButtonText}>CANCELAR</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Enviar"
                    onPress={() => void enviarObservacion()}
                    disabled={!observacion.trim() || enviandoObservacion}
                    style={({ pressed }) => [
                      styles.modalConfirmButton,
                      (!observacion.trim() || enviandoObservacion) && styles.disabledButton,
                      pressed && styles.pressedButton,
                    ]}
                  >
                    {enviandoObservacion ? (
                      <ActivityIndicator color={quivoColors.white} size="small" />
                    ) : (
                      <Text style={styles.modalConfirmButtonText}>ENVIAR</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </BlurView>
        </View>
      </Modal>

      <ControlFeedbackToast ultimaDeteccion={gps.ultimaDeteccion} />
      <ContadorEsperaMolinos
        restanteMin={vueltaActual.restanteEspera}
        bottom={altoSheetVisible + quivoSpacing.md}
      />
      <AvisoDesignacion
        esperaMin={vueltaActual.designacionPendiente?.puntoEspera.esperaMin ?? null}
        cancelada={vueltaActual.cancelacionPendiente}
        sinActualizar={vueltaActual.sinActualizar}
        // Si el banner de vuelta completada está visible, la tarjeta se apila debajo (el banner es
        // pasivo y la tarjeta tiene el botón: no se pueden superponer).
        top={insetSuperior + 8 + (altoBannerVuelta > 0 ? altoBannerVuelta + 8 : 0)}
        onEntenderDesignacion={vueltaActual.entenderDesignacion}
        onEntenderCancelacion={vueltaActual.entenderCancelacion}
      />
      <VueltaCompletadaBanner
        resumen={progreso.avisoVuelta}
        top={insetSuperior + 8}
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

function NavigationInstructionCard({
  distanciaMetros,
  velocidadKmh,
}: {
  distanciaMetros: number | null;
  velocidadKmh: number | null;
  brand: LineaBrand;
}) {
  const distanciaFormateada = distanciaMetros === null ? '120m' : formatearDistancia(distanciaMetros);
  // Siempre visible mientras hay recorrido activo (antes se ocultaba del todo sin un fix de
  // GPS con velocidad válida, así que en la práctica nunca se veía) — sin velocidad real
  // todavía, se muestra "0 km/h" en vez de nada: el conductor espera ver el dato ahí, no que
  // aparezca y desaparezca según la calidad del fix.
  const velocidadRedondeada = velocidadKmh === null ? 0 : Math.round(velocidadKmh);
  return (
    <BlurView intensity={80} tint="light" style={styles.navInstructionCard}>
      <Ionicons name="arrow-up" size={18} color="#3127B1" />
      <Text style={styles.navDistance}>{distanciaFormateada}</Text>
      <View style={styles.navDivider} />
      <Ionicons name="speedometer-outline" size={16} color="#4B4B6B" />
      <Text style={styles.navSpeed}>{velocidadRedondeada} km/h</Text>
    </BlurView>
  );
}

/** Chip calmo bajo el pill de distancia/velocidad: el 408 de ubicación es transitorio y no tiene
 * acción para el conductor, así que se informa sin alarma (paleta warning, sin animación más
 * allá de un fade-in) en vez de un error. Se monta solo mientras hay tracking + señal débil. */
function SenalGpsDebilChip() {
  const opacidad = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacidad, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [opacidad]);
  return (
    <Animated.View
      style={[styles.senalDebilChip, { opacity: opacidad }]}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel="Señal GPS débil: los puntos pueden registrarse con retraso"
    >
      <Ionicons name="cellular-outline" size={14} color={quivoColors.warningText} />
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
        <ActivityIndicator color={quivoColors.primary} />
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
    top: Platform.OS === 'ios' ? 12 : 16,
    left: 16,
    right: 16,
    gap: 8,
  },
  navInstructionCard: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    marginTop: 2,
  },
  senalDebilChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: quivoRadius.pill,
    backgroundColor: quivoColors.warningSoft,
    borderWidth: 1,
    borderColor: quivoColors.warningBorder,
  },
  senalDebilTexto: {
    color: quivoColors.warningText,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 12,
  },
  navDistance: {
    color: '#3127B1',
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
  },
  navDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(49, 39, 177, 0.18)',
  },
  navSpeed: {
    color: '#4B4B6B',
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 13,
  },
  // Fila horizontal de FABs a la derecha, a la altura del pill "Centrar" (izquierda). En navegación
  // son hasta 4 (obs, info, bug de dev, brújula) = 4×42 + 3×12 = 204 dp; el pill (~120 dp) solo
  // existe en libre, donde la brújula no se muestra, así que en 360 dp nunca se solapan.
  fabsContainer: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  centrarContenedor: {
    position: 'absolute',
    left: 16,
  },
  centrarPill: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: quivoRadius.pill,
    backgroundColor: quivoColors.white,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  centrarTexto: {
    color: '#3127B1',
    fontFamily: quivoFonts.displayBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
  recenterButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
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
  sesionNoRevalidadaContainer: {
    gap: quivoSpacing.xs,
  },
  sesionNoRevalidadaButton: {
    alignSelf: 'stretch',
  },
  permisoGpsContainer: {
    gap: quivoSpacing.xs,
  },
  permisoGpsButton: {
    alignSelf: 'stretch',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(25, 20, 60, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: quivoSpacing.lg,
  },
  modalContent: {
    backgroundColor: 'rgba(236, 239, 244, 0.92)',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    width: '100%',
    maxWidth: 290,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  modalTitle: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 16,
    color: '#3127B1',
    letterSpacing: 0.2,
    flex: 1,
  },
  modalText: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16.5,
    color: '#475569',
    marginBottom: 16,
  },
  modalPillButton: {
    height: 38,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A0E70',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  modalPillButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 13,
    letterSpacing: 0.8,
    color: quivoColors.white,
  },
  observacionShell: {
    backgroundColor: '#DCE0E8',
    borderRadius: 14,
    borderWidth: 0,
  },
  observacionError: {
    marginBottom: 8,
  },
  observacionActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  modalCancelButton: {
    flex: 1,
    height: 38,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#DCE0E8',
    borderWidth: 1.5,
    borderColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.6,
    color: '#3127B1',
  },
  modalConfirmButton: {
    flex: 1,
    height: 38,
    borderRadius: quivoRadius.pill,
    backgroundColor: '#3127B1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A0E70',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  modalConfirmButtonText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 12.5,
    letterSpacing: 0.6,
    color: quivoColors.white,
  },
  disabledButton: {
    opacity: 0.5,
  },
  pressedButton: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
