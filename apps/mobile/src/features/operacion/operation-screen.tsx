import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Sentry from '@sentry/react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';
import { Svg, Circle, Line } from 'react-native-svg';
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
import { completadosTrasDeteccion, proximoPuntoControlPendiente } from './proximo-punto-control';
import { RouteMapView } from './route-map-view';
import { NextControlSheet } from './next-control-sheet';
import { useSyncStatus } from './use-sync-status';
import { formatearDistancia } from './format-distancia';
import { ruteoApi } from '../../shared/api/ruteo-api';
import { ControlFeedbackToast } from './control-feedback-toast';
import { QuivoConfirmDialog } from '../../shared/components/quivo-confirm-dialog';
import { CerrarSesionDialog } from '../../shared/components/cerrar-sesion-dialog';
import { useGpsContext } from './gps-provider';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { OperationStackParamList } from '../../app/operation-navigator';
import { useOperacionSettings } from '../perfil/use-operacion-settings';

interface OperationScreenProps {
  contexto: ContextoOperativoMovil;
  deviceId: string;
  aviso: string | null;
  /** A5 (hallazgo de revisión, alto): se agotó el backoff de revalidación de sesión
   * (`refrescarConReintentos` en `use-auth-movil.ts`) sin lograr un refresh válido — distinto
   * del `aviso` genérico de "sin red", que es engañoso acá si la sesión fue cerrada
   * server-side. Renderizado como alerta con CTA explícito más abajo. */
  sesionNoRevalidada: boolean;
  loading: boolean;
  obtenerAccessToken: () => Promise<string | null>;
  onLogout: () => Promise<void>;
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
  const [completados, setCompletados] = useState<Set<string>>(new Set());
  const [observacion, setObservacion] = useState('');
  const [enviandoObservacion, setEnviandoObservacion] = useState(false);
  const [observacionEnviada, setObservacionEnviada] = useState(false);
  const [errorObservacion, setErrorObservacion] = useState<string | null>(null);
  const [observacionModalVisible, setObservacionModalVisible] = useState(false);
  const [recenterTick, setRecenterTick] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const sheetPanY = useRef(new Animated.Value(0)).current;

  // M3 (hallazgo de revisión, medio): `puntosControl.length` se lee por REF, no como
  // dependencia del efecto de abajo — mismo patrón que `onLocationRef` en
  // `use-gps-operativo.ts`. Si el paquete del día se refresca a mitad de jornada (un punto de
  // control dado de baja, commit 9a0e472) este cambio NO debe, por sí solo, reprocesar la
  // MISMA `gps.ultimaDeteccion` con el nuevo total: con `completados` en 20 de 36 y el
  // refresco trayendo 18, `20 >= 18` reseteaba `completados` a un Set vacío y el guiado
  // saltaba al punto 1 con el bus a mitad de recorrido.
  const puntosControlLengthRef = useRef(puntosControl.length);
  useEffect(() => {
    puntosControlLengthRef.current = puntosControl.length;
  }, [puntosControl.length]);

  useEffect(() => {
    if (!gps.ultimaDeteccion) return;
    // Plan §2.5 ("reset del próximo punto por vuelta") — lógica pura y testeada en
    // `completadosTrasDeteccion` (`proximo-punto-control.ts`): sin esto, `completados` solo
    // crecía y nunca se limpiaba entre vueltas, así que al terminar la vuelta 1 se quedaba
    // "sin próximo punto" el resto del día.
    setCompletados((actual) =>
      completadosTrasDeteccion(
        actual,
        gps.ultimaDeteccion!.puntoControlId,
        puntosControlLengthRef.current,
      ),
    );
  }, [gps.ultimaDeteccion]);
  useEffect(() => {
    if (!gps.tracking) setCompletados(new Set());
  }, [gps.tracking]);

