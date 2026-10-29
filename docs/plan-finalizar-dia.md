# Plan — "Terminar el día" real + mapa de navegación (zoom, color de ruta, auto-recentrar)

## Contexto
- Hoy "Terminar el día" (`next-control-sheet.tsx:380-392`, solo visible en pausa) llama
  `gps.detener()`: encola `fin_recorrido` en el outbox y nada más. La sesión sigue abierta y en
  `/en-vivo` el vehículo cae en "Sin señal" y, desde #290, en "Inactivo" a las 3 h. Es el patrón de
  1616PIB, que pausó a las 16:25 y apagó el teléfono.
- El servidor ya marca **"Recorrido finalizado"** con un logout: `clasificarFrescura`
  (`en-vivo.service.ts:249`) evalúa `sesionCerrada && !cerradaPorSistema` antes que nada. **No hace
  falta tocar la API**: el trabajo es del móvil.
- El logout móvil (`use-auth-movil.ts:605` `logout`, `ejecutarLogout` en :1251) **no drena el
  outbox**. Si se encola `fin_recorrido` y se cierra sesión al instante, el token se revoca y el
  evento queda en el teléfono (401). Por eso el orden es: detener, drenar y recién ahí logout.
- El servidor acusa el lote al encolarlo en BullMQ (`sync.controller.ts:43-52`). `acusado` =
  durable en el servidor. `contarEventosPendientes` (`db/outbox.ts:939`) cuenta `estado != 'acusado'`.
- Mapa de navegación (`features/mapa/`, react-native-maps + Google):
  - ruta en seguimiento `COLOR_LINEA = quivoColors.primary #3226B4` y flecha `COLOR_FLECHA #3127B1`
    (`route-map.tsx:141`): son el mismo azul;
  - el zoom sale de `ZOOM_NAVEGACION = 18` y de `CURVA_ZOOM` (`camara.ts:22-30`);
  - en modo `libre` la cámara no vuelve sola: hoy hay que apretar Recentrar.

Decisiones del CTO (28/10):
- "Terminar el día" pasa a ser el cierre completo: finalizar el recorrido, enviar los datos y
  cerrar la sesión. También aparece cuando no hay recorrido.
- Sin conexión: **esperar señal**. El GPS se detiene, pero la sesión sigue abierta, se muestra un
  error y el botón queda para reintentar. No se pierden datos.
- Zoom: **+1 nivel** en toda la curva.
- Color de la ruta: "el que mejor quede en UI/UX". Elijo **fucsia `#C026D3`** con borde `#86198F`.
  Es el único tono que no usa nadie en el mapa: azul es marca, flecha y PC pendiente; naranja es
  Molinos; verde es PC pasado y parques; rojo es PC omitido; gris son las calles. Contra blanco da
  ~4.6:1.
- Auto-recentrar: en `libre`, volver solo a la flecha **5 s** después del último toque.

## Pasos (todo móvil, JS puro, sale por OTA; implementa Sonnet)

### 1. "Terminar el día" = cierre completo
- `use-gps-operativo.ts` `detener()` (:1980): que devuelva `Promise<boolean>`, con `true` si
  `fin_recorrido` quedó encolado. Hoy el `catch` (:2202) solo hace `setErrorGps`. Revisar con grep
  todos los callers.
- Nueva función `terminarDia()` en `operation-screen.tsx`, junto a `confirmarFinalizacion`:
  1. si `gps.tracking`, llamar `await gps.detener()`; si devuelve `false`, cortar y mostrar el error;
  2. drenar: `sincronizarPendientesConLease(accessToken)` (`sync-outbox.ts:298`) en bucle hasta
     `contarEventosPendientes(db) === 0`, con un tope de **~15 s**;
  3. si quedaron pendientes: mostrar "Sin conexión: no se pudo terminar el día. Tus datos quedan
     guardados en el teléfono. Inténtalo de nuevo cuando tengas señal." y **no** hacer logout;
  4. si quedaron 0: llamar `props.onLogout()`, que va a `auth.logout()` y ya maneja el lease y la
     revocación pendiente.
- Reutilizar el `QuivoConfirmDialog` de finalizar (:838-849) con texto nuevo:
  - título "¿Terminar el día?";
  - mensaje "Se finaliza el recorrido, se envían tus datos y se cierra tu sesión. Para volver a
    trabajar hoy tienes que iniciar sesión de nuevo.";
  - botones "Seguir trabajando" y "Terminar el día";
  - `confirmDisabled` y estado de carga "Enviando datos…" mientras drena.
- `next-control-sheet.tsx`:
  - el botón en pausa (:380) llama `terminarDia` a través de su prop;
  - en fase `listo` (:332) se suma un botón ghost "Terminar el día" debajo de COMENZAR RUTA;
  - **no** se agrega en fase `jornada` (ahí está "Cerrar sesión" en Perfil).
- El banner `sesionNoVigente` ("Finalizar recorrido") **no cambia**: con la sesión ya invalidada
  no se puede drenar ni hacer logout útil.
- Corregir `cerrar-sesion-dialog.tsx:15-18` solo si el texto queda falso. No cambia "Cerrar
  sesión" de Perfil.

### 2. Zoom de navegación +1
- `camara.ts`:
  - `ZOOM_NAVEGACION = 19`;
  - `CURVA_ZOOM = [[15,19],[40,18.5],[60,18],[90,17]]`;
  - actualizar el docblock de `zoomPorVelocidad`.
