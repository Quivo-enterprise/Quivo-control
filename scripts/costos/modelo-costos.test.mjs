import { describe, it, expect } from 'vitest';
import {
  calcularEscalon,
  SUPUESTOS_AGOSTO,
  REFERENCIA_AGOSTO_TOTAL,
  residuosApiAgosto,
  residuosTotalAgosto,
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
