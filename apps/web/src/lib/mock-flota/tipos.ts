/**
 * Tipos del módulo `mock-flota` — estado de demo para `/en-vivo` en modo
 * `NEXT_PUBLIC_MOCK_FLOTA=true` (ver `docs/plan-mock-flota-en-vivo.md` y, para la ampliación
 * del panel del delegado, `docs/plan-mock-guion-delegado.md`).
 *
 * Todo lo de este módulo es **mock**: vive solo en memoria del cliente (se resetea al
 * recargar la página) y no toca Prisma, la API real ni `packages/shared`. La severidad
 * `leve|media|grave` es DISTINTA del enum real `leve|grave|gravisima`
 * (`packages/shared/src/enums/estados.ts:59`) — es la que pidió el CTO para esta demo, a
 * propósito, y no se homologan.
 */

/** Gravedad de una infracción mock. Ver nota de cabecera: no es el enum real. */
export type Severidad = 'leve' | 'media' | 'grave';

/** Las 2 líneas mockeadas. Los nombres son literales exactos usados en toda la UI. */
export type LineaMockId = 'z12' | 'l120';

export interface ParadaMock {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  /** Posición dentro de `LineaMock.paradas`, en el orden real de recorrido del circuito. */
  orden: number;
  /** `true` en 3-4 paradas por línea — punto de control del recorrido (guion E07 04:32/05:05).
   * Valor DEFAULT/semilla — la copia editable en runtime vive en `estado.config[lineaId]`
   * (ver `configDe`/`guardarConfigLinea` en `estado/config.ts`), que es la que lee el tick para
   * decidir si registrar un cumplimiento. */
  esPuntoControl: boolean;
  /** Radio de tolerancia en metros (50-80) para contar un cumplimiento al cruzar este punto.
   * Mismo comentario de "valor default" que `esPuntoControl`. */
  radioToleranciaM: number;
  /** Avance `[0,1)` PRECALCULADO sobre `LineaMock.polilinea`: fracción de distancia acumulada
   * del vértice más cercano de esta parada (ver `avanceDeParada` en `geometria.ts`). Es
   * geometría fija — a diferencia de `esPuntoControl`/`radioToleranciaM`, NO tiene copia
   * editable en `estado.config` (la config no permite mover una parada de lugar). */
  avance: number;
}

export interface LineaMock {
  id: LineaMockId;
  nombre: 'Z12' | 'Línea 120';
  /** Color de borde de los marcadores de esta línea (Decisión 6 del plan). */
  color: string;
  /** `[lat, lng]` — OJO: es el orden inverso del GeoJSON `[lon, lat]` de donde salen los datos.
   * Usar para MOVER trufis (`posicionEnPolilinea`) — para DIBUJAR el trazo en el mapa usar
   * `trazoRuta`, no este campo directamente. */
  polilinea: [number, number][];
  /** Tramo a DIBUJAR en `RouteMap` (`MapRoute.points` en `en-vivo-simulado.tsx`) — computado
   * una sola vez en `datos.ts` vía `trazoVisibleDe(polilinea)` (`geometria.ts`). Igual a
   * `polilinea` salvo que la línea sea de ida y vuelta sobre las mismas calles (p. ej. la
   * 120): ahí es solo la ida, para no dibujar dos veces el mismo trazo ni romper el
   * `line-offset` de MapLibre cuando otra línea comparte esa calle (ver `OFFSET_PX` en
   * `en-vivo-simulado.tsx`). */
  trazoRuta: [number, number][];
  paradas: ParadaMock[];
}

export interface TrufiMock {
  id: string;
  placa: string;
  numeroInterno: string;
  conductorNombre: string;
  lineaId: LineaMockId;
  fotoUrl: string;
  /** Solo dígitos, formato E.164 sin `+` (p. ej. `59170000001`) — ver `whatsapp.ts`. */
  whatsapp: string;
}

