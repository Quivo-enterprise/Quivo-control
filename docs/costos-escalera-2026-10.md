# Escalera de costos 30 → 600 trufis (2026-10-20)

Página: https://claude.ai/artifact/GdjWsvXYRUkne8jfp6hN3Y (supuestos, palancas y lo no verificado). Precios de lista
`southamerica-west1` (catálogo de Cloud Billing, 19/10); consumo de los logs y métricas de prod (30 días) y del ensayo B.
Sin facturación real. Reemplaza las tablas de `costos-gcp-2000.md` para 30–600 (aquel no contaba logs, requests ni
egreso del panel).

Versión 2 (20/10): suma Vecinos de la ruta, que no estaba en lo medido. Las 9 requests por minuto por trufi salen de los
logs del 14/10 y Vecinos llegó a los teléfonos con el APK 16 el 17/10. Se agregan 2 por minuto (la app consulta cada
30 s, `INTERVALO_VECINOS_MS`), sin medir: se confirman con los logs del piloto del 21 y 22/10. Con 400 trufis eso
adelanta la segunda instancia de la API.

| Trufis | Pantallas | Cloud SQL | API | Workers | Hoy (USD/mes) | Optimizada |
|---|---|---|---|---|---|---|
| 30 | 2 | db-g1-small | 1 | 1 | 199.37 | 106.05 |
| 60 | 2 | db-g1-small | 1 | 1 | 219.69 | 127.21 |
| 100 | 2 | db-g1-small | 1 | 1 | 229.75 | 148.56 |
| 200 | 3 | db-custom-1-3840 | 1 | 1 | 327.29 | 203.35 |
| 300 | 3 | db-custom-2-7680 | 1 | 1 | 438.15 | 267.48 |
| 400 | 4 | db-custom-2-7680 | 2 | 2 | 554.16 | 317.68 |
| 500 | 5 | db-custom-2-7680 | 2 | 2 | 597.74 | 330.46 |
| 600 | 5 | db-custom-2-7680 | 2 | 2 | 639.58 | 377.55 |

## Modelo (reproducible: `node` sobre este bloque)

```js
// Modelo de costos QUIVO 2026-10-20. Precios de lista southamerica-west1 (catalogo 19/10).
const H = 730, MES_S = H * 3600;
const P = { sqlG1: 0.049, ssd: 0.238, backup: 0.112, redisGiBh: 0.07, runCpuAct: 0.0000336, runMemAct: 0.0000035,
  runIdle: 0.0000035, runReqM: 0.40, wpCpu: 0.000013492, wpMem: 0.000001482, logGiB: 0.50, egress: 0.12,
  nearline: 0.018, e2micro: 0.010868, pdBal: 0.143 };
const tiers = { g1: { n: 'db-g1-small', c: P.sqlG1 * H, cud: false }, c1: { n: 'db-custom-1-3840', c: 69.02, cud: true },
  c2: { n: 'db-custom-2-7680', c: 138.04, cud: true }, c4: { n: 'db-custom-4-15360', c: 276.09, cud: true } };
const N = [30, 60, 100, 200, 300, 400, 500, 600];
const S = { 30: 2, 60: 2, 100: 2, 200: 3, 300: 3, 400: 4, 500: 5, 600: 5 };
const tierSql = n => n <= 100 ? 'g1' : n <= 200 ? 'c1' : 'c2';
const PTS_H = 625, H_TRUFI = 10, DIAS = 26, H_PANEL = 14, DIAS_PANEL = 30, B_PT = 370, B_PT_HEAP = 175;
const OP_S = H_PANEL * DIAS_PANEL * 3600, OP2_S = H_TRUFI * DIAS * 3600;
function calc(n, opt) {
  const s = S[n];
  const rMob = opt ? 6.5 : 11, // 9 y 4,5 medidos el 14/10 + 2 de vecinos-ruta (poll 30 s, APK 16 del 17/10)
    rAdm = opt ? 18 : 50, pollMin = opt ? 12 : 30, ret = opt ? 3 : 6;
  const reqMob = n * rMob * 60 * H_TRUFI * DIAS, reqAdm = s * rAdm * 60 * H_PANEL * DIAS_PANEL, req = reqMob + reqAdm;
  const rpm = n * rMob + s * rAdm;
  const t = tiers[tierSql(n)];
  const sqlComp = t.c * (opt && t.cud ? 0.75 : 1);
  const datosGB = n * PTS_H * H_TRUFI * DIAS * ret * B_PT / 1e9;
  const disco = Math.max(10, Math.ceil(datosGB * 1.2)) * P.ssd;
  const backup = Math.max(0.1, datosGB * P.backup);
  const archivo = opt ? n * PTS_H * H_TRUFI * DIAS * 3 * B_PT_HEAP / 1e9 * P.nearline : 0;
  const redis = opt ? P.e2micro * H + 10 * P.pdBal : 1 * P.redisGiBh * H;
  const vpc = opt ? 0 : 18.40;
  const instApi = rpm > 3900 ? 2 : 1; // 1 instancia ~1900 req/min con CPU p99 21% (19/10); techo de diseno ~45%
  const f = Math.min(1, rpm / 60 * 0.1);
  const act1 = f * OP_S, rate = P.runCpuAct + P.runMemAct;
  let api = act1 * rate + (opt ? 0 : (MES_S - act1) * 2 * P.runIdle) - 180000 * P.runCpuAct - 360000 * P.runMemAct;
  if (instApi === 2) api += OP2_S * rate;
  const reqCost = Math.max(0, req - 2e6) / 1e6 * P.runReqM;
  const workers = n >= 400 ? 2 : 1;
  const worker = workers * (MES_S * P.wpCpu + MES_S * 0.5 * P.wpMem);
  const logGB = req * (opt ? 0.2 : 2) / 1e6;
  const logs = Math.max(0, logGB - 50) * P.logGiB;
  const vehPant = (s - 1) * Math.min(150, Math.ceil(n / (s - 1))) + n; // pantallas de linea + supervision (ve todo)
  const egrAdm = vehPant * 150 * pollMin * 60 * H_PANEL * DIAS_PANEL / 1e9 * (opt ? 0.6 : 1);
  const egrMob = reqMob * 400 / 1e9;
  const egreso = (egrAdm + egrMob) * P.egress;
  const web = 3.0, ar = opt ? 0.1 : 0.38, secrets = 0.72;
  const adminUsd = reqAdm / req * (reqCost + logs) + egrAdm * P.egress + web;
  const gcp = { sqlComp, disco, backup, archivo, redis, vpc, api, reqCost, worker, logs, egreso, web, ar, secrets };
  const totalGcp = Object.values(gcp).reduce((a, b) => a + b, 0);
  const sentry = n <= 100 ? 0 : 26, dominio = 1.25;
  return { adminUsd, reqAdm, n, s, tier: t.n, instApi, workers, req, rpm, datosGB, logGB, gcp, totalGcp, externo: sentry + dominio, total: totalGcp + sentry + dominio };
}
const r2 = x => Math.round(x * 100) / 100;
const fila = c => ({ s: c.s, tier: c.tier, api: c.instApi, wk: c.workers, req: Math.round(c.req), reqAdm: Math.round(c.reqAdm), datosGB: r2(c.datosGB), admin: r2(c.adminUsd), externo: r2(c.externo), totalGcp: r2(c.totalGcp), total: r2(c.total), gcp: Object.fromEntries(Object.entries(c.gcp).map(([k, v]) => [k, r2(v)])) });
console.log(JSON.stringify(N.map(n => ({ n, hoy: fila(calc(n, false)), opt: fila(calc(n, true)) }))));
```

