/**
 * Modelo de costos GCP — QUIVO Control, escalera 10 → 2000 conductores.
 *
 * Fuentes de verdad (NO se inventa ningún precio unitario aquí):
 *   - docs/costos-gcp-por-escala.md (2026-08-26) — precios de lista, criterios de
 *     dimensionamiento, arquitectura actual y las seis palancas de optimización.
 *   - docs/plan-costos-2000.md §9-§12 — verificación 2026-09-20 contra el repo y
 *     la medición real de carga contra `quivo-control-prod`.
 *
 * Convención: todo cálculo que NO sea una cita directa de un precio o supuesto del
 * doc de agosto/plan está marcado como "CALIBRADO" o "EXTRAPOLADO" en su comentario,
 * indicando de qué anclas numéricas se derivó. El criterio pedido por la tarea es no
 * escribir tablas a mano: este módulo es la única fuente de los números del documento
 * generado (docs/costos-gcp-2000.md).
 *
 * Región: southamerica-west1 (Santiago, Tier 2 de GCP).
 */

// ---------------------------------------------------------------------------
// 1. Precios unitarios — todos citados de costos-gcp-por-escala.md §4
//    ("Precios aplicados (lista oficial, southamerica-west1, consultados 2026-08-26)")
// ---------------------------------------------------------------------------

export const REGION = 'southamerica-west1';

/** Base de horas usada en todo el doc de agosto — §5 "Base de horas: 730 h/mes". */
export const HORAS_MES = 730;

export const PRECIOS = Object.freeze({
  // Cloud Run request-based — §4
  cloudRunActivoVcpuSeg: 0.0000336, // CPU activa, $/vCPU-s
  cloudRunIdleVcpuSeg: 0.0000035, // CPU idle (min-instances), $/vCPU-s
  cloudRunMemGiBSeg: 0.0000035, // memoria, $/GiB-s
  cloudRunRequestsPorMillon: 0.4, // $/millón de requests

  // Cloud Run Worker Pools — §4
  workerPoolVcpuSeg: 0.000013493, // $/vCPU-s
  workerPoolMemGiBSeg: 0.000001482, // $/GiB-s

  // Cloud SQL — §4
  sqlEnterpriseVcpuHora: 0.0578, // $/vCPU-h (tiers db-custom-*)
  sqlEnterpriseRamGiBHora: 0.0098, // $/GiB-h (tiers db-custom-*)
  sqlG1SmallHora: 0.049, // $/h, tier shared-core db-g1-small
  sqlSsdGiBHora: 0.000326027, // $/GiB-h (≈ $0.238/GiB-mes)
  sqlBackupGiBHora: 0.000153425, // $/GiB-h (≈ $0.112/GiB-mes), backups + PITR

  // Memorystore Redis Basic M1 — §4
  redisBasicGiBHora: 0.07, // $/GiB-h

  // Redis propio en VM e2-micro (palanca B) — §6, tabla optimizada: $10.50/mes fijo
  // No hay un precio de lista citado en agosto para esto: el propio §6 ya publica el
  // resultado ($51.10 → $10.50) como una cifra de tabla, no como un SKU. Se toma tal cual,
  // como constante fija — NO se re-deriva de un precio de VM porque el doc no lo desglosa.
  redisVmOptimizadaMensual: 10.5,

  // Egreso a internet (Premium, 0-1 TiB) — §4
  egresoInternetGiB: 0.19, // $/GiB

  // Serverless VPC connector e2-micro — §4 ("≈$0.0126/h por instancia, mín. 2")
  vpcConnectorInstanciaHora: 0.0126,
});

/** Free tiers aplicados — §4. */
export const FREE_TIER = Object.freeze({
  cloudRunVcpuSeg: 180000,
  cloudRunGiBSeg: 360000,
  cloudRunRequests: 2000000,
  workerVcpuSeg: 384204,
  workerGiBSeg: 728744,
});

/**
 * Constantes CALIBRADAS: el doc de agosto publica los TOTALES por servicio (§5/§6) pero
 * no desglosa la fórmula interna que traduce "requests/puntos GPS por conductor" en
 * CPU-segundos, GiB-segundos o bytes de egreso facturables. Estas constantes se
 * retro-calcularon resolviendo la ecuación de costo contra las cifras publicadas en los
 * escalones de referencia (10, 100, 300, 600 conductores, 6 vueltas, arquitectura
 * optimizada donde es posible porque no tiene el ruido del idle de min-instances=1) y se
 * aplican igual para toda la proyección. No son un precio de lista: son un parámetro de
 * carga implícito del modelo de agosto, documentado aquí en vez de reescrito a mano en
 * cada escalón.
 */
export const CALIBRACION = Object.freeze({
  // CPU activa por request de sync — plan §13.3: YA NO es una constante escrita a mano
  // acá. Se calibra por mejor ajuste sobre LOS 18 PUNTOS de referencia de agosto (9
  // escalones × 2 arquitecturas), no contra un solo escalón. Ver sección 8b
  // ("Calibración de vCPU-s por request de API") más abajo para la derivación completa,
  // `CPU_SEG_POR_REQUEST_API` (el valor resultante) y `residuosApiAgosto()` (la tabla de
  // error residual por escalón que exige el encargo).
  //
  // Memoria reservada durante el mismo tiempo que la CPU activa (Cloud Run API corre con
  // 1 GiB asignado — §2 tabla de infraestructura desplegada).
  memGiBPorRequestApi: 1,
  // Egreso a internet por punto GPS transmitido (payload + overhead HTTP/TLS), calibrado
  // contra la columna "Egreso" de §5/§6 — es IDÉNTICA en ambas arquitecturas, lo que
  // confirma que depende del volumen de datos GPS y no del tamaño de lote de sync.
  bytesEgresoPorPunto: 500.67,
  // Costo de Cloud Run "quivo-web" por conductor mostrado en el panel — calibrado contra
  // la columna "Web" de §5/§6 (tramo lineal n≥200, donde el free tier ya está agotado).
  webCostoPorConductorMes: 0.005,
});

// ---------------------------------------------------------------------------
// 2. Supuestos de carga
// ---------------------------------------------------------------------------

/**
 * Supuestos DE AGOSTO — costos-gcp-por-escala.md §3.3-3.4. Se usan tal cual en el test de
 * regresión (criterio de aceptación duro del encargo): 240 B/punto, 2.500 puntos/día a
 * 6 vueltas, 26 días operativos, jornada 10 h, vuelta 32,7 km.
 */
