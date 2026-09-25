#!/usr/bin/env node
/**
 * Genera docs/costos-gcp-2000.md a partir de modelo-costos.mjs.
 *
 * Uso: node scripts/costos/generar-tablas.mjs > docs/costos-gcp-2000.md
 *
 * Regla dura del encargo: CADA número que aparece en el .md sale de una llamada a este
 * módulo (directa o vía modelo-costos.mjs). Este script no escribe ningún precio, tier ni
 * total a mano — solo formatea lo que el modelo devuelve.
 *
 * 2026-09-22: recalibrado (docs/plan-experimento-puntos-gps.md §8/§9) con el dimensionamiento
 * MEDIDO de Cloud SQL (`SQL_TIERS_MEDIDOS`), construido sobre una prueba de carga real local
 * (Postgres/Docker, no Cloud SQL — límites declarados en §7 de este documento). El
 * dimensionamiento anterior (`SQL_TIERS`, agosto, sin medición de capacidad) NO se tocó —
 * sigue siendo el ancla del test de regresión — y queda documentado como referencia
 * histórica en §9.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  calcularEscalon,
  ESCALONES_DOCUMENTO,
  ESCENARIOS,
  SUPUESTOS_AGOSTO,
  SUPUESTOS_MEDIDOS,
  SUPUESTOS_MEDIDOS_30M,
  EDGE_CASES_DEFAULT,
  FACTOR_PICO_SOBRE_PROMEDIO,
  SQL_TIERS,
  SQL_TIERS_MEDIDOS,
  BYTES_INDICE_POR_FILA_MEDIDO,
  RAM_MULTIPLICADOR_WORKING_SET,
  MULTIPLICADORES_RAM_SENSIBILIDAD,
  DIAS_WORKING_SET,
  PISO_TRUFIS_EFECTIVOS_MEDIDO,
  PISO_TIER_MEDIDO_NOMBRE,
  UMBRALES_INSTANCIAS_WORKER_REQ_DIA,
  ANCLA_SALTO_1_A_2_INSTANCIAS_CONDUCTORES,
  CPU_SEG_POR_REQUEST_API,
  REFERENCIA_AGOSTO_API,
  IDLE_API_MENSUAL,
  residuosApiAgosto,
  residuosTotalAgosto,
  REFERENCIA_AGOSTO_TOTAL,
  REGION,
  HORAS_MES,
  TOLERANCIA_BORDE_TIER_PCT,
  COMPARACION_CALIBRACION_API,
} from './modelo-costos.mjs';

const ARQUITECTURAS = ['actual', 'optimizada'];
const NOMBRE_ARQUITECTURA = { actual: 'Actual', optimizada: 'Optimizada' };

// ---------------------------------------------------------------------------
// Lectura de resultados de la prueba de carga — hallazgo 3 de revisión (2026-09-22): NO
// escribir a mano números que ya están en un JSON de resultado. `v2-*` (harness corregido,
// hallazgos 5/6/7/8 de revisión) tiene prioridad sobre el archivo pre-fix sin prefijo, si
// existe — ver scripts/experimentos/gps/carga/resultados/resumen.md para el método completo.
// ---------------------------------------------------------------------------

const RESULTADOS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../experimentos/gps/carga/resultados',
);

function leerResultadoPunto(perfil, objetivo, sync = 15) {
  for (const prefijo of ['v2-perfil', 'perfil']) {
    const nombre = `${prefijo}-${perfil}_obj-${objetivo}_sync-${sync}.json`;
    const p = path.join(RESULTADOS_DIR, nombre);
    if (existsSync(p)) return { archivo: nombre, ...JSON.parse(readFileSync(p, 'utf8')) };
  }
  return null;
}

/** CPU% en el punto de la matriz que PASA con el objetivo más alto de ese perfil, entre los
 * puntos dados — usado para "CPU en el máximo que PASA" de §7.1, sin tabla a mano. */
function cpuEnElMaximoQuePasa(puntos) {
  const pasan = puntos.filter((p) => p?.resultado === 'PASA');
  if (pasan.length === 0) return null;
  const maximo = pasan.reduce((a, b) => (b.objetivoPtsSeg > a.objetivoPtsSeg ? b : a));
  if (maximo.cpuPromedioPct == null || maximo.cpuMaxPct == null) return null;
  return `${maximo.cpuPromedioPct.toFixed(0)}-${maximo.cpuMaxPct.toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------

function usd(n) {
  return `${n < 0 ? '-' : ''}US$${Math.abs(n).toFixed(2)}`;
}

function usdCorto(n) {
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
}

function pct(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function gib(n) {
  return `${n.toFixed(0)} GiB`;
}

function fila(cols) {
  return `| ${cols.join(' | ')} |`;
}

// ---------------------------------------------------------------------------
// Helpers de borde de tier (hallazgo 1 de revisión, 2026-09-20) — `bordeTierCercano`
// ya lo calcula modelo-costos.mjs (`tierCercanoABorde`), esta capa solo lo formatea
// para que el documento muestre el RANGO, nunca el punto, cuando el pico cae cerca
// de un empate de tier. Con el dimensionamiento MEDIDO (§7), `bordeTierCercano` solo
// se puebla cuando la regla ganadora fue "escritura" o el fallback a la tabla de
// agosto (`reglaTierMedido`) — si ganó "ram" o "piso" no hay ambigüedad de pts/s que
// reportar, así que estos helpers simplemente no encuentran nada y no imprimen nada.
// ---------------------------------------------------------------------------

/** `{lo, hi}` en USD si `r` tiene un empate de tier cercano, o `null` si no. */
function rangoBorde(r) {
  if (!r.bordeTierCercano) return null;
  return {
    lo: Math.min(r.total, r.bordeTierCercano.totalVecino),
    hi: Math.max(r.total, r.bordeTierCercano.totalVecino),
  };
}

/** `usd()` con rango cuando corresponde, marcado con `†` para la nota al pie. */
function usdConBorde(r) {
  const rango = rangoBorde(r);
  return rango ? `${usd(rango.lo)}–${usd(rango.hi)} †` : usd(r.total);
}

/** Igual que `usdConBorde` pero con el formato corto (`usdCorto`) de las tablas. */
function usdCortoConBorde(r) {
  const rango = rangoBorde(r);
  return rango ? `${usdCorto(rango.lo)}–${usdCorto(rango.hi)} †` : usdCorto(r.total);
}

/**
 * ¿La escritura pico de este escalón supera el techo MEDIDO (`SQL_TIERS_MEDIDOS`) del tier
 * que el modelo eligió? Reemplaza la vieja comparación contra el techo fijo de k6 (300 pts/s,
 * `TECHO_PROBADO_PTS_S`), que quedó stale: la prueba de carga local (plan-experimento §8) llegó
 * a sostener 1.000 pts/s en 1 vCPU y 3.000 pts/s en 2 vCPU. Por construcción (`elegirTierSql`)
 * esto casi siempre da "no" — lo que importa es el margen y si el techo del tier es medido o
 * extrapolado (tiers ≥4 vCPU no se corrieron en la prueba — §7.5).
 */
function escrituraVsTierMedido(r) {
  const tierMedido = SQL_TIERS_MEDIDOS.find((t) => t.nombre === r.tierSql);
  const ptsSMax = tierMedido?.ptsSMax;
  const supera = Number.isFinite(ptsSMax) ? r.ptsPorSegundo > ptsSMax : false;
  const techoTxt = Number.isFinite(ptsSMax) ? ptsSMax.toFixed(0) : '∞';
  const extrapoladoTxt = tierMedido?.extrapolado ? ' (techo extrapolado, no medido — §7.5)' : '';
  return `${supera ? 'sí' : 'no'} (${r.ptsPorSegundo.toFixed(0)}/${techoTxt} pts/s)${extrapoladoTxt}`;
}

/**
 * Nota al pie con el detalle de cada empate de tier presente en `resultados` (uno o
 * varios escalones de una misma tabla). Devuelve `null` si ninguno tiene empate, para
 * no imprimir una nota vacía.
 */
function notaBordeTier(resultados) {
  const conBorde = resultados.filter((r) => r && r.bordeTierCercano);
  if (conBorde.length === 0) return null;
  const items = conBorde.map((r) => {
    const b = r.bordeTierCercano;
    return (
      `n=${r.n} (${r.ptsPorSegundo.toFixed(1)} pts/s, borde de tier en ${b.bordePtsPorSegundo.toFixed(1)} pts/s, ` +
      `margen ${(b.distanciaPct * 100).toFixed(1)}%): \`${r.tierSql}\` → ${usdCorto(r.total)} contra ` +
      `\`${b.tierVecino}\`${b.tierVecinoExtrapolado ? ' (extrapolado)' : ''} → ${usdCorto(b.totalVecino)}`
    );
  });
  return (
    `† **Empate de borde de tier de Cloud SQL** (dentro de ±${(TOLERANCIA_BORDE_TIER_PCT * 100).toFixed(0)}% del ` +
    `límite del tier; en los casos listados el margen es efectivamente CERO, así que el tier — y el total — ` +
    `podría caer para cualquiera de los dos lados): ${items.join('; ')}. El punto de escritura pico que decide ` +
    'el tier es una extrapolación de UNA sola jornada medida (n=1, plan §12.4) redondeada a puntos/día — un ' +
    'redondeo mínimo de ese supuesto empuja el escalón real al tier vecino, más caro. El RANGO, no el punto, ' +
    'es la cifra defendible frente a finanzas.'
  );
}

function tabla(encabezados, filas, aligns) {
  const marcas = encabezados.map((_, i) => ((aligns && aligns[i]) === 'left' ? ':---' : '---:'));
  const out = [];
  out.push(fila(encabezados));
  out.push(fila(marcas));
  for (const f of filas) out.push(fila(f));
  return out.join('\n');
}

const lines = [];
function p(s = '') {
  lines.push(s);
}

// ---------------------------------------------------------------------------
// Cálculo base — todos los escalones, escenarios y arquitecturas, dos cadencias de captura
// ---------------------------------------------------------------------------

function calcularTodo(supuestos) {
  const resultados = {};
  for (const escenarioKey of Object.keys(ESCENARIOS)) {
    resultados[escenarioKey] = {};
    for (const arquitectura of ARQUITECTURAS) {
      resultados[escenarioKey][arquitectura] = ESCALONES_DOCUMENTO.map((n) =>
        calcularEscalon(n, { arquitectura, escenario: escenarioKey, supuestos }),
      );
    }
  }
  return resultados;
}

const RESULTADOS_MEDIDOS = calcularTodo(SUPUESTOS_MEDIDOS); // captura 15 m (actual)
const RESULTADOS_MEDIDOS_30M = calcularTodo(SUPUESTOS_MEDIDOS_30M); // captura 30 m