export interface AccionTipo {
  id: string;
  nombre: string;
  descripcion: string;
}

export interface InfraccionTipo {
  id: string;
  nombre: string;
  severidad: Severidad;
  acciones: AccionTipo[];
}

export type ModoAplicacion = 'ahora' | 'plazo';

export interface AccionAplicada {
  accionId: string;
  modo: ModoAplicacion;
  /** ISO datetime — momento en que se aplicó la acción (no en que vence). */
  aplicadaEn: string;
  /** ISO date (`yyyy-mm-dd`) — solo presente con `modo: 'plazo'`. */
  venceEl?: string;
}

export interface InfraccionMock {
  id: string;
  trufiId: string;
  tipoId: string;
  severidad: Severidad;
  /** ISO datetime en que se disparó la infracción simulada. */
  ocurridaEn: string;
  estado: 'activa' | 'sancionada';
  accionAplicada?: AccionAplicada;
}

/**
 * Fase operativa de un trufi (contrato del plan del guion delegado + `sincronizando`, el
 * estado transitorio de `recuperarSenal` que el guion pide mostrar como "Sincronizando N
 * puntos…" — no está en el contrato textual pero SÍ en la descripción de la toma E08, así que
 * se agrega como valor adicional del enum, no como rename).
 */
export type FaseTrufi =
  | 'en_cola'
  | 'en_ruta'
  | 'atascado'
  | 'desviado'
  | 'sin_senal'
  | 'sincronizando'
  | 'finalizado';

/** `[lat, lng, ts]` — `ts` en epoch ms. Usado por `EstadoTrufi.bufferPuntos`/`traza`. */
export type PuntoTrazado = [lat: number, lng: number, ts: number];

export interface CumplimientoPunto {
  paradaId: string;
  /** ISO datetime del cruce. */
  ts: string;
}

/** Evento que un trufi dispara al avanzar un tick — lo detecta `estado/flota.ts#avanzarTrufi`
 * (y `estado/senal.ts#avanzarSinSenal`) y lo consume `estado/index.ts#tick` para actualizar
 * `recorridos`/`colas` (cumplimiento de punto de control, vuelta completa) — cosas que ni
 * `flota.ts` ni `senal.ts` deciden por sí solos, solo detectan y reportan. Vive en `tipos.ts`
 * (no en `estado/flota.ts`, donde se definía antes) porque `EstadoTrufi.eventosPendientes`
 * (el buffer offline de `sin_senal`) lo necesita como parte del contrato de datos. */
export type EventoTrufiTick = { tipo: 'cumplimiento'; paradaId: string; ts: string } | { tipo: 'vuelta-completa' };