export const SUPUESTOS_AGOSTO = Object.freeze({
  id: 'agosto-2026-08-26',
  origen: 'docs/costos-gcp-por-escala.md §3.3-3.4 (2026-08-26)',
  diasOperativosMes: 26, // §3.3 "Días operativos/mes"
  jornadaHoras: 10, // §3.3 "Jornada activa" (derivado de 6 vueltas a 20 km/h)
  vueltaKm: 32.7, // §3.3 "Vuelta promedio (mix 50/50)"
  bytesPorPunto: 240, // §3.4 "240 B por punto GPS, índices incluidos"
  puntosPorConductorDiaPorVueltas: { 3: 1250, 6: 2500 }, // §3.3
  vueltasDiarias: 6, // techo del rango, el usado en las tablas de §5-§6
  // §3.3 "Requests de sync/conductor/día: ~1.940 — 10h ÷ 15s, 78% de ciclos con pendientes"
  cicloSyncSegActual: 15,
  cicloSyncSegOptimizada: 60, // palanca D de agosto
  fraccionCiclosConPendientes: 0.78,
  mesesRetencionCaliente: 6,
  // Crecimiento de disco por conductor en 6 meses, en GiB. CITADO de §3.4 ("121,7 MB por
  // conductor"), NO re-derivado de bytesPorPunto×puntos×días: reproducir esa cuenta desde
  // cero da ~89,3 MiB (240B×2.500pts/día×26×6 / 1024³), no 121,7 MB — el propio doc de
  // agosto no muestra la fórmula completa detrás de esa cifra (probablemente incluye
  // overhead de bloat/fill-factor no desglosado). Se toma el valor publicado tal cual,
  // convertido a GiB con la aproximación MB≈MiB que mejor reproduce la tabla de §5/§6
  // (ver scripts/costos/modelo-costos.test.mjs para el margen de error real).
  crecimientoGiBPorConductor: 121.7 / 1024,
  crecimientoBytesPorPuntoBase: 240, // base de la cita anterior, para escalar edge cases
  crecimientoPuntosPorDiaBase: 2500,
});

/**
 * Supuestos MEDIDOS 2026-09-20 — docs/plan-costos-2000.md §12 (medición real contra
 * `quivo-control-prod`). Reemplazan a los derivados de agosto para la proyección a 2000,
 * salvo los que el plan §9 confirma que siguen vigentes (días operativos, jornada,
 * vuelta, y el ciclo de sync porque ninguna de las seis palancas de agosto se aplicó
 * — plan §9.3).
 */
export const SUPUESTOS_MEDIDOS = Object.freeze({
  id: 'medido-2026-09-20',
  origen: 'docs/plan-costos-2000.md §12 (medición 2026-09-20 contra quivo-control-prod)',
  // Vigentes de agosto (el plan no los remidió, y §9 no reporta cambios sobre ellos):
  diasOperativosMes: 26, // plan §12.2 los reusa explícitamente
  jornadaHoras: 10, // plan §12.2 "extrapolada a 10h" desde la jornada medida de 8,7h
  vueltaKm: 32.7,
  // Medidos, plan §12.1 y §12.2:
  bytesPorPunto: 365.6, // §12.1 "365,6 B" (heap 200B medido + 3 índices, no 240B derivado del DDL)
  puntosPorConductorDia: 6000, // §12.2 "~6.000 puntos/conductor/día" (jornada medida extrapolada)
  medianaMetrosEntrePuntos: 18.47, // §12.1, informativo — no se usa en el cálculo de costo directo
  loteSyncP50: 3, // §12.3, informativo — confirma que el cuello de botella es overhead de request
  // Ninguna de las seis palancas de agosto está aplicada (plan §9.3): el ciclo de sync
  // sigue en 15s incluso en lo que el doc de agosto llamaba "arquitectura optimizada".
  // Para no perder la comparación de las dos curvas, el escenario "optimizada" en la
  // proyección a 2000 SÍ asume que las palancas se aplican (es today un objetivo, no la
  // realidad medida) — se marca explícitamente en el documento generado.
  cicloSyncSegActual: 15,
  cicloSyncSegOptimizada: 60,
  fraccionCiclosConPendientes: 0.78,
  mesesRetencionCaliente: 6,
  // Crecimiento de disco por conductor en 6 meses, en GiB. CITADO directamente de
  // plan-costos-2000.md §12.2 ("~684 GB" a 2000, "~205 GB" a 600 conductores con estos
  // supuestos) en vez de re-derivarlo de bytesPorPunto×puntos×días: el plan ya publicó el
  // resultado agregado, y reproducirlo desde cero requeriría asumir la misma convención de
  // unidades (GB decimal vs GiB binario) que el plan no deja explícita.
  crecimientoGiBPorConductor: 205 / 600,
  crecimientoBytesPorPuntoBase: 365.6,
  crecimientoPuntosPorDiaBase: 6000,
});

// ---------------------------------------------------------------------------
// 3. Escenarios de definición de "2000 trufis" — plan §10 (§4.2 del plan)
// ---------------------------------------------------------------------------

export const ESCENARIOS = Object.freeze({
  A: {
    nombre: 'A · pico concurrente',
    descripcion: '2000 transmitiendo a la vez (el escalón "n" ES el pico concurrente).',
    factorConcurrencia: 1,
    origen: 'docs/plan-costos-2000.md §4.2 (~207 pts/s a 2000, consistente con factor 1)',
  },
  B: {
    nombre: 'B · padrón con 60% activo',
    descripcion: '"n" es la flota registrada; ~60% está activa/transmitiendo en el pico.',
    factorConcurrencia: 0.6,
    origen: 'docs/plan-costos-2000.md §4.2 ("2000 registrados, ~1200 en pico")',
  },
  C: {
    nombre: 'C · activos/mes, pico menor',
    descripcion:
      '"n" son conductores distintos activos en el mes; el pico diario es menor porque no ' +
      'todos operan el mismo día (patrón típico de flotas de transporte compartido con turnos).',
    // NO VERIFICADO: el plan §4.2 deja este factor "a derivar" y no hay dato de utilización
    // diaria real de la flota. Se toma 0.35 como supuesto de producto, análogo a la
    // fracción de actividad diaria típica en flotas rotativas — es una elección de
    // ingeniería, no un dato medido.
    factorConcurrencia: 0.35,
    origen:
      'docs/plan-costos-2000.md §4.2 (factor marcado "a derivar" en el plan) — ' +
      'NO VERIFICADO, supuesto de producto sin medición de respaldo.',
  },
});

// ---------------------------------------------------------------------------
// 4. Edge cases — plan §4.3 / encargo
// ---------------------------------------------------------------------------

/** Valores default de edge cases: los que reproducen las tablas de agosto. */
export const EDGE_CASES_DEFAULT = Object.freeze({
  vueltasDiarias: 6, // 3 vs 6
  jornadaHoras: null, // null => derivar de vueltasDiarias * vueltaKm / 20 km/h; si se fija, pisa el derivado
  bytesPorPuntoOverride: null, // null => usar el de los supuestos de carga
  haCloudSql: false, // Alta disponibilidad regional (duplica cómputo + storage) — §7
  // Hallazgo 5 de revisión (2026-09-20): había acá un edge case `region: 'us-central1'` que
  // solo descontaba Cloud SQL cómputo y Cloud Run (citado, §6) pero dejaba disco/backup de
  // Cloud SQL, Redis y VPC connector a precio de Santiago, más un ×0,9 de egreso inventado
  // sin cita. Eliminado por completo (ver `generar-tablas.mjs` §6 para el detalle): no hay
  // precio de us-central1 citable en este repo para esas líneas, e inventarlo es peor que no
  // tener la fila.
});

