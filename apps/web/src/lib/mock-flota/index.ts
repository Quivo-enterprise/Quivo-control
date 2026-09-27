/**
 * Barrel del módulo `mock-flota` — mock de estado/datos para `/en-vivo` en modo
 * `NEXT_PUBLIC_MOCK_FLOTA=true`. Ver `docs/plan-mock-flota-en-vivo.md` (mock original) y
 * `docs/plan-mock-guion-delegado.md` (ampliación: flota de 8 trufis, salidas/cola, historial
 * de 24 h, novedades, demanda, configuración por línea, señal/atasco/desvío).
 *
 * TODO lo de este módulo vive solo en memoria del cliente — nada toca Prisma, la API real ni
 * `packages/shared`. El reducer (`estado/`) es PURO: `Math.random()`/`Date.now()` viven
 * ÚNICAMENTE en `flota-mock-context.tsx` (el hook), que resuelve azar/tiempo/ids ANTES de
 * dispatchear.
 *
 * Índice de exports por área (todo re-exportado acá — importar SIEMPRE desde
 * `src/lib/mock-flota`, nunca desde un archivo interno):
 *
 * — Tipos (`tipos.ts`): `Severidad`, `LineaMockId`, `ParadaMock`, `LineaMock`, `TrufiMock`,
 *   `AccionTipo`, `InfraccionTipo`, `ModoAplicacion`, `AccionAplicada`, `InfraccionMock`,
 *   `FaseTrufi`, `PuntoTrazado`, `CumplimientoPunto`, `EventoTrufiTick`, `EstadoTrufi`,
 *   `SalidaMock`, `RecorridoMock`, `TipoNovedad`, `SubtipoReporteConductor`, `NovedadMock`
 *   (con `infraccionId?`), `NivelDemanda`, `DemandaParada`, `ParadaConfigMock`,
 *   `ConfigLineaMock`, `ConfigLineaInput`, `EstadoFlotaMock`.
 *
 * — Datos fijos (`datos.ts`): `LINEAS_MOCK` (Z12 + Línea 120, con `paradas[].esPuntoControl`/
 *   `radioToleranciaM`/`avance` precalculados MONÓTONOS por `orden`, vía `avancesDeParadas`),
 *   `TRUFIS_MOCK` (8 trufis: 5 Z12 + 3 Línea 120).
 *
 * — Catálogo de infracciones (`catalogo-infracciones.ts`): `CATALOGO_INFRACCIONES`,
 *   `SEVERIDAD_META`.
 *
 * — Geometría (`geometria.ts`): `posicionEnPolilinea`, `indiceDeRetornoDe`, `trazoVisibleDe`,
 *   `distanciaEntrePuntosM`, `largoTotalM`, `avanceDeParada`, `avancesDeParadas`,
 *   `distanciaEntreAvancesM`, `tramoDesdeAvance` (siempre ≥2 puntos), `bearingEnAvance`,
 *   `desplazarPerpendicular`.
 *
 * — WhatsApp (`whatsapp.ts`): `construirUrlWhatsApp`, `mensajeParaConductor`.
 *
 * — Estado / reducer (`estado/`, combinado en `estado/index.ts` a partir de los slices
 *   `flota`, `salidas`, `recorridos`, `novedades`, `senal`, `demanda`, `config`):
 *   - Núcleo: `estadoInicial(now?)`, `reducer(estado, accion)`, `AccionFlotaMock`,
 *     `INTERVALO_TICK_MS`, `kpis(estado, lineaId?)`.
 *   - Infracciones (slice `flota`): `PLAZO_MAX_DIAS`, `fechaPlazoValida`, `infraccionActivaDe`,
 *     `infraccionesDe`, `trufisSinInfraccionActiva`, `elegirAleatorios`, `elegirTipoInfraccion`,
 *     `trufisEnRutaVisibles`, `trufisSinSenalVisibles`, `trufisReportables`.
 *   - Señal (slice `senal`): `SINCRONIZANDO_TICKS`.
 *   - Salidas/cola (slice `salidas`): `colaDe`, `delanteDetras`, `horariosCola(estado, lineaId,
 *     now)`, `salidasDelDia`, `GapTrufi`.
 *   - Recorridos (slice `recorridos`): `recorridosDelDia`.
 *   - Novedades (slice `novedades`): `novedadesAbiertas`, `infraccionDeNovedad(estado, novedadId)`.
 *   - Demanda (slice `demanda`): `demandaDe`, `movimientoPorHora`, `movimientoTipicoPorHora(lineaId?)`,
 *     `paradasConAltaDemanda`.
 *   - Configuración (slice `config`): `configDe`, `paradasDe(estado, lineaId)`,
 *     `validarConfigLinea` (ahora también valida nombre/radio por parada),
 *     `puntosControlActivosDe`.
 *   - (interno, NO re-exportado acá — mismo criterio que `mulberry32`/`entreEnteros`/
 *     `hashString` de `estado/rng.ts`) `ordenarPorFecha` — helper genérico de orden
 *     cronológico, reusado por varios de los `sembrar*` de arriba.
 *
 * — Provider + hook (`flota-mock-context.tsx`): `FlotaMockProvider`, `useFlotaMock()` — expone
 *   `estado`, `lineas`, `trufis`, `catalogo` y TODAS las acciones (ver el `SubagentHandback` de
 *   este agente / el header de `flota-mock-context.tsx` para la lista completa con firmas).
 *   `despacharSiguiente`, `simularDesvio`, `crearInfraccionDesdeNovedad` y `guardarConfigLinea`
 *   devuelven `AccionResultado = { ok: true } | { ok: false; motivo: string }` en vez de `void`.
 */

export * from './tipos';
export * from './datos';
export * from './catalogo-infracciones';
export * from './geometria';
export * from './estado';
export * from './whatsapp';
export * from './flota-mock-context';
