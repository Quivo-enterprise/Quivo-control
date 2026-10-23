# Piloto L16 22/10 — qué pasó y cómo se corrige

## Contexto
En el piloto del 22/10, los 6 trufis de L16 reportaron varios síntomas:
- la app "marca la ruta de vuelta";
- puntos de control en rojo, o 0/16;
- la flecha gira 180°;
- "sube y baja" sola;
- vecinos cruzados o que desaparecen;
- banner "Asignación vencida";
- suena pero no marca.

Se cruzaron 26 capturas y un video con:
- prod: admin API, Cloud Logging y Sentry;
- el código de la app y del servidor;
- un **replay** de las trazas GPS reales contra la lógica de fase de la app.

Objetivo: corregirlo antes del piloto, que **se movió al lunes 27/10**. Decisión del CTO del 23/10:
- entra todo lo que se pueda: Fases 0, 1 y 2;
- el arreglo de sesiones viejas va en código, no como instrucción operativa.

**Orden de entrega:**
1. Fase 0, hoy.
2. Fase 1, en OTA.
3. Fase 2.1, en API y en la misma OTA.
4. Resto de la Fase 2.

Todo antes del domingo 26 a la noche. Si se puede, una vuelta de prueba con 1 trufi el fin de semana.

Evidencia cruda: `/tmp/claude-1000/-home-shadowfreak-Documents-Quivo-App-Quivo-control/c82c592a-ed1a-4080-a245-8ed24fa71088/scratchpad/evidencia/`.

## Diagnóstico (confirmado salvo donde se indica)

**Notación de PC:** 0 = SR (terminal), 1–7 = ida, 8 = retorno (Honduras), 9–14 y 16 = regreso, 15 = Molinos.

### Causa 1, la principal: el trazado nuevo de SR (#233) invierte la fase al salir de SR. Es una regresión del 21/10 a la noche.
- **Secuencia en el servidor:**
  - 21/10, todas bien: `0,1,2…7,8,9…16,0`.
  - 22/10, todas mal, incluida PIE, que era sesión nueva: `0 → 16,14,13,12,11,10 → 7,8 → 9…16 → 0`.
- **Qué hizo #233:** la ida y el regreso salen de SR por calles distintas, separadas 84–98 m.
  - Ida: lat -17.3221, luego lng -66.2235, luego lat -17.3239.
  - Regreso: lat -17.3230 y lng -66.2226.
- **Qué hicieron los choferes:** los 5 salieron por la calle que el trazado asigna al **regreso**. A unos 740 m de SR (-17.3230, -66.2226), 3 fixes quedaron a más de 60 m de la ida y a menos de 30 m del regreso. Ahí `evaluarFixFase` (`apps/mobile/src/features/operacion/fase-vuelta.ts:102-120`) pasa la fase a **regreso**.
- **Ventana del cambio de fase:** PIB 19:08:46Z, PIE 18:39:37Z, PIC 18:54:28Z, PIL 19:15:24Z y PIF 19:00:57Z, todos en el mismo punto.
- **Por qué no se corrige:** en las calles compartidas las dos mitades están a menos de 30 m, así que nada vuelve a ida hasta la zona de Honduras, donde se separan. Por eso aparece el `…10 → 7, 8`.
- **Control del replay:**
  - Con el trazado viejo, las trazas del 22/10 dan 0 cambios de fase.
  - Con el trazado nuevo, las del 21/10 también cambian.
  - El código de fase no cambió entre el 15/10 y el 22/10.

### Causa 2, estructural: la detección de PC no mira el sentido de marcha
- Los PC de ida y de regreso están intercalados en la misma calle, a 180–400 m, y el radio es de 150 m.
- `detectarPuntosControlCercanos` (`apps/mobile/src/gps/geofence.ts:57-89`) solo mide distancia.
- Con la fase mal, la app "cumple" los PC del sentido contrario.
- El servidor acepta todo (`cumplido=true`, 0 rechazos) y genera **`pc_omitido` falsos** sobre los PC 1–6 del 22/10.
- **El rumbo lo habría resuelto:** en las calles compartidas las mitades difieren 173–180°, y el 95% de los fixes tiene velocidad ≥ 2 m/s.