// Compartidos entre secciones — hallazgo 3 de revisión (2026-09-22): antes varias secciones
// citaban "495 pts/s" (u otras cifras derivadas de este mismo escalón) escritas a mano en vez
// de leer el resultado ya calculado arriba.
const N600_ACTUAL_15M = RESULTADOS_MEDIDOS.A.actual.find((r) => r.n === 600);
const N2000_ACTUAL_15M = RESULTADOS_MEDIDOS.A.actual.find((r) => r.n === 2000);

/**
 * Margen de la escritura pico de `r` contra el techo de escritura del tier elegido
 * (`SQL_TIERS_MEDIDOS.ptsSMax`), en %. `null` si el tier no tiene techo finito (no debería
 * pasar con los tiers usados en este documento). Reemplaza calificativos escritos a mano
 * ("holgada", "con margen") — hallazgo 3 de revisión.
 */
function margenVsTechoTierPct(ptsPorSegundo, tierNombre) {
  const tier = SQL_TIERS_MEDIDOS.find((t) => t.nombre === tierNombre);
  if (!tier || !Number.isFinite(tier.ptsSMax) || tier.ptsSMax === 0) return null;
  return ((tier.ptsSMax - ptsPorSegundo) / tier.ptsSMax) * 100;
}

function margenEscrituraVsTechoPct(r) {
  return margenVsTechoTierPct(r.ptsPorSegundo, r.tierSql);
}

/**
 * Tier/costo de un escalón bajo cada multiplicador de `MULTIPLICADORES_RAM_SENSIBILIDAD`
 * (3×/4×/5×) — hallazgo 2 de revisión (2026-09-22): en vez de afirmar en prosa si el
 * multiplicador de RAM (heurística DECLARADA, no medida — §7.2 regla 2) mueve el tier de un
 * escalón, se CALCULA para los tres valores y se reporta el resultado real.
 */
function sensibilidadRam(n, arquitectura, supuestos) {
  return MULTIPLICADORES_RAM_SENSIBILIDAD.map((m) => {
    const r = calcularEscalon(n, { arquitectura, escenario: 'A', supuestos, ramMultiplicadorWorkingSet: m });
    return { multiplicador: m, tierSql: r.tierSql, tierSqlExtrapolado: r.tierSqlExtrapolado, total: r.total, reglaTierMedido: r.reglaTierMedido };
  });
}

/** `true` si el tier elegido es el MISMO bajo los tres multiplicadores probados. */
function tierEstableAntesMultiplicador(n, arquitectura, supuestos) {
  const filas = sensibilidadRam(n, arquitectura, supuestos);
  return new Set(filas.map((f) => f.tierSql)).size === 1;
}

/** Calificativo del margen de escritura contra el techo de un tier dado, derivado del número
 * (no elegido a mano) — "cerca del borde" usa la misma tolerancia que
 * `TOLERANCIA_BORDE_TIER_PCT` (±2%), "con margen" el resto. Hallazgo 3 de revisión. */
function calificativoMargenVsTecho(ptsPorSegundo, tierNombre) {
  const margenPct = margenVsTechoTierPct(ptsPorSegundo, tierNombre);
  if (margenPct === null) return 'sin techo finito que comparar';
  const cercaDelBorde = Math.abs(margenPct) <= TOLERANCIA_BORDE_TIER_PCT * 100;
  if (cercaDelBorde) return `cerca del borde (margen ${margenPct.toFixed(1)}%, dentro de ±${(TOLERANCIA_BORDE_TIER_PCT * 100).toFixed(0)}%)`;
  return `con margen (${margenPct.toFixed(1)}% por debajo del techo de escritura de su tier)`;
}

/** Igual que `calificativoMargenVsTecho` pero contra el tier YA elegido de un resultado de
 * `calcularEscalon` (r.tierSql), en vez de un tier nombrado explícitamente. */
function calificativoMargenEscritura(r) {
  return calificativoMargenVsTecho(r.ptsPorSegundo, r.tierSql);
}

// ---------------------------------------------------------------------------
// 0. Encabezado
// ---------------------------------------------------------------------------

const hoy = new Date().toISOString().slice(0, 10);

