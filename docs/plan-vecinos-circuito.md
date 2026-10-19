# Plan — Vecinos delante/detrás en circuito (L16)

## Contexto

Piloto del miércoles 14/10, L16, 2 trufis (PIB `f43f1a8c`, PIL `445cd1f5`). Síntomas:
- la distancia saltaba;
- el de adelante / el de atrás desaparecía a ratos;
- una vez el de adelante vio "delante" al que iba atrás.

Causas encontradas en el código (`apps/api/src/modules/tracking/vecinos-ruta.service.ts:73-148`,
`vecinos-ruta.util.ts:117-155`):

1. **Proyección global sin fase.** `ST_LineLocatePoint` busca el punto más cercano de TODO el circuito. Ida y regreso
   comparten calles o pasan cerca, así que un fix cae a veces en la ida y a veces en el regreso. El `frac` salta de
   mitad de circuito, y con él la distancia y el orden (inversión). Limitación ya documentada en
   `docs/plan-release-13-features.md:117` y `docs/plan-trazado-linea-16.md:97-103`.
2. **Sin distancia circular.** El circuito empieza y termina en Salomón Romero (`frac` 0 y 1 en el mismo lugar). Uno
   que sale y otro que llega se ven a una vuelta entera, del lado equivocado. Test `service.test.ts:477` lo documenta
   como "LIMITACIÓN CONOCIDA".
3. **Fixes malos sin filtro.** El vecino usa el último fix de `gps_sesion_resumen` sin mirar `accuracy`. PIL el
   14/10: precisión mediana 27 m, 45 saltos de más de 100 m (uno de 3,1 km) y 12,5 % de puntos a más de 50 m de la
   ruta. Un fix malo proyecta en cualquier lado.
4. **Con 2 vehículos, "desaparecer" es casi siempre cambio de fila.** Si B salta de `frac`, pasa de "delante" a
   "detrás": la fila esperada queda en "Nadie". Se arregla con 1–3.
5. **Frescura vs. lag de ingesta (a medir).** Umbral 10 min; el doc cita p95 de ingesta ~12 min. Si el lag real del
   14/10 lo supera, el vecino desaparece aunque esté en marcha. Además la posición del otro llega con atraso y la mía
   es en vivo, lo que mete error en la distancia (30 km/h × 1 min = 500 m).

**Decisión del CTO (18/10):** en un circuito, cada vehículo aparece en **una sola fila, la del lado más cercano**.
Si A ve a B delante a X m, B ve a A detrás a X m.

## Paso 0 — Confirmar con datos reales (antes de tocar código)

- Bajar por la API admin de prod (solo GET, `~/.quivo-admin-env`) las trazas del 14/10 de PIB y PIL con `ts`,
  `accuracy` y, si la API lo expone, `received_at`. También la geometría de la ruta `460c9015…` y los PCs (Honduras =
  `retorno`). Guardar en el scratchpad.
- Script de replay (scratchpad, no va al repo): cada 30 s simula lo que vio cada trufi con la lógica actual. Contar:
  inversiones (A ve a B delante y B ve a A delante), cambios de fila, saltos de distancia >300 m entre polls, y
  huecos por frescura.
- Medir lag de ingesta (`received_at − ts`). Si no está en la API: anotar "no medido" y decidir sin eso.
- **Salida:** tabla de síntomas → causa con números. Si algo no cuadra con 1–5, se replantea antes de seguir.

## Cambios (Sonnet implementa; chairman revisa)

### A. `packages/shared/src/circuito.ts` — progreso en el circuito (puro)
- Nueva `progresoEnCircuito(punto, geometria, coordRetorno | null, fase: 'ida' | 'regreso' | null)` →
  `{ progresoM, largoM, distanciaAlTrazadoM, circular }`.
  - Con retorno y fase: `partirCircuitoPorRetorno` (ya existe) y proyecta solo en la mitad de su fase. Ida → `s`;
    regreso → `largo(ida) + s`.
  - Sin retorno o sin fase: proyecta en toda la polilínea (comportamiento de hoy).
  - Reusa `proyectarEnSegmento` (privada en el mismo archivo).
  - `circular` = primer y último vértice a ≤150 m (`RADIO_CORTE_RETORNO_M`).
- Nueva `separacionCircular(miS, suS, largoM, circular)` → `{ lado: 'delante' | 'detras', distanciaM }`.
  - Circular: `d = (suS − miS) mod L`; `d ≤ L/2` → delante a `d`, si no detrás a `L − d`. Lineal: igual que hoy.

### B. API `vecinos-ruta`
- SQL: dejar de calcular `frac` en Postgres. Traer lat/lng crudos de mí y de los candidatos más la **fase de cada
  sesión**: vuelta en curso de `vueltas` con `pasoRetornoTs` no nulo → `regreso`, si no `ida`. Lo marca el worker al
  cumplir Honduras (`apps/api/src/modules/ingesta-worker/vueltas.ts:24`).
- Posición del candidato: último fix **con `accuracy ≤ 50 m` (o nula)** dentro de los 10 min. Si
  `gps_sesion_resumen.accuracy` es mala, caer a `gps_points` con `LATERAL ... ORDER BY ts DESC LIMIT 1`. Antes,
  verificar que haya índice `(sesion_id, ts)`; si no lo hay, se decide con el chairman (no migrar a ciegas).
