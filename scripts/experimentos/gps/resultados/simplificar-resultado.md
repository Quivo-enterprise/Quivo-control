# Resultado — simplificación de traza GPS

Generado: 2026-09-22T09:59:32.782Z

Entrada: 5635 puntos crudos, 110.65 km, 26 puntos de control. Proyección a jornada de referencia: 6000 puntos/día.

| Variante | Puntos | % vs crudo | Desv. máx (m) | Desv. p95 (m) | km | Dif. km (%) | Pasadas perdidas | Pasadas extra | Puntos/día proyectado (6000) |
|---|---|---|---|---|---|---|---|---|---|
| crudo (baseline) | 5635 | 100.0 | 0.0 | 0.0 | 110.65 | 0.0 | 0 | 0 | 6000 |
| dp-2 | 1438 | 25.5 | 2.0 | 1.6 | 110.57 | -0.1 | 7 | 0 | 1531 |
| dp-5 | 724 | 12.8 | 5.0 | 3.7 | 110.38 | -0.2 | 28 | 0 | 771 |
| dp-10 | 462 | 8.2 | 10.0 | 6.7 | 110.06 | -0.5 | 43 | 0 | 492 |
| dp-20 | 282 | 5.0 | 20.0 | 13.5 | 109.56 | -1.0 | 68 | 0 | 300 |
| dp-2-zona-protegida | 3573 | 63.4 | 2.0 | 1.2 | 110.61 | -0.0 | 0 | 0 | 3804 |
| dp-5-zona-protegida | 3216 | 57.1 | 6.8 | 3.0 | 110.52 | -0.1 | 0 | 0 | 3424 |
| dp-10-zona-protegida | 3097 | 55.0 | 9.7 | 4.1 | 110.41 | -0.2 | 0 | 0 | 3298 |
| dp-20-zona-protegida | 3005 | 53.3 | 24.7 | 8.9 | 110.20 | -0.4 | 0 | 0 | 3200 |
| distancia-30m | 2791 | 49.5 | 17.7 | 2.5 | 109.82 | -0.8 | 0 | 0 | 2972 |
| distancia-50m | 1803 | 32.0 | 48.2 | 6.7 | 108.82 | -1.7 | 1 | 0 | 1920 |
| distancia-80m | 1164 | 20.7 | 76.8 | 13.4 | 108.00 | -2.4 | 1 | 0 | 1239 |
| tiempo-15s | 1143 | 20.3 | 34.1 | 10.5 | 109.17 | -1.3 | 0 | 0 | 1217 |
| tiempo-30s | 661 | 11.7 | 65.1 | 27.4 | 107.66 | -2.7 | 5 | 0 | 704 |
| tiempo-60s | 366 | 6.5 | 174.4 | 55.3 | 105.65 | -4.5 | 36 | 0 | 390 |

## Sanity check — baseline recalculado vs cumplimientos_pc reales

| Punto de control | Pasadas baseline (recalculadas) | Pasadas reales (cumplimientos_pc) | Diferencia |
|---|---|---|---|
| 884ac1fd-4de6-48a9-958a-050168c3c3e9 | 6 | 6 | 0 |
| 4a43318e-32f5-4099-90f2-847e3bd18e7d | 6 | 6 | 0 |
| 8d00e36d-9ed0-46f2-9afd-9cb5e78eb27a | 6 | 6 | 0 |
| 1a2f2b1c-f00a-4715-95fe-77f6801c876a | 6 | 6 | 0 |
| c1d6cf09-d684-4264-a8b6-f5e255c88a81 | 6 | 6 | 0 |
| 6ea502f2-4569-41c1-adf5-56b9ff0c340e | 6 | 6 | 0 |
| 58569286-5656-44cc-b5ad-abb4c0c30877 | 5 | 5 | 0 |
| 558a11b8-3023-4973-8bea-3e80b2f4ad49 | 5 | 5 | 0 |
| 30e941ff-e620-4bdf-94c7-6213821c6533 | 2 | 2 | 0 |
| 66893d00-e1c2-411f-8525-67843e34b587 | 0 | 0 | 0 |
| a123450a-7fa3-4376-87fe-35626ad2dbcc | 0 | 0 | 0 |
| eb6d6db9-296c-461d-a7a6-d844d78a6463 | 3 | 3 | 0 |
| dd195dd9-8994-4126-b07c-2b8b7ad7d36d | 6 | 6 | 0 |
| 2d2f81f3-ac5b-4ffa-ac80-6f051fa9d32b | 5 | 5 | 0 |
| ff7028ed-7e8c-4769-b717-2a8dba3c605c | 6 | 6 | 0 |
| 5c62dce3-0edf-49e2-a77a-7c82bbb2cdf4 | 6 | 6 | 0 |
| 6a26a1ba-2b42-4dd3-abfe-b9212f15fad9 | 6 | 6 | 0 |
| 06dfb6a5-8e1d-4817-8f32-34c36589e8ef | 6 | 6 | 0 |
| 86802069-f1a1-4abb-90cf-b138b56e0821 | 6 | 6 | 0 |
| d072a67d-6367-4692-af3a-50e7be7236c6 | 6 | 6 | 0 |
| bb3ca30c-1e13-4079-aacd-ff4bb4b43f24 | 6 | 6 | 0 |
| 59989ff4-2f9e-4fa4-a961-587d50825737 | 6 | 6 | 0 |
| 454c1611-001f-42b8-89c1-f58a68ab0700 | 6 | 6 | 0 |
| 874aaac7-7762-48f0-82c5-5c0fec014b3e | 6 | 6 | 0 |
| 41b18bfa-7053-4c22-b066-2091d7cb1ad9 | 6 | 6 | 0 |
| 72d07939-c87b-4d9a-9359-3d38a2a29f24 | 4 | 4 | 0 |
