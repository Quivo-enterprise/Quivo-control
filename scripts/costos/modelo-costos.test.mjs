import { describe, it, expect } from 'vitest';
import {
  calcularEscalon,
  SUPUESTOS_AGOSTO,
  SUPUESTOS_MEDIDOS,
  SUPUESTOS_MEDIDOS_30M,
  REFERENCIA_AGOSTO_TOTAL,
  residuosApiAgosto,
  residuosTotalAgosto,
  elegirTierSql,
  elegirTierSqlMedido,
  ramRequeridaWorkingSetGiB,
  tierCercanoABorde,
  SQL_TIERS,
  SQL_TIERS_MEDIDOS,
  PISO_TRUFIS_EFECTIVOS_MEDIDO,
  PISO_TIER_MEDIDO_NOMBRE,
  MULTIPLICADORES_RAM_SENSIBILIDAD,
  RAM_MULTIPLICADOR_WORKING_SET,
} from './modelo-costos.mjs';

/**
 * Test de regresión — criterio de aceptación revisado por el chairman (plan
 * docs/plan-costos-2000.md §13.4, autoridad del chairman sobre el criterio original de
 * ±2%):
 *
 * "El test valida totales a ±5%, no ±2%, y falla si algún escalón se desvía más de ±15%.
 * Documentar en el .md y en el test qué escalones no se reproducen y cuánto."
 *
 * Razón del cambio (§13.4): perseguir ±2% contra una columna (API) que tiene un error de
 * origen no reproducible con una fórmula de un solo parámetro (§13.3) produce un modelo
 * que miente para darle la razón a un documento viejo. Que agosto tenga partes no
 * reproducibles es un hallazgo legítimo, documentado en la tabla de residuos de abajo y en
 * la sección propia de docs/costos-gcp-2000.md.
 *
 * Prohibido (encargo, regla dura): hardcodear valores por escalón para pasar el test;
 * relajar la tolerancia más allá de ±5%/±15%; cambiar estos valores esperados para que
 * coincidan con la salida del modelo. Si no cierra, se reporta el residuo, no se maquilla.
 *
 * Cifras esperadas: docs/costos-gcp-por-escala.md §1 (respuesta corta, todos los
 * escalones) y §5/§6 (desglose por servicio), tal cual publicadas el 2026-08-26.
 */

const TOLERANCIA_TOTAL_PCT = 5; // objetivo — no bloquea el build por sí solo
const TOLERANCIA_DURA_PCT = 15; // falla dura — plan §13.4

const ESCALONES_REFERENCIA_AGOSTO = [10, 25, 50, 100, 200, 300, 400, 500, 600];

// Fuente única: REFERENCIA_AGOSTO_TOTAL (modelo-costos.mjs), citada de
// docs/costos-gcp-por-escala.md §1. No se duplica el número acá.
const ESPERADO_TOTAL = REFERENCIA_AGOSTO_TOTAL;

// Desglose por servicio, §5 (actual) y §6 (optimizada), solo en los cuatro escalones que
// el encargo original pidió desglosar línea por línea (10, 100, 300, 600).
const ESPERADO_DESGLOSE = {
  actual: {
    10: { sqlComputo: 35.77, sqlDisco: 2.38, sqlBackup: 0.22, redis: 51.1, api: 18.69, web: 0.3, worker: 31.68, vpcConnector: 18.4, artifactRegistry: 0.3, egreso: 0.06 },
    100: { sqlComputo: 69.02, sqlDisco: 5.95, sqlBackup: 1.57, redis: 51.1, api: 36.89, web: 0.7, worker: 31.68, vpcConnector: 18.4, artifactRegistry: 0.3, egreso: 0.62 },
    300: { sqlComputo: 138.04, sqlDisco: 11.9, sqlBackup: 4.93, redis: 51.1, api: 50.22, web: 1.5, worker: 31.68, vpcConnector: 18.4, artifactRegistry: 0.3, egreso: 1.85 },
    600: { sqlComputo: 276.09, sqlDisco: 21.42, sqlBackup: 9.86, redis: 51.1, api: 56.29, web: 3.0, worker: 68.58, vpcConnector: 18.4, artifactRegistry: 0.3, egreso: 3.71 },
  },
  optimizada: {
    10: { sqlComputo: 35.77, sqlDisco: 2.38, sqlBackup: 0.11, redis: 10.5, api: 0.0, web: 0.3, worker: 31.68, gcs: 0.05, artifactRegistry: 0.3, egreso: 0.06 },
    100: { sqlComputo: 51.77, sqlDisco: 4.76, sqlBackup: 0.9, redis: 10.5, api: 4.45, web: 0.7, worker: 31.68, gcs: 0.15, artifactRegistry: 0.3, egreso: 0.62 },
    300: { sqlComputo: 103.53, sqlDisco: 7.14, sqlBackup: 2.46, redis: 10.5, api: 16.89, web: 1.5, worker: 31.68, gcs: 0.3, artifactRegistry: 0.3, egreso: 1.85 },
    600: { sqlComputo: 207.07, sqlDisco: 11.9, sqlBackup: 4.93, redis: 10.5, api: 35.95, web: 3.0, worker: 31.68, gcs: 0.5, artifactRegistry: 0.3, egreso: 3.71 },
  },
};