// ---------------------------------------------------------------------------
// 5. Dimensionamiento de Cloud SQL
// ---------------------------------------------------------------------------

/**
 * Factor pico/promedio — plan §13.1. `(n × puntosDía) / (jornadaHoras × 3600)` da el
 * PROMEDIO de la jornada, no el pico de escritura que dimensiona Cloud SQL. Agosto
 * dimensionó contra el pico (criterio "conductores ÷ 9,7") sin escribir nunca la fórmula
 * completa; el chairman la retrocalculó comparando esa razón contra la del promedio
 * (conductores ÷ 14,4, que sale de jornada 10h/2.500 pts.día): 14,4 ÷ 9,7 = 1,4845...,
 * redondeado a 1,485. Equivale a asumir que la carga se concentra en ~6,73 h de las 10 h
 * de jornada — supuesto que agosto nunca escribió pero que sus propios números implican.
 * Se aplica ANTES de elegir tier de Cloud SQL, nunca para el resto de los servicios (que
 * escalan con el promedio, no con el pico instantáneo de escritura).
 */
export const FACTOR_PICO_SOBRE_PROMEDIO = 1.485;

/**
 * Promedio de puntos/segundo en la jornada (NO el pico) — insumo de `puntosPorSegundoPico`
 * y de la calibración de los tiers de Cloud SQL más abajo.
 */
function puntosPorSegundoPromedio(nEfectivo, puntosPorConductorDia, jornadaHoras) {
  const segundosJornada = jornadaHoras * 3600;
  return (nEfectivo * puntosPorConductorDia) / segundosJornada;
}

/**
 * Puntos por segundo en escritura PICO (no el promedio de jornada), para un número de
 * conductores dado. Aplica `FACTOR_PICO_SOBRE_PROMEDIO` (§13.1) sobre el promedio. Con los
 * supuestos de agosto (2.500 pts/día, jornada 10h) reproduce el criterio "conductores ÷
 * 9,7" del doc de agosto (verificado contra el plan §12.2: con los supuestos MEDIDOS,
 * 600 conductores dan ~149 pts/s pico y 2000 dan ~496 pts/s pico — exactamente las cifras
 * de esa sección).
 */
export function puntosPorSegundoPico(nEfectivo, puntosPorConductorDia, jornadaHoras) {
  return puntosPorSegundoPromedio(nEfectivo, puntosPorConductorDia, jornadaHoras) * FACTOR_PICO_SOBRE_PROMEDIO;
}

/**
 * Puntos/s PICO de referencia (agosto, jornada 10h/2.500 pts-día/6 vueltas) en los
 * escalones donde agosto documentó un cambio de tier de Cloud SQL (§5: 50→g1-small techo,
 * 100→primer custom, 300→segundo, 600→tercero). Estos boundaries, no números de tabla
 * copiados a mano, son los que fijan `SQL_TIERS.ptsSMax` — así el tier queda determinado
 * por los mismos conductores que agosto usó, sea cual sea el redondeo que agosto mostró en
 * su columna "puntos/s" (que redondea a 1-2 cifras significativas).
 */
const SQL_TIER_BOUNDARIES_CONDUCTORES_AGOSTO = [50, 100, 300, 600];
const SQL_TIER_BOUNDARIES_PTS_S_AGOSTO = SQL_TIER_BOUNDARIES_CONDUCTORES_AGOSTO.map((n) =>
  puntosPorSegundoPico(n, SUPUESTOS_AGOSTO.puntosPorConductorDiaPorVueltas[6], SUPUESTOS_AGOSTO.jornadaHoras),
);

/**
 * Tiers de Cloud SQL. Los primeros cuatro reproducen EXACTAMENTE el criterio de
 * costos-gcp-por-escala.md §5 ("escritura pico sostenida"): db-g1-small hasta 50
 * conductores, luego un vCPU se dobla cada vez que agosto documentó un salto de tier (100,
 * 300, 600). Los `ptsSMax` se derivan de `SQL_TIER_BOUNDARIES_PTS_S_AGOSTO` (arriba), no se
 * escriben a mano. Los tiers desde db-custom-8-30720 en adelante son EXTRAPOLADOS por este
 * modelo (el doc de agosto no llega ahí): siguen el mismo patrón de duplicar vCPU/RAM cada
 * vez que se duplica el techo de pts/s. Se marcan explícitamente como extrapolación en el
 * documento generado — no hay ninguna prueba de carga real que confirme que un solo nodo
 * Cloud SQL sostiene más de ~62 pts/s (el techo más alto que el doc de agosto sí
 * dimensionó), y el propio plan (§9.5, §12.2) señala que el test de carga k6 solo cubre
 * hasta 300 pts/s.
 */
export const SQL_TIERS = Object.freeze([
  { nombre: 'db-g1-small', vcpu: null, ramGiB: null, ptsSMax: SQL_TIER_BOUNDARIES_PTS_S_AGOSTO[0], extrapolado: false },
  { nombre: 'db-custom-1-3840', vcpu: 1, ramGiB: 3.75, ptsSMax: SQL_TIER_BOUNDARIES_PTS_S_AGOSTO[1], extrapolado: false },
  { nombre: 'db-custom-2-7680', vcpu: 2, ramGiB: 7.5, ptsSMax: SQL_TIER_BOUNDARIES_PTS_S_AGOSTO[2], extrapolado: false },
  { nombre: 'db-custom-4-15360', vcpu: 4, ramGiB: 15, ptsSMax: SQL_TIER_BOUNDARIES_PTS_S_AGOSTO[3], extrapolado: false },
  { nombre: 'db-custom-8-30720', vcpu: 8, ramGiB: 30, ptsSMax: SQL_TIER_BOUNDARIES_PTS_S_AGOSTO[3] * 2, extrapolado: true },
  { nombre: 'db-custom-16-61440', vcpu: 16, ramGiB: 60, ptsSMax: SQL_TIER_BOUNDARIES_PTS_S_AGOSTO[3] * 4, extrapolado: true },
  { nombre: 'db-custom-32-122880', vcpu: 32, ramGiB: 120, ptsSMax: SQL_TIER_BOUNDARIES_PTS_S_AGOSTO[3] * 8, extrapolado: true },
  { nombre: 'db-custom-64-245760', vcpu: 64, ramGiB: 240, ptsSMax: Infinity, extrapolado: true },
]);

/**
 * Techo del único test de carga real que existe en el repo (plan §9.5: k6 sostenido a
 * 300 pts/s). Cualquier escalón que supere esto no tiene evidencia de que la
 * arquitectura (un solo nodo Cloud SQL) efectivamente lo sostenga — es una extrapolación
 * de precio, no de capacidad probada.
 */
