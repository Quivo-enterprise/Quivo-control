# Plan — Espera de frecuencia desde la llegada + SALIR antes del turno (24/10/2026)

Decisión del CTO (24/10, tras la prueba en teléfono): la frecuencia base de la fila de SR se aplica
**también desde la hora de llegada** (al completar una vuelta), además de la separación entre
salidas. El botón SALIR debe permitir **salir antes** de la hora (cuando el delegado lo autoriza),
quedando registrada como `anticipada`.

Objeción registrada (chairman): con pocos trufis, la regla nueva hace esperar a un trufi aunque no
haya a quién separar. El CTO lo confirmó: es la regla del sindicato.

## Regla nueva (`calcularFilaSalida`, `packages/shared/src/fila-salida.ts`)
- 1.º de la fila: `ETA₁ = max(ultimaSalida + frec(ultimaSalida), llegada₁ + frec(llegada₁))`
  (sin `ultimaSalida`: `llegada₁ + frec(llegada₁)`).
- i-ésimo: `ETAᵢ = max(base + frec(base), llegadaᵢ + frec(llegadaᵢ))` con `base` como hoy
  (ETA anterior, o `ahora` si el 1.º está demorado).
- `llegada` = `llegadaTs` (hora real de llegada). Además el 1.º conserva `ordenTs` como piso extra
  ("mover al final" no lo habilita antes de ese instante); el i-ésimo no lo usa.
- `habilitado`, `demorado`, `esperaMs` sin cambios de semántica.

## SALIR antes del turno (app)
- `fila-salida-card.tsx`: SALIR habilitado también durante la cuenta. Si `!vista.habilitado`, al
  tocar pide confirmación ("¿Salir antes de tu turno? Solo si el delegado te autorizó. Quedará
  registrada como salida anticipada.") reusando el patrón de modal de confirmación existente; con
  turno, sale directo como hoy.
- El servidor ya calcula `anticipada` en `registrarSalida` (`fila.service.ts`); sin cambios de API.

## Despliegue
- Shared lo usan la API (`fila-datos.ts`) y la web (panel `/salidas`) → **deploy r33** (API + web).
- La app (botón) → **OTA**. La cuenta que ve el chofer viene del servidor (`vuelta-actual.fila`).

## Verificación
- Tests de `calcularFilaSalida`: llegada después de la última salida + frec (espera desde llegada),
  llegada antes (manda la última salida), sin última salida, 2.º en fila con llegada tardía, franjas.
- tsc/lint/vitest shared, api, web, mobile. `/code-review` + `/ponytail-review`.
- En teléfono: llegar a SR → "Salís a las llegada+6", cuenta regresiva, SALIR con confirmación →
  panel `/salidas` con `anticipada = true`.