function pct(actual, esperado) {
  if (esperado === 0) return actual === 0 ? 0 : Infinity;
  return ((actual - esperado) / esperado) * 100;
}

describe('modelo-costos — regresión contra docs/costos-gcp-por-escala.md (agosto 2026-08-26)', () => {
  for (const arquitectura of ['actual', 'optimizada']) {
    for (const n of ESCALONES_REFERENCIA_AGOSTO) {
      it(`TOTAL n=${n} (${arquitectura}): falla dura solo sobre ±${TOLERANCIA_DURA_PCT}%`, () => {
        const resultado = calcularEscalon(n, {
          arquitectura,
          escenario: 'A',
          supuestos: SUPUESTOS_AGOSTO,
        });
        const esperado = ESPERADO_TOTAL[arquitectura][n];
        const diff = pct(resultado.total, esperado);

        // eslint-disable-next-line no-console
        console.log(
          `[modelo-costos] TOTAL n=${n} ${arquitectura}: modelo=${resultado.total.toFixed(2)} ` +
            `doc=${esperado} diff=${diff.toFixed(2)}% ` +
            `(${Math.abs(diff) <= TOLERANCIA_TOTAL_PCT ? 'dentro de ±5%' : 'FUERA de ±5%, dentro de ±15%'})`,
        );

        expect(
          Math.abs(diff),
          `n=${n} (${arquitectura}): modelo=${resultado.total.toFixed(2)} vs doc=${esperado} ` +
            `(diff ${diff.toFixed(2)}%, techo duro ±${TOLERANCIA_DURA_PCT}%)`,
        ).toBeLessThanOrEqual(TOLERANCIA_DURA_PCT);
      });
    }
  }

  it(`reporta escalones fuera de ±${TOLERANCIA_TOTAL_PCT}% (informativo — no bloquea el build)`, () => {
    const fueraDeTolerancia = residuosTotalAgosto()
      .filter((r) => Math.abs(r.diffPct) > TOLERANCIA_TOTAL_PCT)
      .map((r) => ({ arquitectura: r.arquitectura, n: r.n, modelo: +r.modelo.toFixed(2), doc: r.publicado, diffPct: +r.diffPct.toFixed(2) }));
    // eslint-disable-next-line no-console
    console.log(
      `[modelo-costos] Escalones fuera de ±${TOLERANCIA_TOTAL_PCT}% (de 18): ${fueraDeTolerancia.length}`,
    );
    for (const r of fueraDeTolerancia) {
      // eslint-disable-next-line no-console
      console.log(`  ${r.arquitectura} n=${r.n}: modelo=${r.modelo} doc=${r.doc} diff=${r.diffPct}%`);
    }
    // No bloquea: es un reporte de diagnóstico, tal como pide el encargo.
    expect(fueraDeTolerancia).toBeInstanceOf(Array);
  });

  it('reporta el desglose por servicio en n=10/100/300/600 (informativo — no bloquea el build)', () => {
    const reporte = [];
    for (const arquitectura of ['actual', 'optimizada']) {
      for (const n of [10, 100, 300, 600]) {
        const resultado = calcularEscalon(n, {
          arquitectura,
          escenario: 'A',
          supuestos: SUPUESTOS_AGOSTO,
        });
        const esperado = ESPERADO_DESGLOSE[arquitectura][n];
        for (const [linea, valorEsperado] of Object.entries(esperado)) {
          const valorModelo = resultado.desglose[linea] ?? 0;
          const diff = pct(valorModelo, valorEsperado);
          reporte.push({ arquitectura, n, linea, valorModelo: +valorModelo.toFixed(2), valorEsperado, diffPct: +diff.toFixed(1) });
        }
      }
    }
    const fueraDeTolerancia = reporte.filter((r) => Math.abs(r.diffPct) > TOLERANCIA_TOTAL_PCT);
    // eslint-disable-next-line no-console
    console.log(
      `[modelo-costos] Líneas fuera de ±${TOLERANCIA_TOTAL_PCT}%: ${fueraDeTolerancia.length}/${reporte.length}`,
    );
    for (const r of fueraDeTolerancia) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${r.arquitectura} n=${r.n} ${r.linea}: modelo=${r.valorModelo} doc=${r.valorEsperado} diff=${r.diffPct}%`,
      );
    }
    expect(reporte.length).toBeGreaterThan(0);
  });

  it('residuosApiAgosto() cubre los 18 puntos de referencia (informativo — no bloquea el build)', () => {
    const residuos = residuosApiAgosto();
    // eslint-disable-next-line no-console
    console.log(`[modelo-costos] Residuos de calibración de API (§13.3), ${residuos.length} puntos:`);
    for (const r of residuos) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${r.arquitectura} n=${r.n}: modelo=${r.modelo.toFixed(2)} doc=${r.publicado} ` +
          `diffAbs=${r.diffAbs.toFixed(2)} diffPct=${Number.isFinite(r.diffPct) ? r.diffPct.toFixed(1) + '%' : 'n/a'}`,
      );
    }
    expect(residuos.length).toBe(18);
  });
});

