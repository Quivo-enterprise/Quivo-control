// Acumulador de latencias/estados por endpoint para conductores-reales.mjs.
const por = new Map(); // etiqueta -> { lat: number[], estados: Map<string, number> }

export function registrar(etiqueta, ms, estado) {
  let e = por.get(etiqueta);
  if (!e) por.set(etiqueta, (e = { lat: [], estados: new Map() }));
  e.lat.push(ms);
  const k = String(estado);
  e.estados.set(k, (e.estados.get(k) ?? 0) + 1);
}

export function percentil(ordenado, p) {
  if (ordenado.length === 0) return 0;
  return ordenado[Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length))];
}

export function resumen() {
  const filas = [];
  for (const [etiqueta, e] of [...por.entries()].sort()) {
    const o = Float64Array.from(e.lat).sort();
    filas.push({
      endpoint: etiqueta,
      n: o.length,
      p50: +percentil(o, 50).toFixed(1),
      p95: +percentil(o, 95).toFixed(1),
      p99: +percentil(o, 99).toFixed(1),
      estados: Object.fromEntries([...e.estados.entries()].sort()),
    });
  }
  return filas;
}

export function totales() {
  let n = 0;
  let c429 = 0;
  let c5xx = 0;
  let err = 0;
  for (const e of por.values()) {
    for (const [k, v] of e.estados) {
      n += v;
      if (k === '429') c429 += v;
      else if (k.startsWith('5')) c5xx += v;
      else if (k === 'ERR') err += v;
    }
  }
  return { n, c429, c5xx, err };
}

export function imprimirTabla(filas) {
  console.log('endpoint'.padEnd(34), 'n'.padStart(8), 'p50'.padStart(8), 'p95'.padStart(8), 'p99'.padStart(8), ' estados');
  for (const f of filas) {
    console.log(
      f.endpoint.padEnd(34),
      String(f.n).padStart(8),
      String(f.p50).padStart(8),
      String(f.p95).padStart(8),
      String(f.p99).padStart(8),
      ' ' + JSON.stringify(f.estados),
    );
  }
}
