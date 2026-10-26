# Pantalla 04 — Elegir turno

## Archivos

- `apps/mobile/src/features/auth/assignment-selection-screen.tsx`: sustituye la cabecera duplicada y las tarjetas con botón interno por una pantalla sobre `FondoLogin`, cabecera fija y burbujas seleccionables ordenadas por hora.

## Design system

- `Heading` y `Text` para títulos, horarios y datos de turno.
- `Badge` para marcar el turno `Próximo`.
- `Loader` para mostrar la carga dentro de la burbuja tocada.
- `fontStyle('display', '700')` para la hora de salida y `fontVariant: ['tabular-nums']` para alinear sus cifras.
- `dsColors`, `dsSpace`, `dsRadius`, `dsElevation` y `quivoBubble` para color, espaciado, radios y superficie.

## Huecos del design system

El design system no tiene un tamaño tipográfico de 28. La hora usa el tamaño 28 indicado por la spec y conserva `fontStyle()` para Oxanium 700.

## Fuera de alcance

Se mantuvieron las props y las llamadas de `onSelect` y `onBack`. No se modificaron `FondoLogin`, `App.tsx`, `vehicle-login-screen.tsx` ni `use-auth-movil.ts`. No se hizo validación visual en dispositivo; corresponde al supervisor.

## Verificación

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src`: exit 0, sin errores y con 7 advertencias de `react-hooks/exhaustive-deps` en `splash-screen.tsx`, `use-auth-movil.ts`, `operation-screen.tsx` y `use-gps-operativo.ts`.
- `npx vitest run`: exit 0; 88 archivos y 1091 pruebas aprobados.
- Prettier: aplicado al archivo de la pantalla.

## Corrección

### Archivos

- `apps/mobile/src/features/auth/assignment-selection-screen.tsx`: reemplaza las burbujas compactas por tarjetas tipo boleto que comparten el alto disponible, mantiene la franja de línea con el código siempre visible y muestra nombre, hora grande, tiempo relativo, pastillas y acción de elegir.
- `apps/mobile/src/features/auth/turnos-core.ts`: concentra orden, próximo turno, tiempo relativo y presentación de nombre e icono sin dependencias de React Native.
- `apps/mobile/src/features/auth/turnos-core.test.ts`: cubre orden, próximo turno, tiempos relativos, iconos y nombres que duplican el código.

### Design system y reglas

- Usa `FondoLogin`, `Heading`, `Text`, `Badge`, `Loader`, `fontStyle()`, `dsColors`, `dsSpace`, `dsRadius`, `dsElevation` y `quivoBubble`.
- No faltaron tokens nuevos. La tarjeta usa el tamaño tipográfico 56 solicitado para la hora y 28 para el código de línea, ambos con `fontStyle('display', '700')`.
- La fecha del subtítulo y las horas se presentan en hora de Bolivia. El cálculo relativo se actualiza cada minuto; las salidas vencidas usan texto secundario y tiempo relativo de advertencia, y no reciben la insignia `Próximo`.

### Fuera de alcance

- Se conservaron las props y el comportamiento de `onSelect` y `onBack`; no se modificaron `FondoLogin`, `App.tsx` ni `use-auth-movil.ts`.
- No se hizo validación visual en dispositivo.

### Verificación

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src`: exit 0; sin errores, con 7 advertencias preexistentes de `react-hooks/exhaustive-deps` en `splash-screen.tsx`, `use-auth-movil.ts`, `operation-screen.tsx` y `use-gps-operativo.ts`.
- `npx vitest run`: exit 0; 89 archivos y 1097 pruebas aprobados.
- Prettier: aplicado a los tres archivos de código.
