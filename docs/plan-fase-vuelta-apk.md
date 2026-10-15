# Plan — fase de la vuelta (ida/regreso), PC intermedios y APK nuevo (2026-10-15)

## Context

El handoff de `main` está desfasado: su punto de retome más nuevo es el de 05:50 del 14/10. El de
08:00 vive en la rama de #160, sin mergear. Después de las 08:00 quedaron dos trabajos sin
registrar:
- Fix 2 (polilínea azul), en local y sin pushear.
- PC intermedios de la L16, sin commitear en `feat/linea-16-puntos-control-intermedios`.

**Corrección del CTO (2026-10-15):** el chofer no debe ver los PC ni el trazado del regreso
mientras va de ida, y al revés tampoco. Esto resuelve la doble detección de los intermedios, que
aparece porque ida y regreso comparten calles. También resuelve el reporte original de la
rotonda: el chofer veía la otra pasada.

## Estado real (verificado con git y gh)

- **En `main`:** #150–#158. Eso incluye las vueltas en el servidor (#154), la foto (#155), la web
  de Molinos (#157) y el trazado (#158).
- **#159, F1-mobile (aviso de Molinos):** abierto, con `ci` y `acceptance` en verde, cabeza
  `0c1f80e`.
- **#160, piloto de 3 trufis:** abierto y en verde. Ya está aplicado en prod y trae el handoff de
  las 08:00.
- **#105, script de asignaciones del 08/10:** viejo, probado solo contra un mock. Decidir si se
  cierra.
- **Fix 2 (`4ce90b8`):** worktree `fix2-polilinea` sobre `f21ebc1`, que es el primer commit de
  #159. No comparte archivos con los commits posteriores de #159, así que el rebase debería ser
  limpio. Sin `/code-review`.
- **PC intermedios:**
  - El geojson planea 11 PC: SR 0, km 2–14 en órdenes 1–7, Honduras 8, km 16 en 9 y Molinos 10.
  - La renumeración pasa a orden de marcha.
  - Tests de `scripts/lib` 46/46.
  - No hay ningún doc ni plan que los registre.
- **Deploy de API + web a prod:** pendiente. El APK nuevo **depende** de él, porque usa
  `/mobile/vuelta-actual` y el `rol` del paquete del día.

## Bloqueantes y riesgos del APK

1. **#159 contra los intermedios.** `ordenEfectivoPuntos` pone a Molinos justo después del
   retorno (`apps/mobile/src/features/operacion/progreso-vuelta.ts:75-76`). Con km 16 en medio,
   Molinos se pinta como omitido y el "próximo" salta a SR.
2. **Doble detección en el regreso.** Hay voz y notificaciones repetidas y el stepper va hacia
   atrás. Si la vuelta no arranca en SR, el contador local cuenta 2 por vuelta: el inicio se ancla
   en el primer PC pasado, no en el `rol: 'terminal'` (`progreso-vuelta.ts:136`). Se resuelve con
   las fases (paso 3).
3. **Falso `pc_omitido` de Honduras en vivo.** Los PC con `orden` mayor que Honduras lo disparan
   si se cumplen sin haber visitado Honduras
   (`apps/api/src/modules/ingesta-worker/infracciones.logic.ts:76-92`). La guarda de 250 m del
   script lo mitiga solo en parte.
4. **Orden de salida obligatorio:** deploy de la API, después el APK, después la instalación en
   los 3 trufis y recién entonces `cargar-linea-16.ts --apply`. El APK viejo no debe ver la
   renumeración ni la separación entre base y variante.
5. **Build:**
   - Variables de EAS `production` no verificadas: `GOOGLE_MAPS_ANDROID_API_KEY`,
     `TRANSISTORSOFT_LICENSE_KEY` y `SENTRY_AUTH_TOKEN`.
   - `node_modules` del checkout principal desactualizado.
   - `versionCode` remoto.
   - **No subir reanimated a 4.x**: exige la nueva arquitectura, y la app corre con la vieja.
     Quedarse en 3.19.5.
   - El primer OTA de punta a punta queda sin verificar.

## Pasos (implementa Sonnet, revisa y verifica el chairman)

1. **Housekeeping.** Mergear #160 con todos los checks en verde. Decidir #105 con el CTO.
2. **#159 y Fix 2.**
   - Mergear #159.
   - Rebasear Fix 2 sobre `main`, pushear, abrir PR, correr `/code-review` y mergear.
3. **PR nuevo `feat(mobile)`: fase de la vuelta.** Va dentro del APK.
   - **Fase:** `ida` desde el inicio (SR) hasta cumplir el PC `retorno`, y `regreso` desde ahí
     hasta SR. La fase cambia también si se cumple un PC de regreso aunque Honduras haya fallado
     por GPS.
   - **PC por fase, derivada del orden de marcha:**
     - Ida: `orden < retorno.orden`.
     - Regreso: `orden > retorno.orden`, más `espera` si hay designación.
     - `terminal`: en las dos fases.
     - Solo los PC de la fase actual se detectan, se anuncian y se muestran.
   - **Trazado por fase.**
     - Función pura nueva en `packages/shared`: `partirCircuitoPorRetorno(geometria, coordRetorno)`.
       Corta la geometría en la primera pasada a menos de 150 m del retorno, recorriendo desde el
       inicio.
     - `route-map.tsx` dibuja solo el tramo de la fase. En regreso con designación suma el tramo
       de la variante.
     - `snap-ruta.ts` se pega solo al tramo de la fase.
   - **Molinos:**
     - Si `espera.orden > retorno.orden`, usar el `orden` de la base de datos.
     - Si no, que es la numeración vieja, dejarlo después del retorno como hoy.
   - **Anclar el inicio de la vuelta en `terminal`** cuando haya roles.
   - Con 3 PC y la numeración vieja, la app debe seguir funcionando igual.
   - Tests nuevos en `progreso-vuelta.test.ts`, en la función de corte y en `snap-ruta.test.ts`.
4. **PR `fix(api)`.** En vivo, `pc_omitido` solo se dispara por un cumplimiento de un PC con
   `rol` u obligatorio. Los intermedios (`rol` nulo y no obligatorios) no disparan. Gate
   `/codex-debug verify-fix`.
5. **PR de los PC intermedios** (rama actual).
   - Generar los intermedios **por fase**: ida en [0, sHonduras], regreso en [sHonduras, fin].
   - La regla de 300 m aplica solo dentro de cada fase.
   - Quitar la guarda de 250 m antes de Honduras, porque el paso 4 la vuelve innecesaria.
   - Escribir `docs/plan-pc-intermedios-l16.md`.
   - Dry-run contra prod, solo lectura. **Sin `--apply`.**
   - Correr `/code-review`.
6. **Deploy de API + web** (`scripts/deploy-gcp.sh`, ok del CTO ya dado). Verificar el health, la
   subida a GCS y `/mobile/vuelta-actual`.
7. **Breakpoint del APK.**
   - Pasar al CTO el changelog por PR: #150–#159, Fix 2, fases y `fix(api)`.
   - Hacer el pre-build:
     - `eas env:list --environment production`.
     - `pnpm install --frozen-lockfile` limpio.
     - `eas build:list` para el `versionCode`.
   - Lanzar `eas build --profile production`.
8. **Post-instalación en `1616PIL`, `PIB` y `PIC`.**
   - Probar un OTA de humo.
   - Correr `cargar-linea-16.ts --apply`, con ok del CTO ya dado para este momento.
   - En dispositivo, verificar:
     - el cambio de fase en Honduras;
     - que la rotonda muestre solo el tramo correcto;
     - el aviso de Molinos y la polilínea a zoom 16–18.
9. **Cumplimientos de la fase equivocada en el servidor:** quedan en la base de datos sin generar
   infracción. Lo anoto como F2, no bloquea.
10. **Handoff:** actualizarlo al cerrar cada PR.

## Verificación

- Typecheck y tests de `apps/mobile`, `packages/shared` y `apps/api`. Tests de `scripts/lib` con
  `tsx --test`.
- `ci` y `acceptance` en SUCCESS antes de cada merge.
- Dry-run de `cargar-linea-16.ts` con el plan de PC por fase.
- En dispositivo, con el APK nuevo: fases, trazado, Molinos y OTA.
