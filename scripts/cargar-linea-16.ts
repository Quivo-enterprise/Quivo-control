/**
 * Carga la **línea 16** (sindicato piloto, Sindicato Mixto de Transporte(istas) Tiquipaya) en
 * producción, **hablando SOLO con la API HTTP pública** (nunca con la base: Cloud SQL es de IP
 * privada, no hay proxy desde fuera de la VPC). Mismo patrón que `sembrar-piloto-produccion.ts`:
 * login de admin con credenciales por variable de entorno (fail-closed), 429 con reintento,
 * idempotente por lookups. **Dry-run por defecto**: se autentica y LEE el estado actual, imprime
 * qué requests mandaría (conteo de vértices, no payloads) y NO escribe nada. `--apply` escribe.
 *
 * ## Modelo operativo (CTO, 2026-10-12 y corrección 2026-10-13 — reemplaza al anterior)
 *
 *   1. Todos los vehículos salen de **Salomón Romero** (SR) hacia **Honduras**. Honduras = el
 *      punto del KML `RETORNO LINEA 16` (junto al vértice 122 de la línea principal). Es una
 *      identificación del CTO ("creo"): **no confirmada en campo**.
 *   2. En Honduras el control (rol `operador` en la web) designa quién vuelve directo a SR y
 *      quién va a Molinos.
 *   3. Directo: vuelve por la ruta hasta SR.
 *   4. Vía Molinos: en el vértice 43 sube por el ramal Putucu hasta Molinos, ESPERA 30 min,
 *      baja por las mismas calles y **sigue hasta Salomón Romero**: Molinos es una pasada
 *      intermedia, **toda vuelta termina en SR** (corrección del CTO, 2026-10-13).
 *   5. Una vuelta = SR → Honduras → SR (vía Molinos o directa). La vuelta se cuenta recién al
 *      volver a SR (lo implementa el worker de ingesta, `ingesta-worker/vueltas.ts`).
 *   - Cupos diarios (F2, todavía NO modelados): lun-vie 4 directas + 1 Molinos; sáb 2 + 1; dom 3 + 1.
 *   - Salidas de la mañana: 7-8 am con 6 min de intervalo, luego 7 min; después a criterio del admin.
 *     Turno nocturno desde las 17:01.
 *   - Alternancia de conductores: **3 días en la línea 120 (troncal) y 1 día en la 16**.
 *   - Fuera de alcance a propósito: los 4 trufis que salen desde el centro de Cochabamba.
 *
 * ## Geometría (F1, docs/plan-molinos-designacion.md): base + tramo de la variante
 *
 * UNA ruta asignable `sentido 'circuito'` con la **base** = el circuito directo que TERMINA en SR:
 *
 *     ida      principal[0..150]  todo el dibujo principal (151 vértices): Salomón Romero → … → v92
 *                        (América/Libertador) → El Prado → Honduras (v122) → Aroma → Ayacucho →
 *                        Libertador/América (v150, a pocos metros del v92)
 *     regreso  v150 → principal[91..43] invertido: desde ahí, la misma ruta de vuelta hasta la
 *                        bifurcación (49 vértices; se salta el v92 porque v150 ≈ v92)
 *     salomon  principal[43..0] invertida (44 vértices): el regreso directo a Salomón Romero, que
 *                        termina en el v0 donde empieza la ida (circuito cerrado, inicio y fin a <= 50 m)
 *
 *   BASE = ida + regreso + salomon (empalmes sin duplicar el vértice compartido), ya trazada por calles.
 *
 * y la variante **"Vía Molinos"** con el **tramo ADICIONAL** (no el recorrido completo), también trazado
 * por calles, contiguo y sin duplicar empalmes: v43 → Molinos → v43:
 *
 *   conector bifurcación → inicio del ramal (~77 m entre el vértice 43 y el primer vértice
 *     del ramal; el KML no trae ese tramo, así que se traza por calles igual que el resto, con pocos vértices)
 *   + ramal    Putucu (13 vértices) hasta Molinos
 *   + bajada   de Putucu: el ramal invertido (Molinos → ramal[0], 13 vértices) y el v43
 *
 * y como **punto de espera** el PC Molinos (esperaMin 30). La vuelta designada hace base hasta v43,
 * toma el tramo (sube, espera, baja por las mismas calles) y sigue por la base hasta SR; por eso
 * el tramo se guarda una sola vez y la base termina en SR. El desvío de una vuelta designada se mide
 * contra LEAST(base, tramo) (`ingesta-worker/deteccion-infracciones.ts`).
 * Boceto: 151 + 49 + 13 + 13 + 44 = 270 vértices (el script lo asevera, y que |v150 − v92| <= 25 m).
 *
 * ## Trazado por calles (Google Routes API): la geometría que se carga NO es el boceto
 *
 * El boceto es solo la guía. Cada tramo (ida v0..v150; regreso v150→v91..v43 = la ida invertida;
 * conector v43→ramal[0]; ramal; bajada = ramal invertido + v43; salomon = v43→v0) se ajusta a calles POR SEPARADO con `computeRoutes`: se remuestrea
 * cada 250 m y cada muestra va como waypoint `via` con `heading` = rumbo del boceto EN EL SENTIDO
 * DEL TRAMO, lo que obliga a Routes a elegir la calzada de ese sentido (el regreso cae en la
 * calzada de vuelta, no sobre la de ida). Máx. 25 intermedios por request: requests encadenados.
 * Cada tramo se valida contra su boceto (desvío máx. <= 120 m, longitud trazado/boceto <= 1,25, sin
 * rulos ni vueltas en U que el boceto no dibuje). Al unir los tramos el hueco entre ellos debe ser
 * <= 30 m y la base debe cerrar (inicio y fin a <= 50 m, y fin a <= 150 m del PC SR).
 * El resultado se versiona en `scripts/data/linea-16/trazado-calles.json` (con sha256 del KML): si
 * existe y el sha coincide, `--apply` NO llama a Google. `--recalcular-trazado` lo regenera
 * (GOOGLE_ROUTES_API_KEY; `--recalcular-trazado=bajada,salomon` solo esos tramos, el resto se conserva; `--recalcular-zonas` re-rutea solo la zona terminal); `--solo-trazado` escribe además `trazado-vista-previa.geojson` (boceto
 * vs. calles por tramo) y termina sin tocar la API de Quivo. Ver `FUENTE.md`. Dry-run y `--apply` nunca escriben archivos.
 *
 * Zona terminal (v8..v24, `ida` y `salomon`): no va con waypoints sino vértice a vértice del boceto (un request por
 * par de vértices consecutivos), con 2 huecos sin calle en Google (v10→v11, v18→v19) resueltos con la calle real
 * (`ZONAS_TRAMO_A_TRAMO`, `HUECOS_SIN_CALLE`; decisión del CTO 2026-10-14, ver `FUENTE.md`).
 *
 * Aclaración del CTO (2026-10-12): bajando desde Salomón Romero se toma El Prado hasta Honduras;
 * desde Honduras se vuelve por Aroma, se sube por Ayacucho hasta Libertador/América y desde ahí
 * es la misma ruta de regreso (los designados a Molinos suben por el ramal Putucu). Por eso los
 * vértices 123..150 del KML SON el tramo de retorno (un lazo en el centro), no basura. El
 * regreso directo a Salomón Romero (principal 43..0 invertida) y la bajada de Putucu (el
 * ramal invertido) se trazan como tramos propios (`salomon`, `bajada`) con heading de regreso, para
 * caer en la calzada contraria a la de la ida / subida; antes se dibujaban sobre la ida.
 *
 * ## Puntos de control y paradas
 *
 *   PC (radio 150 m como la 120/Z12), con su `rol` para el conteo de vueltas del servidor:
 *     SR        rol `terminal` orden 0 (obligatorio=false) — abre/cierra cada vuelta
 *     Honduras  rol `retorno` (obligatorio=true) — marca el medio de la vuelta
 *     Molinos   rol `espera`, esperaMin 30 (obligatorio=false) — sobre el TRAMO de la variante
 *   (los 3 `orden` son de marcha, ver abajo; ya no 0/1/2)
 *   PC INTERMEDIOS (decisión del CTO 2026-10-14): además de los 3, uno cada ~2 km a lo largo de TODO el circuito base,
 *   `obligatorio=false`, sin `rol` ni `esperaMin`, radio 150 m. Se generan de forma determinista desde la geometría base
 *   (`planificarIntermedios`, `puntosCadaN`): abscisas 2000, 4000… m interpoladas SOBRE la polilínea. Se descartan los
 *   candidatos a < 500 m (recta) de SR/Honduras/Molinos (solo de los activos en la fase del candidato: SR y Honduras en ambas,
 *   Molinos solo en regreso; el fin del circuito es SR); y los que quedan a < 300 m de otro intermedio
 *   ya elegido **de la MISMA fase**.
 *   **Fase (decisión del CTO 2026-10-15):** cada intermedio es `ida` (abscisa < la de Honduras: SR → Honduras) o `regreso`
 *   (abscisa >= la de Honduras: Honduras → SR). La app del conductor es consciente de la fase: durante la ida solo detecta/muestra
 *   los PC de ida y durante el regreso solo los de regreso; la fase se deriva del orden de marcha (orden < Honduras.orden ⇒ ida;
 *   orden > Honduras.orden ⇒ regreso). Por eso ida y regreso, que comparten calles, pueden tener cada uno su PC en el mismo
 *   lugar (el filtro de 300 m aplica solo dentro de la misma fase). **Ya NO existe la guarda de 250 m** que descartaba los
 *   posteriores a Honduras cercanos al tramo SR→Honduras.
 *   **⚠ PRECONDICIÓN DE `--apply` (no se verifica por código):** este plan REQUIERE (1) el PR #161 desplegado en la API (los
 *   intermedios, rol null y no obligatorios, no disparan `pc_omitido` en vivo) y (2) el APK consciente de la fase instalado.
 *   Motivo: los PC de regreso km 26/28 quedan a ~185 m de los de ida km 2/4; sin #161, un `pc_omitido` en vivo de Honduras
 *   (falso) salta en cada viaje. El geojson y el dry-run incluyen la `fase` (SR 'ambas', Honduras 'retorno', Molinos 'regreso').
 *   **`orden` = orden de MARCHA, para TODOS los PC** (consecutivos 0, 1, 2… según la abscisa sobre el circuito
 *   base; paso 1 porque voz móvil / alertas muestran `orden + 1` como número humano): `pc_omitido` y el stepper/voz móvil comparan/usan `orden`. Por eso los PC existentes se RENUMERAN (solo cambia su
 *   `orden`, vía PATCH; ids/coords/rol/esperaMin/obligatorio/radio se conservan): SR 0; Honduras en su posición (su proyección sobre la base, ~km 15); Molinos (en la variante) justo después de la bifurcación v43 del REGRESO. Ya no valen los viejos 1 (Molinos) y 2
 *   (Honduras). Sincronización: los PC con `rol` se emparejan POR ROL, los intermedios por `orden`; cualquier PC activo que no
 *   encaje aborta antes de escribir.
 *   `--solo-puntos` (offline, desde `trazado-calles.json`) imprime el plan completo y escribe `puntos-control-intermedios.geojson`.
 *   **Por qué solo Honduras es obligatorio:** la detección `pc_omitido`
 *   (`ingesta-worker/infracciones.logic.ts`) marca EN VIVO los PC obligatorios de `orden` menor
 *   que el cumplido que no se visitaron, y al `fin_recorrido` cualquier obligatorio sin visitar.
 *   Toda vuelta empieza y termina en SR (no puede ser obligatoria: daría 'omitido' falso en cada
 *   vuelta) y Molinos solo lo visitan los designados. Los intermedios no son
 *   obligatorios y (con #161 desplegado) no disparan `pc_omitido` en vivo; al `fin_recorrido` marca una vuelta que se saltó
 *   Honduras cualquier obligatorio sin visitar: Honduras mismo y también Molinos (espera) si se visita sin pasar por Honduras.
 *   Paradas (orden propio, independiente del de los PC): Salomón Romero (origen, 0), Molinos (intermedia, 1, sobre el
 *   tramo: pasada intermedia, la vuelta termina en SR), Honduras (intermedia, 2). La API acepta un PC/parada a <= 100 m de la base O de una
 *   variante activa de la ruta; se valida localmente ANTES de mandar nada.
 *
 *   Variante "Vía Molinos" (reemplaza al catálogo viejo "Molinos (ramal Putucu)", que se RENOMBRA
 *   en el mismo registro si existe): `geometria` = el tramo, `puntoEsperaId` = el PC Molinos. Si
 *   coexisten ambas, la legacy se pasa a `inactivo` (PATCH estado) para que no quede una variante activa sin tramo.
 *
 * ## ⚠ Calidad de la geometría — LEER ANTES DE USARLA PARA OTRA COSA
 *
 * El KML (`scripts/data/linea-16/linea-16-my-maps.kml`, ver `FUENTE.md`, intacto) es un
 * **boceto dibujado a mano**, no una traza GPS: la línea principal tiene 151 vértices para
 * 18,42 km (salto mediana 105 m, p90 239 m, máximo 580 m). La geometría que se carga es el
 * trazado por calles derivado de él (sección anterior), validado contra el boceto a <= 120 m
 * (`DESVIO_MAX_TRAZADO_M`; `EXCEPCIONES_DESVIO` está vacía); aun así sigue siendo una aproximación (Routes puede elegir otra calle paralela dentro del umbral) y
 * NO una traza GPS: la detección de desvío debe quedar DESHABILITADA para esta ruta.
 *
 * ## NO se crean asignaciones ni rotaciones (el CTO asigna desde el panel).
 *
 * ## ⚠ Antes de `--apply` en producción
 *
 * La geometría base cambia (ya no termina en Molinos sino en SR): el piloto activo (`1616PIL`,
 * ruta `460c9015…`) usa esta ruta. LEER qué asignaciones y sesiones la usan antes de pisarla y
 * aplicar solo con el OK del CTO y DESPUÉS del deploy de F1 (la API vieja no acepta `rol`,
 * `esperaMin`, `geometria` ni `puntoEsperaId`).
 *
 * ## Endpoints usados (todos relativos a `<QUIVO_API_URL>/v1`)
 *
 *   POST /auth/login · GET /sindicatos · GET|POST /lineas · GET|POST /lineas/:id/rutas ·
 *   PATCH /rutas/:id · GET|POST /rutas/:id/puntos-control · PATCH /puntos-control/:id ·
 *   GET|POST /rutas/:id/paradas · PATCH /paradas/:id · GET|POST /rutas/:id/variantes ·
 *   PATCH /variantes/:id   (geometria / puntoEsperaId / rol / esperaMin: solo admin, la API lo exige)
 *
 * ## Idempotencia (por lookups; los ids los pone el servidor)
 *
 *   Sindicato: por `QUIVO_SINDICATO_ID` o por nombre (`QUIVO_SINDICATO_NOMBRE`, default
 *   "Sindicato Piloto — Producción"); NO se crea. Línea: `codigo '16'` en ese sindicato. Ruta:
 *   `sentido 'circuito'` de la línea (geometría distinta → PATCH). PC: por `rol` (SR/Molinos/Honduras) o por `orden` (intermedios) entre los
 *   activos (orden/coord/radio/obligatorio/rol/esperaMin distintos → PATCH). Paradas: por `nombre` entre
 *   las activas (tipo/orden/coord distintos → PATCH). Variante: por nombre (o renombra la vieja).
 *   Orden de escritura con la ruta ya existente (la API valida paradas contra base ∪ tramos): ruta
 *   (solo crea) → variante con su tramo → PATCH de la geometría base → PC → paradas → vínculo de la
 *   variante con el PC de espera. Lo que sobra: rutas con otro
 *   sentido solo se REPORTA; PC/paradas activos no esperados ABORTAN antes de la primera escritura
 *   (nunca se borra nada; lo único que se desactiva es la variante legacy, ver abajo). Antes de escribir también se aborta si alguna parada
 *   existente (activa o no) queda a > 100 m de la geometría planeada, si el sindicato no está
 *   'activo' o si el código '16' existe en OTRO sindicato.
 *
 * ## Cómo se corre (nombres de variables; los valores salen de Secret Manager, nunca se imprimen)
 *
 *   La raíz no tiene tsx: usar `packages/db/node_modules/.bin/tsx`. Proyecto GCP: quivo-control-prod.
 *     QUIVO_ADMIN_EMAIL=$(gcloud secrets versions access latest --secret=QUIVO_PANEL_ADMIN_EMAIL --project=quivo-control-prod) \
 *     QUIVO_ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret=SEED_ADMIN_PASSWORD --project=quivo-control-prod) \
 *       packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts            # dry-run (lee, no escribe)
 *   … mismas variables … packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts --apply
 *
 *   Regenerar el trazado por calles (solo Google, sin API de Quivo ni credenciales de admin):
 *     GOOGLE_ROUTES_API_KEY=$(gcloud secrets versions access latest --secret=google-routes-server-key --project=quivo-control-prod) \
 *       packages/db/node_modules/.bin/tsx scripts/cargar-linea-16.ts --solo-trazado --recalcular-trazado
 *   Tests de las funciones puras: packages/db/node_modules/.bin/tsx --test scripts/lib/trazar-por-calles.test.ts
 *
 *   QUIVO_API_URL es opcional (default: la URL pública de producción de sembrar-piloto; exige
 *   https salvo localhost/127.0.0.1); QUIVO_ADMIN_EMAIL/QUIVO_ADMIN_PASSWORD son obligatorias (el
 *   usuario debe ser admin_quivo); QUIVO_SINDICATO_ID / QUIVO_SINDICATO_NOMBRE opcionales.
 *
 *   Nota: parseo de KML, helpers geográficos, cliente HTTP y login están duplicados a propósito
 *   con `sembrar-piloto-produccion.ts` / `cargar-linea-120.ts` (scripts standalone). Lo nuevo del
 *   trazado por calles vive en `scripts/lib/trazar-por-calles.ts` (funciones puras + cliente Routes).
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { abscisaEnPolilinea, emparejarPuntosControl, ordenesDeMarcha, planificarIntermedios, calcularRutaGoogle, detectarRulos, detectarVueltasU, empalmarZona, geometriaDeHueco, paresDeZona, podarEspolones, distanciaAPolilineaM, distanciaM, longitudM, trazarPorCalles, unirTrozos, ESPACIADO_MUESTRAS_M, MAX_INTERMEDIOS, type HuecoSinCalle, type VueltaU } from './lib/trazar-por-calles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================================================================
// Constantes
// ============================================================================================

const CIUDAD_ID = 'cochabamba';
const NOMBRE_SINDICATO_DEFAULT = 'Sindicato Piloto — Producción';

const LINEA_16_CODIGO = '16';
const LINEA_16_NOMBRE = 'Línea 16';
const COLOR_LINEA = '#B45309'; // ámbar oscuro: distinto de teal/índigo/coral del seed

const SENTIDO_RUTA = 'circuito';
const NOMBRE_VARIANTE = 'Vía Molinos';
/** Nombre del catálogo anterior (sin geometría): si existe se RENOMBRA en el mismo registro. */
const NOMBRES_VARIANTE_LEGACY = ['Molinos (ramal Putucu)'];
/** Minutos de espera obligatoria en Molinos (CTO, 2026-10-13). */
const ESPERA_MOLINOS_MIN = 30;

