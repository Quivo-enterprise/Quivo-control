# Pantalla 00 — Splash

## Archivos tocados

- `apps/mobile/src/features/auth/splash-screen.tsx`: usa `FondoLogin` variante `a`, progreso lineal, texto diferido, errores en `Burbuja` situada debajo del logo y espera mínima de 900 ms; el fundido de salida dura 200 ms.
- `apps/mobile/src/features/auth/components/vector-logo.tsx`: usa el PNG blanco aprobado para el login, con entrada de opacidad y escala y un respiro suave durante la verificación. El logo SVG anterior animaba `transform` en grupos `react-native-svg`; esa combinación es la causa probable de que no se viera en el Motorola. Sin una captura nativa no se puede confirmar la causa exacta.
- `docs/specs/movil-rediseno-rutas/resultados/pantalla-00-splash.md`: este informe.

## Design system

- `Button` primario, `Heading` md y `Text` sm en la burbuja de error; `Text` sm en el progreso.
- `colors`, `space` y `fontStyle()` para colores, separación y fuente de la leyenda; `quivoBubble` para los radios y la posición de la burbuja.
- `Burbuja` compartida para la superficie del error y `FondoLogin` existente para la aurora.

## Huecos y límites

- El design system nativo no ofrece una barra de progreso indeterminada ni un círculo de icono para este caso; ambos se implementaron localmente con tokens existentes.
- El `Button` actual del paquete aplica `fontWeight` a un `Text` de React Native. No se puede corregir la fuente desde estos archivos sin cambiar el paquete; el supervisor puede revisarlo.
- El splash nativo todavía tiene fondo blanco. Para evitar el flash, el supervisor debe cambiar `expo-splash-screen` en `app.config.ts` a `INDIGO_NOCHE` (`#14113F`) y usar `assets/images/logo-white.png` como imagen; esto requiere recompilar la app nativa.
- Se eliminó la espera adicional de 300 ms previa a `onReady`. Con una carga inmediata, la espera de 900 ms y el fundido de 200 ms apuntan a una transición de unos 1,1 s; la duración real depende del dispositivo y queda por medir en el Motorola.
- Falta comprobar en el Motorola el logo, la transición y la accesibilidad con reducir movimiento. No se ejecutaron Metro ni adb.

## Verificación

Desde `apps/mobile`:

- `npx tsc --noEmit -p .`: salida 0.
- `npx eslint src`: salida 0, 0 errores y 7 advertencias de dependencias de hooks; una en `splash-screen.tsx` ya existía y seis están en archivos ajenos.
- `npx vitest run`: salida 0, 88 archivos y 1083 tests aprobados. Prettier, TypeScript, ESLint y Vitest se repitieron después del ajuste de tiempo y mantuvieron esos resultados.