export const TECHO_PROBADO_PTS_S = 300;

export function elegirTierSql(ptsPorSegundo) {
  for (const tier of SQL_TIERS) {
    if (ptsPorSegundo <= tier.ptsSMax) return tier;
  }
  return SQL_TIERS[SQL_TIERS.length - 1];
}

/** Tolerancia de "cerca de borde" — hallazgo 1 de revisión (2026-09-20). */
export const TOLERANCIA_BORDE_TIER_PCT = 0.02; // ±2%

/**
 * Detecta si `ptsPorSegundo` cae dentro de `toleranciaPct` de un borde de tier de Cloud
 * SQL (`elegirTierSql` usa `<=`, así que un empate exacto de borde — como el que produce el
 * escalón de 2000 conductores con los supuestos medidos, 495,0 pts/s contra un borde de
 * 495,0 — decide el tier por un margen efectivamente cero). Cuando hay proximidad, devuelve
 * ambos tiers candidatos (el elegido y el vecino) para que el documento generado muestre el
 * RANGO en vez de un punto — hallazgo 1 de revisión, 2026-09-20: la cifra titular del
 * documento (2000 conductores, escenario A, actual) caía exactamente en ese empate.
 */
export function tierCercanoABorde(ptsPorSegundo, toleranciaPct = TOLERANCIA_BORDE_TIER_PCT) {
  const idx = SQL_TIERS.findIndex((t) => ptsPorSegundo <= t.ptsSMax);
  const tierActual = idx === -1 ? SQL_TIERS[SQL_TIERS.length - 1] : SQL_TIERS[idx];

  const candidatos = [];
  if (Number.isFinite(tierActual.ptsSMax) && idx + 1 < SQL_TIERS.length) {
    // Borde superior del tier elegido: si estamos cerca, el vecino MÁS CARO es la alternativa.
    candidatos.push({ borde: tierActual.ptsSMax, tierVecino: SQL_TIERS[idx + 1] });
  }
  if (idx > 0) {
    // Borde inferior (= borde superior del tier anterior): si estamos cerca, el vecino MÁS
    // BARATO es la alternativa.
    candidatos.push({ borde: SQL_TIERS[idx - 1].ptsSMax, tierVecino: SQL_TIERS[idx - 1] });
  }

  let cercano = null;
  for (const c of candidatos) {
    const distanciaPct = Math.abs(ptsPorSegundo - c.borde) / c.borde;
    if (distanciaPct <= toleranciaPct && (!cercano || distanciaPct < cercano.distanciaPct)) {
      cercano = { distanciaPct, borde: c.borde, tierVecino: c.tierVecino };
    }
  }
  if (!cercano) return null;
  return { tierActual, tierVecino: cercano.tierVecino, borde: cercano.borde, distanciaPct: cercano.distanciaPct };
}

export function costoSqlComputo(tier, { ha = false, cud = false } = {}) {
  let costo;
  if (tier.vcpu == null) {
    // db-g1-small: shared-core, precio plano por hora, no admite CUD (§6).
    costo = PRECIOS.sqlG1SmallHora * HORAS_MES;
  } else {
    costo =
      (tier.vcpu * PRECIOS.sqlEnterpriseVcpuHora + tier.ramGiB * PRECIOS.sqlEnterpriseRamGiBHora) *
      HORAS_MES;
    if (cud) costo *= 0.75; // Palanca F de agosto: CUD 1 año, 25% de descuento — §6
  }
  if (ha) costo *= 2; // HA regional duplica cómputo — §7
  return costo;
}

// ---------------------------------------------------------------------------
// 6. Disco y backups de Cloud SQL
// ---------------------------------------------------------------------------

const DISCO_MINIMO_GIB = 10; // PD_SSD mínimo de Cloud SQL — §2 "10 GB PD_SSD"
const DISCO_INCREMENTO_GIB = 5; // paso de redondeo del autoresize, calibrado contra §5/§6

/**
 * GiB de disco proyectados para `n` conductores, con `mesesRetencionCaliente` de retención.
 * Fórmula: piso de 10 GiB (lo ya desplegado) + crecimiento acumulado, redondeado hacia
 * arriba al siguiente incremento de 5 GiB (aproximación del autoresize de Cloud SQL, que
 * no crece en pasos finos). CASO ESPECIAL n=10: se usa el piso real desplegado (10 GiB,
 * medido — §2 "82 MiB usados de 10GB") en vez de la proyección, porque a esa escala la
 * base real ya está por debajo de lo que la fórmula proyectaría y no tiene sentido
 * "reservar" disco que ya existe sin usarse.
 *
 * IMPORTANTE (hallazgo 6 de revisión, 2026-09-20): `n` es la flota NOMINAL (todos los
 * conductores que van a escribir filas en la ventana de retención), NUNCA la concurrencia
 * efectiva de pico (`nEfectivo` en `calcularEscalon`). El disco crece con quién escribe
 * datos durante el mes, no con cuántos transmiten en el mismo instante — por eso el
 * llamador (`calcularEscalon`) pasa `n`, no `nEfectivo`. Antes de este fix, la guarda
 * "CASO ESPECIAL n=10" se evaluaba sobre `nEfectivo` y por eso se disparaba de más en
 * escenarios con concurrencia fraccionaria (p.ej. escenario B hasta n=16, C hasta n=28).
 *
 * `bytesPorPunto`, `puntosPorConductorDia`, `diasOperativosMes` y `mesesRetencionCaliente`
 * vienen de los supuestos de carga activos (agosto o medidos).
 */
export function calcularDiscoSqlGiB(n, supuestos, { mesesRetencionCaliente } = {}) {
  const meses = mesesRetencionCaliente ?? supuestos.mesesRetencionCaliente;
  const puntosPorDia = supuestos.puntosPorConductorDia ?? supuestos.puntosPorConductorDiaPorVueltas?.[6];

  // Punto de partida: la cifra de crecimiento CITADA (no re-derivada) para los supuestos
  // base del escenario activo (agosto: §3.4 "121,7 MB"; medido: plan §12.2 "~205 GB/600").
  // Si un edge case cambia bytesPorPunto o los puntos/día (menos vueltas, bloat, etc.), se
  // escala proporcionalmente desde esa cita — así el caso base reproduce EXACTAMENTE la
  // cifra publicada y los edge cases se derivan con criterio, no a mano.
  const baseBytesPorPunto = supuestos.crecimientoBytesPorPuntoBase ?? supuestos.bytesPorPunto;
  const basePuntosPorDia = supuestos.crecimientoPuntosPorDiaBase ?? puntosPorDia;
  const baseMeses = supuestos.mesesRetencionCaliente;
  const crecimientoGiBPorConductorBase = supuestos.crecimientoGiBPorConductor;

  const factorEscala =
    (supuestos.bytesPorPunto * puntosPorDia * meses) / (baseBytesPorPunto * basePuntosPorDia * baseMeses);
  const crecimientoGiBPorConductor = crecimientoGiBPorConductorBase * factorEscala;

  if (n <= 10) return DISCO_MINIMO_GIB;

  const proyectado = DISCO_MINIMO_GIB + n * crecimientoGiBPorConductor;
  return Math.ceil(proyectado / DISCO_INCREMENTO_GIB) * DISCO_INCREMENTO_GIB;
}