- `ZOOM_SEGUIMIENTO` (17) no cambia: no es navegación.
- Actualizar el docblock de `route-map.tsx:~95` ("zoom 18").

### 3. Color de la ruta
- `estilo-ruta.ts`:
  - `COLOR_LINEA = '#C026D3'` y `COLOR_CASING_LINEA = '#86198F'`, literales con una línea de por
    qué: que no se confunda con la flecha;
  - `COLOR_ESPERA` (sin seguimiento), designación y tramo OSRM no cambian.
- Actualizar el docblock de `route-map.tsx:~84-86` si nombra colores.

### 4. Auto-recentrar a los 5 s
- `use-modo-camara.ts`: constante `AUTO_RECENTRAR_MS = 5_000`.
  - Con `camara.modo === 'libre'`, un `setTimeout` despacha `recentrar`.
  - **Cada gesto sobre el mapa reinicia el timer.** Verificar que `route-map.tsx` llame
    `onPanUsuario` también estando en `libre`. Hoy podría hacerlo solo en la transición
    (:1185 y `esGestoSobreMapa`); si es así, que avise en cada gesto y el reducer lo ignore, como hoy.
  - Limpiar el timer al salir de `libre` y al desmontar.
- El reducer `modo-camara.ts` sigue puro.

## Tests (vitest, lógica)
- `camara.test.ts`: zoom 19 y la curva nueva (:17-20, :31-51, :163-177, :191-200).
- `estilo-ruta.test.ts`: color nuevo (:71-72). Los `not.toBe(COLOR_LINEA)` siguen valiendo.
- `terminarDia`: extraer la secuencia detener → drenar → logout a una función pura con dependencias
  inyectadas (`detener`, `drenar`, `contarPendientes`, `logout`, reloj). Tests:
  - con pendientes en 0, hace logout;
  - si los pendientes no bajan antes del tope, no hace logout y devuelve el error;
  - si `detener` devuelve `false`, no drena ni hace logout.
- Auto-recentrar: test del timer con `vi.useFakeTimers` si el hook se puede probar sin
  testing-library. Si no, verificarlo en el emulador.

## Verificación
- `pnpm --filter mobile test` y `pnpm -r typecheck`.
- Emulador (memoria `qa-emulador-apk17-prod`: AVD `quivo_trufi2`, `emu geo fix` con las trazas
  L16), con Metro local contra la API local y una copia de la base:
  1. recorrido, pausa, "Terminar el día": llega `fin_recorrido`, la sesión queda `cerrada` con
     `cerradaPorSistema=false`, la app vuelve al login y `/en-vivo` muestra "Recorrido finalizado";
  2. modo avión, "Terminar el día": aparece el error y la sesión sigue activa en la base; sin modo
     avión, reintentar cierra bien;
  3. en navegación: zoom más cercano y ruta fucsia distinguible de la flecha. Revisar el grosor: a
     zoom 19 `anchoLineaDp` llega al tope de 24 dp; si tapa la flecha, decidirlo con el CTO;
  4. arrastrar el mapa: a los 5 s vuelve a la flecha, y cada toque reinicia la cuenta.
- Capturas para el CTO (MCP mobile).
- Gates: `/code-review` y `/ponytail-review`. `/security-review` también, porque toca la sesión, el
  logout y el sync. UI móvil puntual: camino único, sin bake-off (regla 7.c). Codex: no verificado
  (sin cuota).
- Rama, PR, CI (`ci` + `acceptance`), merge y handoff (`docs/plan-finalizar-dia.md` + puntero).

## Entrega
- Solo JS: se entrega por **OTA**, sin APK nuevo (fingerprint sin cambios). Antes del OTA,
  changelog al CTO (memoria `apk-build-11-changelog-antes-de-lanzar`), y verificar el bundle con
  `scripts/publicar-ota.sh`. **La publicación la corre el CTO.**
- No requiere deploy de API ni web.

## Riesgos y trampas
- Carrera en el servidor: el worker puede procesar `fin_recorrido` después del logout.
  - El UPDATE de `recorridoEstado` no exige que la sesión esté activa, así que queda bien.
  - El trigger de cierre pasa la vuelta `en_curso` a `abierta_al_cierre` antes. Una vuelta vacía no
    se borra, pero `vueltaNoVacia` la excluye. Es aceptable y se anota.
- Si la red se corta entre el drenado y el logout, `ejecutarLogout` deja la revocación pendiente
  (se reintenta al abrir la app). Mientras tanto la sesión del servidor sigue abierta hasta el
  reintento o el cierre a las 3 h. Va con `shortcut:`.
- 5 s puede ser corto si el chofer está leyendo el mapa. Igual cada toque reinicia la cuenta.

## Fuera
- Rescatar la evidencia offline de una sesión cerrada por inactividad.
- Cambios en la API o la web.

## Resultado (2026-10-29)
- Implementado según el plan. Gates y riesgos aceptados: ver `docs/handoff.md` ("Terminar el día" real).
- QA emulador: "Terminar el día" verificado de punta a punta (sin conexión ⇒ error y sesión activa;
  reintento ⇒ sesión cerrada `cerradaPorSistema=false`, `fin_recorrido` recibido, app en login).
- No verificado en dispositivo: zoom, color de ruta y auto-recentrar (APK debug sin key de Maps). Validar
  en el primer teléfono con el OTA.