- Geometría de la ruta y coordenadas del PC `retorno` en el `CacheTtl` existente, por `rutaId`.
- Descartar candidatos a más de `RUTA_PROXIMIDAD_TOLERANCIA_METROS` (100 m, `apps/api/src/common/geo`) de su mitad: no
  están "en tu ruta".
- `seleccionarVecinos` (`vecinos-ruta.util.ts`) pasa a recibir `progresoM` y usa `separacionCircular`. Delante = el
  más cercano con lado `delante`; detrás = el más cercano con lado `detras`.
- Query: `fase` opcional en `VecinosRutaQuerySchema` (`packages/shared/src/sync/vecinos-ruta.ts`). Si viene, manda
  para mí; si no, se deriva de `vueltas`. Compatible con los teléfonos actuales.

### C. Mobile (OTA, después de la API)
- `use-vecinos-ruta.ts` / `vecinos-ruta-api.ts`: mandar `fase` (de `progreso.fase`, ya existe en `operation-screen`).
  Mandar `lat`/`lng` solo si la precisión del fix es ≤50 m; si no, que el servidor use el último fix bueno.
- Sin cambios de UI.

## Fuera de alcance (anotado)
- Bajar el lag de ingesta (cadencia del outbox): si el paso 0 lo marca como causa de "desaparece", va en su propio
  plan. No se sube el umbral de 10 min a ciegas.
- Ruteo OSRM y línea punteada.

## Tests
- `circuito.test.ts` con la geometría real de L16 (`scripts/data/linea-16/trazado-calles.json` o la de prod):
  - punto en calle compartida, en ida y en regreso, cae en la mitad correcta;
  - cierre: uno saliendo de SR y otro llegando → detrás a pocos metros, no a una vuelta;
  - simetría: A ve a B delante a X ⇔ B ve a A detrás a X;
  - fix a 3 km → descartado.
- `vecinos-ruta.util.test.ts`: casos de `seleccionarVecinos` con progreso circular.
- `vecinos-ruta.service.test.ts` (PostGIS): reemplazar el caso "LIMITACIÓN CONOCIDA" por circuito real con fase desde
  `vueltas`; fix con accuracy mala ignorado.
- Replay del paso 0 con la lógica nueva: 0 inversiones y menos cambios de fila y saltos que con la actual.

## Verificación y cierre
- `tsc` en shared, api y mobile; tests de shared, api (integración con Postgres) y mobile; CI `ci` + `acceptance`.
- Gates: `/code-review` + `/ponytail-review` + `/security-review` (endpoint móvil y query nueva). Codex: no hay cuota
  hasta el 16/11, se anota "no verificado".
- Deploy de la API: lo corre el CTO (`scripts/deploy-gcp.sh`). Después, OTA con `publicar-ota.sh` (lo corre el CTO).
- Prueba en la calle con 2 trufis: cada uno ve al otro en una sola fila, distancias consistentes entre los dos y nada
  de inversiones al cruzar Honduras ni al volver a SR.
- Estado: aprobado por el CTO el 18/10. Implementado en `fix/vecinos-circuito`.

## Resultado (18/10)

**Paso 0, datos reales del 14/10** (PIB 1639 fixes, PIL 632; 207 polls cada 30 s; `received_at` no está en la API,
así que el lag se modeló con 0 y 160 s):

| Lógica | Desacuerdos con el orden real | Inversiones | Cambios de fila PIB/PIL | Saltos >300 m PIB/PIL |
|---|---|---|---|---|
| Vieja, lag 0 | 74 (36 %) | 0 | 43/43 | 89/89 |
| Vieja, lag 160 s | 98 (47 %) | 60 | 54/46 | 89/83 |
| Nueva, lag 0 | 0 | 0 | 4/1 | 8/7 |
| Nueva, lag 160 s | 0 | 0 | 2/1 | 10/9 |

- 69 de los 74 desacuerdos los explica la proyección en la mitad equivocada; los otros 5, el cierre en SR. Frescura:
  0 descartes. La verdad del replay usa la misma proyección por fase, así que "0 desacuerdos" es en parte por
  construcción; lo que importa es 0 inversiones y la caída de cambios de fila y saltos.
- Costo: el filtro de 100 m deja "nadie" en 26 de 414 lados de poll (fixes fuera de ruta, sobre todo en la terminal).

**Decisiones de la revisión:**
- Fallback por geometría en el servidor: si el punto queda a más de 100 m de la mitad de su fase y a menos de la otra,
  usa la otra (cubre retorno no registrado fuera de calles compartidas y el acercamiento a Honduras).
- Mi fase la manda el teléfono (mi posición es en vivo); la de los demás sale de `vueltas`. Límite conocido: en calles
  compartidas, un retorno no registrado desubica a ese vehículo (`shortcut:` en el código).
- El teléfono no manda su posición si la precisión es peor que 50 m (`PRECISION_MAX_M` en shared).
- `d == L/2` exacto es el único caso no simétrico; aceptado.
- Gates: `/code-review` (10 hallazgos: 8 aplicados, 2 aceptados con motivo), `/ponytail-review` (aplicados),
  `/security-review` sin hallazgos. Codex: no verificado (sin cuota hasta el 16/11).
- No verificado: si la variante de Molinos pasa a más de 100 m del trazado principal (un trufi esperando ahí
  saldría de la tarjeta). Se ve en la prueba en la calle.