/** Mismo valor que la 120 y los PC activos de la Z12. */
const RADIO_TOLERANCIA_M = 150;
/** Tolerancia de `apps/api/src/common/geo/proximidad-ruta.ts` (paradas Y PC a la geometría). */
const PROXIMIDAD_API_M = 100;
/** Tolerancia para comparar coordenadas guardadas vs planeadas en la verificación final. */
const TOLERANCIA_COORD_M = 1;

/** Honduras = punto RETORNO del KML, junto a este vértice de la línea principal (guarda). */
const INDICE_HONDURAS = 122;
/** Vértice de la línea principal donde se bifurca el ramal Putucu (guarda contra el KML). */
const INDICE_BIFURCACION_PUTUCU = 43;
/** Vértice de la ida donde el lazo del retorno vuelve a cruzar (América/Libertador): v150 ≈ v92. */
const INDICE_CRUCE_RETORNO = 92;
const TOLERANCIA_CRUCE_M = 25;
/** La base debe terminar en Salomón Romero: el último vértice dentro del radio del PC SR. */
const CIERRE_EN_SR_MAX_M = RADIO_TOLERANCIA_M;
/**
 * Vértices esperados del BOCETO: ida 151 (0..150) + regreso 49 (91..43) + ramal 13 + bajada del ramal
 * 13 (Molinos → ramal[0], el ramal invertido; v43 ya cuenta en el tramo `salomon`) + salomon 44 (43..0) = 270.
 */
const VERTICES_BOCETO_ESPERADOS = 270;
/** Hueco máximo (m) entre el fin de un tramo y el inicio del siguiente al unirlos. */
const HUECO_MAX_TRAMOS_M = 30;
/** La app considera "cerrada" una ruta cuyo inicio y fin están a <= esto (m). */
const CIERRE_CIRCUITO_MAX_M = 50;

/** Trazado por calles (Google Routes API): validación por tramo contra el boceto. */
/**
 * El boceto es a mano y cruza manzanas en diagonal (vértices hasta 580 m entre sí), y en divididas
 * Routes toma la calzada del sentido aunque sea por otra calle: revisando el mapa, los desvíos
 * restantes (hasta ~275 m) son el boceto fuera de calle o la calle real del sentido, no errores
 * del ajuste. 60 m (primer umbral) rechazaba trazados correctos; los espolones y vueltas largas
 * (>> 300 m) los frena el ratio de longitud y el descarte de waypoints de `trazarPorCalles`.
 */
const DESVIO_MAX_TRAZADO_M = 120;
/**
 * Excepciones EXPLÍCITAS de desvío (NO verificadas sobre el mapa: el CTO debe revisarlas en
 * `trazado-calles.kml` antes de `--apply`, ver `--excepciones-revisadas`). VACÍA desde que la zona
 * terminal se rutea tramo a tramo (`ZONAS_TRAMO_A_TRAMO`): ya no hace falta ampliar umbrales ni tolerar
 * rulos ahí. El mecanismo (`tolerarRulos`, tope propio por zona) queda por si hace falta en el futuro.
 */
interface ExcepcionDesvio { tramo: NombreTramo; centro: Coord; radioM: number; maxM: number; tolerarRulos: boolean; motivo: string }
const EXCEPCIONES_DESVIO: ExcepcionDesvio[] = [];
/**
 * Zonas que NO se trazan con waypoints `via` densos sino VÉRTICE A VÉRTICE del boceto: un request de
 * Routes por cada par de vértices consecutivos (sin waypoints intermedios ni heading), empalmados.
 * Decisión del CTO (2026-10-14, variante "SINDICATO B"): en la zona terminal (Salancachi / Encanto
 * Pampa / U.E. Montecillos) el boceto cruza manzanas y con waypoints+heading Routes daba rulos y
 * desvíos de 134–165 m; ruteando par a par el trazado sigue el dibujo a <= ~8 m, sin rulos ni U.
 * Índices sobre la línea principal del boceto (v8..v24). `ida` la recorre ascendente (v8→v24) y
 * `salomon` en sentido inverso (v24→v8). Solo se reemplaza esa porción del tramo: lo de afuera del
 * rango queda tal cual (se empalma en los vértices más cercanos a v8 y v24, <= `EMPALME_ZONA_MAX_M`).
 */
const EMPALME_ZONA_MAX_M = 5;
/** Salto máximo (m) entre trozos consecutivos de una zona tramo a tramo (un hueco empieza/termina en el vértice crudo del boceto; el trozo vecino de Google, en el punto ajustado a la calle). */
const ZONA_SALTO_MAX_M = 20;
/**
 * Pares de la zona donde Google NO tiene calle transitable (el par no se pide a Routes). Se usa la
 * calle real de OpenStreetMap, copiada acá (sin dependencia de red): vértices intermedios en el
 * sentido desde → hasta. Fuente: © colaboradores de OpenStreetMap (ODbL), Overpass 2026-10-14; ver
 * FUENTE.md. La calle queda a ~16 m de la recta del boceto en ambos huecos (por eso no se usa recta).
 */
const HUECOS_SIN_CALLE: HuecoSinCalle[] = [
  {
    desde: 10,
    hasta: 11,
    calle: 'Calle Los Tajibos',
    motivo: 'Google no tiene calle transitable entre v10 y v11 (~75 m); es la calle Los Tajibos de OSM',
    geometria: [[-66.224783, -17.3199], [-66.224709, -17.320062], [-66.224614, -17.320186], [-66.224508, -17.320237], [-66.224425, -17.320252], [-66.224357, -17.320265], [-66.224216, -17.320311]],
  },
  {
    desde: 18,
    hasta: 19,
    calle: 'Calle Aguas Potables Norte',
    motivo: 'Google no tiene calle transitable entre v18 y v19 (~226 m); la calle real es la cadena de ways OSM Calle Encanto / Aguas Potables Norte',
    geometria: [[-66.223525, -17.323766], [-66.222568, -17.32393], [-66.222448, -17.324015], [-66.222364, -17.324033], [-66.222303, -17.324015], [-66.222228, -17.323948], [-66.222139, -17.323933], [-66.22202, -17.32399], [-66.221839, -17.324058], [-66.221766, -17.324078]],
  },
];
const ZONAS_TRAMO_A_TRAMO: { nombre: string; tramos: NombreTramo[]; desdeVertice: number; hastaVertice: number; huecos: HuecoSinCalle[] }[] = [
  { nombre: 'terminal Salancachi / Encanto Pampa / U.E. Montecillos', tramos: ['ida', 'salomon'], desdeVertice: 8, hastaVertice: 24, huecos: HUECOS_SIN_CALLE },
];
/**
 * Muestras del boceto (waypoints `via` con heading) que se OMITEN al trazar un tramo, porque su
 * heading no lo admite la calle y Routes da una vuelta larga, un rulo o una U para "cumplirlo"
 * (comprobado omitiéndolas una a una con `detectarRulos` / `detectarVueltasU`). Un tramo listado acá
 * se traza SIN reintentos automáticos (el reintento automático quita waypoints a ciegas): lo que se
 * omite es exactamente esto. Coordenadas de las muestras ([lon, lat], a <= 3 m).
 */
const OMITIR_MUESTRAS: Partial<Record<NombreTramo, { coord: Coord; motivo: string }[]>> = {
  regreso: [
    { coord: [-66.16266, -17.36585], motivo: 'esquina de Atahuallpa: la diagonal del boceto lleva a la calzada de ida, rulo + U' },
    { coord: [-66.1638, -17.36465], motivo: 'sobre la calzada de ida (-17.3646,-66.1638): hace ir al este por la ida y dar una U' },
    { coord: [-66.17558, -17.35774], motivo: 'heading 296 en Aroma: rulo de ~900 m antes de alcanzarla' },
    { coord: [-66.18867, -17.34914], motivo: 'heading 284: rulo/U de ~800 m (desvío 388 m)' },
    { coord: [-66.19516, -17.34655], motivo: 'heading 291: rulo de ~750 m (desvío 274 m)' },
  ],
  salomon: [
    { coord: [-66.21854, -17.32617], motivo: 'terminal: el boceto cruza manzanas; con estos headings Routes da U y rulos' },
    { coord: [-66.22138, -17.324], motivo: 'ídem' },
    { coord: [-66.22433, -17.32243], motivo: 'ídem' },
  ],
};
const RATIO_LONGITUD_MAX = 1.25;
/** PC intermedios (CTO 2026-10-14): separación a lo largo del circuito, descartes y numeración de `orden`. */
const PASO_PC_INTERMEDIO_M = 2000;
const DIST_MIN_PC_EXISTENTE_M = 500;
const DIST_MIN_ENTRE_INTERMEDIOS_M = 300;
const PUNTOS_INTERMEDIOS_GEOJSON_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/puntos-control-intermedios.geojson');
const TRAZADO_JSON_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/trazado-calles.json');
const VISTA_PREVIA_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/trazado-vista-previa.geojson');
const KML_TRAZADO_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/trazado-calles.kml');
/** Si un tramo recalculado no pasa la validación, lo calculado se guarda acá (ignorados por git) para diagnosticar sin re-llamar a Google. */
const RECHAZADO_JSON_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/trazado-rechazado.json');
const RECHAZADO_KML_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/trazado-rechazado.kml');
const TRAMOS = ['ida', 'regreso', 'conector', 'ramal', 'bajada', 'salomon'] as const;
type NombreTramo = (typeof TRAMOS)[number];