export function costoSqlDisco(discoGiB, { ha = false } = {}) {
  const factor = ha ? 2 : 1; // HA regional duplica storage — §7
  return discoGiB * factor * PRECIOS.sqlSsdGiBHora * HORAS_MES;
}

/**
 * Backups + PITR. Modelados sobre el crecimiento INCREMENTAL del disco (excluyendo el
 * piso de 10 GiB, que ya queda cubierto por el primer snapshot completo): los backups de
 * Cloud SQL son incrementales tras el primero, y PITR se basa en WAL, así que crecen con
 * los datos nuevos, no con el tamaño total de la base.
 */
export function costoSqlBackup(discoGiB, { ha = false } = {}) {
  const incrementalGiB = Math.max(0, discoGiB - DISCO_MINIMO_GIB);
  const factor = ha ? 2 : 1;
  return incrementalGiB * factor * PRECIOS.sqlBackupGiBHora * HORAS_MES;
}

// ---------------------------------------------------------------------------
// 7. Requests de sync — usados para API y para el fee de requests de Cloud Run
// ---------------------------------------------------------------------------

export function requestsPorConductorDia(supuestos, cicloSyncSeg) {
  const ciclosPorDia = (supuestos.jornadaHoras * 3600) / cicloSyncSeg;
  return ciclosPorDia * supuestos.fraccionCiclosConPendientes;
}

// ---------------------------------------------------------------------------
// 8. Cloud Run — API, Web, Worker, VPC connector, Artifact Registry, Egreso
// ---------------------------------------------------------------------------

function costoCloudRunActivoConC(requestsTotalesMes, cpuSegPorRequestApi) {
  const cpuSegTotal = requestsTotalesMes * cpuSegPorRequestApi;
  const memGiBSegTotal = cpuSegTotal * CALIBRACION.memGiBPorRequestApi;
  const cpuBillable = Math.max(0, cpuSegTotal - FREE_TIER.cloudRunVcpuSeg) * PRECIOS.cloudRunActivoVcpuSeg;
  const memBillable = Math.max(0, memGiBSegTotal - FREE_TIER.cloudRunGiBSeg) * PRECIOS.cloudRunMemGiBSeg;
  const requestFee =
    (Math.max(0, requestsTotalesMes - FREE_TIER.cloudRunRequests) / 1e6) * PRECIOS.cloudRunRequestsPorMillon;
  return cpuBillable + memBillable + requestFee;
}

/** Costo idle mensual de `quivo-api` con min-instances=1 (arquitectura "actual" únicamente). */
export const IDLE_API_MENSUAL = (PRECIOS.cloudRunIdleVcpuSeg + PRECIOS.cloudRunMemGiBSeg) * HORAS_MES * 3600;

// ---------------------------------------------------------------------------
// 8b. Calibración de vCPU-s por request de API — plan §13.3
//
// Agosto NUNCA publicó cuántos vCPU-s consume una request de sync: solo publicó el TOTAL
// de la columna "API" por escalón (§5 arquitectura actual, §6 optimizada). El intento
// anterior calibró un solo parámetro contra UN solo punto (300 conductores, optimizada) y
// Codex marcó el mismo hallazgo `high` tres veces: eso reproduce ese punto y falla en el
// resto. Acá se calibra por MEJOR AJUSTE (mínimos cuadrados sobre el costo activo, en USD)
// contra LOS 18 PUNTOS de referencia publicados (9 escalones × 2 arquitecturas), citados
// tal cual de costos-gcp-por-escala.md §5/§6 columna "API".
// ---------------------------------------------------------------------------

/** Columna "API" de §5 (actual) y §6 (optimizada), citada tal cual, USD/mes. */
export const REFERENCIA_AGOSTO_API = Object.freeze({
  actual: { 10: 18.69, 25: 21.5, 50: 26.3, 100: 36.89, 200: 48.2, 300: 50.22, 400: 52.24, 500: 54.26, 600: 56.29 },
  optimizada: { 10: 0.0, 25: 0.11, 50: 1.53, 100: 4.45, 200: 10.53, 300: 16.89, 400: 23.26, 500: 29.59, 600: 35.95 },
});

function construirPuntosReferenciaApi() {
  const puntos = [];
  for (const arquitectura of ['actual', 'optimizada']) {
    const cicloSyncSeg =
      arquitectura === 'optimizada' ? SUPUESTOS_AGOSTO.cicloSyncSegOptimizada : SUPUESTOS_AGOSTO.cicloSyncSegActual;
    const reqPorConductorDia = requestsPorConductorDia(SUPUESTOS_AGOSTO, cicloSyncSeg);
    for (const [nStr, publicado] of Object.entries(REFERENCIA_AGOSTO_API[arquitectura])) {
      const n = Number(nStr);
      const requestsTotalesMes = n * reqPorConductorDia * SUPUESTOS_AGOSTO.diasOperativosMes;
      const idle = arquitectura === 'actual' ? IDLE_API_MENSUAL : 0;
      puntos.push({ arquitectura, n, requestsTotalesMes, idle, publicado, targetActivo: publicado - idle });
    }
  }
  return puntos;
}

/**
 * Búsqueda en grilla gruesa→fina de la `c` (vCPU-s/request) que minimiza `funcionError(c)`.
 * La función objetivo no es estrictamente convexa (el recorte del free tier introduce
 * quiebres), así que se resuelve así en vez de con un método basado en gradiente — para un
 * solo parámetro, exhaustivo es más simple y más confiable que asumir una forma que no está
 * garantizada.
 */
function buscarMejorC(funcionError) {
  let mejor = { c: 0, error: Infinity };
  let lo = 0.00001;
  let hi = 0.2;
  for (let iter = 0; iter < 10; iter++) {
    const pasos = 400;
    for (let i = 0; i <= pasos; i++) {
      const c = lo + ((hi - lo) * i) / pasos;
      const error = funcionError(c);
      if (error < mejor.error) mejor = { c, error };
    }
    const rango = (hi - lo) / pasos;
    lo = Math.max(0, mejor.c - rango * 2);
    hi = mejor.c + rango * 2;
  }
  return mejor;
}

/** Suma de cuadrados del error en USD del costo activo — criterio elegido (ver más abajo). */
function errorCuadraticoUsd(puntos, c) {
  let suma = 0;
  for (const p of puntos) {
    suma += (costoCloudRunActivoConC(p.requestsTotalesMes, c) - p.targetActivo) ** 2;
  }
  return suma;
}

