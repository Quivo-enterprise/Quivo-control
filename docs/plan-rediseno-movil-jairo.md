# Plan — integrar el rediseño móvil de Jairo (`feat/mobile-rediseno-rutas`) después del piloto

> Decisión del CTO (27/10): **no se mergea nada de esta rama antes del piloto del jueves 29/10
> a las 9:00 (30 usuarios).** Después del piloto se trae por partes, empezando por el login.

## Objetivo

Traer a `main` el login nuevo y lo que sirva de UI/UX de la rama de Jairo, en PRs chicos,
probados en teléfono real y sin poner en riesgo el GPS del recorrido.

## Estado de la rama (revisado 27/10 sobre `7858117`)

- 41 commits, 110 archivos, +9109/−3573. Solo JS (sin cambios nativos), más un paquete nuevo
  `packages/design-system-native`. Nada de `apps/web` ni de admin.
- `tsc --noEmit` ok · tests 1099/1099 · lint 0 errores, 7 avisos `exhaustive-deps` (3 en
  `operation-screen.tsx`, que la rama reescribe; no comparado contra `main`).
- **Visto en emulador (build debug local):** splash, login (placa recordada + teclado PIN +
  saludo en quechua/aymara/guaraní sobre la aurora), mapa en reposo, Perfil y Ajustes.
- **No probado:** Empezar día, pantalla en ruta (avisos, fila, vecinos, modal del vecino),
  elegir turno con varios turnos. Tampoco pasó `/code-review`, `/ponytail-review` ni Codex.

## Pasos (un PR por paso, base `main`, en este orden)

1. **Login + splash + pantalla de carga** — el más valioso.
   `vehicle-login-screen.tsx`, `splash-screen.tsx`, `components/{fondo-login,saludo-idiomas,
   pantalla-carga,linea-progreso,vector-logo}.tsx`, `saludos.ts`, `teclado-pin.ts` (+test),
   `ultima-placa.ts`, y lo que usen de `design-system-native` / `shared/components`.
   El login es de **un paso**: placa + **PIN del conductor** (no el del vehículo).
2. **Elegir turno**: `assignment-selection-screen.tsx`, `turnos-core.ts` (+test) y el cambio de
   `use-auth-movil.ts` (mensaje de selección vencida, + `use-auth-movil.seleccion-vencida.test.ts`).
3. **Perfil + Ajustes**, con dos cambios sobre lo de Jairo:
   - **Quitar el interruptor "Trabajar sin conexión"** (decisión CTO 27/10: la app siempre está
     online y se reconcilia sola). Hoy es un interruptor sin efecto: `trabajarOffline` solo lo lee
     `ajustes-screen.tsx` (ya era así en `main`). Se quita el switch y el campo
     `trabajarOffline` de `use-operacion-settings.tsx`. **Ojo:** lo que se va es el switch,
     **no** el outbox de SQLite: esa cola es justamente lo que reconcilia los eventos
     cuando se corta la señal y se queda.
   - Cambiar "0.1.0 · integrada" por algo sin lenguaje técnico (la propia spec lo pide).
4. **Mapa en ruta** (lo de más riesgo: `operation-screen.tsx`, `next-control-sheet.tsx`,
   `slot-avisos.tsx`, `burbuja/`, `fila-salida-card.tsx`, `vecinos-ruta/*`,
   `aviso-designacion.tsx`, `control-feedback-toast.tsx`). Toca la pantalla del recorrido:
   prueba en la calle con GPS real antes de la OTA a todos.

## Criterios para cada PR

- Rama desde `main` actualizado; `typecheck`, `test`, `lint` en verde.
- `/code-review` + `/ponytail-review` (+ Codex `verify-fix` si es `fix:` y hay cuota).
- Probado en **teléfono real**:
  - Paso 1: tipear el PIN **rápido** (en el emulador se perdió un dígito con toques rápidos;
    el código usa updater funcional, así que puede ser el emulador, pero hay que descartarlo).
  - Aurora y saludo animados: fluidez en el teléfono más barato del piloto.
- Antes de la OTA: `eas fingerprint:compare` contra el runtime del APK 17 (`8bd0b896`). El
  paquete `design-system-native` es JS, pero se confirma; si cambia el runtime, la OTA no le
  llega al APK 17.
- OTA primero a un dispositivo de prueba, después a todos.

## Trampas

- **Dev builds sin HTTP (bug en `main`, aparte de esta rama):**
  `plugins/withAndroidNetworkSecurityConfig.js` pone `cleartextTrafficPermitted` dentro de
  `<debug-overrides>`, pero Android solo acepta `<trust-anchors>` ahí: la excepción de QUI-357
  no tiene efecto y el dev client falla con "CLEARTEXT communication … not permitted". El
  release no se afecta. Arreglo sugerido: un `network_security_config.xml` en el source set
  `src/debug/res/xml/` con cleartext permitido (solo entra en la variante debug).
- **Entorno local:** `apps/api/.env` apunta a `quivo_control_e2echeck`, que tiene la migración
  `20260923090000_refresh_token_hash_anterior` fallida. Para probar se usó una base nueva
  `quivo_control_jairo` (migraciones + seed). Los PIN del seed salen de `MOBILE_SEED_*_PIN`
  en `apps/api/.env`, no de los valores del README.
- La build debug local va con el mismo paquete `.piloto` y otra firma: hay que desinstalar el
  APK 17 del emulador para instalarla (se hizo en `quivo_trufi2`; reinstalar el APK 17 si se
  usa para pruebas de trufis).