export interface EstadoTrufi {
  trufiId: string;
  fase: FaseTrufi;
  /** Avance INTERNO sobre la polilínea de su línea, en `[0, 1)` — hace loop al llegar a 1.
   * Sigue avanzando incluso en `sin_senal` (real, "de la caja negra"); se congela por completo
   * en `atascado` y `sincronizando`, y en `desviado` avanza normal aunque la posición
   * EXPUESTA (`lat`/`lng`) se desplace perpendicular a la ruta. */
  avance: number;
  /** Posición EXPUESTA/dibujada — coincide con `posicionEnPolilinea(linea.polilinea, avance)`
   * salvo en `sin_senal`/`sincronizando` (se congela en la última posición conocida) y
   * `desviado` (se desplaza fuera de la polilínea, ver `trazaDesvio`). */
  lat: number;
  lng: number;
  siguienteParadaId: string | null;
  /** Número de vuelta en curso (incrementa en cada `despacharSiguiente`). */
  vueltaActual: number;
  /** ISO datetime del último momento con señal normal (fase distinta de `sin_senal`/
   * `sincronizando`) — insumo del hint "Sin señal · hace m:ss". */
  ultimaSenalEn: string;
  /** Puntos `[lat,lng,ts]` acumulados MIENTRAS `fase === 'sin_senal'` (posición real, no la
   * expuesta) — se vacía al terminar `recuperarSenal`. */
  bufferPuntos: PuntoTrazado[];
  /** Traza de la vuelta ACTUAL (se reinicia en cada `despacharSiguiente`) — incluye los puntos
   * normales de cada tick más los que se vuelcan desde `bufferPuntos` al recuperar señal. */
  traza: PuntoTrazado[];
  /** Puntos de control cruzados en la vuelta ACTUAL (se reinicia en cada `despacharSiguiente` y
   * al cerrar una vuelta — ya sea online o reconciliada tras `sincronizando`). */
  cumplimientos: CumplimientoPunto[];
  /** Cruces de punto de control / cierre de vuelta detectados MIENTRAS `fase === 'sin_senal'`
   * (posición real, invisible para el panel todavía) — se acumulan acá en vez de aplicarse de
   * una, y se reconcilian de una sola vez (en orden) contra `recorridos`/`cumplimientos` cuando
   * `sincronizando` termina de volcar el buffer (`avanzarSincronizando`, `senal.ts`). Vacío
   * fuera de `sin_senal`/`sincronizando`. */
  eventosPendientes: EventoTrufiTick[];
  /** Tamaño de `bufferPuntos` al ENTRAR a `sincronizando` (se muestra fijo durante el conteo
   * "Sincronizando N puntos…", aunque `bufferPuntos` ya no crezca en ese momento). `0` fuera
   * de `sincronizando`. */
  puntosPendientes: number;
  /** Último tramo volcado por `recuperarSenal` — EXACTAMENTE los puntos que estaban en
   * `bufferPuntos` al terminar `sincronizando` (no una aproximación de "los últimos N puntos de
   * la traza"). `null` mientras el trufi no sincronizó nada todavía en esta vuelta. La UI lo usa
   * para dibujar el tramo "Sincronizando…" tal cual, sin adivinar. */
  ultimoTramoSincronizado: { puntos: [number, number][]; en: string } | null;
  /** Tramo `[lat,lng][]` (~250 m adelante) a dibujar en rojo punteado — solo con
   * `fase === 'atascado'`. */
  tramoAtascado?: [number, number][];
  /** Traza `[lat,lng][]` del desvío ya recorrido — solo con `fase === 'desviado'`. */
  trazaDesvio?: [number, number][];
  /** Ticks restantes con `fase === 'atascado'` antes de reanudar solo. */
  atascoTicksRestantes?: number;
  /** Progreso `[0, DESVIO_TICKS_TOTAL]` del desvío — crece 1 por tick; la envolvente del
   * offset (metros fuera de ruta) es triangular sobre este contador (ver `flota.ts`). */
  desvioProgreso?: number;
  /** Ticks restantes con `fase === 'sincronizando'` antes de volcar el buffer. */
  sincronizandoTicksRestantes?: number;
}

// ================================================================================================
// Salidas / cola de despacho por línea (E07 04:03 / 04:49).
// ================================================================================================

export interface SalidaMock {
  id: string;
  trufiId: string;
  lineaId: LineaMockId;
  /** ISO datetime de la salida PROGRAMADA (según `frecuenciaMin` de la línea). */
  programada: string;
  /** ISO datetime de la salida REAL — ausente mientras el trufi sigue en cola. */
  real?: string;
  /** `true` cuando salió antes que el trufi que tenía adelante en la cola
   * (`simularFueraDeOrden`). */
  fueraDeOrden: boolean;
}

// ================================================================================================
// Recorridos (historial de 24 h — E07 04:03 / 05:05).
// ================================================================================================