/**
 * Suma de cuadrados del error RELATIVO (%) del costo activo. Los puntos con
 * `targetActivo === 0` (arquitectura optimizada, n bajo, agosto publicó $0.00) se excluyen:
 * un error relativo contra un target de $0 es infinito/indefinido y no informa sobre `c`.
 */
function errorCuadraticoRelativo(puntos, c) {
  let suma = 0;
  for (const p of puntos) {
    if (p.targetActivo === 0) continue;
    const rel = (costoCloudRunActivoConC(p.requestsTotalesMes, c) - p.targetActivo) / p.targetActivo;
    suma += rel ** 2;
  }
  return suma;
}

/** Suma del error absoluto en USD (para comparar candidatos con una sola cifra). */
function errorAbsolutoTotalUsd(puntos, c) {
  let suma = 0;
  for (const p of puntos) {
    suma += Math.abs(costoCloudRunActivoConC(p.requestsTotalesMes, c) - p.targetActivo);
  }
  return suma;
}

/**
 * Calibra `cpuSegPorRequestApi` por mejor ajuste sobre los 18 puntos de referencia — plan
 * §13.3. Prueba DOS criterios (§9 del documento generado, "se probó también minimizar el
 * error relativo"): mínimos cuadrados en USD (el que se usa) y mínimos cuadrados en error
 * relativo (%). El resultado de ambos se expone en `comparacion` para que el documento
 * reporte el número real de esa comparación en vez de una afirmación sin verificar.
 */
function calibrarCpuSegPorRequestApi() {
  const puntos = construirPuntosReferenciaApi();

  const usd = buscarMejorC((c) => errorCuadraticoUsd(puntos, c));
  const relativo = buscarMejorC((c) => errorCuadraticoRelativo(puntos, c));

  return {
    valor: usd.c,
    puntos,
    comparacion: {
      usd: { c: usd.c, errorAbsolutoTotalUsd: errorAbsolutoTotalUsd(puntos, usd.c) },
      relativo: { c: relativo.c, errorAbsolutoTotalUsd: errorAbsolutoTotalUsd(puntos, relativo.c) },
    },
  };
}

const CALIBRACION_API = calibrarCpuSegPorRequestApi();

/** vCPU-s por request de API — resultado de la calibración de arriba, NO un número a mano. */
export const CPU_SEG_POR_REQUEST_API = CALIBRACION_API.valor;

/**
 * Comparación de los dos criterios de calibración probados — plan/§9 del documento
 * generado. `usd.c` es el que efectivamente usa `CPU_SEG_POR_REQUEST_API`.
 */
export const COMPARACION_CALIBRACION_API = CALIBRACION_API.comparacion;

/**
 * Tabla de error residual por escalón — plan §13.3 ("emitir tabla de error residual por
 * escalón: referencia, modelo, diferencia absoluta y porcentual"). Consumida por
 * `generar-tablas.mjs` para la sección de "qué no es reproducible" del documento generado.
 */
export function residuosApiAgosto() {
  return CALIBRACION_API.puntos.map((p) => {
    const modeloActivo = costoCloudRunActivoConC(p.requestsTotalesMes, CPU_SEG_POR_REQUEST_API);
    const modeloTotal = modeloActivo + p.idle;
    const diffAbs = modeloTotal - p.publicado;
    const diffPct = p.publicado === 0 ? (modeloTotal === 0 ? 0 : Infinity) : (diffAbs / p.publicado) * 100;
    return {
      arquitectura: p.arquitectura,
      n: p.n,
      modelo: modeloTotal,
      publicado: p.publicado,
      diffAbs,
      diffPct,
    };
  });
}

function costoCloudRunActivo(requestsTotalesMes) {
  return costoCloudRunActivoConC(requestsTotalesMes, CPU_SEG_POR_REQUEST_API);
}

/**
 * Cloud Run `quivo-api`. Arquitectura "actual": min-instances=1 (idle 24/7, palanca C NO
 * aplicada). Arquitectura "optimizada": min-instances=0 (palanca C) + ciclo de sync 60s
 * en vez de 15s (palanca D) — ambas reducen el costo activo y eliminan el idle.
 */
export function costoApi(nEfectivo, supuestos, arquitectura) {
  const cicloSyncSeg = arquitectura === 'optimizada' ? supuestos.cicloSyncSegOptimizada : supuestos.cicloSyncSegActual;
  const reqPorConductorDia = requestsPorConductorDia(supuestos, cicloSyncSeg);
  const requestsTotalesMes = nEfectivo * reqPorConductorDia * supuestos.diasOperativosMes;

  const idle = arquitectura === 'actual' ? IDLE_API_MENSUAL : 0;
  const activo = costoCloudRunActivo(requestsTotalesMes);
  return idle + activo;
}

/**
 * Cloud Run `quivo-web`. Calibrado linealmente contra la columna "Web" de §5/§6 (tramo
 * n≥200, donde el free tier ya está agotado): el doc no desglosa qué genera esta carga
 * (probablemente el panel /en-vivo de operaciones, no el conductor), así que se modela
 * como proporcional a la flota mostrada.
 */
export function costoWeb(nEfectivo) {
  return nEfectivo * CALIBRACION.webCostoPorConductorMes;
}

/**
 * Cloud Run Worker Pool `quivo-worker`. El costo NO depende de conductores directamente
 * sino de cuántas instancias manuales corren 24/7 (scalingMode manual — §2), y esas
 * instancias absorben la cola de sync — por eso el umbral es la TASA DE REQUESTS, no el
 * número de conductores. Esto explica un dato que de otro modo sería inconsistente: en la
 * tabla optimizada de §6 el worker se queda en 31,68 hasta 600 conductores (nunca salta a
 * 2 instancias), mientras que en la tabla actual de §5 salta a 68,58 ya en 500 — la única
 * diferencia entre ambas curvas a esa escala es el ciclo de sync (15s actual vs 60s
 * optimizada, palanca D), que cambia la tasa de requests 4×, no la cantidad de datos.
 *
 * Plan §13.2: el criterio de agosto es una TABLA de dimensionamiento ("1 worker hasta 400
 * conductores, 2 desde 500"), no una fórmula de requests/día — igual que los tiers de
 * Cloud SQL, no es derivable de primeros principios, es una decisión de capacidad. Se
 * construye la tabla anclando el primer salto en el punto medio, en requests/día, entre lo
 * que generan 400 y 500 conductores bajo el ciclo de sync de 15s de agosto (el mismo que
 * agosto usó para fijar ese salto): 400 conductores × ~1.872 req/conductor/día = 748.800;
 * 500 × 1.872 = 936.000; punto medio = 842.400 req/día. Verificado: por debajo de ese
 * umbral 400 conductores quedan en 1 instancia y por encima 500 quedan en 2, tal como pide
 * el encargo.
 *
 * Extensión a 800-2000 (plan §13.2, sin dato de agosto más allá de 600): se extrapola el
 * MISMO patrón de "una instancia más cada vez que se duplica la tasa de requests" que ya
 * está implícito en el propio salto de agosto (no hay otra fuente que fije el paso
 * siguiente) — igual criterio de duplicación que se usa para extrapolar los tiers de Cloud
 * SQL más arriba. Se documentan 5 umbrales (suficiente para llegar a 2000 conductores en
 * la arquitectura "actual", la que genera más requests/día).
 */