/**
 * SQL_TIERS_MEDIDOS — dimensionamiento nuevo, plan-experimento-puntos-gps.md §8/§9.
 * `SQL_TIERS` (agosto) no se toca ni se re-testea acá (ya lo cubre el describe de arriba,
 * que sigue en verde con estos cambios — ver también el test explícito de abajo que fuerza
 * `forzarTierAgosto: true` y verifica que reproduce la cifra histórica).
 */
describe('SQL_TIERS_MEDIDOS — dimensionamiento medido (plan-experimento-puntos-gps.md §9)', () => {
  it('escritura: 495 pts/s (pico medido a 2000 trufis, escenario A) cabe en 1 vCPU — confirma H-tier (plan §8)', () => {
    const tier = elegirTierSql(495, SQL_TIERS_MEDIDOS);
    expect(tier.nombre).toBe('db-custom-1-3840');
    expect(tier.vcpu).toBe(1);
  });

  it('escritura: el techo de 1 vCPU es 500 pts/s (50% de los 1.000 pts/s que PASA en c1, plan §8)', () => {
    const unVcpu = SQL_TIERS_MEDIDOS.find((t) => t.nombre === 'db-custom-1-3840');
    expect(unVcpu.ptsSMax).toBe(500);
    expect(unVcpu.extrapolado).toBe(false);
  });

  it('escritura: 501 pts/s ya NO cabe en 1 vCPU (cruza el techo de diseño)', () => {
    const tier = elegirTierSql(501, SQL_TIERS_MEDIDOS);
    expect(tier.nombre).not.toBe('db-custom-1-3840');
  });

  it('piso: aplica db-custom-2-7680 desde 100 trufis efectivos aunque escritura y RAM pidan menos', () => {
    // pts/s y puntos/día bajos a propósito: ninguna de las otras dos reglas debería pedir
    // más que el piso en este punto (nEfectivo apenas en el umbral).
    const r = elegirTierSqlMedido(PISO_TRUFIS_EFECTIVOS_MEDIDO, 25, 6000);
    expect(r.tier.nombre).toBe(PISO_TIER_MEDIDO_NOMBRE);
    expect(r.reglaGanadora).toBe('piso');
  });

  it('piso: por debajo de 100 trufis efectivos NO aplica — cae a SQL_TIERS (tabla de agosto), no a un tier medido chico inventado', () => {
    const r = elegirTierSqlMedido(PISO_TRUFIS_EFECTIVOS_MEDIDO - 1, 24, 6000);
    expect(r.reglaGanadora).toBe('agosto-fallback');
    expect(r.tier).toEqual(elegirTierSql(24, SQL_TIERS));
  });

  it('RAM (working set): decide por encima del piso cuando el working set de 2 días × margen supera la RAM del piso', () => {
    // nEfectivo y puntos/día grandes a propósito para forzar que la regla de RAM sea la que
    // pide más RAM que el piso (db-custom-2-7680, 7.5 GiB) y que escritura (495 pts/s cabe
    // holgado en 1 vCPU con este puntosPorConductorDia/jornada).
    const r = elegirTierSqlMedido(2000, 495, 6000);
    expect(r.reglaGanadora).toBe('ram');
    expect(r.ramRequeridaGiB).not.toBeNull();
    expect(r.tier.ramGiB).toBeGreaterThanOrEqual(r.ramRequeridaGiB);
    // Y estrictamente por encima del piso — si no, el piso hubiera ganado el empate hacia
    // arriba (candidatos.reduce usa `>`, así que en un empate exacto gana el primero, piso
    // no es el primero acá — este assert deja explícito que la RAM realmente superó el piso).
    const tierPiso = SQL_TIERS_MEDIDOS.find((t) => t.nombre === PISO_TIER_MEDIDO_NOMBRE);
    expect(r.ramRequeridaGiB).toBeGreaterThan(tierPiso.ramGiB);
  });

  it('ramRequeridaWorkingSetGiB: escala linealmente con nEfectivo y con puntos/conductor/día', () => {
    const base = ramRequeridaWorkingSetGiB(100, 1000);
    const dobleN = ramRequeridaWorkingSetGiB(200, 1000);
    const doblePuntos = ramRequeridaWorkingSetGiB(100, 2000);
    expect(dobleN).toBeCloseTo(base * 2, 6);
    expect(doblePuntos).toBeCloseTo(base * 2, 6);
  });

  it('calcularEscalon: usarTierMedido solo se activa con SUPUESTOS_MEDIDOS/SUPUESTOS_MEDIDOS_30M, nunca con SUPUESTOS_AGOSTO', () => {
    const conAgosto = calcularEscalon(2000, { arquitectura: 'actual', escenario: 'A', supuestos: SUPUESTOS_AGOSTO });
    const conMedidos = calcularEscalon(2000, { arquitectura: 'actual', escenario: 'A', supuestos: SUPUESTOS_MEDIDOS });
    expect(conAgosto.usarTierMedido).toBe(false);
    expect(conMedidos.usarTierMedido).toBe(true);
  });

  it('calcularEscalon: forzarTierAgosto reproduce el dimensionamiento histórico (SQL_TIERS) con SUPUESTOS_MEDIDOS — n=600 actual', () => {
    // Cifra citada en docs/plan-experimento-puntos-gps.md §7 (columna "600 actual/opt") y en
    // el docs/costos-gcp-2000.md generado antes de esta recalibración: US$1.402,83.
    const historico = calcularEscalon(600, {
      arquitectura: 'actual',
      escenario: 'A',
      supuestos: SUPUESTOS_MEDIDOS,
      forzarTierAgosto: true,
    });
    expect(historico.usarTierMedido).toBe(false);
    expect(historico.total).toBeCloseTo(1402.83, 1);
  });

  it('SUPUESTOS_MEDIDOS_30M (captura 30 m) reduce puntos/conductor/día y por lo tanto el pico de escritura vs SUPUESTOS_MEDIDOS (15 m/captura actual)', () => {
    expect(SUPUESTOS_MEDIDOS_30M.puntosPorConductorDia).toBeLessThan(SUPUESTOS_MEDIDOS.puntosPorConductorDia);
    expect(SUPUESTOS_MEDIDOS_30M.puntosPorConductorDia).toBe(2972);

    const r15 = calcularEscalon(2000, { arquitectura: 'actual', escenario: 'A', supuestos: SUPUESTOS_MEDIDOS });
    const r30 = calcularEscalon(2000, { arquitectura: 'actual', escenario: 'A', supuestos: SUPUESTOS_MEDIDOS_30M });
    expect(r30.ptsPorSegundo).toBeLessThan(r15.ptsPorSegundo);
    expect(r30.usarTierMedido).toBe(true);
  });
});

