# Pantalla 07 — Vecinos

## Archivos

- `apps/mobile/src/features/vecinos-ruta/vecinos-ruta-card.tsx`: simplifica las filas en línea a micro, placa y distancia; conserva las flechas, el semáforo y el punto de dato viejo, y abre el perfil solo si hay vecino.
- `apps/mobile/src/features/vecinos-ruta/vecino-perfil-modal.tsx`: agrega el perfil temporal del vehículo con silueta, placa, distancia, datos disponibles y botón para cerrar.

## Design system

- Usa `Text`, `Heading`, `Button`, `fontStyle()`, `dsColors`, `dsSpace`, `dsElevation` y `quivoBubble`.
- Reutiliza `PlacaChapa` y `SiluetaVehiculo`; el tamaño 56 × 32 se pasa por sus props existentes, sin cambiar su archivo.
- El modal replica el esqueleto y los tokens de `QuivoConfirmDialog`. No se usó directamente porque su acción principal no permite la variante `outline` que exige esta pantalla; el modal local conserva una sola acción, `Cerrar`, con esa variante y alto 52.
- No faltaron tokens ni se agregaron dependencias.

## Comportamiento

- El vecino se copia al abrir el modal. La placa y el resto de los datos permanecen como estaban al abrir; la distancia solo se actualiza si la misma placa sigue en el mismo lado.
- El modal no realiza solicitudes al servidor. No se tocó la alerta por voz ni la lógica de vecinos.
- No se hizo validación visual en dispositivo.

## Verificación

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src`: exit 0, sin errores y con 7 advertencias `react-hooks/exhaustive-deps` en otros archivos.
- `npx vitest run`: exit 0; 90 archivos y 1099 pruebas aprobados.
- Prettier: aplicado a los dos archivos de código.