const REQ_DIA_POR_CONDUCTOR_ACTUAL_AGOSTO = requestsPorConductorDia(
  SUPUESTOS_AGOSTO,
  SUPUESTOS_AGOSTO.cicloSyncSegActual,
);
export const ANCLA_SALTO_1_A_2_INSTANCIAS_CONDUCTORES = (400 + 500) / 2; // agosto §5: 1 hasta 400, 2 desde 500
export const UMBRALES_INSTANCIAS_WORKER_REQ_DIA = Object.freeze(
  Array.from(
    { length: 5 },
    (_, i) => ANCLA_SALTO_1_A_2_INSTANCIAS_CONDUCTORES * REQ_DIA_POR_CONDUCTOR_ACTUAL_AGOSTO * 2 ** i,
  ),
);

export function calcularInstanciasWorker(requestsPorDiaTotal) {
  return 1 + UMBRALES_INSTANCIAS_WORKER_REQ_DIA.filter((umbral) => requestsPorDiaTotal > umbral).length;
}

export function costoWorker(nEfectivo, supuestos, arquitectura) {
  const cicloSyncSeg =
    arquitectura === 'optimizada' ? supuestos.cicloSyncSegOptimizada : supuestos.cicloSyncSegActual;
  const requestsPorDiaTotal = nEfectivo * requestsPorConductorDia(supuestos, cicloSyncSeg);
  const instancias = calcularInstanciasWorker(requestsPorDiaTotal);
  const segundosMes = HORAS_MES * 3600;
  const vcpuSegTotal = instancias * 1 * segundosMes; // 1 vCPU por instancia — §2
  const memGiBSegTotal = instancias * 0.5 * segundosMes; // 512 MiB por instancia — §2

  const cpuBillable = Math.max(0, vcpuSegTotal - FREE_TIER.workerVcpuSeg) * PRECIOS.workerPoolVcpuSeg;
  const memBillable = Math.max(0, memGiBSegTotal - FREE_TIER.workerGiBSeg) * PRECIOS.workerPoolMemGiBSeg;
  return cpuBillable + memBillable;
}

/** Serverless VPC connector — flat, independiente de n (§4: 2 instancias mínimas e2-micro). */
export function costoVpcConnector() {
  return 2 * PRECIOS.vpcConnectorInstanciaHora * HORAS_MES;
}

/** Redis. Actual: Memorystore Basic 1 GiB, flat. Optimizada: VM propia (palanca B), flat. */
export function costoRedis(arquitectura) {
  return arquitectura === 'optimizada'
    ? PRECIOS.redisVmOptimizadaMensual
    : 1 * PRECIOS.redisBasicGiBHora * HORAS_MES;
}

/** Artifact Registry — flat, tomado de la cifra de tabla de §5/§6 (independiente de n). */
export function costoArtifactRegistry() {
  return 0.3;
}

/**
 * GCS Nearline para archivado (palanca E, solo arquitectura optimizada). Calibrado como
 * fracción pequeña del disco (§6 muestra 0.05-0.50 según escalón, ~0.5-0.6% del disco).
 */
export function costoGcsArchivado(discoGiB, arquitectura) {
  if (arquitectura !== 'optimizada') return 0;
  return discoGiB * 0.0056; // calibrado contra §6 (p.ej. 90 GiB → 0.50)
}

/**
 * Egreso a internet. Calibrado contra la columna "Egreso" de §5/§6 — es IDÉNTICA en
 * ambas arquitecturas (confirma dependencia del volumen de datos GPS, no del framing de
 * requests), así que se calcula sobre el total de puntos generados, no sobre requests.
 */
export function costoEgreso(nFlota, supuestos) {
  const puntosPorDia = supuestos.puntosPorConductorDia ?? supuestos.puntosPorConductorDiaPorVueltas?.[6];
  const totalPuntosMes = nFlota * puntosPorDia * supuestos.diasOperativosMes;
  const egresoGiB = (totalPuntosMes * CALIBRACION.bytesEgresoPorPunto) / 1e9;
  return egresoGiB * PRECIOS.egresoInternetGiB;
}

// ---------------------------------------------------------------------------
// 9. calcularEscalon — función principal
// ---------------------------------------------------------------------------

/**
 * @param {number} n - "trufis" en la definición del escenario elegido (registrados,
 *   concurrentes o activos/mes, según `escenario`).
 * @param {object} opts
 * @param {'actual'|'optimizada'} opts.arquitectura
 * @param {'A'|'B'|'C'} opts.escenario
 * @param {object} opts.supuestos - SUPUESTOS_AGOSTO o SUPUESTOS_MEDIDOS (o un objeto
 *   compatible, p.ej. para tests).
 * @param {object} [opts.edgeCases] - overrides sobre EDGE_CASES_DEFAULT.
 */