### Todos los síntomas salen de la fase invertida
| Síntoma | Mecanismo |
|---|---|
| "Próximo #1", omitidos que saltan (1 a 8), "marca la vuelta" | `derivarProgresoEstaticoEnOrden` (`progreso-vuelta.ts:293-358`): pasar un PC lejano en la lista vuelve omitidos a todos los intermedios y el próximo pasa a ser SR |
| "Sube y baja" | Cambio de fase en SR y otro cerca de Honduras |
| Flecha que gira 180° (video a 10 km/h) | El mapa hace snap a la mitad de la fase (`route-map.tsx:870-896`). A menos de 2 m/s el snap acepta el segmento opuesto y toma su rumbo (`packages/shared/src/snap-ruta.ts:199-206,244-253`) |
| Vecinos cruzados, distancias que saltan | El teléfono manda `fase=regreso` y el servidor lo proyecta a media vuelta (`vecinos-ruta.service.ts:298-304`) |
| PIB, "dos pantallas a las 15:13" | Antes y después de emitir el PC 16 (19:13:10Z). Es coherente, no son dos sesiones |

### Causas secundarias
- **PIC en 0/16 todo el día:**
  - Emitió el terminal a las 18:46, antes de COMENZAR RUTA (18:49).
  - `reiniciarVuelta` borra el ancla y la geocerca de SR queda `dentro:true`: la histéresis no se resetea (`use-gps-operativo.ts:1033` contra `:1537-1600`).
  - Resultado: nunca ancla, y el "próximo" se calcula sobre la fase de regreso (14, 13, 12…).
- **PID con "Asignación vencida":**
  - Siguió con la sesión del 21/10 hasta las 20:22Z y no hizo `inicio_jornada`.
  - Recibió 401 "asignación ya no vigente" en `asignacion-del-dia` y cayó al paquete local vencido (`use-paquete-dia.ts:119-124`).
  - El banner puede quedar pegado (`:81`).
  - El headless descarta el GPS después de `venceAt` (`headless-task.ts:875-883`).
  - Nada en el servidor cierra las sesiones zombi.
- **PIF "suena y no marca", 0/16 desde las 15:41:**
  - El servidor recibió solo 184 puntos y 2 cumplimientos, contra 7/16 en pantalla: el outbox no sincronizó.
  - Sentry `QUIVO-CONTROL-CONDUCTOR-F` registró "Network request failed" 14 veces entre las 18:52 y las 19:10Z.
  - **Causa del atasco: no la sé**, hace falta el teléfono.
  - El sonido y la voz son independientes del marcado (`decidir-anuncio.ts`), así que suena aunque no se marque.
- **Vecinos que desaparecen:**
  - PIE pausó a las 19:30Z y quedó pausado 6 h.
  - PIL hizo fin + inicio a las 19:36Z.
  - PIC cerró sesión a las 20:05Z.
  - Los vecinos exigen `recorridoEstado=en_curso`. Es por diseño y no es un bug.
- **Observabilidad:**
  - Los logs de request no traen placa ni sesión.
  - El worker no usa pino y no hubo líneas en la ventana.
  - Sentry no trae tags de placa o sesión.

## Plan de corrección (recomendado)

### Fase 0: dato, hoy, sin deploy (la decide el CTO)
1. **Trazado de la ida cerca de SR:** compartir con el regreso la calle que usan los choferes (lat -17.3230 y lng -66.2226), hasta reunirse en -17.3239.
   - Dejar de usar el tramo lat -17.3221 / lng -66.2235.
   - Los vértices salen de la mediana de las 5 trazas del 22/10.
   - Quien salga por la calle vieja queda a más de 30 m del regreso, así que no cambia de fase. Es seguro en los dos casos.
2. **Edición:** en `scripts/data/linea-16/trazado-calles.json`.
   - Validar que los PC y paradas queden a ≤ 100 m.
   - Replay de todas las trazas del 21 y del 22/10: 0 cambios de fase antes de Honduras.
   - Dry-run de `scripts/cargar-linea-16.ts`.
   - `--apply` solo con 0 sesiones L16 activas y con OK del CTO.