  const proximoPuntoControl = useMemo(
    () => proximoPuntoControlPendiente(puntosControl, completados),
    [puntosControl, completados],
  );

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
  } | null>(null);
  const trackingAnterior = useRef(gps.tracking);
  const destinoRuteo =
    proximoPuntoControl?.coord.coordinates ??
    paqueteDia.paquete?.ruta.geometria.coordinates.at(-1) ??
    null;
  useEffect(() => {
    const acabaDeIniciar = gps.tracking && !trackingAnterior.current;
    trackingAnterior.current = gps.tracking;

    if (!gps.posicionActual || !destinoRuteo) {
      setRutaCalculada(null);
      return;
    }
    const posicion = gps.posicionActual;
    const anterior = ultimoFetchRuta.current;
    const ahora = Date.now();
    // Si el destino cambió (se completó un punto de control y avanzamos al siguiente),
    // el throttle por distancia/tiempo no aplica: sin esto, el mapa seguía mostrando la
    // ruta OSRM calculada para el punto anterior hasta que el conductor se movía 50m.
    const mismoDestino =
      anterior?.destino[0] === destinoRuteo[0] && anterior?.destino[1] === destinoRuteo[1];
    const distanciaDesdeUltimoFetch = anterior
      ? haversineMetros([posicion.lng, posicion.lat], [anterior.lng, anterior.lat])
      : Infinity;
    if (
      !acabaDeIniciar &&
      mismoDestino &&
      anterior &&
      distanciaDesdeUltimoFetch < 50 &&
      ahora - anterior.ts < 15_000
    ) {
      return;
    }

    ultimoFetchRuta.current = {
      ts: ahora,
      lat: posicion.lat,
      lng: posicion.lng,
      destino: destinoRuteo,
    };
    let cancelado = false;
    void (async () => {
      const token = await props.obtenerAccessToken();
      if (!token || cancelado) return;
      const resultado = await ruteoApi.rutaAPunto(
        posicion,
        { lat: destinoRuteo[1], lng: destinoRuteo[0] },
        token,
      );
      if (!cancelado) setRutaCalculada(resultado?.coordenadas ?? null);
    })();
    return () => {
      cancelado = true;
    };
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
        nextPointId={proximoPuntoControl?.id ?? null}
        position={gps.posicionActual}
        tracking={gps.tracking}
        recenterTick={recenterTick}
        rutaCalculada={rutaCalculada}
      />

      <View pointerEvents="box-none" style={styles.topOverlay}>
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
        {!settings.trabajarOffline && isOffline ? (
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            Modo offline desactivado en tus Ajustes. Conéctate a internet para iniciar.
          </Text>
        ) : null}
      </View>

      <Animated.View style={[styles.fabsContainer, { transform: [{ translateY: sheetPanY }] }]}>
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Centrar en mi ubicación"
          style={styles.recenterButton}
          onPress={() => setRecenterTick((t) => t + 1)}
        >
          <Ionicons name="locate" size={24} color="#3127B1" />
        </Pressable>
      </Animated.View>

      <NextControlSheet
        contexto={props.contexto}
        nextPointOrder={proximoPuntoControl?.orden ?? null}
        totalPoints={puntosControl.length}
        distanciaMetros={distanciaProximoPunto}
        tracking={gps.tracking}
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

function DriverRouteCard({
  contexto,
  tracking,
  brand,
}: {
  contexto: ContextoOperativoMovil;
  brand: LineaBrand;
  tracking: boolean;
}) {
  // Entrega 4 (`docs/estados-red-vs-captura.md`): el status pill de abajo se guía solo por
  // `tracking` — mismo criterio que el fix equivalente en `perfil-screen.tsx` — nunca por
  // `isOffline`, que ya no es una prop de este componente.
  const modeloVehiculo = `${contexto.vehiculo.placa} ${contexto.vehiculo.modelo || 'Toyota Hiace'}`.trim();
  const statusLabel = tracking ? 'EN LINEA' : 'EN ESPERA';

  return (
    // Más blur (pedido explícito) — 80 -> 100, el máximo que acepta expo-blur.
    <BlurView intensity={100} tint="light" style={styles.identityCard}>
      <View style={styles.avatar} />
      <View style={styles.identityText}>
        <Text numberOfLines={1} style={styles.driverName}>
          {contexto.conductor.nombre}
        </Text>
        <Text numberOfLines={1} style={styles.sindicatoText}>
          {contexto.sindicato.nombre}
        </Text>
        <Text numberOfLines={1} style={styles.vehicleText}>
          {modeloVehiculo}
        </Text>
      </View>
      <View style={styles.routeSummary}>
        {/* Antes el "120" solo tomaba un color naranja/morado según tracking, sin relación con
            la línea real — `resolverMarcaLinea` (@quivo/shared) ya trae hasta 3 colores de
            marca por línea (primary/secondary/tertiary), la misma fuente que usa
            `assignment-selection-screen.tsx`. Acá: fondo = primary, borde = tertiary, y una
            franja inferior = secondary — así el badge sí identifica la línea, no el estado. */}
        <View style={[styles.lineBadge, { backgroundColor: brand.primary, borderColor: brand.tertiary }]}>
          <Text style={[styles.lineBadgeText, { color: brand.text }]}>{contexto.linea.codigo}</Text>
          <View style={[styles.lineBadgeAccent, { backgroundColor: brand.secondary }]} />
        </View>
        {/* "EN LÍNEA"/"EN ESPERA" como badge con punto de estado (mismo lenguaje visual que los
            badges de `perfil-screen.tsx`), en vez de solo texto de color — se distingue del
            badge de línea de arriba, que ahora es sobre la marca, no sobre el estado. */}
        <View style={[styles.statusPill, tracking ? styles.statusPillActive : styles.statusPillIdle]}>
          <View style={[styles.statusDot, { backgroundColor: tracking ? '#22C55E' : '#94A3B8' }]} />
          <Text style={[styles.statusPillText, tracking ? styles.statusPillTextActive : styles.statusPillTextIdle]}>
            {statusLabel}
          </Text>
        </View>
      </View>
    </BlurView>
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

function MapLayer({
  loading,
  paquete,
  vehiculo,
  nextPointId,
  position,
  tracking,
  recenterTick,
  rutaCalculada,
}: {
  loading: boolean;
  paquete: PaqueteDia | null;
  vehiculo: ContextoOperativoMovil['vehiculo'];
  nextPointId: string | null;
  position: { lat: number; lng: number } | null;
  tracking: boolean;
  recenterTick: number;
  rutaCalculada: [number, number][] | null;
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
        vehiculo={vehiculo}
        proximoPuntoControlId={nextPointId}
        posicionActual={position}
        tracking={tracking}
        recenterTick={recenterTick}
        rutaCalculada={rutaCalculada}
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
    top: Platform.OS === 'ios' ? 12 : 16,
    left: 16,
    right: 16,
    gap: 8,
  },
  identityCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#3127B1',
  },
  avatarText: { color: quivoColors.white, fontFamily: quivoFonts.displayBold, fontSize: 16 },
  identityText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  driverName: {
    color: '#3127B1',
    fontFamily: quivoFonts.displayBold,
    fontSize: 15.5,
  },
  sindicatoText: {
    color: '#334155',
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 10.5,
    marginTop: 1,
  },
  vehicleText: {
    color: '#475569',
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 9.5,
    marginTop: 1,
  },
  routeSummary: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 54,
  },
  lineBadge: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 10,
    paddingTop: 3,
    paddingBottom: 5,
    overflow: 'hidden',
  },
  lineBadgeText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    lineHeight: 22,
    textAlign: 'center',
  },
  lineBadgeAccent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: quivoRadius.pill,
  },
  statusPillActive: { backgroundColor: 'rgba(34, 197, 94, 0.14)' },
  statusPillIdle: { backgroundColor: 'rgba(49, 39, 177, 0.10)' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 8.5,
    letterSpacing: 0.5,
  },
  statusPillTextActive: { color: '#15803D' },
  statusPillTextIdle: { color: '#3127B1' },
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
  fabsContainer: {
    position: 'absolute',
    right: 16,
    bottom: 180,
    gap: 12,
    alignItems: 'center',
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