export function calcularEscalon(n, opts = {}) {
  // Hallazgo 5 de revisión (2026-09-20): `region` YA NO es un edge case soportado (ver
  // EDGE_CASES_DEFAULT). Rechazar explícitamente en vez de ignorarlo en silencio — si no,
  // alguien vuelve a pedir 'us-central1' y recibe precios de Santiago sin enterarse.
  if (opts.edgeCases && Object.prototype.hasOwnProperty.call(opts.edgeCases, 'region')) {
    throw new Error(
      "calcularEscalon: 'region' ya no es un edge case soportado. No hay precios de " +
        'us-central1 citables en este repo para SQL disco/backup, Redis ni VPC connector — ' +
        'aplicar un descuento solo a Cloud SQL cómputo/Cloud Run sería un híbrido inconsistente ' +
        '(hallazgo 5 de revisión, 2026-09-20). Relevar precios reales de us-central1 con ' +
        '`gcloud`/lista de precios para CADA línea antes de reintroducirlo.',
    );
  }

  const arquitectura = opts.arquitectura ?? 'actual';
  const escenario = opts.escenario ?? 'A';
  const supuestosBase = opts.supuestos ?? SUPUESTOS_AGOSTO;
  const edgeCases = { ...EDGE_CASES_DEFAULT, ...(opts.edgeCases ?? {}) };

  const factorConcurrencia = ESCENARIOS[escenario].factorConcurrencia;
  const nEfectivo = n * factorConcurrencia;

  // --- Resolver supuestos de carga con los edge cases aplicados ---
  const vueltasDiarias = edgeCases.vueltasDiarias ?? 6;

  // Jornada base (sin overrides): la de los supuestos activos (10h en ambos juegos).
  const jornadaHorasBase = supuestosBase.jornadaHoras;

  // Puntos/conductor/día base (sin overrides), y su tasa horaria implícita. Hallazgo 4 de
  // revisión (2026-09-20): antes, un override explícito de `jornadaHoras` ensanchaba el
  // denominador del promedio pero dejaba `puntosPorConductorDia` fijo — una jornada más
  // larga se modelaba como los MISMOS puntos repartidos más finos (pico más bajo, tier más
  // bajo, costo menor), exactamente al revés de lo que implica una cadencia de muestreo
  // fija. Ahora los puntos/día se DERIVAN de la jornada final vía una tasa constante de
  // puntos/hora (`puntosPorConductorDiaBase / jornadaHorasBase`), así que una jornada más
  // larga con la misma cadencia de 15 min da MÁS puntos/día, nunca menos.
  const puntosPorConductorDiaBase =
    supuestosBase.puntosPorConductorDia ?? supuestosBase.puntosPorConductorDiaPorVueltas[6];
  const tasaPuntosPorHora = puntosPorConductorDiaBase / jornadaHorasBase;

  const jornadaHoras = edgeCases.jornadaHoras ?? (jornadaHorasBase * vueltasDiarias) / 6;
  const puntosPorConductorDia = tasaPuntosPorHora * jornadaHoras;

  const bytesPorPunto = edgeCases.bytesPorPuntoOverride ?? supuestosBase.bytesPorPunto;

  const supuestos = {
    ...supuestosBase,
    puntosPorConductorDia,
    puntosPorConductorDiaPorVueltas: undefined,
    jornadaHoras,
    bytesPorPunto,
  };

  const ha = edgeCases.haCloudSql ?? false;

  // --- Cloud SQL ---
  // La concurrencia (`nEfectivo`) aplica SOLO al camino de tasa de escritura pico — hallazgo
  // 3 de revisión (2026-09-20). Storage y egreso escalan con la FLOTA TOTAL (`n`): en el
  // escenario B ("2000 registrados, ~1200 en pico") los 2000 manejan por turnos pero los
  // 2000 escriben filas en la ventana de retención y los 2000 transmiten datos a lo largo
  // del mes, no solo los que están activos en el instante de pico.
  const ptsPorSegundo = puntosPorSegundoPico(nEfectivo, puntosPorConductorDia, jornadaHoras);
  const tier = elegirTierSql(ptsPorSegundo);
  const cud = arquitectura === 'optimizada'; // Palanca F: CUD 1 año, solo optimizada
  const sqlComputo = costoSqlComputo(tier, { ha, cud });

  const discoGiB = calcularDiscoSqlGiB(n, supuestos, {
    mesesRetencionCaliente: arquitectura === 'optimizada' ? 3 : supuestos.mesesRetencionCaliente,
  });
  const sqlDisco = costoSqlDisco(discoGiB, { ha });
  const sqlBackup = costoSqlBackup(discoGiB, { ha });

  // --- Resto de servicios ---
  const redis = costoRedis(arquitectura);
  const api = costoApi(nEfectivo, supuestos, arquitectura);
  const web = costoWeb(nEfectivo);
  const worker = costoWorker(nEfectivo, supuestos, arquitectura);
  const vpcConnector = arquitectura === 'optimizada' ? 0 : costoVpcConnector(); // Palanca A
  const artifactRegistry = costoArtifactRegistry();
  const gcs = costoGcsArchivado(discoGiB, arquitectura);
  const egreso = costoEgreso(n, supuestos);

  const desglose = {
    sqlComputo,
    sqlDisco,
    sqlBackup,
    redis,
    api,
    web,
    worker,
    vpcConnector,
    artifactRegistry,
    gcs,
    egreso,
  };

  const total = Object.values(desglose).reduce((acc, v) => acc + v, 0);

  // Hallazgo 1 de revisión (2026-09-20): si el pico cae cerca de un borde de tier, exponer
  // el vecino y el total que resultaría con ese vecino, para que el documento generado
  // muestre un RANGO en vez de un punto de borde de margen cero.
  const bordeTier = tierCercanoABorde(ptsPorSegundo);
  let bordeTierCercano = null;
  if (bordeTier) {
    const sqlComputoVecino = costoSqlComputo(bordeTier.tierVecino, { ha, cud });
    const totalVecino = total - sqlComputo + sqlComputoVecino;
    bordeTierCercano = {
      distanciaPct: bordeTier.distanciaPct,
      bordePtsPorSegundo: bordeTier.borde,
      tierVecino: bordeTier.tierVecino.nombre,
      tierVecinoExtrapolado: bordeTier.tierVecino.extrapolado,
      totalVecino,
    };
  }

  return {
    n,
    nEfectivo,
    arquitectura,
    escenario,
    tierSql: tier.nombre,
    tierSqlExtrapolado: tier.extrapolado,
    ptsPorSegundo,
    discoGiB,
    superaTechoProbado: ptsPorSegundo > TECHO_PROBADO_PTS_S,
    bordeTierCercano,
    desglose,
    total,
  };
}

export const ESCALONES_DOCUMENTO = [
  10, 25, 50, 100, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1750, 2000,
];

// ---------------------------------------------------------------------------
// 10. Referencia de TOTALES de agosto y tabla de residuos — fuente única para el test de
//     regresión y para generar-tablas.mjs (evita duplicar estos números citados en dos
//     archivos distintos).
// ---------------------------------------------------------------------------

/** Columna "TOTAL" de §1 (respuesta corta), citada tal cual, USD/mes. Los 9 escalones. */
export const REFERENCIA_AGOSTO_TOTAL = Object.freeze({
  actual: { 10: 158.9, 25: 163.32, 50: 169.9, 100: 216.23, 200: 301.54, 300: 309.92, 400: 455.17, 500: 500.35, 600: 508.75 },
  optimizada: { 10: 81.15, 25: 81.56, 50: 84.71, 100: 105.83, 200: 166.66, 300: 176.15, 400: 289.26, 500: 298.73, 600: 309.54 },
});

/**
 * Residuos de TOTAL (no solo API) contra los 18 puntos de referencia de agosto, usando
 * SUPUESTOS_AGOSTO (el único juego de supuestos comparable con esa tabla).
 */
export function residuosTotalAgosto() {
  const residuos = [];
  for (const arquitectura of ['actual', 'optimizada']) {
    for (const [nStr, publicado] of Object.entries(REFERENCIA_AGOSTO_TOTAL[arquitectura])) {
      const n = Number(nStr);
      const resultado = calcularEscalon(n, { arquitectura, escenario: 'A', supuestos: SUPUESTOS_AGOSTO });
      const diffAbs = resultado.total - publicado;
      const diffPct = publicado === 0 ? (resultado.total === 0 ? 0 : Infinity) : (diffAbs / publicado) * 100;
      residuos.push({ arquitectura, n, modelo: resultado.total, publicado, diffAbs, diffPct });
    }
  }
  return residuos;
}
