'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, ConfirmDialog, Loader, RouteMap, type MapPoint } from '@quivo/design-system';
import { AlertTriangle, CheckCircle2, Clock, Maximize2, Navigation, Radio, RefreshCw } from 'lucide-react';
import { etiquetaTipoInfraccion, type EstadoFrescura, type GravedadRegla, type Infraccion } from '@quivo/shared';
import { useAuth } from '../../../src/lib/auth/auth-context';
import { isRouteAllowedForRole, NAV_ITEMS } from '../../../src/lib/nav-items';
import {
  useContextoEnVivo,
  useRutasDeLinea,
  useMolinosResumen,
  INTERVALO_POLL_POSICIONES_MS,
  usePosicionesEnVivo,
  useRecargarTraza,
  useTrazaEnVivo,
} from '../../../src/lib/en-vivo/use-en-vivo';
import { intervaloPoll, presentacionFrescura } from '../../../src/lib/en-vivo/traza';
import {
  ETIQUETA_NIVEL,
  actualizarPrimeraVez,
  contarPorNivel,
  nivelDeAlerta,
  ordenarAlertas,
  resumenContadores,
  puedeActuarEnInfracciones,
  siguienteAlertaId,
} from '../../../src/lib/en-vivo/alertas';
import { filtrarPorEstado, ordenColaMolinos } from '../../../src/lib/en-vivo/atencion';
import { useAdminCity } from '../../../src/lib/geo/use-admin-city';
import { useLineaOptions } from '../../../src/lib/api/use-linea-options';
import {
  construirMarcadoresVehiculos,
  construirMapaDeLinea,
  construirPuntosControl,
  construirRutas,
  construirZonas,
  idMarcadorVehiculo,
  mensajeError,
  vacioSobreMapa,
} from './map-builders';
import { BarraMando } from './barra-mando';
import { ModuloJornada } from './modulo-jornada';
import { ModuloMolinos } from './modulo-molinos';
import { PanelFlota } from './panel-flota';
import { PanelVehiculo, type AvisoPanel, type BorradoresDescarte } from './panel-vehiculo';
import { conPuntoVivo } from '../../../src/lib/en-vivo/punto-vivo';
import { puntosAnimadosSobreRuta, rutasSnapDe } from '../../../src/lib/en-vivo/segmentos-traza';

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
  // `GET /reportes/jornadas` (el `operador` recibiría 403), así que también gobierna `ModuloJornada`.
  const tienePanelAdmin = user ? isRouteAllowedForRole(NAV_ITEMS, '/', user.rol) : false;
  const [confirmandoSalida, setConfirmandoSalida] = useState(false);
  const puedeVerDias = user ? isRouteAllowedForRole(NAV_ITEMS, '/reportes/recorridos', user.rol) : false;
  const soloLectura = !puedeActuarEnInfracciones(user?.rol);
  const { options: lineaOptions, lineas } = useLineaOptions();
  const [lineaFilter, setLineaFilter] = useState('');
  const [sesionSeleccionada, setSesionSeleccionada] = useState<string | null>(null);
  const [seguir, setSeguir] = useState(true);
  // PR E: filtro "solo con alertas de este nivel", aviso aria-live de las acciones del panel y
  // el punto de la infracción que "Ver en mapa" acaba de centrar.
  const [nivelFiltro, setNivelFiltro] = useState<GravedadRegla | null>(null);
  // Filtro por estado de frescura (panel de flota) y apertura del panel en < 1024 px.
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFrescura | null>(null);
  const [flotaAbierta, setFlotaAbierta] = useState(false);
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
      filtrarPorEstado(
        nivelFiltro
          ? posicionesDeLinea.filter((p) => p.id === sesionSeleccionada || nivelDeAlerta(p) === nivelFiltro)
          : posicionesDeLinea,
        estadoFiltro,
        sesionSeleccionada,
      ),
    [posicionesDeLinea, nivelFiltro, estadoFiltro, sesionSeleccionada],
  );
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
    setFlotaAbierta(false);
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

  const varianteId = posicionSeleccionada?.vuelta?.varianteId ?? null;
  const puntosControl = useMemo(
    () => (contexto.data ? construirPuntosControl(contexto.data, datos, varianteId) : []),
    [contexto.data, datos, varianteId],
  );
  // Color de la línea para el anillo del marcador: el catálogo de líneas (si cargó) y, con
  // seguridad, la de la sesión con el panel abierto (viene en su `contexto`).
  const colorLineaPorId = useMemo(() => {
    const mapa: Record<string, string | null | undefined> = {};
    for (const l of lineas) mapa[l.id] = l.color;
    if (contexto.data) mapa[contexto.data.linea.id] = contexto.data.linea.color;
    return mapa;
  }, [lineas, contexto.data]);
  const ordenMolinos = useMemo(() => ordenColaMolinos(molinos.data), [molinos.data]);
  const vehiculos = useMemo(
    () =>
      construirMarcadoresVehiculos(posicionesFiltradas, seleccionarSesion, {
        seleccionadoId: sesionSeleccionada,
        colorLineaPorId,
        ordenMolinos,
      }),
    [posicionesFiltradas, seleccionarSesion, sesionSeleccionada, colorLineaPorId, ordenMolinos],
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
  // Línea filtrada sin vehículo con detalle de ESA línea: se dibuja su ruta aunque nadie reporte.
  const rutasLinea = useRutasDeLinea(token, lineaFilter || null);
  const mapaLinea = useMemo(() => {
    if (!lineaFilter || sesionSeleccionada || !rutasLinea.data) return null;
    const color = lineas.find((l) => l.id === lineaFilter)?.color ?? 'var(--qv-color-primary)';
    return construirMapaDeLinea(color, rutasLinea.data);
  }, [lineaFilter, sesionSeleccionada, rutasLinea.data, lineas]);
  const markers = useMemo(
    () => [...(mapaLinea?.markers ?? puntosControl), ...marcadorFoco, ...vehiculos],
    [mapaLinea, puntosControl, marcadorFoco, vehiculos],
  );
  // Rutas contra las que se ajusta la traza y el marcador (solo cambian con el contexto).
  const rutasSnap = useMemo(
    () => (contexto.data ? rutasSnapDe(contexto.data.ruta.geometria.coordinates, contexto.data.variantes) : []),
    [contexto.data],
  );
  // `fusionarTraza` conserva la referencia de `puntos` si el poll no sumó nada: sin recalcular.
  const puntosTraza = datos?.puntos;
  const routesContexto = useMemo(
    () => (contexto.data ? construirRutas(contexto.data, puntosTraza, rutasSnap, varianteId) : []),
    [contexto.data, puntosTraza, rutasSnap, varianteId],
  );
  const zonesContexto = useMemo(
    () => (contexto.data ? construirZonas(contexto.data) : []),
    [contexto.data],
  );
  const routes = mapaLinea?.routes ?? routesContexto;
  const zones = mapaLinea?.zones ?? zonesContexto;

  // Reencuadre una vez al cargar la ruta de la línea elegida (sin vehículo seleccionado).
  // `lineaReencuadrada` evita reencuadrar al cerrar el panel de un vehículo (la línea no cambió).
  const hayMapaLinea = Boolean(mapaLinea && mapaLinea.routes.length > 0);
  const lineaReencuadrada = useRef('');
  useEffect(() => {
    if (!lineaFilter) lineaReencuadrada.current = '';
    else if (hayMapaLinea && lineaReencuadrada.current !== lineaFilter) {
      lineaReencuadrada.current = lineaFilter;
      setFitKeyOverride((k) => k + 1);
    }
  }, [hayMapaLinea, lineaFilter]);

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
      puntosTraza
        ? puntosAnimadosSobreRuta(
            conPuntoVivo(puntosTraza, { lat: vivoLat, lng: vivoLng, ultimoFixTs: vivoTs }),
            rutasSnap,
          )
        : [],
    [puntosTraza, vivoLat, vivoLng, vivoTs, rutasSnap],
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
      ? { lat: ultimoPunto.lat, lng: ultimoPunto.lng, animado: true }
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
    // punto caiga en el centro de la franja visible, entre la barra de mando y la hoja.
    const hoja = document.querySelector<HTMLElement>('.qv-live-cajon');
    const hud = document.querySelector<HTMLElement>('.qv-live-barra');
    const mapa = mapaRef.current?.querySelector<HTMLElement>('.qv-live-mapa');
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

  const hayHud = !estadoSuperpuesto;
  // Con 0 vehículos la barra de mando sigue visible: el filtro de línea y "Días anteriores" siguen siendo útiles.
  const vacioCompacto = estadoSuperpuesto === 'vacio' && vacioSobreMapa(lineaFilter, hayMapaLinea, rutasLinea.cargando);
  const hayBarra = hayHud || estadoSuperpuesto === 'vacio';

  // Zonas del mapa tapadas por el cajón del vehículo: el seguimiento centra al vehículo en lo que
  // queda visible. En escritorio el cajón es una columna al lado del mapa (no tapa nada: 0); en
  // tablet flota por la derecha; en móvil (<= 720 px) es una hoja inferior.
  const [rellenoSeguir, setRellenoSeguir] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  useEffect(() => {
    const raiz = mapaRef.current;
    const mapa = raiz?.querySelector<HTMLElement>('.qv-live-mapa');
    if (!raiz || !mapa) return;
    const medir = () => {
      const caja = mapa.getBoundingClientRect();
      const panel = sesionSeleccionada ? raiz.querySelector<HTMLElement>('.qv-live-cajon .qv-live-panel') : null;
      const movil = window.matchMedia('(max-width: 720px)').matches;
      const cajaPanel = panel?.getBoundingClientRect();
      const tapa = cajaPanel !== undefined && cajaPanel.left < caja.right - 1;
      const siguiente = {
        top: 0,
        right: cajaPanel && tapa && !movil ? Math.max(0, Math.ceil(caja.right - cajaPanel.left)) : 0,
        bottom: cajaPanel && tapa && movil ? Math.max(0, Math.ceil(caja.bottom - cajaPanel.top)) : 0,
        left: 0,
      };
      setRellenoSeguir((previo) =>
        previo.right === siguiente.right && previo.bottom === siguiente.bottom ? previo : siguiente,
      );
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(mapa);
    raiz.querySelectorAll('.qv-live-cajon .qv-live-panel').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [hayHud, sesionSeleccionada]);

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
      {hayBarra && (
        <BarraMando
          consulta={{ dataUpdatedAt: posiciones.dataUpdatedAt, isError: posiciones.isError }}
          tienePanelAdmin={tienePanelAdmin}
          puedeVerDias={puedeVerDias}
          onSalir={() => {
            if (tienePanelAdmin) router.push('/');
            else setConfirmandoSalida(true);
          }}
          lineas={lineas}
          lineaOptions={lineaOptions}
          lineaFilter={lineaFilter}
          onLinea={setLineaFilter}
          conteoNiveles={conteoNiveles}
          nivelFiltro={nivelFiltro}
          onNivel={setNivelFiltro}
          alertasPendientes={alertasOrdenadas.length}
          resumenAlertas={resumenContadores(contarPorNivel(alertasOrdenadas))}
          siguienteAlertaRef={siguienteAlertaRef}
          onSiguienteAlerta={irASiguienteAlerta}
          flotaAbierta={flotaAbierta}
          onToggleFlota={() => setFlotaAbierta((v) => !v)}
        />
      )}

      <div className="qv-live-cuerpo">
        {hayHud && (
          <PanelFlota
            posicionesLinea={posicionesDeLinea}
            posicionesVisibles={posicionesFiltradas}
            ordenMolinos={ordenMolinos}
            colorLineaPorId={colorLineaPorId}
            estadoFiltro={estadoFiltro}
            onEstado={setEstadoFiltro}
            seleccionadoId={sesionSeleccionada}
            onSeleccionar={(id) => {
              if (id !== sesionSeleccionada) seleccionarSesion(id);
              else setFlotaAbierta(false);
            }}
            abierto={flotaAbierta}
            onCerrar={() => setFlotaAbierta(false)}
          >
            <ModuloMolinos resumen={molinos.data} lineaFilter={lineaFilter} recibidoEn={molinos.dataUpdatedAt} posiciones={todasLasPosiciones} />
            {tienePanelAdmin && <ModuloJornada lineaFilter={lineaFilter} />}
          </PanelFlota>
        )}

        <div className="qv-live-mapa">
          {/* MAPA: ocupa todo el espacio que dejan el panel de flota y el cajón */}
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
            followPadding={rellenoSeguir}
            onUserPan={() => setSeguir(false)}
            defaultCenter={adminCity.centro}
            defaultZoom={adminCity.zoom}
            animatedVehicle={animatedVehicle}
          />

          {/* ESTADOS SIN DATOS: capa sobre el mapa (que sigue montado, ver `estadoSuperpuesto`) */}
          {estadoSuperpuesto && (
            <div className={vacioCompacto ? 'qv-live-pagina qv-live-pagina--sobre-mapa' : 'qv-live-pagina'}>
              {estadoSuperpuesto === 'cargando' && (
                <div className="qv-live-pagina__centro">
                  <Loader label="Cargando flota en vivo..." />
                </div>
              )}
              {estadoSuperpuesto === 'error' && (
                <div className="qv-live-pagina__error">
                  <Alert variant="danger" title="No se pudo cargar la flota en vivo">
                    <div className="qv-live-pagina__columna">
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
                <div className={vacioCompacto ? 'qv-live-vacio qv-live-vacio--compacto' : 'qv-live-pagina__centro qv-live-vacio'}>
                  <div className="qv-live-vacio__icono">
                    <Radio size={28} aria-hidden="true" />
                  </div>
                  <div className="qv-live-vacio__texto">
                    <h2>Sin vehículos en ruta activa</h2>
                    <p>
                      Ningún vehículo ha iniciado recorrido en la jornada de hoy. En cuanto una terminal móvil
                      sincronice su primer punto, aparecerá automáticamente aquí.
                    </p>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => void posiciones.refetch()}>
                    <RefreshCw size={14} className="qv-live-vacio__ico-btn" aria-hidden="true" />
                    Verificar nuevamente
                  </Button>
                  {/* Sin sesiones todavía (típico de madrugada) es justo cuando importa saber quién
                  declaró su jornada: el módulo también vive acá, sin mapa debajo. Es el mismo del
                  panel de flota (que no se monta en este estado): nunca hay dos. */}
                  {tienePanelAdmin && (
                    <div className="qv-live-vacio__jornada">
                      <ModuloJornada lineaFilter="" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {hayHud && (
            <>
              {/* Controles del mapa (la frescura del vehículo seleccionado vive en su panel) */}
              <div className="qv-live-controles" role="group" aria-label="Controles del mapa">
                <button
                  type="button"
                  className="qv-live-btn"
                  onClick={alternarSeguir}
                  disabled={!puedeSeguir}
                  aria-pressed={seguir && puedeSeguir}
                  title="Seguir vehículo en tiempo real"
                >
                  <Navigation size={14} aria-hidden="true" className={seguir && puedeSeguir ? 'qv-live-ico-seguir' : undefined} />
                  Seguir
                </button>
                <button
                  type="button"
                  className="qv-live-btn qv-live-btn--icono"
                  onClick={() => setFitKeyOverride((v) => v + 1)}
                  title="Reencuadrar toda la flota"
                  aria-label="Reencuadrar toda la flota"
                >
                  <Maximize2 size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="qv-live-btn qv-live-btn--icono"
                  onClick={() => void handleManualRefresh()}
                  title="Actualizar datos GPS ahora"
                  aria-label="Actualizar datos GPS ahora"
                >
                  <RefreshCw size={14} aria-hidden="true" className={isRefreshing ? 'qv-live-ico-girando' : undefined} />
                </button>
              </div>

              {/* PILA DE AVISOS sobre el mapa, abajo a la izquierda. Las regiones aria-live están
              SIEMPRE montadas: los lectores de pantalla solo anuncian cambios de contenido en una
              región que ya estaba en el DOM antes de poblarse. */}
              <div className="qv-live-toasts">
                {/* Filtro sin resultados — estado vacío honesto: la flota existe, esta línea (o este
                filtro) no tiene nadie reportando ahora mismo. El mapa sigue montado (el usuario puede
                cambiar el filtro sin perder contexto), a diferencia del empty-state de página completa
                de arriba (que es para "no hay NADA en toda la jornada"). */}
                <div role="status" aria-live="polite">
                  {aviso && (
                    <div className={`qv-live-toast qv-live-toast--${aviso.tono === 'ok' ? 'ok' : 'error'}`}>
                      {aviso.tono === 'ok' ? (
                        <CheckCircle2 size={14} aria-hidden="true" className="qv-live-toast__ico--ok" />
                      ) : (
                        <AlertTriangle size={14} aria-hidden="true" className="qv-live-toast__ico--error" />
                      )}
                      <span>{aviso.texto}</span>
                    </div>
                  )}
                  {posicionesFiltradas.length === 0 && (
                    <div className="qv-live-toast qv-live-toast--aviso">
                      <AlertTriangle size={14} aria-hidden="true" className="qv-live-toast__ico--aviso" />
                      {(nivelFiltro || estadoFiltro) && posicionesDeLinea.length > 0 ? (
                        <>
                          <span>
                            {nivelFiltro && estadoFiltro
                              ? 'Ningún vehículo cumple los filtros de nivel y de estado.'
                              : nivelFiltro
                                ? `Ningún vehículo tiene alertas ${ETIQUETA_NIVEL[nivelFiltro].plural} ahora.`
                                : 'Ningún vehículo está en el estado elegido.'}
                          </span>
                          <button
                            type="button"
                            className="qv-live-btn qv-live-btn--sm"
                            onClick={() => {
                              setNivelFiltro(null);
                              setEstadoFiltro(null);
                            }}
                          >
                            Quitar filtros
                          </button>
                        </>
                      ) : (
                        <span>
                          Ningún vehículo de esta línea está reportando ahora. Probá con todas las líneas.
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {sinConexionConDatos && (
                  <div role="status" aria-live="polite">
                    <div className="qv-live-toast qv-live-toast--warning">
                      <AlertTriangle size={14} aria-hidden="true" className="qv-live-toast__ico--warning" />
                      <span>Sin conexión · mostrando últimos datos</span>
                    </div>
                  </div>
                )}

                {/* FLOATING ALERT TOASTS */}
                <div role="alert" aria-live="assertive">
                  {sesionSeleccionada && presentacion.esFalla && (
                    <div className="qv-live-toast qv-live-toast--falla">
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>{presentacion.etiqueta}: El teléfono no sincroniza con el servidor</span>
                    </div>
                  )}
                </div>

                <div role="status" aria-live="polite">
                  {sesionSeleccionada && estado === 'detenido' && (
                    <div className="qv-live-toast qv-live-toast--aviso">
                      <Clock size={14} aria-hidden="true" className="qv-live-toast__ico--aviso" />
                      <span>Vehículo detenido: Posición estacionaria registrada</span>
                    </div>
                  )}

                  {finalizada && (
                    <div className="qv-live-toast qv-live-toast--info">
                      <CheckCircle2 size={14} aria-hidden="true" className="qv-live-toast__ico--ok" />
                      <span>Sesión finalizada</span>
                      <button
                        type="button"
                        className="qv-live-toast__btn"
                        onClick={() => router.push(`/reportes/recorridos/${sesionSeleccionada}`)}
                      >
                        Ver histórico →
                      </button>
                    </div>
                  )}

                  {pollPausado && (
                    <div className="qv-live-toast qv-live-toast--warning">
                      <Clock size={14} aria-hidden="true" className="qv-live-toast__ico--warning" />
                      <span>Seguimiento pausado por inactividad</span>
                      <button
                        type="button"
                        className="qv-live-toast__btn qv-live-toast__btn--warning"
                        onClick={() => void traza.refetch()}
                      >
                        Reanudar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* CAJÓN DEL VEHÍCULO (cabecera, acciones rápidas, infracciones, PCs y stats): columna de
        372 px a la derecha en escritorio; flota sobre el mapa en tablet y es hoja inferior en
        móvil (<= 720 px, ver `.qv-live-cajon`). */}
        {hayHud && sesionSeleccionada && (
          <div className="qv-live-cajon">
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
          </div>
        )}
      </div>

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