3. **Choferes:** que reabran la app. El paquete se refresca al volver a primer plano (#232).
4. **Limpieza del 22/10:** descartar los `pc_omitido` falsos de PC 1–6 (vía `/infracciones`, CTO).

### Fase 1: OTA antes del sábado (código móvil y shared, lo hace Sonnet)
1. **Fase por sentido de marcha:**
   - `evaluarFixFase` solo cambia de fase si el rumbo del movimiento coincide con el segmento más cercano de la mitad candidata (±60°) y se opone a la propia.
   - El rumbo sale del desplazamiento, con velocidad ≥ 2 m/s y Δ ≥ 8 m, reutilizando `seleccionarRumbo` (`features/operacion/movimiento/rumbo.ts`).
   - Sin rumbo confiable, no cambia.
   - Se mantiene la regla de los 3 fixes.
2. **Compuerta de sentido en la detección de PC:**
   - Si hay rumbo confiable y difiere más de 90° del rumbo del trazado de su mitad en el PC, no se cumple.
   - Lento o sin rumbo: queda como hoy.
   - Exentos: terminal y espera.
   - Es la defensa aunque la fase falle.
3. **COMENZAR RUTA dentro del radio de SR:**
   - Anclar la vuelta en el terminal y re-armar su geocerca, igual que el `enTerminal` del servidor (`deteccion-vueltas.ts:246-264`).
   - Arregla el 0/16 de PIC.
4. **Snap y rumbo:**
   - Lento, no tomar el rumbo de un segmento opuesto (más de 120°) al último rumbo confiable.
   - Limpiar `snapPrevioRef` al cambiar de mitad (`route-map.tsx:416`).
5. **Banner pegado:** un refresco con éxito limpia `vencido` aunque el paquete sea el mismo (`use-paquete-dia.ts:81`).
6. **Test de regresión con datos reales:**
   - Fixture con las trazas del 21 y del 22/10 (`rec_*.json` recortados) más el trazado actual.
   - Afirma la secuencia `0,1…7,8,9…16,0` y sin cambios de fase antes del retorno.
   - Corre en vitest de shared y mobile.

### Fase 2: servidor y sesiones (entra antes del lunes; la 2.1 es prioritaria)
1. **Sesiones zombi:**
   - Job que cierra las sesiones cuya asignación venció (fin de jornada + gracia).
   - La app, ante un 401 "asignación no vigente", lleva a re-login en vez del banner.
   - Al cerrarse la sesión, el trigger existente deja la vuelta en `abierta_al_cierre`.
   - El cierre usa la misma regla que el logout (`auth-movil.service.ts:594-632`).
   - Lleva `/security-review`.
2. **Fase de vecinos acotada a la jornada** (`vecinos-ruta.service.ts:92-119`).
3. **Herencia de fase entre días:** solo si la última actualización fue hace menos de 2 h (`progreso-vuelta-store.ts:107-126`).
4. **Observabilidad:**
   - `sesionId` y placa en los logs de request móviles.
   - pino en el worker.
   - Tags de placa y sesión en Sentry.
   - Contador de outbox pendiente en Sentry, para diagnosticar casos como el de PIF.

**Fuera de alcance (anotado):**
- Que el servidor valide el sentido de los cumplimientos.
- Que la fase la decida el servidor: es circular, porque el servidor deriva de lo que emite la app.

## Ejecución
- Persistir el plan en `docs/plan-post-piloto-22-10-fase.md` y poner el puntero en `docs/handoff.md`.
- Una rama y un PR por fase:
  - Fase 0: `fix/trazado-sr-ida`.
  - Fase 1: `fix/fase-por-rumbo`, dividida en 2–3 subagentes Sonnet (fase y PC; ancla y snap; tests de replay).
  - Fase 2: servidor.
- Gate:
  - `/code-review` y `/ponytail-review`.
  - `/security-review` en la Fase 2, porque toca auth y sesiones.
  - Codex: no verificado, sin cuota hasta el 16/11.
- Merge cuando `ci` y `acceptance` estén en pass.
- OTA: con bundle verificado (`publicar-ota.sh`). La publica el CTO.

## Verificación
- tsc, lint y vitest en shared, mobile y api.
- Replay de todas las sesiones del 21 y 22/10: secuencia esperada y 0 cambios de fase tempranos, con el trazado corregido y con el trazado #233, para probar la defensa por rumbo.
- Emulador con GPS simulado (MCP mobile `set_location`) siguiendo la traza de PIB del 22/10: fase ida hasta Honduras, PC 1–7 en verde, flecha estable.
- Después del `--apply`: `GET` de la ruta igual al JSON y dry-run con 0 escrituras.
- En el piloto: secuencia de cumplimientos en `/reportes/recorridos/:id` y ningún `pc_omitido` en ida.

## Riesgos y decisiones abiertas
- **La Fase 1 toca el núcleo del GPS.** La mitigan el replay con más de 10 mil fixes reales y, si se puede, una vuelta de prueba el fin de semana.
  - Si el replay no da verde el domingo, el lunes va solo con la Fase 0 y la 2.1.
- **Molinos (PC 15):** no tiene traza designada en el 22/10 para el replay. La compuerta de sentido lo deja exento.
- **La Fase 0 sola elimina el disparador del 22/10**, pero la fragilidad sigue en cualquier tramo donde las mitades se separen.
- **El atasco del outbox de PIF sigue sin causa.** Hace falta revisar el teléfono (ahorro de batería, datos, versión de la OTA).