const KML_PATH = path.join(REPO_ROOT, 'scripts/data/linea-16/linea-16-my-maps.kml');
const KML_LINEA_PRINCIPAL = 'Línea 1';
const KML_RAMAL_PUTUCU = 'RUTA PUTUCU LINEA 16';
const KML_PARADA_SALOMON = 'PARADA SALOMON ROMERO LINEA 16';
const KML_PARADA_HONDURAS = 'RETORNO LINEA 16';
const KML_PARADA_MOLINOS = 'PARADA PUTUCU LINEA 16';

// ============================================================================================
// Tipos y geometría
// ============================================================================================

type Coord = [number, number]; // [lon, lat]

interface KmlParseado {
  linestrings: Map<string, Coord[]>;
  puntos: Map<string, Coord>;
}

function redondear(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

const RADIO_TIERRA_METROS = 6_371_000;

function indiceMasCercano(coords: Coord[], punto: Coord): { indice: number; distanciaM: number } {
  let mejor = { indice: 0, distanciaM: Infinity };
  coords.forEach((c, i) => {
    const d = distanciaM(c, punto);
    if (d < mejor.distanciaM) mejor = { indice: i, distanciaM: d };
  });
  return mejor;
}

/** Distancia mínima (m) de un punto a la polilínea, aproximando localmente a plano (equirectangular). */
function distanciaAGeometriaM(coords: Coord[], p: Coord): number {
  const rad = Math.PI / 180;
  const kx = RADIO_TIERRA_METROS * rad * Math.cos(p[1] * rad);
  const ky = RADIO_TIERRA_METROS * rad;
  let mejor = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1]![0] - p[0]) * kx, ay = (coords[i - 1]![1] - p[1]) * ky;
    const bx = (coords[i]![0] - p[0]) * kx, by = (coords[i]![1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    mejor = Math.min(mejor, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return mejor;
}

/** Distancia mínima a la base O al tramo de la variante (lo que acepta la API para PC y paradas). */
function distanciaARutaM(base: Coord[], tramo: Coord[], p: Coord): number {
  return Math.min(distanciaAGeometriaM(base, p), distanciaAGeometriaM(tramo, p));
}

// ============================================================================================
// Parser del KML (regex, igual que la 120: sin librería XML en el repo)
// ============================================================================================

function parseCoordinatesTexto(texto: string): Coord[] {
  return texto
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length > 0)
    .map((tok) => {
      const partes = tok.split(',');
      const lon = Number(partes[0]);
      const lat = Number(partes[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`Coordenada KML inválida: "${tok}"`);
      if (Math.abs(lon) <= 90 && Math.abs(lat) > 90) throw new Error(`Coordenada [${lon}, ${lat}] parece [lat, lon] invertido.`);
      return [redondear(lon), redondear(lat)] as Coord;
    });
}

function parseKml(kmlTexto: string): KmlParseado {
  const linestrings = new Map<string, Coord[]>();
  const puntos = new Map<string, Coord>();
  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match: RegExpExecArray | null;
  let total = 0;
  while ((match = placemarkRegex.exec(kmlTexto)) !== null) {
    total++;
    const bloque = match[1]!;
    const nombre = bloque.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? '';
    if (!nombre) throw new Error(`Placemark #${total} del KML sin <name>.`);
    const ls = bloque.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    const pt = bloque.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    if (ls) {
      const coords = parseCoordinatesTexto(ls[1]!);
      if (coords.length < 2) throw new Error(`Placemark "${nombre}": LineString con menos de 2 vértices.`);
      if (linestrings.has(nombre)) throw new Error(`Placemark "${nombre}" (LineString) duplicado.`);
      linestrings.set(nombre, coords);
    } else if (pt) {
      const coords = parseCoordinatesTexto(pt[1]!);
      if (coords.length !== 1) throw new Error(`Placemark "${nombre}": Point con ${coords.length} coordenadas.`);
      if (puntos.has(nombre)) throw new Error(`Placemark "${nombre}" (Point) duplicado.`);
      puntos.set(nombre, coords[0]!);
    }
  }
  if (total !== 5) {
    throw new Error(`El KML tiene ${total} Placemarks, se esperaban 5 (2 LineString + 3 Point). El archivo cambió: revisar.`);
  }
  return { linestrings, puntos };
}

function requerirLineString(kml: KmlParseado, nombre: string): Coord[] {
  const c = kml.linestrings.get(nombre);
  if (!c) throw new Error(`KML: no se encontró el LineString "${nombre}".`);
  return c;
}

function requerirPunto(kml: KmlParseado, nombre: string): Coord {
  const c = kml.puntos.get(nombre);
  if (!c) throw new Error(`KML: no se encontró el Point "${nombre}".`);
  return c;
}

// ============================================================================================
// CLI y entorno (fail-closed: sin credenciales no se hace nada, ni siquiera el dry-run)
// ============================================================================================

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');
const ARG_RECALCULAR = argv.find((a) => a === '--recalcular-trazado' || a.startsWith('--recalcular-trazado='));
const RECALCULAR_TRAZADO = ARG_RECALCULAR !== undefined;
/** `--recalcular-trazado=bajada,salomon` recalcula solo esos tramos; sin lista, todos. */
const TRAMOS_A_RECALCULAR: NombreTramo[] = (() => {
  const lista = ARG_RECALCULAR?.includes('=') ? ARG_RECALCULAR.split('=')[1]!.split(',').map((x) => x.trim()).filter((x) => x.length > 0) : [];
  const invalidos = lista.filter((x) => !(TRAMOS as readonly string[]).includes(x));
  if (invalidos.length > 0) {
    console.error(`--recalcular-trazado: tramo(s) desconocido(s) ${invalidos.join(', ')}. Válidos: ${TRAMOS.join(', ')}.`);
    process.exit(1);
  }
  return lista.length > 0 ? (lista as NombreTramo[]) : [...TRAMOS];
})();
/** `--recalcular-zonas`: vuelve a rutear SOLO las zonas tramo a tramo sobre los tramos guardados (el resto no se toca). */
const RECALCULAR_ZONAS = argv.includes('--recalcular-zonas');
const EXCEPCIONES_REVISADAS = argv.includes('--excepciones-revisadas');
const SOLO_TRAZADO = argv.includes('--solo-trazado');
const SOLO_PUNTOS = argv.includes('--solo-puntos');
// Dry-run y --apply NUNCA escriben archivos versionados: recalcular (que llama a Google y reescribe el json) solo con --solo-trazado.
if ((RECALCULAR_TRAZADO || RECALCULAR_ZONAS) && !SOLO_TRAZADO) {
  console.error('--recalcular-trazado / --recalcular-zonas requieren --solo-trazado: el dry-run y --apply no escriben archivos versionados.');
  process.exit(1);
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=… QUIVO_ADMIN_PASSWORD=… [QUIVO_API_URL=…] tsx scripts/cargar-linea-16.ts [--apply]
  [GOOGLE_ROUTES_API_KEY=…] tsx scripts/cargar-linea-16.ts --solo-trazado [--recalcular-trazado[=tramo1,tramo2]] [--recalcular-zonas]
  tsx scripts/cargar-linea-16.ts --solo-puntos

Sin --apply: dry-run (login + lecturas GET; NO escribe). Con --apply: escribe vía la API.
--solo-trazado: calcula/lee el trazado por calles, escribe trazado-calles.json y la vista previa
  (.geojson) y termina SIN tocar la API de Quivo.
--solo-puntos: OFFLINE (sin Google ni API de Quivo): arma el plan desde trazado-calles.json, imprime los PC intermedios y escribe
  puntos-control-intermedios.geojson.
--recalcular-trazado[=a,b]: regenera el trazado con Google Routes API (requiere GOOGLE_ROUTES_API_KEY);
  con lista, solo esos tramos (el resto se conserva del json). Tramos: ida, regreso, conector, ramal, bajada, salomon.
--recalcular-zonas: re-rutea SOLO las zonas tramo a tramo (ZONAS_TRAMO_A_TRAMO) sobre los tramos guardados; el resto no se toca.
--excepciones-revisadas: obligatoria con --apply mientras EXCEPCIONES_DESVIO no esté vacía (desvíos sin verificar).
Opcionales: QUIVO_SINDICATO_ID, QUIVO_SINDICATO_NOMBRE.
`);
  process.exit(0);
}

function normalizarBaseUrl(url: string): string {
  const sinBarraFinal = url.replace(/\/+$/, '');
  const host = new URL(sinBarraFinal).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!sinBarraFinal.startsWith('https://') && !local) {
    console.error(`QUIVO_API_URL debe ser https (salvo localhost/127.0.0.1): "${sinBarraFinal}". Abortando.`);
    process.exit(1);
  }
  return sinBarraFinal.endsWith('/v1') ? sinBarraFinal : `${sinBarraFinal}/v1`;
}

function requerirEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim().length === 0) {
    console.error(`Falta la variable de entorno ${nombre}. Abortando antes de tocar nada.`);
    process.exit(1);
  }
  return valor;
}

// ============================================================================================
// Cliente HTTP — único punto de contacto con la API. Las lecturas (GET) se ejecutan siempre;
// las escrituras solo con --apply (en dry-run `escribir` solo imprime el plan).
// ============================================================================================

class ErrorApi extends Error {}

const RATE_LIMIT_ESPERA_MS = 60_000;
const RATE_LIMIT_MAX_REINTENTOS = 5;

let API_URL = '';
let accessToken: string | undefined;
let escriturasPlaneadas = 0;
let escriturasEjecutadas = 0;

function esperarMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function http(metodo: string, ruta: string, body?: unknown): Promise<unknown> {
  for (let intento = 0; ; intento++) {
    const res = await fetch(`${API_URL}${ruta}`, {
      method: metodo,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401) {
      await res.body?.cancel();
      throw new ErrorApi(`${metodo} ${ruta} → HTTP 401: credenciales inválidas o token vencido. Abortando (sin reintento).`);
    }
    if (res.status === 429) {
      await res.body?.cancel();
      if (intento >= RATE_LIMIT_MAX_REINTENTOS) {
        throw new ErrorApi(`${metodo} ${ruta} → HTTP 429 (rate limit) tras ${intento} reintento(s). Abortando.`);
      }
      const ra = Number(res.headers.get('retry-after'));
      const esperaMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : RATE_LIMIT_ESPERA_MS;
      console.warn(`  429 en ${metodo} ${ruta} — esperando ${Math.round(esperaMs / 1000)}s (intento ${intento + 1}/${RATE_LIMIT_MAX_REINTENTOS})`);
      await esperarMs(esperaMs);
      continue;
    }
    const texto = await res.text();
    let cuerpo: unknown = undefined;
    if (texto.length > 0) {
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        cuerpo = texto;
      }
    }
    if (!res.ok) {
      const t = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo, null, 2);
      throw new ErrorApi(`${metodo} ${ruta} → HTTP ${res.status}\n${t}`);
    }
    return cuerpo;
  }
}

function leer<T>(ruta: string): Promise<T> {
  return http('GET', ruta) as Promise<T>;
}

/** Resumen del body para el plan: nunca el JSON completo de geometrías. */
function resumirBody(body: unknown): string {
  if (body === undefined || body === null) return '(sin body)';
  const resumen: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (k === 'geometria' && v && typeof v === 'object' && 'coordinates' in v) {
      resumen[k] = `LineString(${(v as { coordinates: unknown[] }).coordinates.length} vértices)`;
    } else {
      resumen[k] = v;
    }
  }
  return JSON.stringify(resumen);
}

/**
 * DIFF legible de lo que cambiaría: una línea por campo distinto (`antes → después`), o `(nuevo)`
 * si no existe todavía. Nunca imprime geometrías completas (solo vértices / km / extremos).
 */
function imprimirDiff(titulo: string, antes: Record<string, unknown> | null, despues: Record<string, unknown>): void {
  if (antes === null) {
    console.log(`  DIFF ${titulo}: (nuevo) ${JSON.stringify(despues)}`);
    return;
  }
  const cambios = Object.keys(despues).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]));
  if (cambios.length === 0) {
    console.log(`  DIFF ${titulo}: sin cambios.`);
    return;
  }
  for (const k of cambios) console.log(`  DIFF ${titulo}.${k}: ${JSON.stringify(antes[k] ?? null)} → ${JSON.stringify(despues[k])}`);
}

/** Huella corta de una geometría para el diff: vértices, km y extremos redondeados. */
function huellaGeometria(coords: Coord[] | null | undefined): string | null {
  if (!coords || coords.length === 0) return null;
  const e = (c: Coord) => `${c[1].toFixed(5)},${c[0].toFixed(5)}`;
  return `${coords.length}v ${(longitudM(coords) / 1000).toFixed(2)}km ${e(coords[0]!)}→${e(coords[coords.length - 1]!)}`;
}

/** Escritura: en dry-run solo imprime; con --apply la manda. Devuelve la respuesta (o undefined). */
async function escribir<T = { id: string }>(metodo: string, ruta: string, body: unknown): Promise<T | undefined> {
  escriturasPlaneadas++;
  if (!APLICAR) {
    console.log(`  SE HARÍA: ${metodo} ${ruta}  body=${resumirBody(body)}`);
    return undefined;
  }
  escriturasEjecutadas++;
  console.log(`  ${metodo} ${ruta}  body=${resumirBody(body)}`);
  return (await http(metodo, ruta, body)) as T;
}

// ============================================================================================
// Tipos de la API (solo los campos que usamos)
// ============================================================================================

interface SindicatoApi { id: string; nombre: string; estado: string }
interface LineaApi { id: string; sindicatoId: string; cityId: string; codigo: string; nombre: string; color: string | null }
interface RutaApi { id: string; lineaId: string; sentido: string; estado: string; geometria: { type: 'LineString'; coordinates: Coord[] } }
interface PuntoControlApi { id: string; rutaId: string; orden: number; coord: { coordinates: Coord }; radioToleranciaM: number; obligatorio: boolean; estado: string; rol?: string | null; esperaMin?: number | null }
interface ParadaApi { id: string; rutaId: string; tipo: string; orden: number; nombre: string | null; coord: { coordinates: Coord }; estado: string }
interface VarianteApi { id: string; rutaId: string; nombre: string; estado: string; geometria?: { type: 'LineString'; coordinates: Coord[] } | null; puntoEsperaId?: string | null }

const EPS_GRADOS = 1e-6; // ~0,1 m: absorbe el redondeo de ST_AsGeoJSON

function mismaCoord(a: Coord, b: Coord): boolean {
  return Math.abs(a[0] - b[0]) < EPS_GRADOS && Math.abs(a[1] - b[1]) < EPS_GRADOS;
}

function mismaGeometria(a: Coord[], b: Coord[]): boolean {
  return a.length === b.length && a.every((c, i) => mismaCoord(c, b[i]!));
}

/**
 * Huella de `deseada` para el diff, coherente con la decisión de PATCH (`mismaGeometria`): si la geometría
 * existente difiere, agrega cuántos vértices cambian y el desvío máximo, para que el diff nunca diga
 * "sin cambios" cuando se va a mandar un PATCH (la huella sola es igual con otro trazado de igual largo/extremos).
 */
function huellaComparada(actual: Coord[] | null | undefined, deseada: Coord[]): string | null {
  const base = huellaGeometria(deseada);
  if (!actual || actual.length === 0 || mismaGeometria(actual, deseada)) return base;
  let distintos = Math.abs(actual.length - deseada.length);
  for (let i = 0; i < Math.min(actual.length, deseada.length); i++) if (!mismaCoord(actual[i]!, deseada[i]!)) distintos++;
  const desvio = Math.max(...deseada.map((c) => distanciaAGeometriaM(actual, c)));
  return `${base} [geometría cambia: ${distintos} vértice(s) distinto(s), desvío máx ${desvio.toFixed(1)} m]`;
}

// ============================================================================================
// Plan de datos (derivado del KML, puro) — lo que DEBE existir al terminar
// ============================================================================================

interface PuntoPlan { nombre: string; orden: number; coord: Coord; obligatorio: boolean; rol: 'terminal' | 'retorno' | 'espera' | null; esperaMin: number | null; tipo: 'SR' | 'intermedio' | 'Honduras' | 'Molinos'; abscisaM: number; distRutaM: number; fase: 'ida' | 'regreso' | 'ambas' | 'retorno' | null }
interface ParadaPlan { nombre: string; tipo: 'origen' | 'intermedia' | 'destino'; orden: number; coord: Coord }
interface PlanDatos {
  geometria: Coord[];
  /** Tramo ADICIONAL de la variante "Vía Molinos" (conector + ramal Putucu). */
  tramo: Coord[];
  puntosControl: PuntoPlan[];
  paradas: ParadaPlan[];
}

type TramosCoord = Record<NombreTramo, Coord[]>;

interface Boceto {
  principal: Coord[];
  ramal: Coord[];
  salomon: Coord;
  honduras: Coord;
  molinos: Coord;
  /** Tramos del boceto en el sentido de circulación de cada uno. */
  tramos: TramosCoord;
}

/**
 * Parsea el KML y valida el boceto (índices Honduras/bifurcación/cruce, vértices). Pura: no toca la
 * red. Separa los tramos que se ajustan a calles POR SEPARADO, cada uno en su sentido:
 *   ida      principal v0..v150 (Salomón Romero → … → Honduras → lazo → v150 ≈ v92)
 *   regreso  v150 → v91..v43 (la ida invertida: es la que cae en la calzada de vuelta). Se antepone
 *            v150 (≈ v92, ≤ 25 m) para que el tramo arranque donde termina la ida.
 *   conector v43 → ramal[0] (~77 m; el KML no trae ese tramo)
 *   ramal    ramal Putucu hasta Molinos
 *   bajada   ramal invertido (Molinos → ramal[0]) + v43: la bajada de Putucu en sentido contrario
 *   salomon  v43 → v0 (principal invertida): el regreso directo a Salomón Romero
 */
export function prepararBoceto(kmlTexto: string): Boceto {
  const kml = parseKml(kmlTexto);
  const principal = requerirLineString(kml, KML_LINEA_PRINCIPAL);
  const ramal = requerirLineString(kml, KML_RAMAL_PUTUCU);
  const salomon = requerirPunto(kml, KML_PARADA_SALOMON);
  const honduras = requerirPunto(kml, KML_PARADA_HONDURAS);
  const molinos = requerirPunto(kml, KML_PARADA_MOLINOS);

  console.log(`  Línea principal "${KML_LINEA_PRINCIPAL}": ${principal.length} vértices, ${(longitudM(principal) / 1000).toFixed(2)} km.`);
  console.log(`  Ramal Putucu "${KML_RAMAL_PUTUCU}": ${ramal.length} vértices, ${(longitudM(ramal) / 1000).toFixed(2)} km.`);

  if (INDICE_HONDURAS > principal.length - 1) throw new Error(`INDICE_HONDURAS=${INDICE_HONDURAS} fuera de rango.`);
  const hond = indiceMasCercano(principal, honduras);
  if (hond.indice !== INDICE_HONDURAS) {
    throw new Error(`RETORNO (Honduras) está junto al vértice ${hond.indice} y se esperaba ${INDICE_HONDURAS}. El KML cambió: revisar.`);
  }
  const bif = indiceMasCercano(principal, ramal[0]!);
  if (bif.indice !== INDICE_BIFURCACION_PUTUCU) {
    throw new Error(`El ramal Putucu empieza junto al vértice ${bif.indice} y se esperaba ${INDICE_BIFURCACION_PUTUCU}. El KML cambió: revisar.`);
  }

  // Guardas del lazo: el último vértice del dibujo (v150) cierra sobre la ida en el v92.
  const ultimo = principal.length - 1;
  const cierre = distanciaM(principal[ultimo]!, principal[INDICE_CRUCE_RETORNO]!);
  if (cierre > TOLERANCIA_CRUCE_M) {
    throw new Error(`v${ultimo} está a ${cierre.toFixed(1)} m de v${INDICE_CRUCE_RETORNO} (> ${TOLERANCIA_CRUCE_M} m). El KML cambió: revisar.`);
  }
  const regresoInvertido = principal.slice(INDICE_BIFURCACION_PUTUCU, INDICE_CRUCE_RETORNO).reverse(); // v91..v43
  const verticesBoceto = principal.length + regresoInvertido.length + ramal.length + ramal.length + (INDICE_BIFURCACION_PUTUCU + 1);
  console.log(
    `  Boceto: dibujo completo ${principal.length} + regreso a bifurcación ${regresoInvertido.length} + ramal ${ramal.length} + bajada del ramal ${ramal.length} + regreso a Salomón ${INDICE_BIFURCACION_PUTUCU + 1} = ${verticesBoceto} vértices.`,
  );
  console.log(`  Cierre del lazo: v${ultimo} a ${cierre.toFixed(1)} m de v${INDICE_CRUCE_RETORNO} (tope ${TOLERANCIA_CRUCE_M} m).`);
  if (verticesBoceto !== VERTICES_BOCETO_ESPERADOS) {
    throw new Error(`El boceto tiene ${verticesBoceto} vértices y se esperaban ${VERTICES_BOCETO_ESPERADOS}.`);
  }
  const bajadaRamal = [...ramal].reverse(); // Molinos → ramal[0]
  const regresoSalomon = principal.slice(0, INDICE_BIFURCACION_PUTUCU + 1).reverse(); // v43..v0
  const tramos: TramosCoord = {
    ida: principal,
    regreso: [principal[ultimo]!, ...regresoInvertido],
    conector: [principal[INDICE_BIFURCACION_PUTUCU]!, ramal[0]!],
    ramal,
    bajada: [...bajadaRamal, principal[INDICE_BIFURCACION_PUTUCU]!],
    salomon: regresoSalomon,
  };
  return { principal, ramal, salomon, honduras, molinos, tramos };
}

// ============================================================================================
// Trazado por calles (Google Routes API) — versionado en trazado-calles.json
// ============================================================================================

interface TrazadoJson {
  meta: {
    generado: string;
    kmlSha256: string;
    fuente: string;
    parametros: { espaciadoMuestrasM: number; maxIntermedios: number; desvioMaxM: number; ratioLongitudMax: number };
  };
  tramos: TramosCoord;
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

/**
 * Valida un tramo trazado contra su boceto: desvío máximo <= DESVIO_MAX_TRAZADO_M (o el tope de su
 * excepción), sin rulos ni vueltas en U que el boceto no dibuje, y longitud trazado/boceto <=
 * RATIO_LONGITUD_MAX. Si no, error con tramo, valor y coordenada del peor punto.
 */
export function validarTramo(nombre: string, boceto: Coord[], trazado: Coord[], usPrecalculadas?: VueltaU[]): { desvioM: number; kmBoceto: number; kmTrazado: number; coordDesvio: Coord } {
  const kmBoceto = longitudM(boceto) / 1000;
  const kmTrazado = longitudM(trazado) / 1000;
  const ratio = kmTrazado / kmBoceto;
  // Desvío contra el tope general, salvo en las zonas con excepción explícita (que tienen su propio tope).
  const excepciones = EXCEPCIONES_DESVIO.filter((e) => e.tramo === nombre);
  const tope = (p: Coord): number => excepciones.find((e) => distanciaM(p, e.centro) <= e.radioM)?.maxM ?? DESVIO_MAX_TRAZADO_M;
  const tolerado = (p: Coord): boolean => excepciones.some((e) => e.tolerarRulos && distanciaM(p, e.centro) <= e.radioM);
  // Una sola pasada (ambos sentidos): desvío máximo absoluto y peor punto contra SU límite.
  let max = { d: -1, coord: trazado[0]!, sentido: '' };
  let peor: { d: number; tope: number; coord: Coord; sentido: string } | null = null;
  const pasada = (puntos: Coord[], contra: Coord[], sentido: string): void => {
    for (const p of puntos) {
      const d = distanciaAPolilineaM(p, contra);
      if (d > max.d) max = { d, coord: p, sentido };
      const t = tope(p);
      if (d > t && (!peor || d - t > peor.d - peor.tope)) peor = { d, tope: t, coord: p, sentido };
    }
  };
  pasada(trazado, boceto, 'punto del trazado lejos del boceto');
  pasada(boceto, trazado, 'punto del boceto lejos del trazado');
  const f = (c: Coord) => `${c[1].toFixed(6)},${c[0].toFixed(6)}`;
  if (peor) {
    const w = peor as { d: number; tope: number; coord: Coord; sentido: string };
    throw new Error(`Tramo "${nombre}": desvío máximo ${w.d.toFixed(1)} m > ${w.tope} m (${w.sentido}) en ${f(w.coord)}.`);
  }
  // Un trazado con rulos (vuelta a una manzana para reincorporarse a la misma avenida) no se acepta.
  const rulos = detectarRulos(trazado, boceto).filter((r) => !(tolerado(r.salida) && tolerado(r.reingreso)));
  if (rulos.length > 0) {
    throw new Error(
      `Tramo "${nombre}": ${rulos.length} rulo(s) alrededor de una manzana: ` +
        rulos.map((r) => `sale en ${f(r.salida)} y reingresa en ${f(r.reingreso)} (${r.largoM.toFixed(0)} m de recorrido para ${r.rectaM.toFixed(0)} m en recta${r.excesoM === undefined ? '' : `, exceso ${r.excesoM.toFixed(0)} m`}, desvío máx ${r.desvioMaxM.toFixed(0)} m en ${f(r.coordDesvioMax)}, criterio ${r.criterio})`).join('; ') +
        '.',
    );
  }
  const us = (usPrecalculadas ?? detectarVueltasU(trazado, boceto)).filter((u) => !tolerado(u.coord));
  if (us.length > 0) {
    throw new Error(`Tramo "${nombre}": ${us.length} vuelta(s) en U que el boceto no dibuja: ` + us.map((u) => `en ${f(u.coord)} (vértice ${u.indice}, giro ${u.giroGrados.toFixed(0)}° en ${u.arcoM.toFixed(0)} m)`).join('; ') + '.');
  }
  if (ratio > RATIO_LONGITUD_MAX) {
    throw new Error(
      `Tramo "${nombre}": longitud trazado/boceto = ${ratio.toFixed(3)} (${kmTrazado.toFixed(2)} km / ${kmBoceto.toFixed(2)} km) > ${RATIO_LONGITUD_MAX}. Peor desvío ${max.d.toFixed(1)} m en ${f(max.coord)}.`,
    );
  }
  return { desvioM: max.d, kmBoceto, kmTrazado, coordDesvio: max.coord };
}

/** Rango de abscisas (m de arco sobre `boceto.tramos[nombre]`) que cubre la zona tramo a tramo: entre los vértices del tramo más cercanos a sus extremos v(desde) y v(hasta). */
function abscisasDeZona(boceto: Boceto, nombre: NombreTramo, zona: (typeof ZONAS_TRAMO_A_TRAMO)[number]): { desde: number; hasta: number } {
  const tramo = boceto.tramos[nombre];
  const acum = [0];
  for (let i = 1; i < tramo.length; i++) acum.push(acum[i - 1]! + distanciaM(tramo[i - 1]!, tramo[i]!));
  const sDe = (ref: Coord): number => acum[tramo.reduce((m, c, i) => (distanciaM(c, ref) < distanciaM(tramo[m]!, ref) ? i : m), 0)]!;
  const a = sDe(boceto.principal[zona.desdeVertice]!);
  const b = sDe(boceto.principal[zona.hastaVertice]!);
  return { desde: Math.min(a, b), hasta: Math.max(a, b) };
}

/**
 * Rutea una zona tramo a tramo (par de vértices consecutivos del boceto, sin waypoints ni heading; los
 * huecos sin calle usan la calle real) y la empalma en `tramo` reemplazando solo esa porción.
 * `invertir`: el tramo recorre la zona de `hastaVertice` a `desdeVertice` (el regreso a Salomón).
 */
async function rutearZona(nombre: NombreTramo, tramo: Coord[], boceto: Boceto, zona: (typeof ZONAS_TRAMO_A_TRAMO)[number], apiKey: string): Promise<Coord[]> {
  const invertir = nombre === 'salomon';
  const pares = paresDeZona(boceto.principal, zona.desdeVertice, zona.hastaVertice, invertir, zona.huecos);
  const trozos: Coord[][] = [];
  for (const par of pares) {
    if (par.hueco) {
      trozos.push(geometriaDeHueco(par));
      console.log(`      ${nombre}: v${par.indiceA}→v${par.indiceB} sin calle en Google: ${par.hueco.calle} (${par.hueco.geometria?.length ?? 0} vértices propios).`);
    } else {
      const r = await calcularRutaGoogle({ origen: { coord: par.a, rumbo: null }, intermedios: [], destino: { coord: par.b, rumbo: null } }, apiKey);
      trozos.push(r.coords.map((c) => [redondear(c[0]), redondear(c[1])] as Coord));
    }
  }
  // Control de saltos entre trozos consecutivos de la zona (el hueco empieza/termina en el vértice crudo del boceto).
  for (let k = 1; k < trozos.length; k++) {
    const salto = distanciaM(trozos[k - 1]![trozos[k - 1]!.length - 1]!, trozos[k]![0]!);
    if (salto > ZONA_SALTO_MAX_M) {
      throw new Error(`${nombre}: salto de ${salto.toFixed(1)} m (> ${ZONA_SALTO_MAX_M} m) en la zona "${zona.nombre}" entre los pares v${pares[k - 1]!.indiceA}→v${pares[k - 1]!.indiceB} y v${pares[k]!.indiceA}→v${pares[k]!.indiceB}.`);
    }
  }
  const ensamblada = unirTrozos(trozos);
  const [inicioRef, finRef] = invertir ? [boceto.principal[zona.hastaVertice]!, boceto.principal[zona.desdeVertice]!] : [boceto.principal[zona.desdeVertice]!, boceto.principal[zona.hastaVertice]!];
  const e = empalmarZona(tramo, ensamblada, inicioRef, finRef, EMPALME_ZONA_MAX_M);
  console.log(`    ${nombre}: zona "${zona.nombre}" (v${zona.desdeVertice}..v${zona.hastaVertice}${invertir ? ', invertida' : ''}): ${pares.length} pares, ${e.indiceFin - e.indiceInicio + 1} → ${ensamblada.length} vértices; vértices antes/después del tramo intactos.`);
  return e.coords;
}

/**
 * Devuelve el trazado por calles de cada tramo. Si `trazado-calles.json` existe y el sha256 del KML
 * coincide, se usa SIN llamar a Google. `--recalcular-trazado` lo regenera (requiere
 * GOOGLE_ROUTES_API_KEY); `--recalcular-trazado=a,b` recalcula solo esos tramos y conserva el resto
 * del json tal cual. Si el sha no coincide y no se pidió recalcular: error. Si un tramo recalculado
 * no pasa la validación, lo calculado se guarda en `trazado-rechazado.json/.kml` antes de abortar.
 */
async function obtenerTrazado(kmlTexto: string, boceto: Boceto): Promise<TramosCoord> {
  const sha = sha256(kmlTexto);
  let guardado: TrazadoJson | undefined;
  if (fs.existsSync(TRAZADO_JSON_PATH)) guardado = JSON.parse(fs.readFileSync(TRAZADO_JSON_PATH, 'utf8')) as TrazadoJson;

  const shaCoincide = guardado !== undefined && guardado.meta.kmlSha256 === sha;
  const recalcular = new Set<NombreTramo>(RECALCULAR_TRAZADO ? TRAMOS_A_RECALCULAR : []);
  // Tramos cuya zona tramo a tramo se (re)rutea: los recalculados completos + todos los de ZONAS_TRAMO_A_TRAMO con --recalcular-zonas.
  const zonasARutear = new Set<NombreTramo>();
  for (const z of ZONAS_TRAMO_A_TRAMO) for (const t of z.tramos) if (recalcular.has(t) || RECALCULAR_ZONAS) zonasARutear.add(t);
  if (!RECALCULAR_TRAZADO && !shaCoincide) {
    throw new Error(
      guardado
        ? `trazado-calles.json es de otro KML (sha ${guardado.meta.kmlSha256.slice(0, 12)}… vs ${sha.slice(0, 12)}…). Regenerar con --recalcular-trazado (requiere GOOGLE_ROUTES_API_KEY).`
        : 'No existe scripts/data/linea-16/trazado-calles.json. Generarlo con --recalcular-trazado (requiere GOOGLE_ROUTES_API_KEY).',
    );
  }
  // Los tramos que no se recalculan salen del json versionado: tienen que existir (y ser del mismo KML).
  const faltantes = TRAMOS.filter((t) => !recalcular.has(t) && !(shaCoincide && guardado!.tramos[t]?.length));
  if (faltantes.length > 0) {
    throw new Error(`Faltan en trazado-calles.json (o es de otro KML) los tramos: ${faltantes.join(', ')}. Recalcularlos con --recalcular-trazado=${faltantes.join(',')} (requiere GOOGLE_ROUTES_API_KEY).`);
  }

  const tramos = {} as TramosCoord;
  for (const t of TRAMOS) if (!recalcular.has(t)) tramos[t] = guardado!.tramos[t];
  if (recalcular.size === 0 && zonasARutear.size === 0) {
    console.log(`  Trazado versionado (${guardado!.meta.generado}, sha KML ${sha.slice(0, 12)}…): se usa sin llamar a Google.`);
  } else {
    const apiKey = requerirEnv('GOOGLE_ROUTES_API_KEY');
    if (recalcular.size === 0) console.log(`  Se conserva todo el json versionado salvo las zonas tramo a tramo de: ${[...zonasARutear].join(', ')}.`);
    if (recalcular.size > 0) console.log(`  Recalculando con Google Routes API ${[...recalcular].join(', ')} (muestras cada ${ESPACIADO_MUESTRAS_M} m, heading del boceto en el sentido del tramo)…`);
    if (recalcular.size < TRAMOS.length) console.log(`  Se conservan tal cual del json: ${TRAMOS.filter((t) => !recalcular.has(t)).join(', ')}.`);
    for (const nombre of TRAMOS.filter((t) => recalcular.has(t))) {
      const omitir = OMITIR_MUESTRAS[nombre];
      const r = await trazarPorCalles(boceto.tramos[nombre], apiKey, {
        pasoM: ESPACIADO_MUESTRAS_M,
        maxIntermedios: MAX_INTERMEDIOS,
        ...(omitir ? { omitir: omitir.map((o) => o.coord), maxReintentos: 0 } : {}),
        // La zona que después se reemplaza con `rutearZona` no cuenta como problema (ni dispara reintentos).
        excluirAbscisas: ZONAS_TRAMO_A_TRAMO.filter((z) => z.tramos.includes(nombre)).map((z) => abscisasDeZona(boceto, nombre, z)),
        log: (m) => console.log(`      ${nombre}: ${m}`),
      });
      tramos[nombre] = r.coords.map((c) => [redondear(c[0]), redondear(c[1])] as Coord);
      console.log(`    ${nombre}: ${r.requests} request(s), ${tramos[nombre].length} vértices${r.descartadas.length ? `, ${r.descartadas.length} waypoint(s) quitado(s) por provocar espolones/rulos` : ''}${r.sinRumbo.length ? `, ${r.sinRumbo.length} sin heading` : ''}.`);
      for (const c of r.descartadas) console.log(`      quitado:    ${c[1].toFixed(6)},${c[0].toFixed(6)}`);
      for (const c of r.sinRumbo) console.log(`      sin heading: ${c[1].toFixed(6)},${c[0].toFixed(6)}`);
    }
    for (const z of ZONAS_TRAMO_A_TRAMO) {
      for (const t of z.tramos) if (zonasARutear.has(t)) tramos[t] = await rutearZona(t, tramos[t], boceto, z, apiKey);
    }
  }

  // Espolones (ir hasta un ápice y volver por los mismos puntos, que el boceto no dibuja). La poda solo se aplica en
  // --solo-trazado (ahí se reescribe el json y se regenera el KML para revisar). Dry-run y --apply NUNCA modifican lo
  // que se carga en silencio ni escriben archivos versionados: si el json versionado tiene un espolón, abortan.
  let podado = false;
  const usPorTramo: Partial<Record<NombreTramo, VueltaU[]>> = {};
  for (const t of TRAMOS) {
    const p = podarEspolones(tramos[t], boceto.tramos[t]);
    if (p.podados.length === 0) {
      usPorTramo[t] = p.us;
      continue;
    }
    const donde = p.podados.map((c) => `${c[1].toFixed(6)},${c[0].toFixed(6)}`).join('; ');
    if (!SOLO_TRAZADO) {
      throw new Error(`${t}: el trazado versionado tiene ${p.podados.length} espolón(es) que la poda quitaría (${donde}). No se poda en silencio lo que se carga: regenerar con --solo-trazado y revisar el KML.`);
    }
    console.log(`  ${t}: ${p.podados.length} espolón(es) podado(s) en ${donde} (${tramos[t].length} → ${p.coords.length} vértices).`);
    tramos[t] = p.coords;
    podado = true;
  }

  // Validación SIEMPRE (también el json versionado): no se carga basura. Se validan todos y se juntan los errores.
  console.log('  Validación por tramo (boceto → trazado):');
  const errores: string[] = [];
  for (const nombre of TRAMOS) {
    try {
      const v = validarTramo(nombre, boceto.tramos[nombre], tramos[nombre], usPorTramo[nombre]);
      console.log(
        `    ${nombre.padEnd(8)} vértices ${String(boceto.tramos[nombre].length).padStart(3)} → ${String(tramos[nombre].length).padStart(4)} · ${v.kmBoceto.toFixed(2)} km → ${v.kmTrazado.toFixed(2)} km · desvío máx ${v.desvioM.toFixed(1)} m en ${v.coordDesvio[1].toFixed(6)},${v.coordDesvio[0].toFixed(6)}`,
      );
    } catch (err) {
      errores.push(err instanceof Error ? err.message : String(err));
    }
  }
  // --solo-trazado no corre `main` hasta `construirPlan`: se aplican acá las mismas validaciones locales de base/variante
  // (hueco regreso→salomon, cierre en SR, PC y paradas a <= 100 m de base o tramo) ANTES de escribir el json. Sin red.
  if (SOLO_TRAZADO && errores.length === 0) {
    try {
      construirPlan(boceto, tramos);
    } catch (err) {
      errores.push(err instanceof Error ? err.message : String(err));
    }
  }
  const salida: TrazadoJson = {
    meta: {
      generado: new Date().toISOString(),
      kmlSha256: sha,
      fuente: 'Google Routes API computeRoutes (DRIVE, TRAFFIC_UNAWARE, HIGH_QUALITY) sobre scripts/data/linea-16/linea-16-my-maps.kml',
      parametros: { espaciadoMuestrasM: ESPACIADO_MUESTRAS_M, maxIntermedios: MAX_INTERMEDIOS, desvioMaxM: DESVIO_MAX_TRAZADO_M, ratioLongitudMax: RATIO_LONGITUD_MAX },
    },
    tramos,
  };
  if (errores.length > 0) {
    if (recalcular.size > 0 || zonasARutear.size > 0) {
      fs.writeFileSync(RECHAZADO_JSON_PATH, JSON.stringify(salida) + '\n');
      fs.writeFileSync(RECHAZADO_KML_PATH, armarKmlTrazado(boceto, tramos));
      console.error(`  Lo calculado quedó en ${path.relative(REPO_ROOT, RECHAZADO_JSON_PATH)} y ${path.relative(REPO_ROOT, RECHAZADO_KML_PATH)} (no versionados) para diagnosticar sin re-llamar a Google.`);
    }
    throw new Error(errores.join('\n'));
  }
  // Solo se llega con trazado recalculado o con json válido ya existente: escribir únicamente si hubo cálculo o poda (solo con --solo-trazado: el resto de modos nunca llega acá con cambios).
  if (SOLO_TRAZADO && (recalcular.size > 0 || zonasARutear.size > 0 || podado)) {
    fs.writeFileSync(TRAZADO_JSON_PATH, JSON.stringify(salida) + '\n');
    console.log(`  Escrito ${path.relative(REPO_ROOT, TRAZADO_JSON_PATH)}.`);
  }
  return tramos;
}

/** FeatureCollection con boceto y trazado por tramo, para revisar en geojson.io / QGIS. */
function escribirVistaPrevia(boceto: Boceto, trazado: TramosCoord): void {
  const features = TRAMOS.flatMap((tramo) => [
    { type: 'Feature', properties: { tramo, fuente: 'boceto' }, geometry: { type: 'LineString', coordinates: boceto.tramos[tramo] } },
    { type: 'Feature', properties: { tramo, fuente: 'calles' }, geometry: { type: 'LineString', coordinates: trazado[tramo] } },
  ]);
  fs.writeFileSync(VISTA_PREVIA_PATH, JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  console.log(`  Escrito ${path.relative(REPO_ROOT, VISTA_PREVIA_PATH)}.`);
  fs.writeFileSync(KML_TRAZADO_PATH, armarKmlTrazado(boceto, trazado));
  console.log(`  Escrito ${path.relative(REPO_ROOT, KML_TRAZADO_PATH)} (importable en Google My Maps).`);
}

const xmlEscape = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Colores KML = aabbggrr. */
const COLOR_KML: Record<NombreTramo, string> = { ida: 'ffff7f00', regreso: 'ff0000ff', conector: 'ff00ffff', ramal: 'ff00c800', bajada: 'ffff00ff', salomon: 'ff0080ff' };
const NOMBRE_KML: Record<NombreTramo, string> = { ida: 'Ida', regreso: 'Regreso', conector: 'Conector', ramal: 'Ramal Putucu', bajada: 'Bajada de Putucu', salomon: 'Regreso a Salomón Romero' };

/** KML para revisar el trazado sobre el mapa de Google (My Maps): una carpeta con el trazado por tramo y otra con el boceto en gris. */
export function armarKmlTrazado(boceto: Boceto, trazado: TramosCoord): string {
  const linea = (nombre: string, estilo: string, coords: Coord[]): string =>
    `    <Placemark><name>${xmlEscape(nombre)}</name><styleUrl>#${estilo}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords.map((c) => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LineString></Placemark>`;
  const estilos = [
    ...TRAMOS.map((t) => `  <Style id="calles-${t}"><LineStyle><color>${COLOR_KML[t]}</color><width>4</width></LineStyle></Style>`),
    '  <Style id="boceto"><LineStyle><color>ff9e9e9e</color><width>2</width></LineStyle></Style>',
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    '  <name>Línea 16 — trazado por calles (Google Routes API)</name>',
    ...estilos,
    '  <Folder>',
    '    <name>Trazado por calles</name>',
    ...TRAMOS.map((t) => linea(`${NOMBRE_KML[t]} (calles)`, `calles-${t}`, trazado[t])),
    '  </Folder>',
    '  <Folder>',
    '    <name>Boceto original (gris)</name>',
    ...TRAMOS.map((t) => linea(`${NOMBRE_KML[t]} (boceto)`, 'boceto', boceto.tramos[t])),
    '  </Folder>',
    '</Document>',
    '</kml>',
    '',
  ].join('\n');
}

/** Construye y valida todo lo que se va a cargar. Pura: no toca la red. */
export function construirPlan(boceto: Boceto, trazado: TramosCoord): PlanDatos {
  const { salomon, honduras, molinos } = boceto;
  for (const t of TRAMOS) {
    if (!trazado[t] || trazado[t].length < 2) throw new Error(`Falta el tramo "${t}" del trazado (o tiene menos de 2 vértices).`);
  }
  // Empalmes internos de cada grupo (la base y la variante son geometrías separadas; ya no hay una cadena única de 6 tramos):
  // ida→regreso (base) y conector→ramal, ramal→bajada (variante). regreso→salomon y la salida/vuelta de la variante
  // se validan más abajo junto a la base y al tramo.
  for (const [a, b] of [['ida', 'regreso'], ['conector', 'ramal'], ['ramal', 'bajada']] as const) {
    const hueco = distanciaM(trazado[a][trazado[a].length - 1]!, trazado[b][0]!);
    console.log(`  Empalme ${a} → ${b}: ${hueco.toFixed(1)} m.`);
    if (hueco > HUECO_MAX_TRAMOS_M) throw new Error(`Hueco de ${hueco.toFixed(1)} m entre el fin de "${a}" y el inicio de "${b}" (tope ${HUECO_MAX_TRAMOS_M} m).`);
  }
  // BASE: el circuito directo que termina en SR = ida + regreso + salomon (sin conector/ramal/bajada).
  // El regreso termina en v43 y salomon arranca en v43: empalme directo de la base (sin pasar por la variante).
  const huecoBase = distanciaM(trazado.regreso[trazado.regreso.length - 1]!, trazado.salomon[0]!);
  console.log(`  Empalme regreso → salomon (base directa, sin Molinos): ${huecoBase.toFixed(1)} m.`);
  if (huecoBase > HUECO_MAX_TRAMOS_M) throw new Error(`Hueco de ${huecoBase.toFixed(1)} m entre el fin de "regreso" y el inicio de "salomon" en la base (tope ${HUECO_MAX_TRAMOS_M} m).`);
  const geometria: Coord[] = unirTrozos([trazado.ida, trazado.regreso, trazado.salomon]);
  const cierre = distanciaM(geometria[0]!, geometria[geometria.length - 1]!);
  console.log(`  Cierre de la base (fin de salomon ↔ inicio de ida): ${cierre.toFixed(1)} m (tope ${CIERRE_CIRCUITO_MAX_M} m).`);
  if (cierre > CIERRE_CIRCUITO_MAX_M) throw new Error(`La base no cierra: el fin de la geometría está a ${cierre.toFixed(1)} m del inicio (> ${CIERRE_CIRCUITO_MAX_M} m).`);
  const cierreEnSr = distanciaM(geometria[geometria.length - 1]!, salomon);
  console.log(`  La base termina a ${cierreEnSr.toFixed(1)} m del PC Salomón Romero (tope ${CIERRE_EN_SR_MAX_M} m).`);
  if (cierreEnSr > CIERRE_EN_SR_MAX_M) throw new Error(`La base termina a ${cierreEnSr.toFixed(1)} m de Salomón Romero (> ${CIERRE_EN_SR_MAX_M} m): el circuito debe terminar en SR.`);
  console.log(`  Base (ida + regreso + salomon): ${geometria.length} vértices, ${(longitudM(geometria) / 1000).toFixed(2)} km.`);

  // TRAMO de la variante "Vía Molinos" = conector + ramal + bajada (v43 → Molinos → v43), contiguo, sin duplicar empalmes.
  const tramo: Coord[] = unirTrozos([trazado.conector, trazado.ramal, trazado.bajada]);
  console.log(`  Tramo "${NOMBRE_VARIANTE}" (conector + ramal + bajada): ${tramo.length} vértices, ${(longitudM(tramo) / 1000).toFixed(2)} km.`);
  // La variante debe colgar de la base en v43 (sale del fin de "regreso") y volver a ella (inicio de "salomon").
  const salida = distanciaM(trazado.regreso[trazado.regreso.length - 1]!, tramo[0]!);
  const vuelta = distanciaM(tramo[tramo.length - 1]!, trazado.salomon[0]!);
  console.log(`  Variante: sale de la base a ${salida.toFixed(1)} m y vuelve a ${vuelta.toFixed(1)} m (tope ${HUECO_MAX_TRAMOS_M} m).`);
  if (salida > HUECO_MAX_TRAMOS_M || vuelta > HUECO_MAX_TRAMOS_M) throw new Error(`El tramo de la variante no empalma con la base (sale a ${salida.toFixed(1)} m, vuelve a ${vuelta.toFixed(1)} m; tope ${HUECO_MAX_TRAMOS_M} m).`);

  // `orden` = orden de MARCHA a lo largo del circuito base (pc_omitido compara `orden`; ver cabecera). Posiciones:
  //  · Honduras: proyección de su coord sobre la base (la `ida` sigue ~3,6 km más por el lazo de retorno, v123..150; Honduras queda ANTES).
  //  · Molinos (sobre la variante): justo después de la bifurcación (v43, fin de `regreso`) en la pasada del REGRESO.
  const largoIda = longitudM(trazado.ida);
  const hond = abscisaEnPolilinea(geometria, honduras, 0, largoIda);
  if (hond.distM > PROXIMIDAD_API_M) throw new Error(`Honduras a ${hond.distM.toFixed(1)} m de la base (> ${PROXIMIDAD_API_M} m): no se puede ubicar su orden de marcha.`);
  const sHonduras = hond.abscisaM;
  const bifur = abscisaEnPolilinea(geometria, trazado.regreso[trazado.regreso.length - 1]!, largoIda);
  const sMolinos = bifur.abscisaM + 1e-6;
  console.log(`  Honduras en el km ${(sHonduras / 1000).toFixed(2)} del circuito (a ${hond.distM.toFixed(1)} m de la base; fin de la ida en el km ${(largoIda / 1000).toFixed(2)}); bifurcación Molinos (v43, regreso) en el km ${(bifur.abscisaM / 1000).toFixed(2)}.`);
  const inter = planificarIntermedios(geometria, {
    pasoM: PASO_PC_INTERMEDIO_M, minPcM: DIST_MIN_PC_EXISTENTE_M,
    // SR y Honduras (frontera de fases) valen en ambas fases; Molinos solo en regreso.
    existentes: [{ coord: salomon, fase: 'ambas' }, { coord: honduras, fase: 'ambas' }, { coord: molinos, fase: 'regreso' }],
    minEntreM: DIST_MIN_ENTRE_INTERMEDIOS_M, sHonduras,
  });
  const sinOrden: Omit<PuntoPlan, 'orden'>[] = [
    { nombre: 'Salomón Romero', coord: salomon, obligatorio: false, rol: 'terminal', esperaMin: null, tipo: 'SR', abscisaM: 0, distRutaM: distanciaARutaM(geometria, tramo, salomon), fase: 'ambas' },
    { nombre: 'Molinos (Parada Putucu)', coord: molinos, obligatorio: false, rol: 'espera', esperaMin: ESPERA_MOLINOS_MIN, tipo: 'Molinos', abscisaM: sMolinos, distRutaM: distanciaARutaM(geometria, tramo, molinos), fase: 'regreso' },
    { nombre: 'Honduras (RETORNO)', coord: honduras, obligatorio: true, rol: 'retorno', esperaMin: null, tipo: 'Honduras', abscisaM: sHonduras, distRutaM: distanciaARutaM(geometria, tramo, honduras), fase: 'retorno' },
    ...inter.puntos.map((q): Omit<PuntoPlan, 'orden'> => ({ nombre: `Control km ${(q.abscisaM / 1000).toFixed(0)}`, coord: [redondear(q.coord[0]), redondear(q.coord[1])], obligatorio: false, rol: null, esperaMin: null, tipo: 'intermedio', abscisaM: q.abscisaM, distRutaM: distanciaARutaM(geometria, tramo, q.coord), fase: q.fase })),
  ];
  const ordenes = ordenesDeMarcha(sinOrden.map((p) => p.abscisaM));
  const puntosControl: PuntoPlan[] = sinOrden.map((p, i) => ({ ...p, orden: ordenes[i]! })).sort((a, b) => a.orden - b.orden);
  if (puntosControl[0]!.tipo !== 'SR' || puntosControl[0]!.orden !== 0) throw new Error('El PC Salomón Romero debe ser el orden 0 (inicio del circuito).');
  console.log(`  PC intermedios cada ${PASO_PC_INTERMEDIO_M} m: ${inter.puntos.length} planeados; omitidos: ${inter.omitidosCercaPc} a < ${DIST_MIN_PC_EXISTENTE_M} m de SR/Honduras/Molinos (según la fase), ${inter.omitidosCercaIntermedio} a < ${DIST_MIN_ENTRE_INTERMEDIOS_M} m de otro intermedio de la MISMA fase (ida/regreso).`);
  const paradas: ParadaPlan[] = [
    { nombre: 'Salomón Romero', tipo: 'origen', orden: 0, coord: salomon },
    { nombre: 'Molinos', tipo: 'intermedia', orden: 1, coord: molinos },
    { nombre: 'Honduras', tipo: 'intermedia', orden: 2, coord: honduras },
  ];

  // Mismas reglas que la API (<= 100 m a la geometría), validadas ANTES de mandar nada.
  // La API acepta un punto a <= 100 m de la base O del tramo de una variante activa.
  for (const p of puntosControl) {
    const d = p.distRutaM;
    if (p.tipo !== 'intermedio') console.log(`  PC orden ${p.orden} ${p.nombre} (${p.rol}): a ${d.toFixed(1)} m de la base/tramo.`);
    if (d > PROXIMIDAD_API_M) throw new Error(`PC "${p.nombre}" a ${d.toFixed(1)} m de la base/tramo (> ${PROXIMIDAD_API_M} m: la API lo rechazaría).`);
  }
  for (const p of paradas) {
    const d = distanciaARutaM(geometria, tramo, p.coord);
    if (d > PROXIMIDAD_API_M) throw new Error(`Parada "${p.nombre}" a ${d.toFixed(1)} m de la base/tramo (> ${PROXIMIDAD_API_M} m: la API la rechazaría).`);
  }
  return { geometria, tramo, puntosControl, paradas };
}

// ============================================================================================
// Sincronización contra la API
// ============================================================================================

const PENDIENTE = 'PENDIENTE';

async function login(): Promise<void> {
  console.log('--- Login (POST /v1/auth/login) ---');
  const r = (await http('POST', '/auth/login', { email: requerirEnv('QUIVO_ADMIN_EMAIL'), password: requerirEnv('QUIVO_ADMIN_PASSWORD') })) as {
    accessToken: string;
    user: { email: string; rol: string };
  };
  accessToken = r.accessToken;
  console.log(`  OK — autenticado como ${r.user.email} (rol=${r.user.rol}).`);
  if (r.user.rol !== 'admin_quivo') throw new Error(`El usuario tiene rol "${r.user.rol}"; hace falta admin_quivo (GET /sindicatos y crear líneas lo exigen).`);
}

async function resolverSindicato(): Promise<SindicatoApi> {
  console.log('\n--- Sindicato piloto (GET /v1/sindicatos) ---');
  const todos = await leer<SindicatoApi[]>('/sindicatos');
  const id = process.env.QUIVO_SINDICATO_ID?.trim();
  const nombre = process.env.QUIVO_SINDICATO_NOMBRE?.trim() || NOMBRE_SINDICATO_DEFAULT;
  const candidatos = id ? todos.filter((s) => s.id === id) : todos.filter((s) => s.nombre === nombre);
  if (candidatos.length !== 1) {
    throw new Error(
      `Se esperaba exactamente 1 sindicato (${id ? `id=${id}` : `nombre="${nombre}"`}), hay ${candidatos.length}. ` +
        `Existentes: ${todos.map((s) => `"${s.nombre}"`).join(', ') || '(ninguno)'}. Usar QUIVO_SINDICATO_ID / QUIVO_SINDICATO_NOMBRE.`,
    );
  }
  if (candidatos[0]!.estado !== 'activo') throw new Error(`El sindicato "${candidatos[0]!.nombre}" está '${candidatos[0]!.estado}', no 'activo'.`);
  console.log(`  "${candidatos[0]!.nombre}" (${candidatos[0]!.id}).`);
  return candidatos[0]!;
}

async function sincronizarLinea(sindicato: SindicatoApi): Promise<string> {
  console.log('\n--- Línea 16 (GET/POST /v1/lineas) ---');
  const todas = await leer<LineaApi[]>('/lineas');
  const otras = todas.filter((l) => l.codigo === LINEA_16_CODIGO && l.sindicatoId !== sindicato.id);
  if (otras.length > 0) throw new Error(`El código '${LINEA_16_CODIGO}' ya existe en OTRO sindicato (${otras.map((l) => l.sindicatoId).join(', ')}). Abortando antes de escribir.`);
  const lineas = todas.filter((l) => l.sindicatoId === sindicato.id && l.codigo === LINEA_16_CODIGO);
  if (lineas.length > 1) throw new Error(`Hay ${lineas.length} líneas con código ${LINEA_16_CODIGO} en el sindicato (el unique lo impide: revisar).`);
  if (lineas[0]) {
    const l = lineas[0];
    console.log(`  Ya existe: ${l.id} ("${l.nombre}", color=${l.color}).`);
    if (l.nombre !== LINEA_16_NOMBRE || l.color !== COLOR_LINEA || l.cityId !== CIUDAD_ID) {
      await escribir('PATCH', `/lineas/${l.id}`, { nombre: LINEA_16_NOMBRE, color: COLOR_LINEA, cityId: CIUDAD_ID });
    }
    return l.id;
  }
  const creada = await escribir<LineaApi>('POST', '/lineas', {
    sindicatoId: sindicato.id,
    cityId: CIUDAD_ID,
    codigo: LINEA_16_CODIGO,
    nombre: LINEA_16_NOMBRE,
    color: COLOR_LINEA,
  });
  return creada?.id ?? PENDIENTE;
}

/**
 * Ruta: SOLO la crea si falta (con la base ya completa). El cambio de geometría de una ruta
 * existente va DESPUÉS de cargar el tramo de la variante (`parchearGeometriaRuta`): la API valida
 * que las paradas queden a <= 100 m de la base O de una variante activa, y la parada de Molinos
 * ya no está sobre la nueva base.
 */
async function sincronizarRuta(lineaId: string, plan: PlanDatos): Promise<{ rutaId: string; existente: RutaApi | null }> {
  console.log(`\n--- Ruta '${SENTIDO_RUTA}' (GET/POST /v1/lineas/:id/rutas) ---`);
  const nueva = { sentido: SENTIDO_RUTA, geometria: { type: 'LineString', coordinates: plan.geometria }, estado: 'activo' };
  if (lineaId === PENDIENTE) {
    imprimirDiff('ruta', null, { sentido: SENTIDO_RUTA, geometria: huellaGeometria(plan.geometria) });
    await escribir('POST', `/lineas/${PENDIENTE}/rutas`, nueva);
    return { rutaId: PENDIENTE, existente: null };
  }
  const rutas = await leer<RutaApi[]>(`/lineas/${lineaId}/rutas`);
  for (const r of rutas.filter((x) => x.sentido !== SENTIDO_RUTA)) {
    console.warn(`  AVISO: la línea tiene una ruta '${r.sentido}' (${r.id}, ${r.estado}) que este script no toca — revisar a mano.`);
  }
  const propias = rutas.filter((r) => r.sentido === SENTIDO_RUTA);
  if (propias.length > 1) throw new Error(`Hay ${propias.length} rutas '${SENTIDO_RUTA}' en la línea; ambiguo. Resolver a mano.`);
  const existente = propias[0];
  if (!existente) {
    imprimirDiff('ruta', null, { sentido: SENTIDO_RUTA, geometria: huellaGeometria(plan.geometria) });
    const creada = await escribir<RutaApi>('POST', `/lineas/${lineaId}/rutas`, nueva);
    return { rutaId: creada?.id ?? PENDIENTE, existente: null };
  }
  console.log(`  Ya existe: ${existente.id} (${existente.geometria.coordinates.length} vértices, ${existente.estado}).`);
  return { rutaId: existente.id, existente };
}

/** PATCH de la geometría base / estado de una ruta que ya existía (después del tramo de la variante). */
async function parchearGeometriaRuta(existente: RutaApi | null, plan: PlanDatos): Promise<void> {
  if (!existente) return;
  console.log('\n--- Geometría base de la ruta (PATCH /v1/rutas/:id) ---');
  const actual = existente.geometria.coordinates;
  imprimirDiff(
    'ruta',
    { geometria: huellaGeometria(actual), estado: existente.estado },
    { geometria: huellaComparada(actual, plan.geometria), estado: 'activo' },
  );
  const patch: Record<string, unknown> = {};
  if (!mismaGeometria(actual, plan.geometria)) patch.geometria = { type: 'LineString', coordinates: plan.geometria };
  if (existente.estado !== 'activo') patch.estado = 'activo';
  if (Object.keys(patch).length === 0) {
    console.log('  Sin cambios.');
    return;
  }
  console.warn(
    `  ATENCIÓN: se REEMPLAZA la geometría de la ruta ${existente.id} (${actual.length} → ${plan.geometria.length} vértices). ` +
      'Si hay un piloto activo sobre esta ruta, verificar sus asignaciones/sesiones antes de aplicar.',
  );
  await escribir('PATCH', `/rutas/${existente.id}`, patch);
}

/** PC por `orden` (el planeado, de marcha) → id (o PENDIENTE en dry-run) para vincular la variante después. */
async function sincronizarPuntosControl(rutaId: string, plan: PlanDatos): Promise<Map<number, string>> {
  console.log('\n--- Puntos de control (GET/POST /v1/rutas/:id/puntos-control) ---');
  const ids = new Map<number, string>();
  const existentes = rutaId === PENDIENTE ? [] : (await leer<PuntoControlApi[]>(`/rutas/${rutaId}/puntos-control`)).filter((p) => p.estado === 'activo');
  // Emparejamiento: los PC con `rol` por ROL (su `orden` se renumera al de marcha), los intermedios (sin rol) por `orden`.
  // Aborta ANTES de la primera escritura si algún PC activo no encaja o hay ambigüedad.
  const pares = emparejarPuntosControl(existentes, plan.puntosControl);
  for (const { planIdx, existenteIdx } of pares) {
    const p = plan.puntosControl[planIdx]!;
    const cuerpo = {
      orden: p.orden,
      coord: { type: 'Point', coordinates: p.coord },
      radioToleranciaM: RADIO_TOLERANCIA_M,
      obligatorio: p.obligatorio,
      estado: 'activo',
      rol: p.rol,
      esperaMin: p.esperaMin,
    };
    const e = existenteIdx === null ? undefined : existentes[existenteIdx];
    console.log(`  [${p.orden}] ${p.nombre}: fase ${p.fase}, a ${p.distRutaM.toFixed(1)} m de la base/tramo`);
    imprimirDiff(
      `PC[${p.orden}]`,
      e ? { orden: e.orden, coord: mismaCoord(e.coord.coordinates, p.coord) ? p.coord : e.coord.coordinates, radioToleranciaM: e.radioToleranciaM, obligatorio: e.obligatorio, rol: e.rol ?? null, esperaMin: e.esperaMin ?? null } : null,
      { orden: p.orden, coord: p.coord, radioToleranciaM: RADIO_TOLERANCIA_M, obligatorio: p.obligatorio, rol: p.rol, esperaMin: p.esperaMin },
    );
    if (!e) {
      const creado = await escribir<PuntoControlApi>('POST', `/rutas/${rutaId}/puntos-control`, cuerpo);
      ids.set(p.orden, creado?.id ?? PENDIENTE);
    } else {
      ids.set(p.orden, e.id);
      if (
        e.orden !== p.orden ||
        !mismaCoord(e.coord.coordinates, p.coord) ||
        e.radioToleranciaM !== RADIO_TOLERANCIA_M ||
        e.obligatorio !== p.obligatorio ||
        (e.rol ?? null) !== p.rol ||
        (e.esperaMin ?? null) !== p.esperaMin
      ) {
        await escribir('PATCH', `/puntos-control/${e.id}`, cuerpo);
      } else {
        console.log(`    ya existe (${e.id}), sin cambios.`);
      }
    }
  }
  return ids;
}

async function sincronizarParadas(rutaId: string, plan: PlanDatos): Promise<void> {
  console.log('\n--- Paradas (GET/POST /v1/rutas/:id/paradas) ---');
  const existentes = rutaId === PENDIENTE ? [] : (await leer<ParadaApi[]>(`/rutas/${rutaId}/paradas`)).filter((p) => p.estado === 'activo');
  const nombres = new Set(plan.paradas.map((p) => p.nombre));
  for (const p of existentes.filter((e) => !e.nombre || !nombres.has(e.nombre))) {
    throw new Error(`Parada activa "${p.nombre}" (${p.id}) no prevista en la ruta. Abortando; resolver a mano.`);
  }
  for (const p of plan.paradas) {
    const cuerpo = { tipo: p.tipo, orden: p.orden, nombre: p.nombre, coord: { type: 'Point', coordinates: p.coord }, estado: 'activo' };
    const iguales = existentes.filter((e) => e.nombre === p.nombre);
    if (iguales.length > 1) throw new Error(`Hay ${iguales.length} paradas activas "${p.nombre}"; resolver a mano.`);
    const e = iguales[0];
    console.log(`  ${p.nombre} (${p.tipo}, orden ${p.orden}):`);
    if (!e) {
      await escribir('POST', `/rutas/${rutaId}/paradas`, cuerpo);
    } else if (e.tipo !== p.tipo || e.orden !== p.orden || !mismaCoord(e.coord.coordinates, p.coord)) {
      await escribir('PATCH', `/paradas/${e.id}`, cuerpo);
    } else {
      console.log(`    ya existe (${e.id}), sin cambios.`);
    }
  }
}

/**
 * Variante "Vía Molinos": nombre/estado/tramo. El vínculo con el PC de espera va aparte
 * (`vincularPuntoEspera`) porque el PC de Molinos solo puede crearse DESPUÉS del tramo (queda a
 * > 100 m de la base) y el vínculo exige que el PC ya exista.
 */
async function sincronizarVariante(rutaId: string, plan: PlanDatos): Promise<VarianteApi | null | typeof PENDIENTE> {
  console.log('\n--- Variante "Vía Molinos" con su tramo (GET/POST/PATCH /v1/rutas/:id/variantes) ---');
  const todas = rutaId === PENDIENTE ? [] : await leer<VarianteApi[]>(`/rutas/${rutaId}/variantes`);
  const nuevas = todas.filter((v) => v.nombre === NOMBRE_VARIANTE);
  const legacy = todas.filter((v) => NOMBRES_VARIANTE_LEGACY.includes(v.nombre));
  if (nuevas.length > 1) throw new Error(`Hay ${nuevas.length} variantes "${NOMBRE_VARIANTE}"; resolver a mano.`);
  if (nuevas.length === 0 && legacy.length > 1) throw new Error(`Hay ${legacy.length} variantes del catálogo viejo; resolver a mano.`);
  const e = nuevas[0] ?? legacy[0];
  // Si coexisten "Vía Molinos" y la legacy, la legacy (sin tramo) quedaría activa: se desactiva (PATCH estado 'inactivo').
  if (nuevas.length === 1) {
    for (const l of legacy.filter((v) => v.estado === 'activo')) {
      console.log(`  Variante legacy "${l.nombre}" (${l.id}) activa junto a "${NOMBRE_VARIANTE}": se desactiva.`);
      await escribir('PATCH', `/variantes/${l.id}`, { estado: 'inactivo' });
    }
  }
  const tramo = { type: 'LineString', coordinates: plan.tramo };
  const deseado = { nombre: NOMBRE_VARIANTE, estado: 'activo', geometria: huellaComparada(e?.geometria?.coordinates, plan.tramo) };
  imprimirDiff(
    `variante`,
    e ? { nombre: e.nombre, estado: e.estado, geometria: huellaGeometria(e.geometria?.coordinates) } : null,
    deseado,
  );
  if (!e) {
    const creada = await escribir<VarianteApi>('POST', `/rutas/${rutaId}/variantes`, { nombre: NOMBRE_VARIANTE, estado: 'activo', geometria: tramo });
    return creada ?? PENDIENTE;
  }
  if (e.nombre !== NOMBRE_VARIANTE || e.estado !== 'activo' || !e.geometria || !mismaGeometria(e.geometria.coordinates, plan.tramo)) {
    return (await escribir<VarianteApi>('PATCH', `/variantes/${e.id}`, { nombre: NOMBRE_VARIANTE, estado: 'activo', geometria: tramo })) ?? e;
  }
  console.log(`  "${NOMBRE_VARIANTE}" ya existe (${e.id}) con el tramo planeado, sin cambios.`);
  return e;
}

async function vincularPuntoEspera(variante: VarianteApi | null | typeof PENDIENTE, puntoEsperaId: string | undefined): Promise<void> {
  console.log('\n--- Punto de espera de la variante (PATCH /v1/variantes/:id) ---');
  const actual = variante && variante !== PENDIENTE ? (variante.puntoEsperaId ?? null) : null;
  imprimirDiff('variante', { puntoEsperaId: actual }, { puntoEsperaId: puntoEsperaId ?? PENDIENTE });
  if (!variante || variante === PENDIENTE || !puntoEsperaId || puntoEsperaId === PENDIENTE) {
    await escribir('PATCH', `/variantes/${variante && variante !== PENDIENTE ? variante.id : PENDIENTE}`, { puntoEsperaId: puntoEsperaId ?? PENDIENTE });
    return;
  }
  if (actual === puntoEsperaId) console.log('  ya vinculada, sin cambios.');
  else await escribir('PATCH', `/variantes/${variante.id}`, { puntoEsperaId });
}

/** Relee todo desde la API tras --apply y falla si el estado no es el esperado. */
async function verificar(lineaId: string, plan: PlanDatos): Promise<void> {
  console.log('\n--- Verificación final (solo lecturas) ---');
  const rutas = (await leer<RutaApi[]>(`/lineas/${lineaId}/rutas`)).filter((r) => r.sentido === SENTIDO_RUTA && r.estado === 'activo');
  if (rutas.length !== 1) throw new Error(`Se esperaba 1 ruta '${SENTIDO_RUTA}' activa, hay ${rutas.length}.`);
  const ruta = rutas[0]!;
  console.log(`  Ruta ${ruta.id}: ${ruta.geometria.coordinates.length} vértices (esperado ${plan.geometria.length}).`);
  if (!mismaGeometria(ruta.geometria.coordinates, plan.geometria)) throw new Error('La geometría guardada no coincide con la planeada.');

  const pcs = (await leer<PuntoControlApi[]>(`/rutas/${ruta.id}/puntos-control`)).filter((p) => p.estado === 'activo');
  if (pcs.length !== plan.puntosControl.length) throw new Error(`PC activos: ${pcs.length}, esperados ${plan.puntosControl.length}.`);
  for (const esp of plan.puntosControl) {
    const hallados = pcs.filter((p) => p.orden === esp.orden);
    if (hallados.length !== 1) throw new Error(`PC orden ${esp.orden}: ${hallados.length} activos, esperado 1.`);
    const p = hallados[0]!;
    const d = distanciaARutaM(ruta.geometria.coordinates, plan.tramo, p.coord.coordinates);
    const dPlan = distanciaM(p.coord.coordinates, esp.coord);
    console.log(`  PC orden ${p.orden} ${esp.nombre}: rol=${p.rol ?? null}, esperaMin=${p.esperaMin ?? null}, radio ${p.radioToleranciaM} m, obligatorio=${p.obligatorio}, a ${d.toFixed(1)} m de la base/tramo, ${dPlan.toFixed(2)} m del plan.`);
    if (
      p.obligatorio !== esp.obligatorio ||
      p.radioToleranciaM !== RADIO_TOLERANCIA_M ||
      (p.rol ?? null) !== esp.rol ||
      (p.esperaMin ?? null) !== esp.esperaMin ||
      d > PROXIMIDAD_API_M ||
      dPlan > TOLERANCIA_COORD_M
    ) {
      throw new Error(`PC orden ${p.orden} (${esp.nombre}) no coincide con el plan (coord/radio/obligatorio/rol/esperaMin/distancia).`);
    }
  }
  const pars = (await leer<ParadaApi[]>(`/rutas/${ruta.id}/paradas`)).filter((p) => p.estado === 'activo');
  if (pars.length !== plan.paradas.length) throw new Error(`Paradas activas: ${pars.length}, esperadas ${plan.paradas.length}.`);
  for (const esp of plan.paradas) {
    const hallados = pars.filter((p) => p.nombre === esp.nombre);
    if (hallados.length !== 1) throw new Error(`Parada "${esp.nombre}": ${hallados.length} activas, esperada 1.`);
    const p = hallados[0]!;
    const d = distanciaARutaM(ruta.geometria.coordinates, plan.tramo, p.coord.coordinates);
    const dPlan = distanciaM(p.coord.coordinates, esp.coord);
    console.log(`  Parada ${esp.nombre}: tipo=${p.tipo}, orden=${p.orden}, a ${d.toFixed(1)} m de la geometría, ${dPlan.toFixed(2)} m del plan.`);
    if (p.tipo !== esp.tipo || p.orden !== esp.orden || d > PROXIMIDAD_API_M || dPlan > TOLERANCIA_COORD_M) {
      throw new Error(`Parada "${esp.nombre}" no coincide con el plan (tipo/orden/coord/distancia).`);
    }
  }
  const vars = (await leer<VarianteApi[]>(`/rutas/${ruta.id}/variantes`)).filter((v) => v.nombre === NOMBRE_VARIANTE && v.estado === 'activo');
  if (vars.length !== 1) throw new Error(`Variante "${NOMBRE_VARIANTE}": ${vars.length} activas, esperada 1.`);
  const variante = vars[0]!;
  const legacyActivas = (await leer<VarianteApi[]>(`/rutas/${ruta.id}/variantes`)).filter((v) => NOMBRES_VARIANTE_LEGACY.includes(v.nombre) && v.estado === 'activo');
  if (legacyActivas.length > 0) throw new Error(`Siguen activas variantes legacy: ${legacyActivas.map((v) => `"${v.nombre}" (${v.id})`).join(', ')}.`);
  const pcMolinos = pcs.find((p) => p.rol === 'espera');
  if (!variante.geometria || !mismaGeometria(variante.geometria.coordinates, plan.tramo)) throw new Error(`El tramo guardado de "${NOMBRE_VARIANTE}" no coincide con el planeado.`);
  if (!pcMolinos || variante.puntoEsperaId !== pcMolinos.id) throw new Error(`"${NOMBRE_VARIANTE}" no está vinculada al PC de espera (Molinos).`);
  console.log(`  Variante "${NOMBRE_VARIANTE}": tramo ${variante.geometria.coordinates.length} vértices, punto de espera ${variante.puntoEsperaId} (Molinos, ${pcMolinos.esperaMin} min). OK.`);
}

/**
 * Pre-vuelo de SOLO LECTURA, antes de la primera escritura: si ya existe la línea y su ruta,
 * cada parada existente (activa o no) debe quedar a <= 100 m de la geometría planeada (si no,
 * el PATCH de geometría o las paradas fallarían a medio camino), y no puede haber PC/paradas
 * activos no previstos, duplicados ni rutas ambiguas.
 */
async function preVuelo(sindicato: SindicatoApi, plan: PlanDatos): Promise<void> {
  console.log('\n--- Pre-vuelo (solo lecturas, antes de cualquier escritura) ---');
  const todas = await leer<LineaApi[]>('/lineas');
  const otras = todas.filter((l) => l.codigo === LINEA_16_CODIGO && l.sindicatoId !== sindicato.id);
  if (otras.length > 0) throw new Error(`El código '${LINEA_16_CODIGO}' ya existe en OTRO sindicato (${otras.map((l) => l.sindicatoId).join(', ')}).`);
  const linea = todas.find((l) => l.sindicatoId === sindicato.id && l.codigo === LINEA_16_CODIGO);
  if (!linea) {
    console.log('  La línea 16 no existe todavía: nada más que validar.');
    return;
  }
  const rutas = (await leer<RutaApi[]>(`/lineas/${linea.id}/rutas`)).filter((r) => r.sentido === SENTIDO_RUTA);
  if (rutas.length > 1) throw new Error(`Hay ${rutas.length} rutas '${SENTIDO_RUTA}' en la línea; ambiguo.`);
  const ruta = rutas[0];
  if (!ruta) {
    console.log('  La línea existe sin ruta circuito: nada más que validar.');
    return;
  }
  const paradas = await leer<ParadaApi[]>(`/rutas/${ruta.id}/paradas`);
  for (const pa of paradas) {
    const d = distanciaARutaM(plan.geometria, plan.tramo, pa.coord.coordinates);
    if (d > PROXIMIDAD_API_M) throw new Error(`Parada existente "${pa.nombre}" (${pa.id}, ${pa.estado}) a ${d.toFixed(1)} m de la base/tramo planeados (> ${PROXIMIDAD_API_M} m).`);
  }
  const nombres = new Set(plan.paradas.map((p) => p.nombre));
  const inesperadasPar = paradas.filter((pa) => pa.estado === 'activo' && (!pa.nombre || !nombres.has(pa.nombre)));
  if (inesperadasPar.length > 0) throw new Error(`Paradas activas no previstas: ${inesperadasPar.map((pa) => `"${pa.nombre}" (${pa.id})`).join(', ')}.`);
  const pcs = (await leer<PuntoControlApi[]>(`/rutas/${ruta.id}/puntos-control`)).filter((pc) => pc.estado === 'activo');
  emparejarPuntosControl(pcs, plan.puntosControl); // lanza si hay PC activos no previstos (rol/orden) o ambiguos
  console.log(`  OK: ${paradas.length} parada(s) y ${pcs.length} PC activo(s) existentes, todo compatible con el plan.`);
}

// ============================================================================================
// main
// ============================================================================================

function mainSoloPuntos(): void {
  console.log('Línea 16 — SOLO PUNTOS (offline, desde trazado-calles.json); no toca Google ni la API de Quivo.');
  const boceto = prepararBoceto(fs.readFileSync(KML_PATH, 'utf8'));
  const json = JSON.parse(fs.readFileSync(TRAZADO_JSON_PATH, 'utf8')) as { tramos: TramosCoord };
  const plan = construirPlan(boceto, json.tramos);
  const inter = plan.puntosControl.filter((p) => p.tipo === 'intermedio');
  console.log(`\nPlan completo de PC (${plan.puntosControl.length}: SR + Honduras + Molinos + ${inter.length} intermedios), circuito base de ${(longitudM(plan.geometria) / 1000).toFixed(2)} km, ordenado por orden de marcha:`);
  console.log('  orden  tipo       km_circuito  lat          lng          dist_ruta_m  fase');
  for (const p of plan.puntosControl) {
    console.log(`  ${String(p.orden).padStart(5)}  ${p.tipo.padEnd(9)}  ${(p.abscisaM / 1000).toFixed(2).padStart(11)}  ${p.coord[1].toFixed(6)}  ${p.coord[0].toFixed(6)}  ${p.distRutaM.toFixed(2).padStart(11)}  ${p.fase ?? '-'}`);
  }
  const features = plan.puntosControl.map((p) => ({
    type: 'Feature',
    properties: { orden: p.orden, tipo: p.tipo, km: Number((p.abscisaM / 1000).toFixed(3)), nombre: p.nombre, rol: p.rol, obligatorio: p.obligatorio, fase: p.fase },
    geometry: { type: 'Point', coordinates: p.coord },
  }));
  fs.writeFileSync(PUNTOS_INTERMEDIOS_GEOJSON_PATH, JSON.stringify({ type: 'FeatureCollection', features }, null, 1) + '\n');
  console.log(`\nEscrito ${path.relative(REPO_ROOT, PUNTOS_INTERMEDIOS_GEOJSON_PATH)} (${features.length} puntos).`);
}

async function main(): Promise<void> {
  if (SOLO_PUNTOS) {
    try {
      mainSoloPuntos();
    } catch (err) {
      console.error('\nAbortado.');
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
    return;
  }
  if (SOLO_TRAZADO) {
    // Sin API de Quivo: ni login ni red salvo Google (y solo si se pidió recalcular).
    console.log('='.repeat(90));
    console.log(`Línea 16 — SOLO TRAZADO (${RECALCULAR_TRAZADO ? 'recalcula con Google Routes API' : 'lee el json versionado'}); no toca la API de Quivo.`);
    console.log('='.repeat(90));
    if (EXCEPCIONES_DESVIO.length > 0) console.warn(`AVISO: ${EXCEPCIONES_DESVIO.length} excepción(es) de desvío (hasta 150 m) NO verificadas sobre el mapa; --apply exigirá --excepciones-revisadas.`);
    try {
      const kmlTexto = fs.readFileSync(KML_PATH, 'utf8');
      const boceto = prepararBoceto(kmlTexto);
      const trazado = await obtenerTrazado(kmlTexto, boceto);
      escribirVistaPrevia(boceto, trazado);
    } catch (err) {
      console.error('\nAbortado.');
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
    return;
  }

  if (APLICAR && EXCEPCIONES_DESVIO.length > 0 && !EXCEPCIONES_REVISADAS) {
    console.error(
      `--apply abortado: hay ${EXCEPCIONES_DESVIO.length} excepción(es) de desvío (EXCEPCIONES_DESVIO, hasta 150 m) sin verificar sobre el mapa. ` +
        'Revisar scripts/data/linea-16/trazado-calles.kml y volver a correr con --excepciones-revisadas.',
    );
    process.exit(1);
  }
  API_URL = normalizarBaseUrl(process.env.QUIVO_API_URL || 'https://quivo-api-741758083365.southamerica-west1.run.app');
  requerirEnv('QUIVO_ADMIN_EMAIL');
  requerirEnv('QUIVO_ADMIN_PASSWORD');

  console.log('='.repeat(90));
  console.log(`Línea 16 (vueltas / Vía Molinos) — API ${API_URL} — modo: ${APLICAR ? 'APPLY (escribe vía la API)' : 'DRY-RUN (solo lecturas; no escribe nada)'}`);
  console.log('='.repeat(90));

  if (APLICAR) {
    console.warn('!!! PRECONDICIÓN (no verificada por el script): el PR #161 (los PC intermedios no disparan pc_omitido en vivo) debe estar DESPLEGADO en la API y el APK consciente de la fase instalado. Sin eso, un pc_omitido falso de Honduras salta en cada viaje (los PC de regreso km 26/28 quedan a ~185 m de los de ida km 2/4).');
  }

  console.log('\n--- Paso 0: insumos (KML + trazado por calles) ---');
  const kmlTexto = fs.readFileSync(KML_PATH, 'utf8');
  const boceto = prepararBoceto(kmlTexto);
  let plan: PlanDatos;
  try {
    plan = construirPlan(boceto, await obtenerTrazado(kmlTexto, boceto));
  } catch (err) {
    console.error('\nAbortado.');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  try {
    await login();
    const sindicato = await resolverSindicato();
    await preVuelo(sindicato, plan);
    const lineaId = await sincronizarLinea(sindicato);
    const { rutaId, existente } = await sincronizarRuta(lineaId, plan);
    // Orden (la API valida contra base ∪ tramos de variantes activas): tramo → base → PC → paradas → vínculo.
    const variante = await sincronizarVariante(rutaId, plan);
    await parchearGeometriaRuta(existente, plan);
    const pcIds = await sincronizarPuntosControl(rutaId, plan);
    await sincronizarParadas(rutaId, plan);
    await vincularPuntoEspera(variante, pcIds.get(plan.puntosControl.find((pc) => pc.rol === 'espera')!.orden));

    if (APLICAR) {
      await verificar(lineaId, plan);
      console.log(`\nOK. ${escriturasEjecutadas} escritura(s) ejecutada(s). Sin asignaciones (el CTO asigna desde el panel).`);
    } else {
      console.log(`\nDRY-RUN: ${escriturasPlaneadas} escritura(s) planeada(s), 0 enviadas. Para aplicar: agregar --apply.`);
    }
  } catch (err) {
    console.error('\nAbortado.');
    console.error(err instanceof Error ? err.message : err);
    console.error(`(escrituras ejecutadas antes del error: ${escriturasEjecutadas}; el script es idempotente: re-correr para completar)`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void main();
}