/**
 * Hallazgo 1 de revisión (2026-09-22): cuando gana "escritura", el rango de borde cercano no
 * puede ofrecer un tier por debajo de lo que exigen RAM/piso, y los empates entre reglas se
 * reportan TODOS (no solo la primera en `candidatos`). Repro exacto pedido por la revisión:
 * `elegirTierSqlMedido(150, 505, 6000)`.
 */
describe('elegirTierSqlMedido / tierCercanoABorde — clamp del rango y empates (hallazgo 1 de revisión, 2026-09-22)', () => {
  it('repro elegirTierSqlMedido(150, 505, 6000): empate escritura+piso en db-custom-2-7680, reporta ambas reglas', () => {
    const r = elegirTierSqlMedido(150, 505, 6000);
    expect(r.tier.nombre).toBe('db-custom-2-7680');
    expect(r.reglaGanadora).toBe('escritura+piso');
    expect(r.tierRam.nombre).toBe('db-custom-1-3840'); // RAM por sí sola pediría menos que el piso
    expect(r.tierPiso.nombre).toBe('db-custom-2-7680');
  });

  it('tierCercanoABorde: con tierMinimo, un vecino barato por debajo del piso se omite (no se agrega como candidato)', () => {
    // Mismo clamp que aplica calcularEscalon internamente cuando reglaGanadora incluye
    // "escritura": tierMinimo = max(tierRam, tierPiso) del resultado de elegirTierSqlMedido.
    const tierMinimo = SQL_TIERS_MEDIDOS.find((t) => t.nombre === 'db-custom-2-7680'); // tierPiso del repro de arriba
    const sinClamp = tierCercanoABorde(505, undefined, SQL_TIERS_MEDIDOS);
    const conClamp = tierCercanoABorde(505, undefined, SQL_TIERS_MEDIDOS, tierMinimo);
    expect(sinClamp.tierVecino.nombre).toBe('db-custom-1-3840'); // sin clamp: ofrece el tier inválido
    expect(conClamp).toBeNull(); // con clamp: no hay vecino barato válido, no hay rango que reportar
  });

  it('n=600 (escenario A, SUPUESTOS_MEDIDOS): ram y piso empatan en db-custom-2-7680, se reportan ambas', () => {
    const r = calcularEscalon(600, { arquitectura: 'actual', escenario: 'A', supuestos: SUPUESTOS_MEDIDOS });
    expect(r.tierSql).toBe('db-custom-2-7680');
    expect(r.reglaTierMedido).toBe('ram+piso');
  });
});

