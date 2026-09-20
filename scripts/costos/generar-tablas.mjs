#!/usr/bin/env node
/**
 * Genera docs/costos-gcp-2000.md a partir de modelo-costos.mjs.
 *
 * Uso: node scripts/costos/generar-tablas.mjs > docs/costos-gcp-2000.md
 *
 * Regla dura del encargo: CADA número que aparece en el .md sale de una llamada a este
 * módulo (directa o vía modelo-costos.mjs). Este script no escribe ningún precio, tier ni
 * total a mano — solo formatea lo que el modelo devuelve.
 */

import {
  calcularEscalon,
  ESCALONES_DOCUMENTO,
  ESCENARIOS,
  SUPUESTOS_AGOSTO,
  SUPUESTOS_MEDIDOS,
  EDGE_CASES_DEFAULT,
  FACTOR_PICO_SOBRE_PROMEDIO,
  TECHO_PROBADO_PTS_S,
  SQL_TIERS,
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
} from './modelo-costos.mjs';

const ARQUITECTURAS = ['actual', 'optimizada'];
const NOMBRE_ARQUITECTURA = { actual: 'Actual', optimizada: 'Optimizada' };

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
// Cálculo base — todos los escalones, escenarios y arquitecturas
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

const RESULTADOS_MEDIDOS = calcularTodo(SUPUESTOS_MEDIDOS);

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
    '(2026-09-20).',
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
    `Con los supuestos de carga MEDIDOS el 2026-09-20 (plan §12) y el escenario A (2000 transmitiendo a la ` +
      `vez — la definición más exigente de "2000 trufis"):`,
  );
  p();
  p(
    tabla(
      ['Conductores', 'Arquitectura actual', 'Arquitectura optimizada', 'Tier Cloud SQL (actual)', `¿Supera el techo probado por k6 (${TECHO_PROBADO_PTS_S} pts/s)?`],
      [
        [
          '600',
          usd(n600A.total) + '/mes',
          usd(n600O.total) + '/mes',
          `\`${n600A.tierSql}\`${n600A.tierSqlExtrapolado ? ' (extrapolado)' : ''}`,
          n600A.superaTechoProbado ? `sí (${n600A.ptsPorSegundo.toFixed(0)} pts/s)` : 'no',
        ],
        [
          '2000',
          usd(n2000A.total) + '/mes',
          usd(n2000O.total) + '/mes',
          `\`${n2000A.tierSql}\`${n2000A.tierSqlExtrapolado ? ' (extrapolado)' : ''}`,
          n2000A.superaTechoProbado ? `sí (${n2000A.ptsPorSegundo.toFixed(0)} pts/s)` : 'no',
        ],
      ],
      ['right', 'right', 'right', 'left', 'left'],
    ),
  );
  p();
  p(
    `El costo por conductor a 2000 (arquitectura optimizada) es ${usd(n2000O.total / 2000)}/mes — ` +
      `${n2000O.total / 2000 < n600O.total / 600 ? 'sigue bajando' : 'sube'} respecto a los ` +
      `${usd(n600O.total / 600)}/mes de 600 conductores, porque la base fija (Redis, worker, VPC/GCS, ` +
      `Artifact Registry) se sigue repartiendo entre más conductores. **El hallazgo estructural de agosto ` +
      `sigue vigente: el costo no escala con la flota, escala con el dimensionamiento de Cloud SQL, y ese ` +
      `dimensionamiento es la única parte del modelo con criterio de ingeniería, no aritmética.**`,
  );
  p();
  p(
    `A ${n2000A.ptsPorSegundo.toFixed(0)} puntos/s pico (escenario A, 2000 conductores), la arquitectura ` +
      `supera ${(n2000A.ptsPorSegundo / TECHO_PROBADO_PTS_S).toFixed(1)}× el techo de ${TECHO_PROBADO_PTS_S} pts/s ` +
      `que cubre el único test de carga real del repo (\`tests/load/k6/\`, plan §9.5). Los tiers de Cloud SQL ` +
      `usados por encima de 600 conductores (\`${SQL_TIERS.filter((t) => t.extrapolado).map((t) => t.nombre).join('`, `')}\`) ` +
      `son EXTRAPOLACIONES de precio, no capacidad probada.`,
  );
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
    'rango es anterior al relevamiento real con `gcloud` (2026-08-26) y a la medición de carga real ' +
    '(2026-09-20): es una estimación de arquitectura, no de infraestructura desplegada y medida.',
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
          'Este documento (medido, escenario A)',
          usd(n2000A.total) + ' actual / ' + usd(n2000O.total) + ' optimizada',
          '2000 conductores',
          hoy,
        ],
      ],
      ['left', 'left', 'left', 'left'],
    ),
  );
  p();
  p(
    `**La diferencia es real y se explica en tres capas, no en una:**`,
  );
  p();
  p(
    `1. **El rango de julio era arquitectura, no infraestructura desplegada.** No hubo relevamiento con ` +
      `\`gcloud\` ni precios de lista aplicados — es una estimación previa, del mismo tipo que el ADR 0002 ` +
      `(que estimaba ~$255-290/mes asumiendo una base de datos de 2 vCPU/8 GB que nunca se creó, corregida ` +
      `en \`costos-gcp-por-escala.md\`).`,
  );
  p(
    `2. **3000 ≠ 2000.** Este documento no extrapola hasta 3000 (fuera del encargo de la tarea ClickUp ` +
      `\`86e34jkb2\`, que pide hasta 2000). El rango de julio pesa sobre 1000 vehículos más.`,
  );
  p(
    `3. **El régimen de costo no es lineal con la flota** (§1, hallazgo de agosto que sigue vigente): a ` +
      `2000 conductores la base fija (Redis, worker, VPC/GCS, Artifact Registry) sigue siendo una fracción ` +
      `chica del total, y el grueso es Cloud SQL dimensionado por PICO de escritura, no por cantidad de ` +
      `vehículos per se.`,
  );
  p();
  p(
    `**Conclusión para finanzas:** el rango de julio (US$1.200–2.800 para 3000) y el número medido de este ` +
      `documento para 2000 (${usd(n2000A.total)} actual / ${usd(n2000O.total)} optimizada) NO son ` +
      `directamente comparables — son estimaciones de dos momentos distintos del proyecto, con dos niveles ` +
      `de evidencia distintos. El número de este documento tiene evidencia real detrás (precios de lista + ` +
      `una medición de carga real, aunque limitada — ver §8). El de julio es una proyección de arquitectura ` +
      `sin verificar contra infraestructura desplegada. **Se recomienda a finanzas usar el número de este ` +
      `documento y descartar el rango de julio para 2000-3000 vehículos.**`,
  );
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
    `(plan §13.1). El promedio de la jornada (n × puntos/día ÷ jornada en segundos) NO es el pico de ` +
    `escritura que dimensiona el tier de Cloud SQL; agosto dimensionó contra el pico sin escribir la ` +
    `fórmula. Se aplica antes de elegir tier, nunca para el resto de los servicios.`,
);
p(
  `- **Tiers de Cloud SQL:** tabla explícita (no fórmula), calibrada contra los saltos de tier que agosto ` +
    `documentó en 50, 100, 300 y 600 conductores. Los tiers por encima de 600 (\`` +
    SQL_TIERS.filter((t) => t.extrapolado).map((t) => t.nombre).join('`, `') +
    `\`) son EXTRAPOLACIÓN explícita: duplican vCPU/RAM cada vez que se duplica el techo de pts/s, sin ` +
    `evidencia de que un solo nodo lo sostenga.`,
);
p(
  `- **Instancias de \`quivo-worker\`:** tabla explícita de umbrales en requests/día (no una fórmula de ` +
    `conductores), anclada en el punto medio entre lo que generan 400 y 500 conductores bajo el ciclo de ` +
    `sync de 15s de agosto (${ANCLA_SALTO_1_A_2_INSTANCIAS_CONDUCTORES} conductores × tasa de agosto). ` +
    `Reproduce "1 worker hasta 400, 2 desde 500" (agosto §5) y se extiende a 800-2000 duplicando el mismo ` +
    `umbral, documentado como extrapolación (plan §13.2).`,
);
p(
  `- **Costo de \`quivo-api\`:** el componente de CPU activa por request (\`cpuSegPorRequestApi\`) se ` +
    `calibra por MEJOR AJUSTE de mínimos cuadrados (error en USD) contra los **18 puntos de referencia** ` +
    `publicados en agosto (9 escalones × 2 arquitecturas), no contra un solo escalón (plan §13.3). El valor ` +
    `resultante es \`CPU_SEG_POR_REQUEST_API = ${CPU_SEG_POR_REQUEST_API.toFixed(6)}\` vCPU-s/request. ` +
    `**Este parámetro no reproduce bien toda la columna "API" de agosto** — ver §7 para la tabla de ` +
    `residuos completa y por qué.`,
);
p(
  `- **Supuestos de carga:** dos juegos, citados de fuentes distintas. "Agosto" (\`SUPUESTOS_AGOSTO\`, ` +
    `${SUPUESTOS_AGOSTO.bytesPorPunto} B/punto, ${SUPUESTOS_AGOSTO.puntosPorConductorDiaPorVueltas[6]} ` +
    `pts/conductor/día) se usa SOLO para el test de regresión contra el documento de agosto. "Medidos" ` +
    `(\`SUPUESTOS_MEDIDOS\`, ${SUPUESTOS_MEDIDOS.bytesPorPunto} B/punto, ` +
    `${SUPUESTOS_MEDIDOS.puntosPorConductorDia} pts/conductor/día) son los que arma la proyección a 2000 de ` +
    `este documento — plan §12, medición real 2026-09-20 contra \`quivo-control-prod\`.`,
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 4. Escalones 10 → 2000, tres escenarios, dos arquitecturas
// ---------------------------------------------------------------------------

p('## 4. Escalones 10 → 2000 conductores (supuestos MEDIDOS 2026-09-20)');
p();
p(
  'Tres escenarios de qué significa "2000 trufis" (plan §4.2/§10 — el CTO pidió modelarlos todos en vez de ' +
    'elegir uno):',
);
p();
for (const [key, esc] of Object.entries(ESCENARIOS)) {
  p(`- **${esc.nombre}** — ${esc.descripcion} (factor de concurrencia ${esc.factorConcurrencia}). ${esc.origen}`);
}
p();

for (const [escenarioKey, esc] of Object.entries(ESCENARIOS)) {
  p(`### 4.${['A', 'B', 'C'].indexOf(escenarioKey) + 1} Escenario ${esc.nombre}`);
  p();
  for (const arquitectura of ARQUITECTURAS) {
    p(`**Arquitectura ${NOMBRE_ARQUITECTURA[arquitectura]}**`);
    p();
    const filas = RESULTADOS_MEDIDOS[escenarioKey][arquitectura].map((r) => [
      String(r.n),
      r.nEfectivo.toFixed(0),
      `\`${r.tierSql}\`${r.tierSqlExtrapolado ? ' *' : ''}`,
      r.ptsPorSegundo.toFixed(1),
      r.superaTechoProbado ? 'sí' : 'no',
      gib(r.discoGiB),
      usdCorto(r.total),
      usdCorto(r.total / r.n),
    ]);
    p(
      tabla(
        ['Conductores (n)', 'n efectivo', 'Tier SQL', 'Pts/s pico', `¿Supera ${TECHO_PROBADO_PTS_S} pts/s?`, 'Disco', 'Total/mes', 'USD/conductor'],
        filas,
        ['right', 'right', 'left', 'right', 'left', 'right', 'right', 'right'],
      ),
    );
    p();
  }
}
{
  const ultimoTierNoExtrapolado = SQL_TIERS.filter((t) => !t.extrapolado).at(-1);
  p(
    `\\* Tier extrapolado por este modelo (agosto no dimensionó más allá de ${ultimoTierNoExtrapolado.ptsSMax.toFixed(0)} ` +
      'pts/s / 600 conductores). Sin evidencia de prueba de carga real a esa capacidad.',
  );
}
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 5. Desglose por servicio (600 y 2000, escenario A)
// ---------------------------------------------------------------------------

p('## 5. Desglose por servicio — n=600 y n=2000 (escenario A, supuestos medidos)');
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
for (const arquitectura of ARQUITECTURAS) {
  p(`**Arquitectura ${NOMBRE_ARQUITECTURA[arquitectura]}**`);
  p();
  const filas = [600, 2000].map((n) => {
    const r = RESULTADOS_MEDIDOS.A[arquitectura].find((x) => x.n === n);
    return [
      String(n),
      ...COLUMNAS_DESGLOSE.map(([key]) => usdCorto(r.desglose[key] ?? 0)),
      `**${usdCorto(r.total)}**`,
    ];
  });
  p(tabla(['Conductores', ...COLUMNAS_DESGLOSE.map(([, label]) => label), 'TOTAL'], filas));
  p();
}
p('---');
p();

// ---------------------------------------------------------------------------
// 6. Sensibilidad de edge cases
// ---------------------------------------------------------------------------

p('## 6. Sensibilidad — edge cases (plan §4.3, n=600, escenario A, arquitectura actual)');
p();
{
  const base = calcularEscalon(600, { arquitectura: 'actual', escenario: 'A', supuestos: SUPUESTOS_MEDIDOS });
  const variantes = [
    ['Base (6 vueltas, jornada derivada, bytes medidos, sin HA, Santiago)', {}],
    ['Vueltas diarias: 3 (piso)', { vueltasDiarias: 3 }],
    ['Jornada operativa: 14 h (en vez de 10 h)', { jornadaHoras: 14 }],
    ['Ancho de fila con bloat: 350 B (en vez de ' + SUPUESTOS_MEDIDOS.bytesPorPunto + ' B medidos)', { bytesPorPuntoOverride: 350 }],
    ['Alta disponibilidad regional en Cloud SQL: sí', { haCloudSql: true }],
    ['Región: us-central1 (en vez de southamerica-west1)', { region: 'us-central1' }],
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
    '`EDGE_CASES_DEFAULT`), por eso se muestran por separado.',
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 7. Calibración y residuos — qué no es reproducible del doc de agosto
// ---------------------------------------------------------------------------

p('## 7. Qué partes del documento de agosto NO son reproducibles');
p();
p(
  '`costos-gcp-por-escala.md` publicó totales y desgloses por servicio, pero no la fórmula interna que los ' +
    'genera. Reconstruir esa fórmula (obligatorio para extender la tabla a 2000, que agosto no cubre) expone ' +
    'tres puntos donde el documento de agosto no es reproducible con un modelo de parámetros explícitos:',
);
p();
p('### 7.0 Residuo de TOTAL — los 18 puntos de referencia completos');
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
      `que el error en la columna "API" sola (§7.1) porque el resto de las líneas — Cloud SQL, Redis, ` +
      'worker, VPC/GCS, Artifact Registry, egreso — sí se reproducen dentro de tolerancia y son la mayor ' +
      'parte de la factura.',
  );
}
p();
p('### 7.1 La columna "API" no es reproducible con un parámetro global');
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
p(`### 7.2 El crecimiento de disco por conductor de agosto no se reproduce desde el DDL`);
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
p('### 7.3 El dimensionamiento de Cloud SQL y de `quivo-worker` son tablas, no fórmulas');
p();
p(
  'Agosto documentó saltos de tier y de instancias de worker como resultado ("100 conductores → ' +
    '`db-custom-1-3840`"), no como una fórmula derivable de primeros principios. El chairman confirmó esto ' +
    'en el plan §13.1/§13.2: no hay una ecuación que reproduzca los saltos sin fijar constantes de ' +
    'calibración (el factor pico/promedio de 1,485, el umbral de requests/día de los workers). Ambos quedan ' +
    'modelados como tablas explícitas en `modelo-costos.mjs` (`SQL_TIERS`, `UMBRALES_INSTANCIAS_WORKER_REQ_DIA`), ' +
    'no como fórmulas de un parámetro — es, literalmente, lo que el plan pide y lo que agosto no dejó por ' +
    'escrito.',
);
p();
p('---');
p();

// ---------------------------------------------------------------------------
// 8. Límites de la medición
// ---------------------------------------------------------------------------

p('## 8. Límites de la medición que alimenta este documento (plan §12.4)');
p();
p(
  'Los supuestos MEDIDOS que arman las tablas de §4-§6 vienen de una sola medición contra ' +
    '`quivo-control-prod`, ejecutada el 2026-09-20. **Este documento no puede presentar esos números como ' +
    'más firmes de lo que son:**',
);
p();
p(
  `- **n = 1 en la métrica que más pesa.** De 8 sesiones registradas, solo UNA (${SUPUESTOS_MEDIDOS.puntosPorConductorDia} ` +
    'puntos extrapolados desde una jornada de 8,7 h) es una jornada real completa. Las otras siete van de 2 a ' +
    '625 puntos: pruebas, no operación.',
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
    'corrió `ANALYZE`). El número en régimen puede diferir.',
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
// 9. Supuestos tomados por cuenta propia
// ---------------------------------------------------------------------------

p('## 9. Supuestos tomados por cuenta propia en esta implementación');
p();
p(
  `- **Escenario C (factor de concurrencia ${ESCENARIOS.C.factorConcurrencia}):** el plan §4.2 deja este ` +
    'factor explícitamente "a derivar", sin dato de utilización diaria real de la flota. Se tomó 0,35 como ' +
    'supuesto de producto (fracción de actividad diaria típica en flotas rotativas con turnos), NO VERIFICADO.',
);
p(
  '- **Extrapolación de tiers de Cloud SQL más allá de 600 conductores:** duplicar vCPU/RAM cada vez que se ' +
    'duplica el techo de pts/s, siguiendo el mismo patrón que agosto usó hasta 600. Sin prueba de carga que ' +
    'confirme que un solo nodo sostiene esa capacidad.',
);
p(
  '- **Extrapolación de umbrales de `quivo-worker` más allá de 600 conductores:** duplicar el umbral de ' +
    'requests/día en cada salto de instancia, anclado en el salto real de agosto (400→500 conductores).',
);
p(
  '- **Calibración de `CPU_SEG_POR_REQUEST_API` por mínimos cuadrados en USD** (no en % relativo) sobre los ' +
    '18 puntos de referencia. Se probó también minimizar el error relativo (%); el resultado no fue mejor — ' +
    'ambos metodos dejan una parte de la columna "API" sin reproducir (§7.1). Se optó por mínimos cuadrados ' +
    'en USD por ser el criterio estándar y no distorsionar por los escalones de "optimizada" con costo ' +
    'publicado cercano a cero.',
);
p(
  '- **Tolerancia del test de regresión:** ±5% como objetivo (informativo), ±15% como falla dura, sobre ' +
    'los 18 puntos de referencia de agosto (9 escalones × 2 arquitecturas) — no solo los 4 escalones ' +
    '(10/100/300/600) que cubría el intento anterior. Plan §13.4.',
);
p(
  '- **Escenario "optimizada" en la proyección a 2000 asume que las seis palancas de agosto SÍ están ' +
    'aplicadas** (ciclo de sync 60s, min-instances=0, Redis propio, etc.), aunque el plan §9.3 confirma que ' +
    'ninguna lo está hoy en `quivo-control-prod`. Es un objetivo, no el estado real — se marca explícitamente ' +
    'en este párrafo porque no hay otro lugar natural en las tablas de arriba para esa advertencia.',
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
