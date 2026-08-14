# Spike GPS Transistorsoft — QUI-216

**Gate GO/NO-GO del stack móvil.** Nada de M3 (app móvil + sync) arranca sin este resultado.
Ver `docs/documento-tecnico-cto.md` §6 y §12, y `docs/plan-maestro.md` (riesgo #1).

## Estado

**Código y protocolo de medición: listos.** Ejecución física de las 8h de tracking:
**pendiente** — requiere un dispositivo Android real de gama baja, no disponible en este
entorno de desarrollo. Este documento no se marca como "hecho" en Linear hasta tener los
números reales.

**La licencia Transistorsoft NO es un prerequisito para correr este spike** (corregido
2026-08-14 — la versión anterior de este documento lo pedía como paso 1 y eso costó un mes de
bloqueo real, ver `docs/plan-finalizacion-piloto.md`). El SDK es _fully functional_ en builds
**debug** sin ninguna key (README/FAQ oficiales de Transistorsoft) — el protocolo de abajo
corre gratis, hoy, con solo un dispositivo. El detalle de licencia por escenario está en el
protocolo.

## Qué queda implementado (`apps/mobile`)

- `App.tsx`: pantalla única con botones iniciar/detener tracking, contador de puntos y
  cálculo del veredicto GO/NO-GO al detener.
- `src/gps/background-geolocation.config.ts`: config MVP — 10s / 50m en movimiento,
  motion-detection nativa, foreground service, sin auto-sync (este spike solo mide).
  `stopOnTerminate: false` + `startOnBoot: true` + `enableHeadless: true` (corregido
  2026-08-14 — los defaults del SDK son los contrarios y hacían fallar el criterio C del GO
  sin que ninguna licencia lo arreglara).
- `src/gps/location-task.ts` (lógica pura) + `src/gps/headless-task.ts` (wiring nativo):
  grabación de un punto GPS extraída de React, compartida entre `use-gps-operativo.ts` (app
  viva) y el headless task registrado en `index.js` (app terminada) — sin este registro,
  `enableHeadless: true` no tiene ningún código propio que copie al outbox lo que el SDK
  sigue grabando en su SQLite nativa tras el kill.
- `src/gps/battery-gap-monitor.ts` (+ tests): lógica pura de detección de huecos > 2 min
  y cálculo de % de batería consumido, normalizado a una jornada de 8h.
- `src/db/outbox.ts`: persistencia SQLite de cada punto (sobrevive kill de app / reboot,
  criterio de aceptación del issue).

## Sobre el stack: correr esto sobre SDK 54 + Transistorsoft 5.4.0, no sobre el actual

El repo hoy está en **Expo SDK 52 + `react-native-background-geolocation` 4.19.4**. La
migración a **Expo SDK 54 + Transistorsoft 5.4.0** es la tarea siguiente del plan (N2 en
`docs/plan-finalizacion-piloto.md`, que ya está en `main`) — separada de este fix. **El
protocolo de abajo debe correrse sobre el stack migrado (SDK 54 + v5.4.0), no sobre el
actual**: medir batería/huecos/persistencia contra un stack que se va a tirar apenas termine
N2 no valida nada útil para el gate D1. Si este documento se ejecuta antes de que esa
migración esté mergeada, completarla primero.

## Protocolo de ejecución (a correr por quien tenga el dispositivo)

**Licencia según el escenario** — ninguno de los tres implica comprar nada hoy:

| Escenario                                                    | ¿Necesita licencia?                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Este spike** (dev-build / `expo run:android`, build debug) | No. El SDK corre completo sin key en debug — pasos 1–4 de abajo, gratis.                                    |
| Demo interna por APK release sin firma de Play               | Sí, pero sin costo: activar el [**trial gratuito de 30 días**](https://transistorsoft.com/shop/trials/new). |
| Release firmado en Google Play (producción)                  | Sí, comprar (Starter, ~US$399, perpetua, un `app-identifier`).                                              |

**La licencia v4 NO sirve para v5** (v5 usa formato JWT, incompatible con las keys v4). Como
a la fecha de esta corrección no se compró ninguna licencia todavía, cuando llegue el momento
de comprar — recién para el escenario de Play arriba — comprar directamente la v5.

1. (Solo si vas a generar una demo por APK sin firma de Play — **no hace falta para el spike
   en sí**) Activar el trial en https://transistorsoft.com/shop/trials/new y agregarlo en
   `apps/mobile/app.json` → `plugins` → `react-native-background-geolocation` → `license`.
2. Sobre el stack migrado (SDK 54 + Transistorsoft 5.4.0, ver sección de arriba):
   `cd apps/mobile && npx expo prebuild -p android && npx expo run:android` (o dev-build EAS,
   build **debug** — no necesita licencia) sobre un **Android real de gama baja** (idealmente
   Xiaomi/Huawei/Samsung A — fabricantes con battery killers agresivos).
3. Tocar "Iniciar tracking", dejar el teléfono con pantalla apagada y la app en background
   durante **8 horas continuas**, simulando movimiento urbano real (o un recorrido real).
   Para probar específicamente el criterio C (sobrevive kill / reboot), matar la app a mano
   desde el selector de apps reciente durante la ventana de medición y, si es posible,
   reiniciar el dispositivo una vez — el tracking debe seguir sin intervención manual
   (`stopOnTerminate: false` + `startOnBoot: true` + headless task).
4. Tocar "Detener y calcular veredicto" — la pantalla muestra duración, puntos, batería
   consumida (medición y estimada a jornada de 8h) y huecos > 2 min.
5. Copiar el resultado a la sección de abajo y actualizar el veredicto de este documento.

## Criterios GO (los 4 deben cumplirse)

- [ ] Consumo de batería < 5% por jornada de 8h atribuible al tracking.
- [ ] Sin huecos de tracking > 2 minutos con la app en background y pantalla apagada.
- [ ] Puntos persistidos en SQLite sobreviven kill de la app / reboot.
- [ ] Informe con números reales completado en este documento.

## Resultado de la medición

_Pendiente de ejecución física — completar tras correr el protocolo de arriba._

| Métrica                                     | Valor          |
| ------------------------------------------- | -------------- |
| Fecha de la medición                        | —              |
| Dispositivo (marca/modelo, Android version) | —              |
| Duración                                    | —              |
| Puntos GPS registrados                      | —              |
| Batería consumida (medición)                | —              |
| Batería estimada / jornada 8h               | —              |
| Huecos > 2 min detectados                   | —              |
| Puntos sobreviven kill/reboot (sí/no)       | —              |
| **Veredicto**                               | **GO / NO-GO** |

## Si NO-GO

Plan B: módulo nativo Kotlin (Foreground Service) dentro de la app Expo. Escalar a decisión
de CTO inmediatamente — impacta el timeline de M3 (`docs/plan-maestro.md`).
