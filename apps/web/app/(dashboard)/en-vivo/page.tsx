'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, ConfirmDialog, Loader, RouteMap, Select, type MapPoint } from '@quivo/design-system';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Bus,
  CheckCircle2,
  CircleCheck,
  Clock,
  Maximize2,
  LogOut,
  Navigation,
  Radio,
  RefreshCw,
} from 'lucide-react';
import type { GravedadRegla, Infraccion } from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { isRouteAllowedForRole, NAV_ITEMS } from '../../../src/lib/nav-items';
import {
  useContextoEnVivo,
  useMolinosResumen,
  INTERVALO_POLL_POSICIONES_MS,
  usePosicionesEnVivo,
  useRecargarTraza,
  useTrazaEnVivo,
} from '../../../src/lib/en-vivo/use-en-vivo';
import { intervaloPoll, presentacionFrescura } from '../../../src/lib/en-vivo/traza';
import {
  ETIQUETA_NIVEL,
  NIVELES_DESC,
  actualizarPrimeraVez,
  contarPorNivel,
  etiquetaTipoInfraccion,
  nivelDeAlerta,
  ordenarAlertas,
  resumenContadores,
  puedeActuarEnInfracciones,
  siguienteAlertaId,
} from '../../../src/lib/en-vivo/alertas';
import { useAdminCity } from '../../../src/lib/geo/use-admin-city';
import { useLineaOptions } from '../../../src/lib/api/use-linea-options';
import {
  construirMarcadoresVehiculos,
  construirPuntosControl,
  construirRutas,
  construirZonas,
  idMarcadorVehiculo,
  mensajeError,
} from './map-builders';
import { HudMolinos } from './hud-molinos';
import { PanelJornada } from './panel-jornada';
import { IconoNivel, PanelVehiculo, type AvisoPanel, type BorradoresDescarte } from './panel-vehiculo';
import { conPuntoVivo } from '../../../src/lib/en-vivo/punto-vivo';