p('# Proyección de costos GCP — 10 a 2000 conductores');
p();
p(`**Fecha de generación:** ${hoy} (script \`scripts/costos/generar-tablas.mjs\`, salida no editada a mano)`);
p('**Autor:** Tecnología / CTO');
p(`**Proyecto GCP:** \`quivo-control-prod\` · **Región:** \`${REGION}\` (Santiago, Tier 2 de GCP)`);
p(
  '**Fuente del modelo:** `scripts/costos/modelo-costos.mjs` — extiende `docs/costos-gcp-por-escala.md` ' +
    '(2026-08-26) a 2000 conductores, recalibrado con la medición real de `docs/plan-costos-2000.md` §12 ' +
    '(2026-09-20) y, desde 2026-09-22, con la prueba de carga local de Postgres (Docker, disco NVMe local, ' +
    'no Cloud SQL — confirmada el 2026-09-22 contra una instancia Cloud SQL real, §7.5) de ' +
    '`docs/plan-experimento-puntos-gps.md` §8/§9 (ver §7 de este documento).',
);
p();
p(
  '> **Este documento NO reemplaza `docs/costos-gcp-por-escala.md`.** Ese archivo es registro histórico y no ' +
    'se modifica. Este documento es la extensión pedida (ClickUp `86e34jkb2`) más la reconciliación con ' +
    '`documento-tecnico-cto.md` §10.',
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 1. Resumen ejecutivo
// ---------------------------------------------------------------------------

p('## 1. Resumen ejecutivo');
p();
{
  const n600A = RESULTADOS_MEDIDOS.A.actual.find((r) => r.n === 600);
  const n600O = RESULTADOS_MEDIDOS.A.optimizada.find((r) => r.n === 600);
  const n2000A = RESULTADOS_MEDIDOS.A.actual.find((r) => r.n === 2000);
  const n2000O = RESULTADOS_MEDIDOS.A.optimizada.find((r) => r.n === 2000);

  p(
    `Con los supuestos de carga MEDIDOS el 2026-09-20 (plan-costos-2000 §12), captura a 15 m (la actual, sin ` +
      `cambios de producto) y el escenario A (2000 transmitiendo a la vez — la definición más exigente de ` +
      `"2000 trufis"):`,
  );
  p();
  p(
    tabla(
      ['Conductores', 'Arquitectura actual', 'Arquitectura optimizada', 'Tier Cloud SQL (actual)', '¿Supera la escritura medida del tier? (local)'],
      [
        [
          '600',
          usdConBorde(n600A) + '/mes',
          usdConBorde(n600O) + '/mes',
          `\`${n600A.tierSql}\`${n600A.tierSqlExtrapolado ? ' (extrapolado)' : ''}`,
          escrituraVsTierMedido(n600A),
        ],
        [
          '2000',
          usdConBorde(n2000A) + '/mes',
          usdConBorde(n2000O) + '/mes',
          `\`${n2000A.tierSql}\`${n2000A.tierSqlExtrapolado ? ' (extrapolado)' : ''}`,
          escrituraVsTierMedido(n2000A),
        ],
      ],
      ['right', 'right', 'right', 'left', 'left'],
    ),
  );
  p();
  p(
    '_Techo de escritura = `SQL_TIERS_MEDIDOS.ptsSMax` (§7.4), 50% de lo que la prueba de carga local ' +
      '(plan-experimento §8) mostró que PASA. Tiers de 4 vCPU o más son EXTRAPOLADOS — no se corrieron en la ' +
      'prueba (RAM del host insuficiente, §7.5)._',
  );
  p();
  const notaResumen = notaBordeTier([n600A, n600O, n2000A, n2000O]);
  if (notaResumen) {
    p(notaResumen);
    p();
  }
  const rangoResumenO = rangoBorde(n2000O);
  const costoPorConductorTxt = rangoResumenO
    ? `entre ${usd(rangoResumenO.lo / 2000)} y ${usd(rangoResumenO.hi / 2000)}`
    : `${usd(n2000O.total / 2000)}`;
  p(
    `El costo por conductor a 2000 (arquitectura optimizada) es ${costoPorConductorTxt}/mes — ` +
      `${n2000O.total / 2000 < n600O.total / 600 ? 'sigue bajando' : 'sube'} respecto a los ` +
      `${usd(n600O.total / 600)}/mes de 600 conductores, porque la base fija (Redis, worker, VPC/GCS, ` +
      `Artifact Registry) se sigue repartiendo entre más conductores. **El hallazgo estructural de agosto ` +
      `sigue vigente: el costo no escala con la flota, escala con el dimensionamiento de Cloud SQL** — lo que ` +
      `cambió el 2026-09-22 es QUÉ decide ese dimensionamiento: ya no es una tabla de escritura sin medir, ` +
      `es el máximo de tres reglas medidas/declaradas (escritura, memoria de working set, piso de producción ` +
      `— §7 de este documento).`,
  );
  p();
  p(
    `A ${n2000A.ptsPorSegundo.toFixed(1)} puntos/s pico (escenario A, 2000 conductores, captura 15 m) el tier ` +
      `elegido es \`${n2000A.tierSql}\`${n2000A.tierSqlExtrapolado ? ', EXTRAPOLADO (sin prueba de carga real a esa capacidad)' : ', con evidencia real de carga (plan-experimento §8)'} — ` +
      `decidido por la regla "**${n2000A.reglaTierMedido}**" de §9 del plan (§7.2 de este documento). Esto es ` +
      `un cambio estructural frente al dimensionamiento anterior (\`SQL_TIERS\`, agosto, sin medición de ` +
      `capacidad de escritura): la prueba de carga real (plan-experimento §8) mostró que la ESCRITURA sola de ` +
      `2000 conductores (${n2000A.ptsPorSegundo.toFixed(1)} pts/s) entra en \`db-custom-1-3840\`, ` +
      `${calificativoMargenVsTecho(n2000A.ptsPorSegundo, 'db-custom-1-3840')} — el tier real lo termina ` +
      `decidiendo la memoria de working set o el piso de producción, no el pico de escritura. Detalle completo ` +
      `y cifras del dimensionamiento descartado en §9.`,
  );
  p();
  {
    // Hallazgo 2 de revisión (2026-09-22): antes esto comparaba strings exactos ('ram' ===
    // 'ram'), que dejaba de matchear en cuanto `elegirTierSqlMedido` empezó a reportar
    // empates ('ram+piso') — el caso REAL de n=600. Ahora se separa el string por '+' y se
    // reporta explícitamente cuándo hay empate, en vez de perder esa información.
    const reglas600 = n600A.reglaTierMedido.split('+');
    const reglas2000 = n2000A.reglaTierMedido.split('+');
    const empate600 = reglas600.length > 1;
    const estable600 = tierEstableAntesMultiplicador(600, 'actual', SUPUESTOS_MEDIDOS);
    const estable2000 = tierEstableAntesMultiplicador(2000, 'actual', SUPUESTOS_MEDIDOS);
    p(
      `**A 600 conductores, las reglas "${reglas600.join('" y "')}" ${empate600 ? 'EMPATAN' : 'no empatan'} en ` +
        `\`${n600A.tierSql}\`** (§7.2) — ${empate600 ? 'ninguna de las dos domina sola: aunque una cambiara de opinión, la otra igual pediría ese tier' : ''}. ` +
        `A 2000 conductores la regla ganadora es "**${n2000A.reglaTierMedido}**". El multiplicador de RAM ` +
        `(${RAM_MULTIPLICADOR_WORKING_SET}×, §7.2 regla 2) es una heurística DECLARADA, no medida — se probó ` +
        `${MULTIPLICADORES_RAM_SENSIBILIDAD.join('×/')}× programáticamente (tabla completa en §7.6): a 600 ` +
        `conductores el tier **${estable600 ? 'NO cambia' : 'SÍ cambia'}** en ese rango (${empate600 ? 'el piso de producción ya fuerza ' + n600A.tierSql + ' aunque RAM pidiera menos' : 'la regla de RAM sola decide'}); a ` +
        `2000 conductores el tier **${estable2000 ? 'NO cambia' : 'SÍ cambia'}** — ver §2 para la cifra de 2000 ` +
        `como RANGO por este motivo.`,
    );
  }
}
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 2. Reconciliación con documento-tecnico-cto.md §10
// ---------------------------------------------------------------------------

p('## 2. Reconciliación con `documento-tecnico-cto.md` §10');
p();
p(
  '`documento-tecnico-cto.md` §10 (2026-07-19) proyectó **US$1.200–2.800/mes para 3000 vehículos**. Ese ' +
    'rango es anterior al relevamiento real con `gcloud` (2026-08-26), a la medición de carga de producción ' +
    '(2026-09-20) y a la prueba de carga real local (Postgres/Docker, no Cloud SQL — 2026-09-22, ' +
    'plan-experimento-puntos-gps.md §8): es una estimación de arquitectura, no de infraestructura desplegada ' +
    'y medida.',
);
p();
{
  const n2000A = RESULTADOS_MEDIDOS.A.actual.find((r) => r.n === 2000);
  const n2000O = RESULTADOS_MEDIDOS.A.optimizada.find((r) => r.n === 2000);
  p(
    tabla(
      ['Fuente', 'Cifra', 'Escala', 'Fecha'],
      [
        ['`documento-tecnico-cto.md` §10', 'US$1.200 – 2.800/mes', '3000 vehículos', '2026-07-19'],
        [
          '`costos-gcp-por-escala.md`',
          usdCorto(REFERENCIA_AGOSTO_TOTAL.actual[600]) + ' actual / ' + usdCorto(REFERENCIA_AGOSTO_TOTAL.optimizada[600]) + ' optimizada',
          '600 conductores',
          '2026-08-26',
        ],
        [
          'Este documento (medido + carga real, escenario A, captura 15 m)',
          usdConBorde(n2000A) + ' actual / ' + usdConBorde(n2000O) + ' optimizada',
          '2000 conductores',
          hoy,
        ],
      ],
      ['left', 'left', 'left', 'left'],
    ),
  );
  p();
  const notaReconciliacion = notaBordeTier([n2000A, n2000O]);
  if (notaReconciliacion) {
    p(notaReconciliacion);
    p();
  }
  p(`**La diferencia es real y se explica en tres capas, no en una:**`);
  p();
  p(
    `1. **El rango de julio era arquitectura, no infraestructura desplegada ni medida.** No hubo relevamiento ` +
      `con \`gcloud\` ni precios de lista aplicados, y mucho menos una prueba de carga real contra la base de ` +
      `datos (ni siquiera local, como la de este documento — la confirmación contra Cloud SQL real se hizo el ` +
      `2026-09-22, §7.5) — es una estimación previa, del mismo tipo que el ADR 0002 (que estimaba ~$255-290/mes asumiendo una base ` +
      `de datos de 2 vCPU/8 GB que nunca se creó, corregida en \`costos-gcp-por-escala.md\`).`,
  );
  p(
    `2. **3000 ≠ 2000.** Este documento no extrapola hasta 3000 (fuera del encargo de la tarea ClickUp ` +
      `\`86e34jkb2\`, que pide hasta 2000). El rango de julio pesa sobre 1000 vehículos más.`,
  );
  p(
    `3. **El régimen de costo no es lineal con la flota** (§1, hallazgo de agosto que sigue vigente): a ` +
      `2000 conductores la base fija (Redis, worker, VPC/GCS, Artifact Registry) sigue siendo una fracción ` +
      `chica del total, y el grueso es Cloud SQL — pero desde 2026-09-22 dimensionado con evidencia de carga ` +
      `real (§7), no solo con un criterio de escritura pico sin medir.`,
  );
  p();
  {
    const rangoConclA = rangoBorde(n2000A);
    const cifraA = rangoConclA ? `${usd(rangoConclA.lo)}–${usd(rangoConclA.hi)}` : usd(n2000A.total);
    const cifraO = rangoBorde(n2000O) ? `${usd(rangoBorde(n2000O).lo)}–${usd(rangoBorde(n2000O).hi)}` : usd(n2000O.total);
    p(
      `**Conclusión para finanzas:** el rango de julio (US$1.200–2.800 para 3000) y la proyección de este ` +
        `documento para 2000 (${cifraA} actual / ${cifraO} optimizada) NO son directamente comparables — son ` +
        `estimaciones de tres momentos distintos del proyecto, con tres niveles de evidencia distintos.`,
    );
    p();
    if (rangoConclA) {
      const techoA = usd(rangoConclA.hi);
      p(
        `**La cifra de este documento para 2000 es un RANGO, no un punto, y hay que decírselo a finanzas así:** ` +
          `a 2000 conductores el pico de escritura da exactamente ${n2000A.ptsPorSegundo.toFixed(1)} pts/s, que ` +
          `cae cerca del borde entre \`${n2000A.tierSql}\` y ` +
          `\`${n2000A.bordeTierCercano ? n2000A.bordeTierCercano.tierVecino : 'el tier vecino'}\`. Recomendar el ` +
          `extremo bajo del rango sin este contexto sería decirle a finanzas que adopte el resultado de un ` +
          `empate como si fuera un número firme. **Se recomienda presupuestar contra el EXTREMO ALTO del rango ` +
          `(${techoA} actual) hasta que una segunda medición confirme de qué lado del borde cae la carga real.**`,
      );
    } else {
      // Hallazgo 2b de revisión (2026-09-22): NO afirmar "número firme" solo porque no hay
      // empate de BORDE de escritura (§7.2 regla 1) — cuando la regla ganadora es "ram" (una
      // heurística DECLARADA, no medida, ver §7.2), el multiplicador de RAM (3×-5× probado)
      // SÍ puede mover el tier, y por lo tanto el costo. Se calcula (no se afirma) si eso pasa
      // acá.
      const sens2000 = sensibilidadRam(2000, 'actual', SUPUESTOS_MEDIDOS);
      const en3x = sens2000.find((f) => f.multiplicador === 3);
      const en4x = sens2000.find((f) => f.multiplicador === RAM_MULTIPLICADOR_WORKING_SET);
      const tierCambia = en3x.tierSql !== en4x.tierSql;
      if (tierCambia) {
        const lo = Math.min(en3x.total, en4x.total);
        const hi = Math.max(en3x.total, en4x.total);
        p(
          `**La cifra de este documento para 2000 (arquitectura actual) es un RANGO, no un número firme** — no ` +
            `por un empate de borde de escritura (§7.2 regla 1, eso ya no aplica: la regla ganadora es ` +
            `"**${n2000A.reglaTierMedido}**"), sino porque el multiplicador de RAM (§7.2 regla 2, heurística ` +
            `DECLARADA, no medida) mueve el tier dentro del rango probado: a ${en3x.multiplicador}× el tier es ` +
            `\`${en3x.tierSql}\` (${usd(en3x.total)}/mes); a ${en4x.multiplicador}× (el default de este ` +
            `documento) es \`${en4x.tierSql}\` (${usd(en4x.total)}/mes). **Rango real: ${usd(lo)}–${usd(hi)}/mes.** ` +
            `Ambos tiers (\`${en3x.tierSql}\`, \`${en4x.tierSql}\`) son de 4 vCPU o más — sus capacidades ` +
            `(escritura Y RAM) están EXTRAPOLADAS de la prueba de carga real (§7.1/§7.5: los perfiles \`c4\`/\`c8\` ` +
            `no corrieron, RAM del host insuficiente). Tabla de sensibilidad completa (3×/4×/5×, 600 y 2000, ` +
            `15 m y 30 m, ambas arquitecturas): §7.6.`,
        );
      } else {
        p(
          `**La cifra de este documento para 2000 (arquitectura actual) NO cambia de tier entre ${en3x.multiplicador}× ` +
            `y ${en4x.multiplicador}×** de multiplicador de RAM (§7.2 regla 2, calculado, no afirmado — tabla ` +
            `completa en §7.6): en ambos casos el tier es \`${en4x.tierSql}\`${en4x.tierSqlExtrapolado ? ' (EXTRAPOLADO — §7.1/§7.5, capacidades de 4 vCPU o más sin prueba de carga real)' : ''}. ` +
            `La prueba de carga LOCAL (§7.1) se confirmó el 2026-09-22 contra una instancia Cloud SQL real de ` +
            `1 vCPU (§7.5): sostuvo 2.000 pts/s con CPU máx. 50%, sin cambiar esta conclusión — la escritura no ` +
            `es la restricción que decide el tier a esta escala (§7.2, la regla ganadora es RAM/piso, no escritura).`,
        );
      }
    }
    p();
    p(
      `El número de este documento tiene evidencia real detrás (precios de lista + una prueba de carga real ` +
        `local de Postgres, aunque limitada y no sobre Cloud SQL — ver §7.1); el de julio es una proyección de ` +
        `arquitectura sin verificar contra infraestructura desplegada ni medida.`,
    );
  }
}
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 3. Metodología
// ---------------------------------------------------------------------------

p('## 3. Metodología (resumen)');
p();
p(
  `- **Factor pico/promedio de Cloud SQL:** \`FACTOR_PICO_SOBRE_PROMEDIO = ${FACTOR_PICO_SOBRE_PROMEDIO}\` ` +
    `(plan-costos-2000 §13.1). El promedio de la jornada (n × puntos/día ÷ jornada en segundos) NO es el pico ` +
    `de escritura que dimensiona el tier de Cloud SQL; agosto dimensionó contra el pico sin escribir la ` +
    `fórmula. Se aplica antes de elegir tier, nunca para el resto de los servicios.`,
);
p(
  `- **Tiers de Cloud SQL — DOS dimensionamientos distintos, usados en momentos distintos (§7.2):** ` +
    `\`SQL_TIERS\` (agosto, criterio de escritura pico SIN medición de capacidad real, NO se toca — es el ` +
    `ancla del test de regresión) y \`SQL_TIERS_MEDIDOS\` (2026-09-22, plan-experimento §8/§9, construido ` +
    `sobre una prueba de carga real de Postgres). Este documento usa \`SQL_TIERS_MEDIDOS\` para toda la ` +
    `proyección con supuestos MEDIDOS (§4-§6); \`SQL_TIERS\` solo sobrevive para el test de regresión contra ` +
    `agosto y para la referencia histórica de §9.`,
);
p(
  `- **Dimensionamiento MEDIDO de Cloud SQL (§7, plan §9) — el tier elegido es el MAYOR de tres reglas:**\n` +
    `  1. **Escritura:** techo de diseño = 50% de lo que la prueba de carga mostró que PASA. 1 vCPU → 500 ` +
    `pts/s, 2 vCPU → 1.500 pts/s, 4 vCPU → 3.000 pts/s (extrapolado).\n` +
    `  2. **Memoria (working set):** RAM del tier ≥ ${RAM_MULTIPLICADOR_WORKING_SET} × (bytes de índice de ` +
    `${DIAS_WORKING_SET} días de la flota efectiva), con ${BYTES_INDICE_POR_FILA_MEDIDO.toFixed(2)} B de ` +
    `índice/fila MEDIDOS (§7.1).\n` +
    `  3. **Piso de producción:** \`${PISO_TIER_MEDIDO_NOMBRE}\` desde ${PISO_TRUFIS_EFECTIVOS_MEDIDO} trufis ` +
    `efectivos; por debajo, se delega en \`SQL_TIERS\` (agosto) — este dimensionamiento medido no inventa un ` +
    `tier chico sin evidencia a esa escala.`,
);
p(
  `- **Instancias de \`quivo-worker\`:** tabla explícita de umbrales en requests/día (no una fórmula de ` +
    `conductores), anclada en el punto medio entre lo que generan 400 y 500 conductores bajo el ciclo de ` +
    `sync de 15s de agosto (${ANCLA_SALTO_1_A_2_INSTANCIAS_CONDUCTORES} conductores × tasa de agosto). ` +
    `Reproduce "1 worker hasta 400, 2 desde 500" (agosto §5) y se extiende a 800-2000 duplicando el mismo ` +
    `umbral, documentado como extrapolación (plan-costos-2000 §13.2).`,
);
p(
  `- **Costo de \`quivo-api\`:** el componente de CPU activa por request (\`cpuSegPorRequestApi\`) se ` +
    `calibra por MEJOR AJUSTE de mínimos cuadrados (error en USD) contra los **18 puntos de referencia** ` +
    `publicados en agosto (9 escalones × 2 arquitecturas), no contra un solo escalón (plan-costos-2000 §13.3). ` +
    `El valor resultante es \`CPU_SEG_POR_REQUEST_API = ${CPU_SEG_POR_REQUEST_API.toFixed(6)}\` vCPU-s/request. ` +
    `**Este parámetro no reproduce bien toda la columna "API" de agosto** — ver §11 para la tabla de residuos ` +
    `completa y por qué.`,
);
p(
  `- **Supuestos de carga:** tres juegos, citados de fuentes distintas. "Agosto" (\`SUPUESTOS_AGOSTO\`, ` +
    `${SUPUESTOS_AGOSTO.bytesPorPunto} B/punto, ${SUPUESTOS_AGOSTO.puntosPorConductorDiaPorVueltas[6]} ` +
    `pts/conductor/día) se usa SOLO para el test de regresión contra el documento de agosto. "Medidos, 15 m" ` +
    `(\`SUPUESTOS_MEDIDOS\`, ${SUPUESTOS_MEDIDOS.bytesPorPunto} B/punto, ` +
    `${SUPUESTOS_MEDIDOS.puntosPorConductorDia} pts/conductor/día, plan-costos-2000 §12, medición real ` +
    `2026-09-20) es la captura ACTUAL, sin cambios de producto — arma §4/§6. "Medidos, 30 m" ` +
    `(\`SUPUESTOS_MEDIDOS_30M\`, ${SUPUESTOS_MEDIDOS_30M.puntosPorConductorDia} pts/conductor/día, plan-experimento ` +
    `§7/§9.6) asume que se sube el \`distanceFilter\` del SDK móvil de 15 m a 30 m — arma §5.`,
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 4/5. Escalones 10 → 2000, dos cadencias de captura (15 m y 30 m), tres escenarios, dos
// arquitecturas
// ---------------------------------------------------------------------------

function imprimirEscalones(numeroSeccion, tituloCadencia, resultados) {
  p(`## ${numeroSeccion}. Escalones 10 → 2000 conductores (${tituloCadencia})`);
  p();
  p(
    'Tres escenarios de qué significa "2000 trufis" (plan-costos-2000 §4.2/§10 — el CTO pidió modelarlos ' +
      'todos en vez de elegir uno):',
  );
  p();
  for (const [, esc] of Object.entries(ESCENARIOS)) {
    p(`- **${esc.nombre}** — ${esc.descripcion} (factor de concurrencia ${esc.factorConcurrencia}). ${esc.origen}`);
  }
  p();

  for (const [escenarioKey, esc] of Object.entries(ESCENARIOS)) {
    p(`### ${numeroSeccion}.${['A', 'B', 'C'].indexOf(escenarioKey) + 1} Escenario ${esc.nombre}`);
    p();
    for (const arquitectura of ARQUITECTURAS) {
      p(`**Arquitectura ${NOMBRE_ARQUITECTURA[arquitectura]}**`);
      p();
      const filas = resultados[escenarioKey][arquitectura].map((r) => {
        const rango = rangoBorde(r);
        return [
          String(r.n),
          r.nEfectivo.toFixed(0),
          `\`${r.tierSql}\`${r.tierSqlExtrapolado ? ' *' : ''}${rango ? ' †' : ''}`,
          r.ptsPorSegundo.toFixed(1),
          r.reglaTierMedido ?? '—',
          gib(r.discoGiB),
          rango ? `${usdCorto(rango.lo)}–${usdCorto(rango.hi)}` : usdCorto(r.total),
          rango ? `${usdCorto(rango.lo / r.n)}–${usdCorto(rango.hi / r.n)}` : usdCorto(r.total / r.n),
        ];
      });
      p(
        tabla(
          ['Conductores (n)', 'n efectivo', 'Tier SQL', 'Pts/s pico', 'Regla', 'Disco', 'Total/mes', 'USD/conductor'],
          filas,
          ['right', 'right', 'left', 'right', 'left', 'right', 'right', 'right'],
        ),
      );
      p();
      const notaTablaEscalones = notaBordeTier(resultados[escenarioKey][arquitectura]);
      if (notaTablaEscalones) {
        p(notaTablaEscalones);
        p();
      }
    }
  }
  {
    const algunExtrapolado = Object.values(resultados)
      .flatMap((porArq) => Object.values(porArq))
      .flat()
      .some((r) => r.tierSqlExtrapolado);
    if (algunExtrapolado) {
      p(
        '\\* Tier extrapolado por este modelo — sin evidencia de prueba de carga real a esa capacidad ' +
          '(agosto no dimensionó más allá de 600 conductores; la prueba de carga local de septiembre no ' +
          'corrió los perfiles de 4/8 vCPU, RAM del host insuficiente — §7.1).',
      );
    }
  }
  p();
  p(
    'Columna "Regla": qué regla de §7.2 decidió el tier de Cloud SQL en ese escalón — `escritura` (pico de ' +
      'INSERT), `ram` (memoria de working set) o `piso` (mínimo de producción desde 100 trufis efectivos). ' +
      'Por debajo de 100 trufis efectivos, este dimensionamiento medido no aplica y se usa la tabla de agosto ' +
      '(`SQL_TIERS`) — la columna muestra `agosto-fallback` en esos escalones.',
  );
  p();
  p('---');
  p();
}

imprimirEscalones(4, 'supuestos MEDIDOS 2026-09-20, captura 15 m — la actual, sin cambios de producto', RESULTADOS_MEDIDOS);
imprimirEscalones(
  5,
  'supuestos MEDIDOS + captura 30 m — requiere subir `distanceFilter` en el SDK móvil (plan-experimento §7/§9.6)',
  RESULTADOS_MEDIDOS_30M,
);

// ---------------------------------------------------------------------------
// 6. Desglose por servicio (600 y 2000, escenario A) — 15 m y 30 m
// ---------------------------------------------------------------------------

p('## 6. Desglose por servicio — n=600 y n=2000 (escenario A)');
p();
const COLUMNAS_DESGLOSE = [
  ['sqlComputo', 'SQL cómputo'],
  ['sqlDisco', 'SQL disco'],
  ['sqlBackup', 'SQL backup'],
  ['redis', 'Redis'],
  ['api', 'API'],
  ['web', 'Web'],
  ['worker', 'Worker'],
  ['vpcConnector', 'VPC conn.'],
  ['gcs', 'GCS'],
  ['artifactRegistry', 'Art.Reg.'],
  ['egreso', 'Egreso'],
];

function imprimirDesglose(resultados) {
  for (const arquitectura of ARQUITECTURAS) {
    p(`**Arquitectura ${NOMBRE_ARQUITECTURA[arquitectura]}**`);
    p();
    const filas = [600, 2000].map((n) => {
      const r = resultados.A[arquitectura].find((x) => x.n === n);
      const rango = rangoBorde(r);
      return [
        String(n),
        ...COLUMNAS_DESGLOSE.map(([key]) => {
          if (key === 'sqlComputo' && rango) {
            const sqlComputoVecino = r.desglose.sqlComputo + (rango.hi - rango.lo);
            return `${usdCorto(r.desglose.sqlComputo)}–${usdCorto(sqlComputoVecino)} †`;
          }
          return usdCorto(r.desglose[key] ?? 0);
        }),
        rango ? `**${usdCorto(rango.lo)}–${usdCorto(rango.hi)} †**` : `**${usdCorto(r.total)}**`,
      ];
    });
    p(tabla(['Conductores', ...COLUMNAS_DESGLOSE.map(([, label]) => label), 'TOTAL'], filas));
    p();
    const notaDesglose = notaBordeTier([600, 2000].map((n) => resultados.A[arquitectura].find((x) => x.n === n)));
    if (notaDesglose) {
      p(notaDesglose);
      p();
    }
  }
}

p('### 6.1 Captura 15 m (supuestos medidos, la actual)');
p();
imprimirDesglose(RESULTADOS_MEDIDOS);
p('### 6.2 Captura 30 m (supuestos medidos + captura reducida)');
p();
imprimirDesglose(RESULTADOS_MEDIDOS_30M);
p('---');
p();

// ---------------------------------------------------------------------------
// 7. Capacidad medida de la base — dimensionamiento de Cloud SQL
// ---------------------------------------------------------------------------

p('## 7. Capacidad medida de la base — dimensionamiento de Cloud SQL (`SQL_TIERS_MEDIDOS`)');
p();
p('### 7.1 La prueba de carga (resumen de `docs/plan-experimento-puntos-gps.md` §8)');
p();
p(
  'Postgres local (`postgis/postgis:16-3.4-alpine`, Docker, NVMe local), migraciones reales de `packages/db` ' +
    '(34 migraciones), RLS `FORCE`, `gps_points` precargada con ≥1M filas históricas antes de medir. Detalle ' +
    'completo, metodología y las corridas inválidas descartadas: `scripts/experimentos/gps/carga/resultados/resumen.md`.',
);
p();
{
  // Hallazgo 3 de revisión (2026-09-22): tabla armada LEYENDO los JSON de resultado
  // (`leerResultadoPunto`), un renglón por punto medido — reemplaza la tabla agrupada escrita
  // a mano (que resumía 3-4 puntos por fila con texto libre). `v2-*` tiene prioridad si ya se
  // volvió a correr la matriz con el harness corregido (hallazgos 5/6/7/8) — ver §7.6.
  const PUNTOS_MATRIZ = [
    ['c1', '1 vCPU / 3,75 GB', 300],
    ['c1', '1 vCPU / 3,75 GB', 500],
    ['c1', '1 vCPU / 3,75 GB', 1000],
    ['c1', '1 vCPU / 3,75 GB', 2000],
    ['c2', '2 vCPU / 7,5 GB (4 GB en la corrida v1, capado por RAM del host — ver §7.5)', 1000],
    ['c2', '2 vCPU / 7,5 GB (4 GB en la corrida v1, capado por RAM del host — ver §7.5)', 2000],
    ['c2', '2 vCPU / 7,5 GB (4 GB en la corrida v1, capado por RAM del host — ver §7.5)', 3000],
  ];
  const filasMatriz = [];
  const sinArchivo = [];
  for (const [perfil, etiqueta, objetivo] of PUNTOS_MATRIZ) {
    const r = leerResultadoPunto(perfil, objetivo);
    if (!r) {
      sinArchivo.push(`${perfil}@${objetivo}`);
      filasMatriz.push([`\`${perfil}\` (${etiqueta})`, String(objetivo), 'sin archivo de resultado', '—']);
      continue;
    }
    const g = r.generador;
    const resultadoTxt =
      r.resultado === 'PASA'
        ? `PASA (p95 lote ${g.latenciaLoteMs.p95.toFixed(1)}ms)`
        : `${r.resultado} (${g.throughputVsObjetivoPct.toFixed(1)}% del objetivo, ` +
          `${g.sostenido ? 'backlog drena' : 'backlog no drena'})`;
    filasMatriz.push([
      `\`${perfil}\` (${etiqueta})`,
      String(objetivo),
      resultadoTxt,
      r.cpuPromedioPct != null && r.cpuMaxPct != null ? `${r.cpuPromedioPct.toFixed(0)}-${r.cpuMaxPct.toFixed(0)}%` : '—',
    ]);
  }
  p(tabla(['Perfil', 'Objetivo pts/s', 'Resultado', 'CPU'], filasMatriz, ['left', 'right', 'left', 'right']));
  p();
  if (sinArchivo.length > 0) {
    p(
      `**Puntos sin archivo de resultado en \`resultados/\` al generar este documento:** ${sinArchivo.join(', ')} ` +
        '— la fila de arriba lo marca explícitamente en vez de inventar un número.',
    );
    p();
  }
  const c1Pasan = PUNTOS_MATRIZ.filter(([perfil]) => perfil === 'c1').map(([perfil, , objetivo]) => leerResultadoPunto(perfil, objetivo));
  const c2Pasan = PUNTOS_MATRIZ.filter(([perfil]) => perfil === 'c2').map(([perfil, , objetivo]) => leerResultadoPunto(perfil, objetivo));
  const cpuC1 = cpuEnElMaximoQuePasa(c1Pasan);
  const cpuC2 = cpuEnElMaximoQuePasa(c2Pasan);
  p(
    `CPU en el objetivo pts/s más alto que PASA de cada perfil (dato del propio archivo de resultado, no una ` +
      `cita): \`c1\` ${cpuC1 ?? '—'}, \`c2\` ${cpuC2 ?? '—'}.`,
  );
  p();
  p(
    // El tier de referencia acá es EL DE ESCRITURA sola (`elegirTierSql` contra
    // `SQL_TIERS_MEDIDOS`, regla 1), no el tier final del escalón (que puede ganar por RAM o
    // piso, más arriba en el tier list) — por eso se compara contra 'db-custom-1-3840'
    // explícito, no contra `N2000_ACTUAL_15M.tierSql`.
    `- **Escritura sola (INSERT multi-fila real del worker):** el pico del modelo a 2.000 trufis ` +
      `(${N2000_ACTUAL_15M.ptsPorSegundo.toFixed(1)} pts/s, escenario A) entra en \`db-custom-1-3840\`, ` +
      `${calificativoMargenVsTecho(N2000_ACTUAL_15M.ptsPorSegundo, 'db-custom-1-3840')} — ver ` +
      `\`elegirTierSql(${N2000_ACTUAL_15M.ptsPorSegundo.toFixed(0)}, SQL_TIERS_MEDIDOS)\` en el test. Techo de ` +
      `diseño = 50% de lo medido que pasa (§3, regla 1).`,
  );
  p(
    '- **Concurrencia del worker:** `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts` no ' +
      'fija `concurrency` ⇒ default de BullMQ = 1 (serializado). El mismo objetivo de 2.000 pts/s que FALLA en ' +
      '`c1` con concurrencia=1 PASA limpio con concurrencia=4 en el MISMO contenedor — la palanca de costo más ' +
      'barata antes de subir el tier de Cloud SQL (no aplicada en este documento: es cambio de código de ' +
      'producción, fuera de alcance de "solo medir").',
  );
  p(
    '- **Lectura — el dimensionador real ERA el mapa en vivo, no la escritura (ya corregido, PR #74):** ver §8 ' +
      'para el detalle completo y el estado post-fix — el N+1 medido acá (paso prerequisito de este documento) ' +
      'ya no es el estado actual del código, `gps_sesion_resumen` lo reemplaza.',
  );
  p();
}
p('### 7.2 Las tres reglas y por qué gana cada una (plan §9)');
p();
p(
  tabla(
    ['Regla', 'Umbral/criterio', 'Fuente'],
    [
      ['1. Escritura', '1 vCPU→500 pts/s · 2 vCPU→1.500 pts/s · 4 vCPU→3.000 pts/s (extrapolado)', 'plan §9.1, 50% de lo medido que PASA (§7.1)'],
      [
        '2. Memoria (working set)',
        `RAM ≥ ${RAM_MULTIPLICADOR_WORKING_SET} × (índices de ${DIAS_WORKING_SET} días de la flota efectiva)`,
        `plan §9.2, ${BYTES_INDICE_POR_FILA_MEDIDO.toFixed(2)} B de índice/fila medidos (ver más abajo)`,
      ],
      ['3. Piso de producción', `${PISO_TIER_MEDIDO_NOMBRE} desde ${PISO_TRUFIS_EFECTIVOS_MEDIDO} trufis efectivos`, 'plan §9.3'],
    ],
    ['left', 'left', 'left'],
  ),
);
p();
p(
  '**Tier elegido = el MAYOR de las tres (plan §9.4).** Por debajo de 100 trufis efectivos, el piso no aplica ' +
    'y el modelo delega en `SQL_TIERS` (la tabla de agosto) — este dimensionamiento medido no inventa un tier ' +
    'chico sin evidencia a esa escala (columna "Regla" = `agosto-fallback` en §4/§5).',
);
p();
p(
  `**Decisión propia (no está en la letra del plan §9.2, que no distingue \`n\` de \`nEfectivo\`):** la ` +
    `"flota" de la regla de memoria se resuelve como \`nEfectivo\` (no la flota nominal \`n\`) — es la misma ` +
    `cantidad que el resto del modelo ya usa para "cuántos trufis generan carga en un día dado" bajo el ` +
    `escenario elegido, y el escenario C define su factor de concurrencia explícitamente como fracción de la ` +
    `flota que opera CADA DÍA, que es la pregunta que el working set de "hoy" necesita responder.`,
);
p();
p('### 7.3 Bytes de índice por fila — medición');
p();
p(
  `**${BYTES_INDICE_POR_FILA_MEDIDO.toFixed(2)} B/fila** — \`pg_indexes_size\` sumado sobre la tabla padre + ` +
    `todas las particiones de \`gps_points\`, dividido por filas totales, con \`ANALYZE\` corrido antes de ` +
    `medir. Postgres local (mismo entorno que §7.1), migraciones reales, ≥1M filas precargadas. Detalle ` +
    `completo (por partición, heap vs. índices): \`scripts/experimentos/gps/carga/resultados/tamanos-indice.json\`.`,
);
p();
p('### 7.4 Tabla de tiers (`SQL_TIERS_MEDIDOS`)');
p();
p(
  tabla(
    ['Tier', 'vCPU', 'RAM', 'Techo de escritura (pts/s)', '¿Extrapolado?'],
    SQL_TIERS_MEDIDOS.map((t) => [
      `\`${t.nombre}\``,
      String(t.vcpu),
      `${t.ramGiB.toFixed(2).replace(/\.?0+$/, '')} GiB`,
      Number.isFinite(t.ptsSMax) ? t.ptsSMax.toFixed(0) : '∞',
      t.extrapolado ? 'sí' : 'no',
    ]),
    ['left', 'right', 'right', 'right', 'left'],
  ),
);
p();
p('### 7.5 Límites de esta prueba de carga (plan §8, no se presentan como más firmes de lo que son)');
p();
p(
  '- **Disco NVMe local ≠ PD-SSD de Cloud SQL.** Sin el modelo de IOPS provisionadas ni la latencia de red ' +
    'VPC de Cloud SQL real — la prueba acota, no reemplaza, una confirmación en una instancia Cloud SQL real.',
);
p('- **7 días de datos precargados, no 6 meses.** Sin bloat de largo plazo, sin fragmentación de meses de autovacuum.');
p(
  '- **Perfiles `c4` (4 vCPU/15 GB) y `c8` (8 vCPU/30 GB) NO se corrieron** — RAM del host de la prueba ' +
    '(13 GiB total) no alcanza para esos perfiles. El techo de escritura de 4 vCPU en `SQL_TIERS_MEDIDOS` ' +
    '(3.000 pts/s) es EXTRAPOLADO, no medido.',
);
p(
  '- **`c2` corrió con memoria capada a 4 GB** en vez del nominal 7,5 GB, por RAM insuficiente del host — ' +
    'desviación declarada, no un default silencioso (`QUIVO_CARGA_MEM` en `levantar.sh`).',
);
p('- **1 pt/s por trufi** es un supuesto del generador de carga, no medido contra datos reales de producción.');
p(
  '- **Confirmación en una instancia Cloud SQL real temporal:** hecha el 2026-09-22 (`db-custom-1-3840`, ' +
    'instancia temporal `quivo-carga-temp`, borrada al cerrar) — plan §10, resultados en ' +
    '`scripts/experimentos/gps/carga/resultados/resumen.md` §9. Con concurrencia de cliente suficiente (40, ' +
    'compensando el RTT de red que limitaba concurrencias menores), 1 vCPU sostuvo 2.000 pts/s al 100% del ' +
    'objetivo, backlog ~0, 0 filas perdidas, con CPU de la instancia entre 31-50% (máx. 49,6%) y memoria ' +
    '58-65% (Cloud Monitoring, `metricas.sh`). La evidencia medida muestra que 1 vCPU sostiene ≥2.000 pts/s a ' +
    '≤50% de CPU — el `ptsSMax=500` de `db-custom-1-3840` en `SQL_TIERS_MEDIDOS` (§7.4) queda conservador a ' +
    'propósito: se mantiene así porque la escritura no es la regla que decide el tier a esta escala (§7.2, la ' +
    'regla ganadora es RAM/piso). El perfil `remoto-c2` (2 vCPU) se descartó a propósito: 1 vCPU ya sostiene el ' +
    'pico de 2000 conductores con margen, y el tier a 600/2000 lo decide la regla de RAM/working-set y el piso ' +
    'de producción (§9.2/§9.3 del plan), no la capacidad de escritura — por eso las cifras en dólares de este ' +
    'documento no cambian.',
);
p();
p('### 7.6 Sensibilidad del multiplicador de RAM (3×/4×/5×) — hallazgo 2 de revisión (2026-09-22)');
p();
p(
  `El multiplicador de RAM (\`RAM_MULTIPLICADOR_WORKING_SET = ${RAM_MULTIPLICADOR_WORKING_SET}\`, §7.2 regla 2) ` +
    'es una heurística DECLARADA, no medida contra un working set real de Postgres (§7.1 sí mide el techo de ' +
    `escritura con la prueba de carga; esto no). \`ramRequeridaWorkingSetGiB\`/\`elegirTierSqlMedido\` aceptan el ` +
    'multiplicador como parámetro — la tabla de abajo recorre ' +
    `${MULTIPLICADORES_RAM_SENSIBILIDAD.join('×, ')}× programáticamente (\`calcularEscalon(..., { ` +
    'ramMultiplicadorWorkingSet })`) para 600 y 2000 conductores, ambas cadencias de captura (15 m y 30 m) y ' +
    'ambas arquitecturas, en vez de afirmar en prosa si el tier cambia.',
);
p();
{
  const filasSensibilidad = [];
  for (const n of [600, 2000]) {
    for (const [cadencia, supuestos] of [['15 m', SUPUESTOS_MEDIDOS], ['30 m', SUPUESTOS_MEDIDOS_30M]]) {
      for (const arquitectura of ARQUITECTURAS) {
        const filas = sensibilidadRam(n, arquitectura, supuestos);
        const tierCambia = new Set(filas.map((f) => f.tierSql)).size > 1;
        for (const f of filas) {
          filasSensibilidad.push([
            String(n),
            cadencia,
            NOMBRE_ARQUITECTURA[arquitectura],
            `${f.multiplicador}×`,
            `\`${f.tierSql}\`${f.tierSqlExtrapolado ? ' *' : ''}`,
            f.reglaTierMedido,
            usdCorto(f.total),
            f.multiplicador === MULTIPLICADORES_RAM_SENSIBILIDAD[MULTIPLICADORES_RAM_SENSIBILIDAD.length - 1]
              ? (tierCambia ? '← tier CAMBIA en este grupo' : '← tier estable en este grupo')
              : '',
          ]);
        }
      }
    }
  }
  p(
    tabla(
      ['n', 'Cadencia', 'Arquitectura', 'Multiplicador', 'Tier', 'Regla', 'Total/mes', ''],
      filasSensibilidad,
      ['right', 'left', 'left', 'right', 'left', 'left', 'right', 'left'],
    ),
  );
  p();
  p(
    '\\* Tier extrapolado (§7.1/§7.5: capacidades de 4 vCPU o más sin prueba de carga real — el multiplicador de ' +
      'RAM, al empujar hacia esos tiers, empuja hacia territorio no probado con más frecuencia que la regla de ' +
      'escritura sola).',
  );
}
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 8. Prerequisito: N+1 del mapa en vivo
// ---------------------------------------------------------------------------

p('## 8. Prerequisito: N+1 del mapa en vivo (`listarHoy`/`obtenerPosiciones`) — RESUELTO');
p();
p(
  '**Estado (hallazgo 4 de revisión, 2026-09-22): DONE.** El N+1 que motivó esta sección quedó corregido en ' +
    '`perf/en-vivo-resumen-sesion` (PR #74, mergeado a `main`, `docs/handoff.md`) con la tabla nueva ' +
    '`gps_sesion_resumen` — el worker la mantiene en el MISMO statement que inserta `gps_points` (CTE ' +
    '`INSERT ... RETURNING` + upsert, ver `apps/api/src/modules/ingesta-worker/ingesta-worker.service.ts`, ' +
    'función `insertarGpsPoints`), y `listarHoy`/`obtenerPosiciones` ' +
    '(`apps/api/src/modules/reportes/en-vivo.service.ts`) leen `gps_sesion_resumen` en vez de agregar ' +
    '`gps_points` por sesión — el costo pasa de O(puntos del día de la flota) a O(sesiones visibles).',
);
p();
p(
  '**Medición local (EXPLAIN ANALYZE, 1.000 sesiones / 6,7 M filas, `docs/handoff.md`):** `listarHoy` ' +
    '**53 s → 62 ms**, `obtenerPosiciones` **53 s → 72 ms**. El objetivo de <50 ms no se alcanzó — el resto del ' +
    'costo es el join de sesiones/vehículos/rutas, fuera de este cambio. Estas cifras SON las que ' +
    '`scripts/experimentos/gps/carga/resultados/resumen.md` reportaba como el problema (ahí con otra base ' +
    'precargada, ~10 s en vez de 53 s — mismo patrón N+1, volumen de datos distinto).',
);
p();
p(
  '`listarHoy` lo consume la web cada 30 s por pestaña abierta ' +
    '(`apps/web/src/lib/en-vivo/use-en-vivo.ts:34`, `refetchInterval: 30_000`). `obtenerPosiciones` sigue sin ' +
    'consumidor en `apps/web` (`grep -rn "obtenerPosiciones" apps/` solo encuentra el service y el controller) ' +
    '— es un riesgo latente resuelto por adelantado, no un costo actual, hasta que algo lo conecte a un mapa de ' +
    'flota.',
);
p();
p(
  '**Paso manual obligatorio tras el deploy a producción (`docs/runbooks/retencion-gps.md`, sección ' +
    '"`gps_sesion_resumen` — recompute obligatorio"):** correr UNA VEZ el recompute completo desde `gps_points` ' +
    'cuando el worker nuevo (el que escribe `gps_sesion_resumen`) esté vivo — cubre los puntos que ingirieron ' +
    'instancias del worker VIEJO entre que corrió el backfill de la migración y que terminó el rollout. Sin ' +
    'este paso, el resumen de esa ventana de gap queda desactualizado hasta que el próximo lote de cada ' +
    'dispositivo lo "arrastre" al valor correcto (puede tardar minutos u horas, y una sesión ya terminada puede ' +
    'quedar corta para siempre).',
);
p();
p(
  'Este documento (§4-§7) YA asume el fix aplicado — `SQL_TIERS_MEDIDOS` y las cifras de escritura de §7 son ' +
    'sobre la escritura pura del worker, que sigue siendo el mismo costo con o sin este fix (el CTE agrega el ' +
    'upsert a `gps_sesion_resumen` al mismo INSERT, no una segunda escritura — ver `generador.mjs` del harness, ' +
    'que replica esa SQL completa desde el hallazgo 5 de revisión).',
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 9. Dimensionamiento anterior (descartado) — referencia histórica
// ---------------------------------------------------------------------------

p('## 9. Dimensionamiento anterior (descartado) — referencia histórica');
p();
p(
  '**Este dimensionamiento quedó DESCARTADO el 2026-09-22** al recalibrar con la prueba de carga real (§7): ' +
    'usaba `SQL_TIERS` (criterio de agosto, escritura pico SIN medición de capacidad) también para la ' +
    'proyección con supuestos MEDIDOS — el mismo código que hoy solo sobrevive para el test de regresión ' +
    'contra agosto. Se reproduce acá con `calcularEscalon(..., { forzarTierAgosto: true })` (mismo módulo, ' +
    'nada escrito a mano) para dejar la comparación citable.',
);
p();
{
  const filas = [];
  const descartadoTxtPorN = {};
  for (const arquitectura of ARQUITECTURAS) {
    for (const n of [600, 2000]) {
      const r = calcularEscalon(n, { arquitectura, escenario: 'A', supuestos: SUPUESTOS_MEDIDOS, forzarTierAgosto: true });
      const rango = rangoBorde(r);
      const txt = rango ? `${usdCorto(rango.lo)}–${usdCorto(rango.hi)}` : usdCorto(r.total);
      filas.push([
        NOMBRE_ARQUITECTURA[arquitectura],
        String(n),
        `\`${r.tierSql}\`${r.tierSqlExtrapolado ? ' (extrapolado)' : ''}`,
        rango ? `${txt} †` : txt,
      ]);
      if (arquitectura === 'actual') {
        descartadoTxtPorN[n] = rango ? `${usd(rango.lo)}–${usd(rango.hi)}` : usd(r.total);
      }
    }
  }
  p(tabla(['Arquitectura', 'Conductores', 'Tier (SQL_TIERS, agosto)', 'Total/mes (descartado)'], filas, ['left', 'right', 'left', 'right']));
  p();
  p(
    // Hallazgo 3 de revisión (2026-09-22): las cifras de esta oración salen de la tabla de
    // ARRIBA (misma corrida, `calcularEscalon(..., { forzarTierAgosto: true })`), no de una
    // cita hand-typed — antes decía "US$1.402,83" / "US$2.926,66–US$5.135,35" a mano, que
    // podía divergir de la tabla si el modelo cambiaba y nadie actualizaba la prosa.
    `Estas son las cifras que este documento publicó antes de la recalibración (arquitectura actual: 600 → ` +
      `${descartadoTxtPorN[600]} / 2000 → ${descartadoTxtPorN[2000]} — mismos números de la tabla de arriba, ` +
      `citados también en \`docs/plan-experimento-puntos-gps.md\` §7). La diferencia frente a §1/§4 es ` +
      `el hallazgo del paso B del experimento (plan §8): la escritura sola no necesita ese tier — el pico de ` +
      `2000 conductores (${N2000_ACTUAL_15M.ptsPorSegundo.toFixed(1)} pts/s) entra en \`db-custom-1-3840\`, ` +
      `${calificativoMargenVsTecho(N2000_ACTUAL_15M.ptsPorSegundo, 'db-custom-1-3840')}. \`SQL_TIERS\` estaba ` +
      `sobredimensionado por no tener una prueba de carga real detrás.`,
  );
}
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 10. Sensibilidad de edge cases
// ---------------------------------------------------------------------------

p('## 10. Sensibilidad — edge cases (plan-costos-2000 §4.3, n=600, escenario A, arquitectura actual, captura 15 m)');
p();
{
  const base = calcularEscalon(600, { arquitectura: 'actual', escenario: 'A', supuestos: SUPUESTOS_MEDIDOS });
  const variantes = [
    ['Base (6 vueltas, jornada derivada, bytes medidos, sin HA, Santiago)', {}],
    ['Vueltas diarias: 3 (piso)', { vueltasDiarias: 3 }],
    ['Jornada operativa: 14 h (en vez de 10 h)', { jornadaHoras: 14 }],
    ['Ancho de fila con bloat: 350 B (por debajo de los ' + SUPUESTOS_MEDIDOS.bytesPorPunto + ' B medidos)', { bytesPorPuntoOverride: 350 }],
    ['Ancho de fila con bloat: 480 B (por encima de los ' + SUPUESTOS_MEDIDOS.bytesPorPunto + ' B medidos)', { bytesPorPuntoOverride: 480 }],
    ['Alta disponibilidad regional en Cloud SQL: sí', { haCloudSql: true }],
  ];
  const filas = variantes.map(([nombre, edgeCases]) => {
    const r = calcularEscalon(600, { arquitectura: 'actual', escenario: 'A', supuestos: SUPUESTOS_MEDIDOS, edgeCases });
    const delta = ((r.total - base.total) / base.total) * 100;
    return [nombre, usdCorto(r.total), nombre === variantes[0][0] ? '—' : pct(delta)];
  });
  p(tabla(['Variante', 'Total/mes', 'Δ vs. base'], filas, ['left', 'right', 'right']));
}
p();
p(
  'Nota: los edge cases de "3 vueltas" y "jornada 14h" no son independientes — el modelo deriva la jornada ' +
    'de las vueltas diarias salvo que se fuerce explícitamente (`jornadaHoras` distinto de `null` en ' +
    '`EDGE_CASES_DEFAULT`), por eso se muestran por separado. Los dos casos de ancho de fila (350 B y 480 B) ' +
    'acotan el riesgo real: §12 advierte que los 365,6 B medidos vienen de una muestra chica sin `VACUUM FULL` ' +
    'ni `ANALYZE`, así que el número real en régimen puede ser MAYOR, no solo menor.',
);
p();
p(
  '**Nota sobre región (eliminada de esta tabla):** una versión anterior de este modelo incluía un edge case ' +
    '`region: us-central1` que aplicaba los descuentos citados de §6 (×0,6 Cloud SQL cómputo, ×0,8 Cloud Run) ' +
    'pero NO tocaba disco/backup de Cloud SQL, Redis ni el VPC connector (nunca recibían el parámetro), y ' +
    'encima multiplicaba el egreso ×0,9 con un factor inventado sin cita. Ese híbrido subestimaba el ahorro ' +
    'real (PD-SSD y Memorystore SÍ son más baratos en us-central1) y a la vez inventaba un número donde no ' +
    'había fuente. Se eliminó el edge case completo: inventar el resto de los factores para "completarlo" es ' +
    'peor que no tener la fila. Reintroducirlo requiere relevar precios de us-central1 con `gcloud`/lista de ' +
    'precios para cada línea, no solo para cómputo.',
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 11. Calibración y residuos — qué no es reproducible del doc de agosto
// ---------------------------------------------------------------------------

p('## 11. Qué partes del documento de agosto NO son reproducibles');
p();
p(
  '`costos-gcp-por-escala.md` publicó totales y desgloses por servicio, pero no la fórmula interna que los ' +
    'genera. Reconstruir esa fórmula (obligatorio para extender la tabla a 2000, que agosto no cubre) expone ' +
    'tres puntos donde el documento de agosto no es reproducible con un modelo de parámetros explícitos:',
);
p();
p('### 11.0 Residuo de TOTAL — los 18 puntos de referencia completos');
p();
{
  const residuosTotal = residuosTotalAgosto();
  const filas = residuosTotal.map((r) => [
    NOMBRE_ARQUITECTURA[r.arquitectura],
    String(r.n),
    usdCorto(r.modelo),
    usdCorto(r.publicado),
    pct(r.diffPct),
  ]);
  p(
    tabla(
      ['Arquitectura', 'Conductores', 'Modelo', 'Doc. agosto', 'Diferencia (%)'],
      filas,
      ['left', 'right', 'right', 'right', 'right'],
    ),
  );
  const dentro5Total = residuosTotal.filter((r) => Math.abs(r.diffPct) <= 5).length;
  const dentro15Total = residuosTotal.filter((r) => Math.abs(r.diffPct) <= 15).length;
  p();
  p(
    `De 18 puntos, ${dentro5Total} caen dentro de ±5% en el TOTAL (el criterio objetivo del plan §13.4) y ` +
      `${dentro15Total} dentro de ±15% (la falla dura del test de regresión). El error en el TOTAL es menor ` +
      `que el error en la columna "API" sola (§11.1) porque el resto de las líneas — Cloud SQL, Redis, ` +
      'worker, VPC/GCS, Artifact Registry, egreso — sí se reproducen dentro de tolerancia y son la mayor ' +
      'parte de la factura. Nota: este residuo se calcula SIEMPRE contra `SQL_TIERS` (agosto) — es el test de ' +
      'regresión, no cambia con la recalibración de §7.',
  );
}
p();
p('### 11.1 La columna "API" no es reproducible con un parámetro global');
p();
{
  const residuos = residuosApiAgosto();
  const filas = residuos.map((r) => [
    NOMBRE_ARQUITECTURA[r.arquitectura],
    String(r.n),
    usdCorto(r.modelo),
    usdCorto(r.publicado),
    usdCorto(r.diffAbs),
    Number.isFinite(r.diffPct) ? pct(r.diffPct) : 'n/a',
  ]);
  p(
    tabla(
      ['Arquitectura', 'Conductores', 'Modelo', 'Doc. agosto', 'Diferencia (USD)', 'Diferencia (%)'],
      filas,
      ['left', 'right', 'right', 'right', 'right', 'right'],
    ),
  );
  const peor = residuos.reduce((a, b) => (Math.abs(b.diffPct) > Math.abs(a.diffPct) ? b : a));
  const dentro5 = residuos.filter((r) => Math.abs(r.diffPct) <= 5).length;
  const activoActual600 = REFERENCIA_AGOSTO_API.actual[600] - IDLE_API_MENSUAL;
  const activoOptimizada600 = REFERENCIA_AGOSTO_API.optimizada[600];
  const ratioCiclos = SUPUESTOS_AGOSTO.cicloSyncSegOptimizada / SUPUESTOS_AGOSTO.cicloSyncSegActual;
  p();
  p(
    `De 18 puntos de referencia, ${dentro5} caen dentro de ±5% con un único parámetro calibrado por ` +
      `mínimos cuadrados (\`CPU_SEG_POR_REQUEST_API = ${CPU_SEG_POR_REQUEST_API.toFixed(6)}\`). El peor caso ` +
      `es ${NOMBRE_ARQUITECTURA[peor.arquitectura].toLowerCase()} con ${peor.n} conductores: modelo ` +
      `${usdCorto(peor.modelo)} contra ${usdCorto(peor.publicado)} publicado (${pct(peor.diffPct)}).`,
  );
  p();
  p(
    '**Por qué no cierra:** si el costo activo de API dependiera solo de `requests × constante`, la ' +
      `arquitectura "actual" (ciclo de sync ${SUPUESTOS_AGOSTO.cicloSyncSegActual}s) debería costar ` +
      `~${ratioCiclos.toFixed(0)}× lo que la "optimizada" (ciclo ${SUPUESTOS_AGOSTO.cicloSyncSegOptimizada}s) al ` +
      `mismo n, porque genera ${ratioCiclos.toFixed(0)}× más requests. Los números publicados NO muestran esa ` +
      `proporción — a 600 conductores el costo activo real (columna "API" de agosto, ya sin el idle en el caso ` +
      `"actual") es prácticamente el mismo entre arquitecturas (${usdCorto(activoActual600)} actual vs ` +
      `${usdCorto(activoOptimizada600)} optimizada). Eso implica que la columna ` +
      '"API" de agosto agrega algo más que `requests × vCPU-s/request` — probablemente un componente fijo o ' +
      'un supuesto de CPU boost/cold start no documentado en el propio §4-§6 del documento de agosto. **No se ' +
      'puede reproducir con un modelo de un solo parámetro porque el documento de origen no publicó la ' +
      'fórmula completa, solo el resultado.**',
  );
}
p();
p(`### 11.2 El crecimiento de disco por conductor de agosto no se reproduce desde el DDL`);
p();
{
  const bytesPorPuntoAgosto = SUPUESTOS_AGOSTO.bytesPorPunto;
  const puntosPorDiaAgosto = SUPUESTOS_AGOSTO.puntosPorConductorDiaPorVueltas[6];
  const diasAgosto = SUPUESTOS_AGOSTO.diasOperativosMes;
  const mesesAgosto = SUPUESTOS_AGOSTO.mesesRetencionCaliente;
  const reproducidoMiB = ((bytesPorPuntoAgosto * puntosPorDiaAgosto * diasAgosto * mesesAgosto) / 1024 ** 3) * 1024;
  const publicadoMiB = SUPUESTOS_AGOSTO.crecimientoGiBPorConductor * 1024;
  p(
    `Documentado ya en el propio código del modelo (\`SUPUESTOS_AGOSTO.crecimientoGiBPorConductor\`, ` +
      `\`scripts/costos/modelo-costos.mjs\`): reproducir \`bytesPorPunto × puntos/día × días × meses\` desde ` +
      `cero con los supuestos citados de agosto (${bytesPorPuntoAgosto} B, ${puntosPorDiaAgosto} pts/día, ` +
      `${diasAgosto} días, ${mesesAgosto} meses) da ~${reproducidoMiB.toFixed(1)} MiB, no los ` +
      `${publicadoMiB.toFixed(1)} MB que agosto publicó ("121,7 MB por conductor", §3.4 del doc de agosto). ` +
      `El documento de agosto nunca mostró la fórmula completa detrás de esa cifra — probablemente incluye ` +
      `overhead de bloat/fill-factor no desglosado. Este modelo usa el valor publicado tal cual (citado, no ` +
      `derivado) para no perder la reproducción del caso base.`,
  );
}
p();
p('### 11.3 El dimensionamiento de Cloud SQL y de `quivo-worker` son tablas, no fórmulas');
p();
p(
  'Agosto documentó saltos de tier y de instancias de worker como resultado ("100 conductores → ' +
    '`db-custom-1-3840`"), no como una fórmula derivable de primeros principios. El chairman confirmó esto ' +
    'en el plan-costos-2000 §13.1/§13.2: no hay una ecuación que reproduzca los saltos sin fijar constantes de ' +
    'calibración (el factor pico/promedio de 1,485, el umbral de requests/día de los workers). Ambos quedan ' +
    'modelados como tablas explícitas en `modelo-costos.mjs` (`SQL_TIERS`, `UMBRALES_INSTANCIAS_WORKER_REQ_DIA`), ' +
    'no como fórmulas de un parámetro. El mismo criterio se repite en `SQL_TIERS_MEDIDOS` (§7): tabla ' +
    'explícita, no fórmula, esta vez calibrada contra una prueba de carga real en vez de contra un documento ' +
    'publicado sin desglosar.',
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 12. Límites de la medición de carga de producción que alimenta este documento
// ---------------------------------------------------------------------------

p('## 12. Límites de la medición de carga de producción (plan-costos-2000 §12.4)');
p();
p(
  'Los supuestos MEDIDOS que arman las tablas de §4-§6 vienen de una sola medición contra ' +
    '`quivo-control-prod`, ejecutada el 2026-09-20 — DISTINTA de la prueba de carga local de Postgres de §7 ' +
    '(esa es del 22 de septiembre, no contra Cloud SQL). **Este documento no puede presentar esos números ' +
    'como más firmes de lo que son:**',
);
p();
p(
  `- **n = 1 en la métrica que más pesa.** De 8 sesiones registradas, solo UNA (${SUPUESTOS_MEDIDOS.puntosPorConductorDia} ` +
    'puntos extrapolados desde una jornada de 8,7 h) es una jornada real completa. Las otras siete van de 2 a ' +
    '625 puntos: pruebas, no operación. La misma sesión es la fuente de `SUPUESTOS_MEDIDOS_30M` (§5, plan §7).',
);
p('- **Dos días de datos:** 2026-09-09 y 2026-09-10. Nada más.');
p(
  '- **La base no recibe datos desde el 2026-09-11** (piloto detenido). No hay forma de saber si esa ' +
    'jornada es representativa de la operación en régimen.',
);
p(
  '- **No hay comparación pre/post en la misma base.** El proyecto GCP se recreó el 2026-09-08; los datos ' +
    'del período anterior (81-103 m entre puntos) vienen del proyecto borrado, no de esta base.',
);
p(
  `- **Los ${SUPUESTOS_MEDIDOS.bytesPorPunto} B/punto** se midieron sobre una muestra chica de filas, sin ` +
    '`VACUUM FULL` ni estado estable, y `reltuples` devolvió `-1` en casi todas las particiones (nunca ' +
    'corrió `ANALYZE`). El número en régimen puede diferir. (Distinto del `BYTES_INDICE_POR_FILA_MEDIDO` de ' +
    '§7.3, que SÍ corrió `ANALYZE` antes de medir, sobre datos sintéticos de la prueba de carga, no de prod.)',
);
p();
p(
  '**Consecuencia directa para las cifras de §4-§6:** son la mejor proyección disponible hoy, no una ' +
    'facturación observada ni una medición en régimen. El piloto múltiple de usuarios (ClickUp `86e329ub0`) ' +
    'o una corrida de `tests/load/k6/` contra `quivo-control-prod` son las dos vías para reemplazar esta ' +
    'proyección por datos reales.',
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 13. Supuestos tomados por cuenta propia
// ---------------------------------------------------------------------------

p('## 13. Supuestos tomados por cuenta propia en esta implementación');
p();
p(
  `- **Escenario C (factor de concurrencia ${ESCENARIOS.C.factorConcurrencia}):** el plan-costos-2000 §4.2 ` +
    'deja este factor explícitamente "a derivar", sin dato de utilización diaria real de la flota. Se tomó ' +
    '0,35 como supuesto de producto (fracción de actividad diaria típica en flotas rotativas con turnos), NO ' +
    'VERIFICADO.',
);
p(
  '- **Extrapolación de tiers de Cloud SQL más allá de 600 conductores (`SQL_TIERS`, histórico):** duplicar ' +
    'vCPU/RAM cada vez que se duplica el techo de pts/s, siguiendo el mismo patrón que agosto usó hasta 600. ' +
    'Sin prueba de carga que confirme que un solo nodo sostiene esa capacidad.',
);
p(
  '- **Extrapolación de `SQL_TIERS_MEDIDOS` más allá de 4 vCPU (§7):** mismo patrón de duplicación del techo ' +
    'de escritura (3.000 → 6.000 → 12.000 → 24.000 pts/s), sin evidencia — los perfiles `c4`/`c8` no ' +
    'corrieron en la prueba de carga (RAM del host). Con los escalones de este documento (hasta 2000 ' +
    'conductores) esta extrapolación no llega a pesar: la regla de escritura nunca gana por encima de 600 ' +
    'trufis efectivos en ninguno de los escenarios/arquitecturas calculados — gana RAM o el piso.',
);
p(
  '- **"Flota" de la regla de memoria = `nEfectivo`, no `n` nominal (§7.2):** el plan §9.2 no distingue las ' +
    'dos cantidades. Se tomó `nEfectivo` por consistencia con el resto del modelo (API, worker, escritura ' +
    'pico ya usan `nEfectivo` como "carga de un día dado bajo el escenario elegido").',
);
p(
  '- **`forzarTierAgosto` (opción nueva de `calcularEscalon`):** mecanismo para reproducir en §9 el ' +
    'dimensionamiento histórico sin duplicar la fórmula de costo a mano — reutiliza el mismo módulo, no ' +
    'escribe las cifras de §9 a mano.',
);
p(
  '- **Extrapolación de umbrales de `quivo-worker` más allá de 600 conductores:** duplicar el umbral de ' +
    'requests/día en cada salto de instancia, anclado en el salto real de agosto (400→500 conductores).',
);
{
  const { usd: critUsd, relativo: critRelativo } = COMPARACION_CALIBRACION_API;
  const peorPct = ((critRelativo.errorAbsolutoTotalUsd - critUsd.errorAbsolutoTotalUsd) / critUsd.errorAbsolutoTotalUsd) * 100;
  p(
    '- **Calibración de `CPU_SEG_POR_REQUEST_API` por mínimos cuadrados en USD** (no en % relativo) sobre los ' +
      '18 puntos de referencia. Se probó también minimizar el error relativo (%) — comparación real, no una ' +
      `afirmación sin verificar: mínimos cuadrados en USD da \`c = ${critUsd.c.toFixed(6)}\` con un error ` +
      `absoluto total de ${usdCorto(critUsd.errorAbsolutoTotalUsd)} sobre los 18 puntos; minimizar el error ` +
      `relativo da \`c = ${critRelativo.c.toFixed(6)}\` con un error absoluto total de ` +
      `${usdCorto(critRelativo.errorAbsolutoTotalUsd)} — ${peorPct.toFixed(1)}% PEOR en USD, no mejor. Ambos ` +
      'métodos dejan una parte de la columna "API" sin reproducir (§11.1); se optó por mínimos cuadrados en USD ' +
      'porque además de ganar en error absoluto total, es el criterio estándar y no se distorsiona por los ' +
      'escalones de "optimizada" con costo publicado cercano a cero (donde el error relativo queda indefinido ' +
      'y se excluye de esa suma, sesgando ese criterio hacia los escalones de "actual").',
  );
}
p(
  '- **Tolerancia del test de regresión:** ±5% como objetivo (informativo), ±15% como falla dura, sobre ' +
    'los 18 puntos de referencia de agosto (9 escalones × 2 arquitecturas) — no solo los 4 escalones ' +
    '(10/100/300/600) que cubría el intento anterior. Plan-costos-2000 §13.4. Este test sigue usando ' +
    '`SQL_TIERS` (agosto) exclusivamente, sin tocar — la recalibración de §7 no lo afecta.',
);
p(
  '- **Escenario "optimizada" en la proyección a 2000 asume que las seis palancas de agosto SÍ están ' +
    'aplicadas** (ciclo de sync 60s, min-instances=0, Redis propio, etc.), aunque el plan-costos-2000 §9.3 ' +
    'confirma que ninguna lo está hoy en `quivo-control-prod`. Es un objetivo, no el estado real — se marca ' +
    'explícitamente en este párrafo porque no hay otro lugar natural en las tablas de arriba para esa ' +
    'advertencia.',
);
p(
  '- **Desglose por servicio (§6) para las dos cadencias (15 m y 30 m):** el encargo lo pedía junto a la ' +
    'escalera de ambas cadencias en la misma frase; se interpretó como "ambas", no solo la de 15 m.',
);
p();
p('---');
p();
p(
  `_Generado automáticamente por \`scripts/costos/generar-tablas.mjs\` a partir de ` +
    `\`scripts/costos/modelo-costos.mjs\`. Base de horas: ${HORAS_MES} h/mes. Para reproducir: ` +
    '`node scripts/costos/generar-tablas.mjs > docs/costos-gcp-2000.md`._',
);

process.stdout.write(lines.join('\n') + '\n');
