# Pantalla 06 — pendientes, partes A y B

## Archivos tocados

- `apps/mobile/App.tsx`: reemplaza `LoadingScreen` por `PantallaCarga`, conserva cuándo se muestra y cambia el texto normal a «Preparando tu ruta…».
- `apps/mobile/src/features/auth/components/pantalla-carga.tsx`: agrega la carga con FondoLogin, logo blanco y línea de progreso; el error muestra icono y texto del sistema en una burbuja sin progreso.
- `apps/mobile/src/features/auth/components/linea-progreso.tsx`: extrae la línea indeterminada y la lectura de reducir movimiento para compartirlas con el splash.
- `apps/mobile/src/features/auth/splash-screen.tsx`: reutiliza la línea y la lectura de reducir movimiento compartidas; conserva el resto del flujo y sus tiempos.
- `apps/mobile/src/features/auth/use-auth-movil.ts`: agrega `MENSAJE_SELECCION_VENCIDA` y transforma solo el 401 sin código `SESION_NO_VIGENTE` al seleccionar turno.
- `apps/mobile/src/features/auth/assignment-selection-screen.tsx`: añade «Ingresar PIN» en ghost y de 44 dp solo para el mensaje de selección vencida; llama a `onBack`.
- `apps/mobile/src/features/auth/use-auth-movil.seleccion-vencida.test.ts`: cubre 401 sin código y 401 con `SESION_NO_VIGENTE`.

## Design system y huecos

Se usan `Text`, `colors`, `space`, `radius`, `elevation`, `Burbuja` y los tokens `quivoBubble`. No se añadieron dependencias ni colores hex sueltos. El texto del caso de error de carga usa `Text` de React Native con la fuente de sistema, porque ese caso se presenta cuando fallan las fuentes de marca.

## Fuera de alcance

No se modificó `fondo-login.tsx`, el resto del hook ni la lógica de selección. No se ejecutaron Metro ni adb. No se hicieron commits ni comandos de git que escriban.

## Verificación

- Prettier aplicado; `git diff --check` sin observaciones.
- `npx tsc --noEmit -p .`: aprobado.
- `npx eslint src`: 0 errores y 7 advertencias `react-hooks/exhaustive-deps` existentes.
- `npx vitest run`: 90 archivos y 1099 tests aprobados, incluidos los 2 casos nuevos.
