# Plan — cerrar la vuelta al llegar a la fila de SR + SR sin doble confirmación (24/10/2026)

Origen: prueba en teléfono real (Redmi, APK 16 + OTA `d3bc4849`, sesión `7288cb24` de 1616PIL) con
GPS simulado (Appium Settings) reproduciendo las trazas reales del 22/10 (`5e19c201` ida,
`4d3b08a1` regreso). Fixture: `apps/mobile/src/features/operacion/fixtures/l16-piloto-trazas.json`.

## Lo que la prueba confirmó que funciona
- Fase por rumbo: secuencia del servidor 0,1…8,9…14,16 en orden, 0 infracciones (el 22/10 la misma
  traza dio `0 → 16,14,13…`).
- Ancla en SR al COMENZAR RUTA (1/16 inmediato). Outbox: corte de red de 4 min → sincroniza al volver.
- Fila: llegada automática a SR (`Posición 1 de 1`), salida detectada por el servidor (`deteccion`).

## Problemas encontrados (objetivo de este plan)
1. **La vuelta no se cierra al llegar a la fila.** Llegó a SR 13:19, quedó en fila 18 min mostrando
   "Vuelta 1 · Próximo #1 a 16 m"; el terminal recién se emitió al arrancar (17:37:25Z). Causa: el
   terminal usa la regla de "mínimo local" de todo PC (`filtrarNuevosCumplimientos`, geofence.ts) —
   parado, la distancia no crece y no hay fixes nuevos (`distanceFilter: 15`).
2. **Doble confirmación de SR al COMENZAR RUTA dentro del radio.** `iniciar()` ancla el progreso
   (`reiniciarVueltaEnCurso`) pero la geocerca del terminal queda en `ESTADO_INICIAL`: el siguiente
   fix dispara la voz "Punto de control 1, a 20 metros" y luego el toast "alcanzado". El
   cumplimiento del terminal SÍ debe seguir yendo al servidor (abre la vuelta).
3. **El respaldo por heartbeat (`confirmarVisitasVencidas`, 90 s) no confirmó en 15 min parado.**
   Afecta a cualquier PC donde el vehículo se detiene (también el PC 6, 60 s retenido). Causa
   desconocida → diagnóstico aparte (puede ser artefacto del GPS simulado).

## Diseño
**Fix 1 — llegada a fila confirma el terminal pendiente.**
- `procesarFixFila` (`features/fila-salida/fila-salida-deteccion.ts`) informa al caller cuando
  registró una `llegada` (valor de retorno o callback opcional).
- Callers (foreground `use-gps-operativo.ts:~653` y headless `headless-task.ts:~1351`): en
  `llegada`, llaman `confirmarVisitasVencidasEnCola(..., umbralMs = 0, ...)` **restringido al PC
  terminal** — nuevo parámetro opcional `soloPuntoControlId` en `confirmarVisitasVencidas`
  (geofence.ts) y propagado por `confirmarVisitasVencidasEnCola`. Reusa la cola serializada
  (sin duplicar evidencia), `aplicarConfirmacionesForzadas` (progreso + cumplimiento) y el anuncio.
- Si no hay visita pendiente del terminal (ya confirmada, o fuera de radio) no hace nada.
- Sin cambios de servidor: `avanzarVueltas` ya cierra N y abre N+1 con el cumplimiento terminal.

**Fix 2 — silenciar el terminal anclado.**
- `iniciar()` (`use-gps-operativo.ts:~1607`), cuando `enTerminal`: registra el `terminalId` en un
  Set de módulo (junto a `aproximacionesAnunciadas`, `anuncio-punto-control.ts`).
- `anunciarPuntoControl`: no anuncia aproximación de un id silenciado.
- Toast: `setUltimaDeteccion` (use-gps-operativo.ts ~553/757/2062) se salta la confirmación de
  ese terminal en su próxima pasada y lo saca del Set. El cumplimiento se encola igual.

**Fuera de alcance (decisión):** cambiar la regla de mínimo local para PC intermedios; botón SALIR
habilitado durante la cuenta regresiva (hoy salir físicamente ya registra la salida, `anticipada`).

## Pasos
1. Diagnóstico read-only del heartbeat (problema 3) — subagente Sonnet. Si la causa es chica y
   segura, entra en este PR; si no, se documenta.
2. Implementación fix 1 + fix 2 + tests — subagente Sonnet.
3. `tsc` + lint + vitest mobile/shared; `/code-review` + `/ponytail-review`; Codex: no verificado
   (sin cuota).
4. PR → `ci` + `acceptance` → merge → OTA (`publicar-ota.sh`, la corre el CTO).
5. Re-prueba en el teléfono: regreso `4d3b08a1` desde PC 16 hasta SR + 3 min parado + salida
   (`5e19c201` idx 0–46). Criterio: al entrar a la fila, "Vuelta 1 completada" y Vuelta 2 sin
   esperar la salida; servidor con terminal emitido a la llegada; al COMENZAR RUTA en SR, sin voz
   de aproximación ni toast duplicado.

## Trampas
- No emitir dos cumplimientos del terminal (llegada + mínimo local): pasar SIEMPRE por la cola
  (`confirmarVisitasVencidasEnCola`), que marca la visita `confirmado: true`.
- Headless: el Map de estados es singleton de módulo → `filtrarSesionActual: true` ahí.
- La llegada a la fila puede ocurrir al inicio del día (COMENZAR RUTA en SR): confirmar el
  terminal ahí es correcto (el servidor lo necesita), pero sin voz/toast (fix 2).