## Mapa de la línea en vivo para el chofer

Mostrarle a cada chofer todos los trufis de su línea trabajando. Costo extra por mes sobre la escalera:

- **A:** la consulta de Vecinos que la app ya hace cada 30 s devuelve también la línea entera. No suma requests, solo
  bytes.
- **B:** una consulta propia cada 10 s, para que los trufis se muevan más fluido. Suma 6 requests por minuto por
  teléfono.

| Trufis | 30 | 60 | 100 | 200 | 300 | 400 | 500 | 600 |
|---|---|---|---|---|---|---|---|---|
| Trufis por línea | 30 | 60 | 100 | 100 | 150 | 134 | 125 | 150 |
| A: 30 s, sobre Vecinos (USD/mes) | 0.13 | 0.54 | 1.50 | 3.00 | 6.74 | 8.03 | 9.36 | 13.48 |
| B: 10 s, hoy (USD/mes) | 14.66 | 4.34 | 13.06 | 36.77 | 96.61 | 79.64 | 97.53 | 123.78 |
| B: 10 s, optimizada (USD/mes) | 18.59 | 20.60 | 9.02 | 18.05 | 33.81 | 76.93 | 85.46 | 67.62 |
| Datos del chofer con A (MB/mes) | 37 | 75 | 125 | 125 | 187 | 167 | 156 | 187 |
| Datos del chofer con B (MB/mes) | 140 | 253 | 402 | 402 | 590 | 530 | 496 | 590 |

- El servidor casi no cambia. `VecinosRutaService` ya arma la lista de los vehículos en curso de la ruta y la cachea
  15 s por `(sindicatoId, rutaId)`. A solo deja de recortarla a delante y detrás.
- B salta de escalón porque sus requests adelantan la segunda instancia de la API y suman logs.
- El costo que importa es el de los megas del chofer. Supuesto: 40 bytes por vehículo por respuesta (id, lat, lng,
  rumbo y edad del fix, comprimido; placa y silueta una sola vez). Con 150 bytes por vehículo, como el panel, A pasa a
  unos 700 MB por mes con 150 trufis por línea.
- El SDK de Google Maps para Android no se cobra.
- Sin verificar:
  - el tamaño real de la respuesta;
  - cuántos trufis de una línea están en curso a la vez (se supone que todos).
- Decisión de producto: qué pasa cuando los choferes ven a todos (esperas, carreras por pasajeros).

El cálculo usa el modelo de arriba con `egrMob` + bytes de la línea y `rMob` + 6 para B.
