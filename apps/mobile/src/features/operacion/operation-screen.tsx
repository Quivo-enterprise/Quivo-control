import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { OfflineBanner } from './offline-banner';
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
  const { pendientes, errorSync, isOffline, isSyncing } = useSyncStatus(
    props.obtenerAccessToken,
    props.contexto.sesionId,
  );
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
                isOffline={isOffline}
              />
            </Pressable>
          </View>
          <OfflineBanner isOffline={isOffline} />
        </View>

        {gps.tracking && proximoPuntoControl && (
          <NavigationInstructionCard distanciaMetros={distanciaProximoPunto} brand={lineaBrand} />
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
        {/* Plan §2.2, punto 3 (hallazgo de revisión): `errorSync` se leía de `useSyncStatus`
            pero nunca se mostraba — el conductor no tenía forma de enterarse de que la
            sincronización venía fallando. Se oculta si ya se muestra el banner de
            `sesionNoRevalidada` arriba (ese caso ya explica, con más precisión, por qué no
            sincroniza) para no duplicar alarmas por el mismo motivo. El texto aclara
            explícitamente que los datos NO se pierden (el outbox los retiene) para no
            alarmar de más a alguien manejando. */}
        {errorSync && !props.sesionNoRevalidada ? (
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            No se pudo sincronizar el recorrido. Tus datos están guardados en el teléfono y se
            van a enviar solos apenas haya conexión.
          </Text>
        ) : null}
        {pendientes >= 800 ? (
          <Text accessibilityRole="alert" style={styles.dangerNotice}>
            Almacenamiento local casi lleno (80%). Conéctate pronto para sincronizar.
          </Text>
        ) : null}
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
        {gps.tracking && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Información de registro"
            style={styles.recenterButton}
            onPress={() => setShowInfo(true)}
          >
            <Ionicons name="information" size={24} color={quivoColors.primary} />
          </Pressable>
        )}
        {gps.tracking && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Registrar observación"
            style={styles.recenterButton}
            onPress={() => setObservacionModalVisible(true)}
          >
            <Ionicons name="chatbubble-ellipses" size={24} color={quivoColors.primary} />
          </Pressable>
        )}
        {__DEV__ && gps.tracking && proximoPuntoControl && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Simular detección (Debug)"
            style={[styles.recenterButton, { backgroundColor: quivoColors.accentSoft }]}
            onPress={() => gps.simularDeteccion(proximoPuntoControl.id)}
          >
            <Ionicons name="bug" size={24} color={quivoColors.accentStrong} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Centrar en mi ubicación"
          style={styles.recenterButton}
          onPress={() => setRecenterTick((t) => t + 1)}
        >
          <Svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke={quivoColors.primary}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Circle cx="12" cy="12" r="7" />
            <Line x1="12" y1="1" x2="12" y2="5" />
            <Line x1="12" y1="19" x2="12" y2="23" />
            <Line x1="1" y1="12" x2="5" y2="12" />
            <Line x1="19" y1="12" x2="23" y2="12" />
          </Svg>
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
        pendingEvents={pendientes}
        isOffline={isOffline}
        isSyncing={isSyncing}
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
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Ionicons name="information-circle" size={32} color={quivoColors.primary} />
              <Text style={styles.modalTitle}>Registro Automático</Text>
            </View>
            <Text style={styles.modalText}>
              Al entrar al radio del punto de control, se registrará automáticamente en el sistema
              sin necesidad de intervención manual.
            </Text>
            <Button
              variant="primary"
              onPress={() => setShowInfo(false)}
              style={{ marginTop: quivoSpacing.xl }}
            >
              Entendido
            </Button>
          </View>
        </View>
      </Modal>

      {/* Hallazgo 3 (MEDIO, ver docs/plan-v2-app-y-mapa-en-vivo.md §2.4): el botón de
          "Registrar observación" era un no-op — `enviarObservacion` y su estado ya estaban
          completos (encolan un evento `observacion` al outbox) pero nada los disparaba.
          Reusa el mismo patrón de modal que "Registro Automático" arriba (mismos estilos
          `modalOverlay`/`modalContent`/`modalHeader`/`modalTitle`) y los componentes del
          design system (`Input`, `Button`, mismo que el resto de la app) — pocos toques,
          texto grande, y un botón de cancelar siempre disponible para manejar mientras se
          usa. */}
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
              <Ionicons name="chatbubble-ellipses" size={32} color={quivoColors.primary} />
              <Text style={styles.modalTitle}>Registrar observación</Text>
            </View>
            {observacionEnviada ? (
              <>
                <Text style={styles.modalText}>
                  Observación enviada. Se sincroniza junto con tu recorrido.
                </Text>
                <Button variant="primary" onPress={cerrarModalObservacion} style={{ marginTop: quivoSpacing.xl }}>
                  Listo
                </Button>
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
                  numberOfLines={4}
                  value={observacion}
                  onChangeText={setObservacion}
                  placeholder="Describe lo que pasó…"
                  editable={!enviandoObservacion}
                  style={styles.observacionInput}
                  accessibilityLabel="Texto de la observación"
                />
                <View style={styles.observacionActions}>
                  <Button
                    variant="outline"
                    onPress={cerrarModalObservacion}
                    disabled={enviandoObservacion}
                    style={styles.actionButton}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    onPress={() => void enviarObservacion()}
                    loading={enviandoObservacion}
                    disabled={!observacion.trim() || enviandoObservacion}
                    style={styles.actionButton}
                  >
                    Enviar
                  </Button>
                </View>
              </>
            )}
          </View>
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

      {/* Hallazgo ALTO (piloto día 1, ver docs/plan-v2-app-y-mapa-en-vivo.md §2.4): antes,
          el botón de "Vuelve a iniciar sesión" del banner de arriba llamaba a
          `props.onLogout()` de un solo toque. `logout()` corre `borrarSesionMovil()`, y el
          siguiente tick headless entra por `obtenerContextoUbicacionPersistido()` → `!sesion`
          → `detenerTrackingNativo()`: un `stop()` nativo IRREVERSIBLE (apaga `startOnBoot`,
          nunca encola `fin_recorrido`) justo cuando el banner de arriba promete "El recorrido
          se sigue grabando". Mismo patrón que `confirmarFinVisible`/`onFinish` arriba: exige
          confirmación explícita antes de cortar la captura GPS de un conductor a mitad de
          turno. El mensaje del diálogo vive en `CerrarSesionDialog` (Hallazgo 2, ALTO): antes
          este mensaje estaba duplicado acá y en `perfil-screen.tsx`, y solo este call site lo
          tenía completo. */}
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
  brand,
  tracking,
  isOffline,
}: {
  contexto: ContextoOperativoMovil;
  brand: LineaBrand;
  tracking: boolean;
  isOffline: boolean;
}) {
  return (
    <View
      style={[
        styles.identityCard,
        { borderLeftColor: brand.secondary, backgroundColor: brand.background },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: brand.primary }]}>
        <Text style={styles.avatarText}>{initials(contexto.conductor.nombre)}</Text>
      </View>
      <View style={styles.identityText}>
        <Text numberOfLines={1} style={styles.driverName}>
          {contexto.conductor.nombre}
        </Text>
        <Text numberOfLines={1} style={styles.sindicatoText}>
          ({contexto.sindicato.nombre})
        </Text>
        <Text numberOfLines={1} style={styles.vehicleText}>
          {contexto.vehiculo.numeroInterno ? `#${contexto.vehiculo.numeroInterno} · ` : ''}
          {contexto.vehiculo.placa} - {contexto.vehiculo.marca} {contexto.vehiculo.modelo}
        </Text>
      </View>
      <View style={styles.routeSummary}>
        <Text style={[styles.lineCode, { color: brand.primary }]}>{brand.shortName}</Text>
        <Text style={styles.lineName}>Línea {contexto.linea.codigo}</Text>
        <View style={styles.profileStatus}>
          <View
            style={[
              styles.profileStatusDot,
              tracking && !isOffline ? styles.profileStatusDotActive : null,
            ]}
          />
          <Text
            style={[
              styles.gpsStatus,
              tracking && !isOffline ? styles.gpsStatusActive : null,
            ]}
          >
            {tracking && !isOffline ? 'En recorrido' : 'En espera'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function NavigationInstructionCard({
  distanciaMetros,
  brand,
}: {
  distanciaMetros: number | null;
  brand: LineaBrand;
}) {
  return (
    <View
      style={[
        styles.navInstructionCard,
        { backgroundColor: brand.primary, borderLeftColor: brand.secondary },
      ]}
    >
      <View style={styles.navIconContainer}>
        <Ionicons name="arrow-up" size={36} color={brand.text} />
      </View>
      <View style={styles.navInstructionText}>
        <Text style={styles.navDistance}>
          {distanciaMetros === null ? '—' : formatearDistancia(distanciaMetros)}
        </Text>
        <Text style={styles.navAction}>Dirígete al punto de control</Text>
      </View>
    </View>
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
    top: quivoSpacing.lg,
    left: quivoSpacing.lg,
    right: quivoSpacing.lg,
    gap: quivoSpacing.sm,
  },
  identityCard: {
    backgroundColor: quivoColors.white,
    borderLeftWidth: 5,
    borderRadius: quivoRadius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.md,
    padding: quivoSpacing.md,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: quivoRadius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: quivoColors.primary,
  },
  avatarText: { color: quivoColors.white, fontFamily: quivoFonts.displayBold, fontSize: 16 },
  identityText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  driverName: { color: quivoColors.text, fontFamily: quivoFonts.bodySemiBold, fontSize: 13 },
  sindicatoText: {
    color: quivoColors.textSecondary,
    fontFamily: quivoFonts.bodyRegular,
    fontSize: 11,
    marginTop: 2,
  },
  vehicleText: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 10,
    marginTop: 4,
  },
  routeBadge: {
    alignItems: 'flex-end',
    borderRadius: quivoRadius.lg,
    justifyContent: 'center',
    maxWidth: 104,
    paddingHorizontal: quivoSpacing.sm,
    paddingVertical: quivoSpacing.xs,
  },
  routeSummary: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 86,
  },
  roofSignBadge: {
    borderRadius: quivoRadius.pill,
    marginBottom: 2,
    maxWidth: 88,
    paddingHorizontal: quivoSpacing.xs,
    paddingVertical: 2,
  },
  roofSignText: { fontFamily: quivoFonts.bodySemiBold, fontSize: 10 },
  lineLogo: { height: 24, width: 24, borderRadius: quivoRadius.sm, marginBottom: 2 },
  lineCode: { fontFamily: quivoFonts.displayBold, fontSize: 34, lineHeight: 38 },
  lineName: {
    color: quivoColors.primaryStrong,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 14,
    marginTop: 1,
  },
  lineRoofSign: { fontFamily: quivoFonts.bodyMedium, fontSize: 7, opacity: 0.9 },
  lineTagline: { fontFamily: quivoFonts.bodyRegular, fontSize: 7, opacity: 0.86 },
  gpsStatus: {
    color: quivoColors.textMuted,
    fontFamily: quivoFonts.bodySemiBold,
    fontSize: 12,
  },
  gpsStatusActive: {
    color: quivoColors.success,
  },
  profileStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: quivoSpacing.xs,
  },
  profileStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: quivoColors.textMuted,
  },
  profileStatusDotActive: {
    backgroundColor: quivoColors.success,
  },
  navInstructionCard: {
    backgroundColor: 'rgba(50, 38, 180, 0.95)',
    borderLeftWidth: 5,
    borderRadius: quivoRadius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: quivoSpacing.lg,
    gap: quivoSpacing.md,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  navIconContainer: {
    width: 44,
    alignItems: 'center',
  },
  navInstructionText: {
    flex: 1,
    justifyContent: 'center',
  },
  navDistance: {
    color: quivoColors.white,
    fontFamily: quivoFonts.displayBold,
    fontSize: 28,
  },
  navAction: {
    color: quivoColors.white,
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 16,
    opacity: 0.9,
    marginTop: -4,
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
  fabsContainer: {
    position: 'absolute',
    right: quivoSpacing.md,
    bottom: 280,
    zIndex: 1000,
    gap: quivoSpacing.md,
  },
  recenterButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: quivoColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: quivoSpacing.xl,
  },
  modalContent: {
    backgroundColor: quivoColors.white,
    borderRadius: quivoRadius.xl,
    padding: quivoSpacing.xl,
    width: '100%',
    maxWidth: 400,
    shadowColor: quivoColors.text,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: quivoSpacing.sm,
    marginBottom: quivoSpacing.md,
  },
  modalTitle: {
    fontFamily: quivoFonts.displayBold,
    fontSize: 20,
    color: quivoColors.text,
    flex: 1,
  },
  modalText: {
    fontFamily: quivoFonts.bodyMedium,
    fontSize: 15,
    color: quivoColors.textSecondary,
    lineHeight: 22,
  },
  observacionInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  observacionError: {
    marginBottom: quivoSpacing.md,
  },
  observacionActions: {
    flexDirection: 'row',
    gap: quivoSpacing.sm,
    marginTop: quivoSpacing.xl,
  },
  actionButton: {
    flex: 1,
  },
});
