# Spike GPS Transistorsoft — QUI-216

**Gate GO/NO-GO del stack móvil.** Nada de M3 (app móvil + sync) arranca sin este resultado.
Ver `docs/documento-tecnico-cto.md` §6 y §12, y `docs/plan-maestro.md` (riesgo #1).

## Estado

**Código y protocolo de medición: listos.** Ejecución física de las 8h de tracking:
**pendiente** — requiere comprar la licencia Transistorsoft (~US$400 única) y un dispositivo
Android real de gama baja, ninguno de los dos disponible en este entorno de desarrollo.
Este documento no se marca como "hecho" en Linear hasta tener los números reales.

## Qué queda implementado (`apps/mobile`)

- `App.tsx`: pantalla única con botones iniciar/detener tracking, contador de puntos y
  cálculo del veredicto GO/NO-GO al detener.
- `src/gps/background-geolocation.config.ts`: config MVP — 10s / 50m en movimiento,
  motion-detection nativa, foreground service, sin auto-sync (este spike solo mide).
- `src/gps/battery-gap-monitor.ts` (+ tests): lógica pura de detección de huecos > 2 min
  y cálculo de % de batería consumido, normalizado a una jornada de 8h.
- `src/db/outbox.ts`: persistencia SQLite de cada punto (sobrevive kill de app / reboot,
  criterio de aceptación del issue).

## Protocolo de ejecución (a correr por quien tenga licencia + dispositivo)

1. Agregar la licencia Transistorsoft en `apps/mobile/app.json` → `plugins` →
   `react-native-background-geolocation` → `license`.
2. `cd apps/mobile && npx expo prebuild -p android && npx expo run:android` (o dev-build EAS)
   sobre un **Android real de gama baja** (idealmente Xiaomi/Huawei/Samsung A — fabricantes
   con battery killers agresivos).
3. Tocar "Iniciar tracking", dejar el teléfono con pantalla apagada y la app en background
   durante **8 horas continuas**, simulando movimiento urbano real (o un recorrido real).
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