export default function EnVivoPage() {
  const { token, user, logout } = useAuth();
  const router = useRouter();

  // ENTREGA 13 — `posiciones` (TODOS los vehículos, `GET /reportes/en-vivo/posiciones`)
  // reemplaza al listado de sesiones (`useSesionesEnVivo`) como fuente del mapa: antes el
  // panel dibujaba UNA sesión a la vez, elegida en un `<select>` de ~20 entradas con
  // sesiones muertas (síntomas 1/2/3 del piloto 2026-09-09). Ahora se dibujan todos los
  // vehículos activos y `sesionSeleccionada` es solo "cuál tiene el detalle abierto" — nace
  // `null`, nunca gobierna qué se pinta en el mapa.
  const posiciones = usePosicionesEnVivo(token);
  const molinos = useMolinosResumen(token);
  // El `operador` (control) no tiene dashboard ni atiende infracciones: "Panel" pasa a "Salir" y
  // el panel del vehículo muestra las infracciones en solo lectura. Allowlist: sale de los roles
  // del dashboard (`/`), no de excluir roles a mano. Esos mismos roles son los que pueden leer
  // `GET /reportes/jornadas` (el `operador` recibiría 403), así que también gobierna `PanelJornada`.
  const tienePanelAdmin = user ? isRouteAllowedForRole(NAV_ITEMS, '/', user.rol) : false;
  const [confirmandoSalida, setConfirmandoSalida] = useState(false);
  const soloLectura = !puedeActuarEnInfracciones(user?.rol);
  const { options: lineaOptions, lineas } = useLineaOptions();
  const [lineaFilter, setLineaFilter] = useState('');
  const [sesionSeleccionada, setSesionSeleccionada] = useState<string | null>(null);
  const [seguir, setSeguir] = useState(true);
  // PR E: filtro "solo con alertas de este nivel", aviso aria-live de las acciones del panel y
  // el punto de la infracción que "Ver en mapa" acaba de centrar.
  const [nivelFiltro, setNivelFiltro] = useState<GravedadRegla | null>(null);
  const [aviso, setAviso] = useState<AvisoPanel | null>(null);
  const [focoMapa, setFocoMapa] = useState<{
    lat: number;
    lng: number;
    nivel: GravedadRegla;
    etiqueta: string;
    /** Cambia en cada "Ver en mapa": pide centrar otra vez aunque sea la misma infracción. */
    nonce: number;
    /** Px que se corre la cámara para que el punto caiga sobre la hoja inferior (móvil). */
    offsetY: number;
  } | null>(null);
  const [fitKeyOverride, setFitKeyOverride] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const adminCity = useAdminCity();

  const todasLasPosiciones = useMemo(() => posiciones.data ?? [], [posiciones.data]);
  const posicionesDeLinea = useMemo(
    () =>
      lineaFilter
        ? todasLasPosiciones.filter((p) => p.lineaId === lineaFilter)
        : todasLasPosiciones,
    [todasLasPosiciones, lineaFilter],
  );
  // Contadores sobre la flota de la línea (no sobre la ya filtrada por nivel: así siguen
  // visibles todos los niveles). El filtro por nivel conserva siempre el vehículo con el panel
  // abierto: atenderle la última alerta no debe cerrarle el panel de golpe.
  const conteoNiveles = useMemo(() => contarPorNivel(posicionesDeLinea), [posicionesDeLinea]);
  const posicionesFiltradas = useMemo(
    () =>
      nivelFiltro
        ? posicionesDeLinea.filter(
            (p) => p.id === sesionSeleccionada || nivelDeAlerta(p) === nivelFiltro,
          )
        : posicionesDeLinea,
    [posicionesDeLinea, nivelFiltro, sesionSeleccionada],
  );
  // Resumen honesto (pedido explícito del plan post-piloto): un vehículo sin primer fix
  // (`lat`/`lng` `null` — la sesión existe pero nunca entró un punto GPS) no tiene dónde
  // dibujarse, pero tampoco puede desaparecer en silencio del conteo.
  const vehiculosSinFix = useMemo(
    () => posicionesFiltradas.filter((p) => p.lat === null || p.lng === null).length,
    [posicionesFiltradas],
  );
  const vehiculosEnMapa = posicionesFiltradas.length - vehiculosSinFix;

  // ENTREGA 16 — fix de code-review: si el filtro por línea excluye al vehículo con detalle
  // abierto (`sesionSeleccionada`), el panel de detalle, el `followPoint` de la cámara y
  // `animatedVehicle.markerId` seguían activos sobre un vehículo que ya NO está en `markers`
  // (`posicionesFiltradas` lo sacó) — el mapa quedaba "siguiendo" un marker invisible. Se
  // cierra la selección apenas deja de estar en la lista filtrada, en vez de esperar a que el
  // usuario la cierre a mano.
  // Con trabajo a medias (formulario de sanción abierto, borrador de descarte) NO se cierra: se
  // perdería lo escrito. El panel queda abierto con un aviso (`fueraDelMapa`) y se cierra solo
  // cuando el trabajo termina.
  const [trabajoEnCurso, setTrabajoEnCurso] = useState(false);
  // Borradores de descarte por sesión: viven acá para sobrevivir al remonte del panel al cambiar de
  // vehículo (`key`) y reaparecer al volver a ese vehículo.
  const [borradores] = useState<BorradoresDescarte>(() => new Map());
  // Única vía para dejar sin vehículo abierto (botón de cerrar, Escape y des-selección automática):
  // también suelta el pin de "Ver en mapa", que sin vehículo abierto quedaría huérfano en el mapa.
  const cerrarSeleccion = useCallback(() => {
    setSesionSeleccionada(null);
    setFocoMapa(null);
    setTrabajoEnCurso(false);
  }, []);
  const seleccionFueraDeLista =
    sesionSeleccionada !== null && !posicionesDeLinea.some((p) => p.id === sesionSeleccionada);
  useEffect(() => {
    if (seleccionFueraDeLista && !trabajoEnCurso) {
      cerrarSeleccion();
      setSeguir(false);
    }
  }, [seleccionFueraDeLista, trabajoEnCurso, cerrarSeleccion]);

  // Foco del panel (lo gestiona la página, no el panel: cambiar de vehículo con "Siguiente alerta"
  // remonta el panel por `key` y no debe mover el foco). Al ABRIR (cerrado -> abierto) pasa al
  // encabezado; al CERRAR vuelve al marcador (si el elemento que lo tenía se recreó, al marcador
  // vigente de esa sesión; si no, a "Siguiente alerta" o al contenedor del mapa; nunca a <body>).
  const tituloPanelRef = useRef<HTMLHeadingElement>(null);
  const mapaRef = useRef<HTMLDivElement>(null);
  const siguienteAlertaRef = useRef<HTMLButtonElement>(null);
  // `puntoId`: si el foco venía de un marcador, id del marcador de la sesión VIGENTE (cambia al
  // cambiar de vehículo con el panel abierto); `siguiente`: venía de "Siguiente alerta".
  const focoPrevioRef = useRef<{ el: HTMLElement | null; puntoId: string | null; siguiente: boolean } | null>(null);
  const sesionAbiertaRef = useRef<string | null>(null);
  useEffect(() => {
    const antes = sesionAbiertaRef.current;
    sesionAbiertaRef.current = sesionSeleccionada;
    const marcadorDe = (puntoId: string) =>
      document.querySelector<HTMLElement>(`.qv-gmap-veh[data-punto-id="${CSS.escape(puntoId)}"]`);
    // Foco posible: conectado, no deshabilitado y visible (nunca un destino que no lo reciba).
    const enfocable = (el: HTMLElement | null | undefined): el is HTMLElement =>
      Boolean(
        el &&
          el.isConnected &&
          !el.matches(':disabled') &&
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== 'hidden',
      );
    if (sesionSeleccionada && !antes) {
      const activo = document.activeElement;
      const el = activo instanceof HTMLElement && activo !== document.body ? activo : null;
      focoPrevioRef.current = {
        el,
        puntoId: el?.closest<HTMLElement>('.qv-gmap-veh')?.dataset.puntoId ?? null,
        siguiente: el !== null && el === siguienteAlertaRef.current,
      };
      tituloPanelRef.current?.focus({ preventScroll: true });
    } else if (sesionSeleccionada && antes && sesionSeleccionada !== antes) {
      // Cambio de vehículo con el panel abierto: si el origen era un marcador, al cerrar se vuelve
      // al marcador del vehículo NUEVO (no al del anterior); "Siguiente alerta" se conserva.
      const previo = focoPrevioRef.current;
      if (previo?.puntoId) {
        const puntoId = idMarcadorVehiculo(sesionSeleccionada);
        focoPrevioRef.current = { ...previo, puntoId, el: marcadorDe(puntoId) };
      }
    } else if (!sesionSeleccionada && antes) {
      const previo = focoPrevioRef.current;
      focoPrevioRef.current = null;
      const activo = document.activeElement;
      // Si el usuario ya puso el foco en otro control (clic fuera), no se le quita.
      if (activo && activo !== document.body && activo.isConnected) return;
      const origenMarcador = previo?.puntoId ? marcadorDe(previo.puntoId) : null;
      const candidatos: Array<HTMLElement | null | undefined> = [
        origenMarcador ?? previo?.el,
        marcadorDe(idMarcadorVehiculo(antes)),
        siguienteAlertaRef.current,
        mapaRef.current,
      ];
      candidatos.find(enfocable)?.focus({ preventScroll: true });
    }
  }, [sesionSeleccionada]);

  // Click en un marcador de vehículo → recién ahí se piden `contexto` y `traza` de ESA
  // sesión (los hooks ya existentes, sin cambios). Con un solo detalle abierto a la vez, el
  // problema de escalado del poll por sesión (Entrega 10) se resuelve solo.
  const seleccionarSesion = useCallback((id: string) => {
    setSesionSeleccionada(id);
    setSeguir(true);
    setFocoMapa(null);
  }, []);

  // La posición no trae el inicio de la infracción: "la más antigua" de "Siguiente alerta" es la
  // que esta pestaña vio primero (se olvida cuando la alerta se cierra). Estado derivado durante
  // el render (`actualizarPrimeraVez` es pura y devuelve la misma referencia si nada cambió), así
  // el orden nunca va un render por detrás de las posiciones.
  const [primeraVezAlerta, setPrimeraVezAlerta] = useState<ReadonlyMap<string, number>>(() => new Map());
  const primeraVezActual = actualizarPrimeraVez(primeraVezAlerta, todasLasPosiciones, Date.now());
  if (primeraVezActual !== primeraVezAlerta) setPrimeraVezAlerta(primeraVezActual);

  const alertasOrdenadas = useMemo(
    () => ordenarAlertas(posicionesFiltradas.filter((p) => p.lat !== null && p.lng !== null), primeraVezActual),
    [posicionesFiltradas, primeraVezActual],
  );
  const irASiguienteAlerta = () => {
    const id = siguienteAlertaId(alertasOrdenadas, sesionSeleccionada);
    if (!id) return;
    seleccionarSesion(id);
    const idx = alertasOrdenadas.findIndex((p) => p.id === id);
    const p = alertasOrdenadas[idx];
    const nivel = p ? nivelDeAlerta(p) : null;
    anunciar({
      tono: 'ok',
      texto: p
        ? `Alerta ${idx + 1} de ${alertasOrdenadas.length}: ${p.vehiculoPlaca}${nivel ? `, ${ETIQUETA_NIVEL[nivel].singular}` : ''}`
        : 'Sin alertas',
    });
  };

  // Aviso aria-live de las acciones del panel (atender, descartar, sancionar, copiar…).
  const anunciar = useCallback((a: AvisoPanel) => setAviso(a), []);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6_000);
    return () => clearTimeout(t);
  }, [aviso]);

  const contexto = useContextoEnVivo(token, sesionSeleccionada);
  const traza = useTrazaEnVivo(token, sesionSeleccionada);
  const recargarTraza = useRecargarTraza(sesionSeleccionada);

  // Posición "en vivo" de la sesión seleccionada según el último poll de `/posiciones` — sirve
  // de fallback de presentación (badge de frescura, "finalizada") mientras `contexto`/`traza`
  // todavía no respondieron, y aunque el filtro por línea la haya sacado del mapa.
  const posicionSeleccionada = useMemo(
    () =>
      sesionSeleccionada ? todasLasPosiciones.find((p) => p.id === sesionSeleccionada) : undefined,
    [todasLasPosiciones, sesionSeleccionada],
  );

  const datos = traza.data;
  const ultimoPunto = datos?.puntos.at(-1);
  const finalizada = Boolean(
    datos ? datos.sesionFin : posicionSeleccionada && !posicionSeleccionada.activa,
  );
  const pollPausado = Boolean(sesionSeleccionada) && intervaloPoll(datos) === false;

  const estado = datos?.estadoFrescura ?? posicionSeleccionada?.estadoFrescura ?? 'sin_datos';
  const presentacion = presentacionFrescura(estado);

  const puntosControl = useMemo(
    () => (contexto.data ? construirPuntosControl(contexto.data, datos) : []),
    [contexto.data, datos],
  );
  // Color de la línea para el anillo del marcador: el catálogo de líneas (si cargó) y, con
  // seguridad, la de la sesión con el panel abierto (viene en su `contexto`).
  const colorLineaPorId = useMemo(() => {
    const mapa: Record<string, string | null | undefined> = {};
    for (const l of lineas) mapa[l.id] = l.color;
    if (contexto.data) mapa[contexto.data.linea.id] = contexto.data.linea.color;
    return mapa;
  }, [lineas, contexto.data]);
  const vehiculos = useMemo(
    () =>
      construirMarcadoresVehiculos(posicionesFiltradas, seleccionarSesion, {
        seleccionadoId: sesionSeleccionada,
        colorLineaPorId,
      }),
    [posicionesFiltradas, seleccionarSesion, sesionSeleccionada, colorLineaPorId],
  );
  // Punto de la infracción que "Ver en mapa" centró: un pin del color de su severidad.
  const marcadorFoco = useMemo<MapPoint[]>(
    () =>
      focoMapa
        ? [
            {
              id: 'infraccion-foco',
              lat: focoMapa.lat,
              lng: focoMapa.lng,
              label: focoMapa.etiqueta,
              pinType: 'pin',
              color: `var(--qv-alerta-${focoMapa.nivel})`,
            },
          ]
        : [],
    [focoMapa],
  );
  const markers = useMemo(
    () => [...puntosControl, ...marcadorFoco, ...vehiculos],
    [puntosControl, marcadorFoco, vehiculos],
  );
  const routes = useMemo(
    () => (contexto.data ? construirRutas(contexto.data, datos) : []),
    [contexto.data, datos],
  );
  const zones = useMemo(
    () => (contexto.data ? construirZonas(contexto.data) : []),
    [contexto.data],
  );

  // Animación del marcador de vehículo (`route-map-impl.tsx` hace el trabajo real — ver el
  // comentario de `animatedVehicle` en `RouteMapProps`). Solo se anima la sesión CON DETALLE
  // ABIERTO: es la única con traza de alta resolución (`datos.puntos`) cargada — el resto de
  // los vehículos salta directo entre polls de `/posiciones` (cada 2 s), que es la cadencia
  // que ya tienen. `markerId = idMarcadorVehiculo(sesionSeleccionada)` (Entrega 14): con TODOS
  // los vehículos dibujados a la vez, el id ya no puede ser una constante única — tiene que
  // apuntar exactamente al marker de esta sesión entre los N que trae `vehiculos`.
  // Puntos animados = traza (poll de 10 s) + el último fix de `/posiciones` (poll de 2 s) si
  // es más nuevo que el último punto de la traza (ver `conPuntoVivo`). Dependencias por
  // valor primitivo: `posicionSeleccionada` cambia de identidad en cada poll aunque el fix
  // sea el mismo.
  const vivoLat = posicionSeleccionada?.lat ?? null;
  const vivoLng = posicionSeleccionada?.lng ?? null;
  const vivoTs = posicionSeleccionada?.ultimoFixTs ?? null;
  const puntosAnimados = useMemo(
    () =>
      datos ? conPuntoVivo(datos.puntos, { lat: vivoLat, lng: vivoLng, ultimoFixTs: vivoTs }) : [],
    [datos, vivoLat, vivoLng, vivoTs],
  );
  const animatedVehicle = useMemo(
    () =>
      datos && sesionSeleccionada && !seleccionFueraDeLista
        ? {
            markerId: idMarcadorVehiculo(sesionSeleccionada),
            resetKey: sesionSeleccionada,
            points: puntosAnimados,
            // Cadencia real a la que llegan puntos nuevos (poll de `/posiciones`): repartir
            // la animación en ese lapso evita mover-y-quedarse-quieto.
            intervalMs: INTERVALO_POLL_POSICIONES_MS,
          }
        : null,
    [datos, sesionSeleccionada, seleccionFueraDeLista, puntosAnimados],
  );

  // "Ver en mapa" gana sobre el seguimiento (que se apaga al usarlo); sin foco, se sigue el último
  // punto de la traza o, mientras ésta carga, la posición del último poll. Nunca toca el zoom.
  const puntoASeguir = focoMapa
    ? { lat: focoMapa.lat, lng: focoMapa.lng, nonce: focoMapa.nonce, offsetY: focoMapa.offsetY }
    : seguir && !seleccionFueraDeLista && ultimoPunto
      ? { lat: ultimoPunto.lat, lng: ultimoPunto.lng }
      : seguir && !seleccionFueraDeLista && posicionSeleccionada?.lat != null && posicionSeleccionada.lng != null
        ? { lat: posicionSeleccionada.lat, lng: posicionSeleccionada.lng }
        : null;

  // Única condición para "Seguir" (HUD y panel): hay un vehículo abierto y se sabe dónde está.
  const puedeSeguir =
    Boolean(sesionSeleccionada) && !seleccionFueraDeLista && (Boolean(ultimoPunto) || posicionSeleccionada?.lat != null);
  const alternarSeguir = () => {
    // Al ENCENDER el seguimiento deja de mandar el punto de "Ver en mapa" (si no, no seguiría nada).
    if (!seguir) setFocoMapa(null);
    setSeguir(!seguir);
  };

  const verInfraccionEnMapa = (inf: Infraccion) => {
    setSeguir(false);
    // En móvil (<= 720 px) la hoja inferior tapa el centro del mapa: la cámara se corre para que el
    // punto caiga en el centro de la franja visible, entre el HUD superior y la hoja.
    const hoja = document.querySelector<HTMLElement>('.qv-live-hud-bottom--panel');
    const hud = document.querySelector<HTMLElement>('.qv-live-hud-top');
    const mapa = mapaRef.current;
    let offsetY = 0;
    if (hoja && mapa && window.matchMedia('(max-width: 720px)').matches) {
      const caja = mapa.getBoundingClientRect();
      const arriba = Math.max(hud ? hud.getBoundingClientRect().bottom : caja.top, caja.top);
      const abajo = hoja.getBoundingClientRect().top;
      const centroVisible = (Math.min(arriba, abajo) + abajo) / 2 - caja.top;
      offsetY = Math.max(0, Math.round(caja.height / 2 - centroVisible));
    }
    setFocoMapa({
      lat: inf.lat,
      lng: inf.lng,
      nivel: inf.gravedad,
      etiqueta: etiquetaTipoInfraccion(inf.tipo),
      nonce: Date.now(),
      offsetY,
    });
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    // `Promise<unknown>[]` explícito: `posiciones.refetch()` y `traza.refetch()` resuelven a
    // `QueryObserverResult` de tipos de dato distintos (`PosicionEnVivo[]` vs.
    // `TrazaAcumulada`) — un array inferido los unifica y el segundo `push` no tipa.
    const refetches: Promise<unknown>[] = [posiciones.refetch()];
    if (sesionSeleccionada) refetches.push(traza.refetch());
    await Promise.all(refetches);
    if (sesionSeleccionada) recargarTraza();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const cerrarDetalle = () => {
    // Cierre explícito: el borrador de descarte se descarta con el panel.
    borradores.clear();
    cerrarSeleccion();
  };

  // El mapa se mantiene SIEMPRE montado: si cargando / error / flota vacía lo reemplazaran por
  // un `return` anticipado, al volver los datos se remontaría y perdería el zoom del usuario.
  // Estos estados van como capa encima del mapa.
  // - error: solo si NO hay datos (con datos en caché, un refetch fallido solo muestra el chip
  //   "Sin conexión" en el HUD; React Query v5 conserva `data` tras un refetch fallido).
  // - cargando: incluye "sin token todavía" (query deshabilitada, `data` undefined, sin error).
  const hayDatos = posiciones.data !== undefined;
  const estadoSuperpuesto: 'cargando' | 'error' | 'vacio' | null =
    posiciones.isError && !hayDatos
      ? 'error'
      : !hayDatos
        ? 'cargando'
        : todasLasPosiciones.length === 0
          ? 'vacio'
          : null;
  const sinConexionConDatos = posiciones.isError && hayDatos;

  // Alto real del HUD superior -> `--qv-hud-top-h` (borde inferior respecto del mapa): la pila
  // inferior acota su altura con él y nunca llega a tapar el HUD (Siguiente alerta, Seguir…).
  const hayHud = !estadoSuperpuesto;
  useEffect(() => {
    const raiz = mapaRef.current;
    const hud = hayHud ? raiz?.querySelector<HTMLElement>('.qv-live-hud-top') : null;
    if (!raiz || !hud) return;
    const medir = () => {
      const borde = hud.getBoundingClientRect().bottom - raiz.getBoundingClientRect().top;
      raiz.style.setProperty('--qv-hud-top-h', `${Math.ceil(borde)}px`);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(hud);
    ro.observe(raiz);
    return () => {
      ro.disconnect();
      raiz.style.removeProperty('--qv-hud-top-h');
    };
  }, [hayHud]);

  // El mapa sigue montado con `fitMode="once"`: cuando la flota pasa de vacía a con vehículos
  // (después de haber tenido alguno), `fitKey` ya se disparó y no los encuadraría. Se bumpea
  // `fitKeyOverride` solo en esa transición (no en cada poll).
  const flotaPrevRef = useRef<'nunca' | 'con' | 'sin'>('nunca');
  const hayVehiculosEnMapa = vehiculos.length > 0;
  useEffect(() => {
    const prev = flotaPrevRef.current;
    if (hayVehiculosEnMapa) {
      if (prev === 'sin') setFitKeyOverride((k) => k + 1);
      flotaPrevRef.current = 'con';
    } else if (prev === 'con') {
      flotaPrevRef.current = 'sin';
    }
  }, [hayVehiculosEnMapa]);

  return (
    <div className="qv-live-map-wrapper" ref={mapaRef} tabIndex={-1}>
      {/* MAPA PRINCIPAL A PANTALLA COMPLETA */}
      <RouteMap
        engine="google"
        googleMapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
        googleMapsMapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID}
        height="100%"
        loading={Boolean(sesionSeleccionada) && contexto.isLoading}
        routes={routes}
        markers={markers}
        zones={zones}
        // `fitMode="once"` (explícito: el default de `RouteMap` es 'auto', que reencuadraba en cada poll
        // de 5 s y pisaba el zoom del usuario) con `fitKey` fijo a `fitKeyOverride` (NO a `sesionSeleccionada`):
        // los `markers`/`routes` que ve `fitToBounds` son SIEMPRE la unión de la flota
        // filtrada + la sesión con detalle abierto, nunca un subconjunto de "solo lo
        // seleccionado" — encuadrar de nuevo cada vez que cambia la selección terminaría
        // alejando la cámara para mostrar TODA la flota otra vez, justo lo contrario de lo
        // que espera alguien que acaba de tocar un vehículo puntual. El encuadre inicial (a
        // la flota completa) y el botón manual "Reencuadrar" siguen bumpeando `fitKeyOverride`;
        // seguir a un vehículo puntual es trabajo de `followPoint`/`seguir`, no de esto.
        fitMode="once"
        fitKey={fitKeyOverride}
        followPoint={puntoASeguir}
        onUserPan={() => setSeguir(false)}
        defaultCenter={adminCity.centro}
        defaultZoom={adminCity.zoom}
        animatedVehicle={animatedVehicle}
      />

      {/* ESTADOS SIN DATOS: capa sobre el mapa (que sigue montado, ver `estadoSuperpuesto`) */}
      {estadoSuperpuesto && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            overflowY: 'auto',
            backgroundColor: 'var(--qv-surface-sunken)',
          }}
        >
          {estadoSuperpuesto === 'cargando' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
              }}
            >
              <Loader label="Cargando flota en vivo..." />
            </div>
          )}
          {estadoSuperpuesto === 'error' && (
            <div
              style={{ padding: '2rem', maxWidth: '40rem', margin: '0 auto', paddingTop: '4rem' }}
            >
              <Alert variant="danger" title="No se pudo cargar la flota en vivo">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <span>{mensajeError(posiciones.error)}</span>
                  <span>
                    <Button size="sm" variant="secondary" onClick={() => void posiciones.refetch()}>
                      Reintentar
                    </Button>
                  </span>
                </div>
              </Alert>
            </div>
          )}
          {estadoSuperpuesto === 'vacio' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: '1.25rem',
                padding: '2rem',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: '4rem',
                  height: '4rem',
                  borderRadius: '50%',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-primary) 12%, transparent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--qv-color-primary)',
                }}
              >
                <Radio size={28} />
              </div>
              <div style={{ maxWidth: '28rem' }}>
                <h2
                  style={{
                    fontFamily: 'var(--qv-font-display)',
                    fontSize: '1.25rem',
                    margin: '0 0 0.5rem 0',
                  }}
                >
                  Sin vehículos en ruta activa
                </h2>
                <p style={{ fontSize: '0.875rem', color: 'var(--qv-text-secondary)', margin: 0 }}>
                  Ningún vehículo ha iniciado recorrido en la jornada de hoy. En cuanto una terminal
                  móvil sincronice su primer punto, aparecerá automáticamente aquí.
                </p>
              </div>
              <Button size="sm" variant="primary" onClick={() => void posiciones.refetch()}>
                <RefreshCw size={14} style={{ marginRight: '0.35rem' }} />
                Verificar nuevamente
              </Button>
              {/* Sin sesiones todavía (típico de madrugada) es justo cuando importa saber quién
                declaró su jornada: el panel también vive acá, en el flujo, sin mapa debajo. */}
              {tienePanelAdmin && <PanelJornada lineaFilter="" flotante={false} />}
            </div>
          )}
        </div>
      )}

      {!estadoSuperpuesto && (
        <>
          {/* TOP FLOATING HUD CONTROLS */}
          <div className="qv-live-hud-top">
            {/* Left Side: Live Badge & Filtro de línea + alertas por infracción */}
            <div className="qv-live-hud-left">
            <div className="qv-live-hud-card" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  if (tienePanelAdmin) router.push('/');
                  else setConfirmandoSalida(true);
                }}
                aria-label={tienePanelAdmin ? undefined : 'Cerrar sesión'}
                title={tienePanelAdmin ? 'Volver al panel administrativo' : 'Cerrar sesión'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.25rem 0.6rem',
                  borderRadius: 'var(--qv-radius-full)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-surface-card) 70%, transparent)',
                  color: 'var(--qv-text-secondary)',
                  border: '1px solid var(--qv-border-glass)',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all var(--qv-transition-fast)',
                }}
              >
                {tienePanelAdmin ? <ArrowLeft size={13} /> : <LogOut size={13} />}
                <span>{tienePanelAdmin ? 'Panel' : 'Salir'}</span>
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.2rem 0.55rem',
                  borderRadius: 'var(--qv-radius-full)',
                  backgroundColor: 'color-mix(in srgb, var(--qv-color-danger) 15%, transparent)',
                  color: 'var(--qv-color-danger)',
                  fontWeight: 800,
                  fontSize: '0.6875rem',
                  letterSpacing: '0.05em',
                  border: '1px solid color-mix(in srgb, var(--qv-color-danger) 30%, transparent)',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--qv-color-danger)',
                    boxShadow: '0 0 6px var(--qv-color-danger)',
                  }}
                />
                LIVE
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Bus size={15} style={{ color: 'var(--qv-color-primary)' }} />
                <div style={{ minWidth: '11rem' }}>
                  <Select
                    aria-label="Filtrar por línea"
                    options={[{ label: 'Todas las líneas', value: '' }, ...lineaOptions]}
                    placeholder="Todas las líneas"
                    value={lineaFilter}
                    onChange={(e) => setLineaFilter(e.target.value)}
                  />
                </div>
                <span
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: 'var(--qv-text-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {vehiculosEnMapa} en el mapa
                  {vehiculosSinFix > 0 && ` · ${vehiculosSinFix} sin GPS aún`}
                </span>
              </div>
            </div>

            {/* Leyenda + contadores por nivel (cada uno filtra "solo con alertas de ese nivel") y
            "Siguiente alerta". El color nunca va solo: cada nivel lleva su ícono y su texto. */}
            <div className="qv-live-hud-card qv-live-alertas" role="group" aria-label="Alertas por infracción">
              <span className="qv-live-alertas__titulo">Alertas</span>
              {NIVELES_DESC.every((n) => conteoNiveles[n] === 0) && !nivelFiltro ? (
                <span className="qv-live-alertas__vacio">
                  <CircleCheck size={14} aria-hidden="true" style={{ color: 'var(--qv-color-success)' }} />
                  Sin infracciones abiertas
                </span>
              ) : (
                NIVELES_DESC.map((nivel) => {
                  const n = conteoNiveles[nivel];
                  const activo = nivelFiltro === nivel;
                  return (
                    <button
                      key={nivel}
                      type="button"
                      className={`qv-live-nivel qv-live-nivel--${nivel}`}
                      aria-pressed={activo}
                      disabled={n === 0 && !activo}
                      title={`Mostrar solo vehículos con alertas ${ETIQUETA_NIVEL[nivel].plural}`}
                      aria-label={`${n} ${n === 1 ? ETIQUETA_NIVEL[nivel].singular : ETIQUETA_NIVEL[nivel].plural}: solo con alertas de este nivel`}
                      onClick={() => setNivelFiltro(activo ? null : nivel)}
                    >
                      <IconoNivel nivel={nivel} />
                      <span aria-hidden="true">
                        {n} {n === 1 ? ETIQUETA_NIVEL[nivel].singular : ETIQUETA_NIVEL[nivel].plural}
                      </span>
                    </button>
                  );
                })
              )}
              <button
                ref={siguienteAlertaRef}
                type="button"
                className="qv-live-btn qv-live-btn--primario"
                disabled={alertasOrdenadas.length === 0}
                onClick={irASiguienteAlerta}
                title={
                  alertasOrdenadas.length > 0
                    ? `Ir a la siguiente alerta (${resumenContadores(contarPorNivel(alertasOrdenadas))})`
                    : undefined
                }
              >
                <BellRing size={14} aria-hidden="true" />
                Siguiente alerta
              </button>
            </div>
            <HudMolinos
              lineas={molinos.data?.lineas}
              lineaFilter={lineaFilter}
              servidorTs={molinos.data?.servidorTs}
              recibidoEn={molinos.dataUpdatedAt}
            />
            </div>

            {/* Columna derecha: controles + panel "Jornada de hoy" (release 13). El panel va en el
            flujo, debajo de lo que midan los controles (una o dos filas), sin `top` mágico. */}
            <div className="qv-live-hud-right">
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
              >
                {/* Map Controls (la frescura del vehículo seleccionado vive en su panel) */}
                <div
                  className="qv-live-hud-card"
                  style={{ gap: '0.35rem', padding: '0.3rem 0.5rem' }}
                >
                  <button
                    type="button"
                    onClick={alternarSeguir}
                    disabled={!puedeSeguir}
                    aria-pressed={seguir}
                    title="Seguir vehículo en tiempo real"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.35rem 0.65rem',
                      borderRadius: 'var(--qv-radius-md)',
                      backgroundColor: seguir
                        ? 'var(--qv-color-primary)'
                        : 'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                      color: seguir ? '#ffffff' : 'var(--qv-text-secondary)',
                      border: 'none',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: puedeSeguir ? 'pointer' : 'not-allowed',
                      opacity: puedeSeguir ? 1 : 0.6,
                      transition: 'all var(--qv-transition-fast)',
                    }}
                  >
                    <Navigation
                      size={13}
                      aria-hidden="true"
                      style={{ transform: seguir ? 'rotate(45deg)' : 'none' }}
                    />
                    <span>Seguir</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFitKeyOverride((v) => v + 1)}
                    title="Reencuadrar toda la flota"
                    aria-label="Reencuadrar toda la flota"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.85rem',
                      height: '1.85rem',
                      borderRadius: 'var(--qv-radius-md)',
                      backgroundColor:
                        'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                      color: 'var(--qv-text-secondary)',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all var(--qv-transition-fast)',
                    }}
                  >
                    <Maximize2 size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleManualRefresh()}
                    title="Actualizar datos GPS ahora"
                    aria-label="Actualizar datos GPS ahora"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.85rem',
                      height: '1.85rem',
                      borderRadius: 'var(--qv-radius-md)',
                      backgroundColor:
                        'color-mix(in srgb, var(--qv-surface-card) 60%, transparent)',
                      color: 'var(--qv-text-secondary)',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all var(--qv-transition-fast)',
                    }}
                  >
                    <RefreshCw
                      size={13}
                      style={{ animation: isRefreshing ? 'spin 0.6s linear infinite' : 'none' }}
                    />
                  </button>
                </div>
              </div>
              {tienePanelAdmin && <PanelJornada lineaFilter={lineaFilter} />}
            </div>

          </div>

          {/* PANEL UNIFICADO DEL VEHÍCULO (cabecera, acciones rápidas, infracciones, PCs y stats).
          En móvil (<= 720 px) se acomoda como hoja inferior (ver `.qv-live-hud-bottom--panel`). */}
          {/* PILA INFERIOR: avisos sobre el panel unificado del vehículo (cabecera, acciones rápidas,
          infracciones, PCs y stats). Ambos en flujo dentro del mismo contenedor anclado abajo: los
          avisos no dependen de la altura del HUD superior (Jornada expandida) ni tapan el panel.
          En móvil (<= 720 px) el panel es una hoja inferior (ver `.qv-live-hud-bottom--panel`).
          Las regiones aria-live de los avisos están SIEMPRE montadas. */}
          <div className={`qv-live-hud-bottom${sesionSeleccionada ? ' qv-live-hud-bottom--panel' : ''}`}>
            <div className="qv-live-toasts">
              {/* Filtro sin resultados — estado vacío honesto: la flota existe, esta línea no tiene
              nadie reportando ahora mismo. El mapa sigue montado (el usuario puede cambiar el
              filtro sin perder contexto), a diferencia del empty-state de página completa de
              arriba (que es para "no hay NADA en toda la jornada"). */}
              {/* Contenedor live SIEMPRE montado: los lectores de pantalla solo anuncian cambios de
              contenido en una región aria-live que ya estaba en el DOM antes de poblarse; si el
              toast se monta condicionalmente ya con su texto, NVDA/VoiceOver no lo anuncian. */}
              <div role="status" aria-live="polite">
                {aviso && (
                  <div
                    className="qv-live-toast"
                    style={{
                      borderColor: aviso.tono === 'ok' ? 'var(--qv-color-success)' : 'var(--qv-color-danger)',
                      color: 'var(--qv-text-primary)',
                    }}
                  >
                    {aviso.tono === 'ok' ? (
                      <CheckCircle2 size={14} style={{ color: 'var(--qv-color-success)' }} />
                    ) : (
                      <AlertTriangle size={14} style={{ color: 'var(--qv-color-danger)' }} />
                    )}
                    <span>{aviso.texto}</span>
                  </div>
                )}
                {posicionesFiltradas.length === 0 && (
                  <div
                    className="qv-live-toast"
                    style={{ borderColor: 'var(--qv-color-accent)', color: 'var(--qv-text-primary)' }}
                  >
                    <AlertTriangle size={14} style={{ color: 'var(--qv-color-accent)' }} />
                    {nivelFiltro && posicionesDeLinea.length > 0 ? (
                      <>
                        <span>
                          Ningún vehículo tiene alertas {ETIQUETA_NIVEL[nivelFiltro].plural} ahora.
                        </span>
                        <button
                          type="button"
                          className="qv-live-btn qv-live-btn--sm"
                          onClick={() => setNivelFiltro(null)}
                        >
                          Quitar filtro de nivel
                        </button>
                      </>
                    ) : (
                      <span>
                        Ningún vehículo de esta línea está reportando ahora. Probá con &quot;Todas las
                        líneas&quot;.
                      </span>
                    )}
                  </div>
                )}
              </div>

              {sinConexionConDatos && (
                <div role="status" aria-live="polite">
                  <div
                    className="qv-live-toast"
                    style={{ borderColor: 'var(--qv-color-warning)', color: 'var(--qv-text-primary)' }}
                  >
                    <AlertTriangle size={14} style={{ color: 'var(--qv-color-warning)' }} />
                    <span>Sin conexión · mostrando últimos datos</span>
                  </div>
                </div>
              )}

              {/* FLOATING ALERT TOASTS */}
              <div role="alert" aria-live="assertive">
                {sesionSeleccionada && presentacion.esFalla && (
                  <div
                    className="qv-live-toast"
                    style={{ borderColor: 'var(--qv-color-danger)', color: 'var(--qv-color-danger)' }}
                  >
                    <AlertTriangle size={14} />
                    <span>{presentacion.etiqueta}: El teléfono no sincroniza con el servidor</span>
                  </div>
                )}
              </div>

              <div role="status" aria-live="polite">
                {sesionSeleccionada && estado === 'detenido' && (
                  <div
                    className="qv-live-toast"
                    style={{ borderColor: 'var(--qv-color-accent)', color: 'var(--qv-text-primary)' }}
                  >
                    <Clock size={14} style={{ color: 'var(--qv-color-accent)' }} />
                    <span>Vehículo detenido: Posición estacionaria registrada</span>
                  </div>
                )}

                {finalizada && (
                  <div
                    className="qv-live-toast"
                    style={{ borderColor: 'var(--qv-color-primary)', color: 'var(--qv-text-primary)' }}
                  >
                    <CheckCircle2 size={14} style={{ color: 'var(--qv-color-success)' }} />
                    <span>Sesión finalizada</span>
                    <button
                      type="button"
                      onClick={() => router.push(`/reportes/recorridos/${sesionSeleccionada}`)}
                      style={{
                        background: 'var(--qv-color-primary)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '999px',
                        padding: '0.15rem 0.5rem',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Ver histórico →
                    </button>
                  </div>
                )}

                {pollPausado && (
                  <div
                    className="qv-live-toast"
                    style={{ borderColor: 'var(--qv-color-warning)', color: 'var(--qv-text-primary)' }}
                  >
                    <Clock size={14} style={{ color: 'var(--qv-color-warning)' }} />
                    <span>Seguimiento pausado por inactividad</span>
                    <button
                      type="button"
                      onClick={() => void traza.refetch()}
                      style={{
                        background: 'var(--qv-color-warning)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '999px',
                        padding: '0.15rem 0.5rem',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Reanudar
                    </button>
                  </div>
                )}
              </div>
            </div>

            {sesionSeleccionada && (
              <PanelVehiculo
                key={sesionSeleccionada}
                token={token}
                sesionId={sesionSeleccionada}
                posicion={posicionSeleccionada}
                contexto={contexto.data}
                datos={datos}
                ultimoPuntoTs={ultimoPunto?.ts}
                seguir={seguir}
                puedeSeguir={puedeSeguir}
                onToggleSeguir={alternarSeguir}
                tituloRef={tituloPanelRef}
                fueraDelMapa={seleccionFueraDeLista}
                onTrabajoEnCurso={setTrabajoEnCurso}
                borradores={borradores}
                onCerrar={cerrarDetalle}
                onVerEnMapa={verInfraccionEnMapa}
                onAviso={anunciar}
                trazaRecibidoEn={traza.dataUpdatedAt}
                posicionesRecibidoEn={posiciones.dataUpdatedAt}
                soloLectura={soloLectura}
              />
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmandoSalida}
        title="¿Cerrar sesión?"
        message="Vas a salir de Quivo. Para volver a ver la flota en vivo tendrás que iniciar sesión de nuevo."
        confirmLabel="Cerrar sesión"
        onConfirm={() => {
          setConfirmandoSalida(false);
          logout();
          router.push('/login');
        }}
        onCancel={() => setConfirmandoSalida(false)}
      />
    </div>
  );
}