/**
 * Hallazgo 2 de revisión (2026-09-22): `ramRequeridaWorkingSetGiB`/`elegirTierSqlMedido`
 * aceptan el multiplicador de RAM como parámetro (default `RAM_MULTIPLICADOR_WORKING_SET`)
 * para poder recorrer 3×/4×/5× programáticamente.
 */
describe('sensibilidad del multiplicador de RAM (hallazgo 2 de revisión, 2026-09-22)', () => {
  it('ramRequeridaWorkingSetGiB acepta un multiplicador explícito y escala linealmente con él', () => {
    const conDefault = ramRequeridaWorkingSetGiB(100, 1000);
    const conMultiplicadorIgualAlDefault = ramRequeridaWorkingSetGiB(100, 1000, undefined, RAM_MULTIPLICADOR_WORKING_SET);
    const conTres = ramRequeridaWorkingSetGiB(100, 1000, undefined, 3);
    expect(conMultiplicadorIgualAlDefault).toBeCloseTo(conDefault, 9);
    expect(conTres).toBeCloseTo((conDefault * 3) / RAM_MULTIPLICADOR_WORKING_SET, 9);
  });

  it('MULTIPLICADORES_RAM_SENSIBILIDAD expone 3/4/5', () => {
    expect(MULTIPLICADORES_RAM_SENSIBILIDAD).toEqual([3, 4, 5]);
  });

  it('n=2000 (escenario A, SUPUESTOS_MEDIDOS): el tier cambia entre 3× y 4× — el multiplicador SÍ mueve el resultado', () => {
    const r3 = calcularEscalon(2000, {
      arquitectura: 'actual',
      escenario: 'A',
      supuestos: SUPUESTOS_MEDIDOS,
      ramMultiplicadorWorkingSet: 3,
    });
    const r4 = calcularEscalon(2000, {
      arquitectura: 'actual',
      escenario: 'A',
      supuestos: SUPUESTOS_MEDIDOS,
      ramMultiplicadorWorkingSet: 4,
    });
    expect(r3.tierSql).toBe('db-custom-4-15360');
    expect(r4.tierSql).toBe('db-custom-8-30720');
    expect(r3.total).toBeLessThan(r4.total);
  });

  it('n=600 (escenario A, SUPUESTOS_MEDIDOS): el tier NO cambia entre 3×, 4× y 5× — el piso ya domina en ese rango', () => {
    const tiers = MULTIPLICADORES_RAM_SENSIBILIDAD.map(
      (m) =>
        calcularEscalon(600, {
          arquitectura: 'actual',
          escenario: 'A',
          supuestos: SUPUESTOS_MEDIDOS,
          ramMultiplicadorWorkingSet: m,
        }).tierSql,
    );
    expect(new Set(tiers).size).toBe(1);
    expect(tiers[0]).toBe('db-custom-2-7680');
  });
});