export interface RecorridoMock {
  id: string;
  trufiId: string;
  lineaId: LineaMockId;
  /** ISO datetime de inicio (salida). */
  inicio: string;
  /** ISO datetime de cierre — ausente mientras `estado === 'en_curso'`. */
  fin?: string;
  /** Puntos de control cruzados en ESTE recorrido — vive también, en vivo, como
   * `EstadoTrufi.cumplimientos.length` mientras `estado === 'en_curso'`. */
  puntosCumplidos: number;
  /** Total de puntos de control de la línea al momento de iniciar el recorrido. */
  puntosTotal: number;
  estado: 'en_curso' | 'completo' | 'incompleto';
}

// ================================================================================================
// Novedades (bandeja — E07 04:17).
// ================================================================================================

export type TipoNovedad = 'desvio' | 'fuera_de_orden' | 'reporte_conductor' | 'atascado' | 'sin_senal';

export type SubtipoReporteConductor =
  | 'pinchazo'
  | 'control_policial'
  | 'bloqueo_via'
  | 'falla_mecanica'
  | 'incidente_pasajero';

export interface NovedadMock {
  id: string;
  tipo: TipoNovedad;
  subtipo?: SubtipoReporteConductor;
  trufiId: string;
  /** ISO datetime de creación. */
  creadaEn: string;
  estado: 'nueva' | 'en_revision' | 'atendida';
  /** Nota dejada al atender (`atenderNovedad`) — también se siembra en el historial del día. */
  nota?: string;
  /** Id de la `InfraccionMock` que esta novedad generó — SOLO presente cuando la infracción se
   * creó de verdad (no cuando `crearInfraccionDesdeNovedad`/`simularDesvio` la pisan porque el
   * trufi ya tenía una activa, ver `flota-mock-context.tsx`). Las novedades de desvío
   * SEMBRADAS (`sembrarNovedades`) no tienen infracción real detrás — queda `undefined`. Usar
   * `infraccionDeNovedad(estado, novedadId)` para resolverla. */
  infraccionId?: string;
}

// ================================================================================================
// Demanda (paradas con alta demanda / hora pico — E07 04:32).
// ================================================================================================

export type NivelDemanda = 'baja' | 'media' | 'alta';

export interface DemandaParada {
  nivel: NivelDemanda;
  esperando: number;
}

// ================================================================================================
// Configuración por línea (E08 06:01).
// ================================================================================================

/** Copia EDITABLE en runtime de los 3 campos configurables de una parada — el resto
 * (`lat`/`lng`/`orden`/`avance`) sigue viniendo de `LineaMock.paradas` (geometría fija). */
export interface ParadaConfigMock {
  id: string;
  nombre: string;
  esPuntoControl: boolean;
  radioToleranciaM: number;
}

export interface ConfigLineaMock {
  lineaId: LineaMockId;
  frecuenciaMin: number;
  /** `HH:MM`, 24 h. */
  horaInicio: string;
  /** `HH:MM`, 24 h. */
  horaFin: string;
  paradas: ParadaConfigMock[];
}

/** Entrada de `guardarConfigLinea` — mismo shape que `ConfigLineaMock` sin `lineaId` (va aparte,
 * como primer argumento de la acción). */
export interface ConfigLineaInput {
  frecuenciaMin: number;
  horaInicio: string;
  horaFin: string;
  paradas: ParadaConfigMock[];
}

// ================================================================================================
// Estado combinado (ver `estado/index.ts` — se arma juntando los slices de `estado/*`).
// ================================================================================================

export interface EstadoFlotaMock {
  trufis: Record<string, EstadoTrufi>;
  infracciones: InfraccionMock[];
  pausado: boolean;
  /** Cola de despacho por línea — SOLO trufis `en_cola`, en orden (el índice 0 es el próximo a
   * despachar con `despacharSiguiente`). */
  colas: Record<LineaMockId, string[]>;
  salidas: SalidaMock[];
  recorridos: RecorridoMock[];
  novedades: NovedadMock[];
  /** `true` mientras `alternarHoraPico()` fuerza alta demanda (ver `demandaDe`). */
  horaPico: boolean;
  config: Record<LineaMockId, ConfigLineaMock>;
}
