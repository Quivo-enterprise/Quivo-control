# Pantalla 01 · Login

## Qué se hizo

- `apps/mobile/src/features/auth/vehicle-login-screen.tsx`: reemplazó el formulario de dos campos por placa recordada, puntos de PIN y teclado numérico de 72 dp; conservó exactamente el degradado y el logo blanco. Añadió cambio de placa, validación antes de continuar, vibración, borrado largo, carga y reacción al error del servidor.
- `apps/mobile/src/features/auth/teclado-pin.ts`: añadió funciones puras para entrada, borrado, validación y cantidad de puntos.
- `apps/mobile/src/features/auth/teclado-pin.test.ts`: cubrió límites de 6 y 12 dígitos, borrado y puntos visibles. Se verificó el fallo de los cuatro tests antes de implementar las funciones.
- `apps/mobile/src/features/auth/ultima-placa.ts`: añadió lectura, guardado y olvido tolerantes a fallos de AsyncStorage con la clave solicitada.
- `apps/mobile/App.tsx`: envolvió `onSubmit` y guarda la placa enviada únicamente cuando la autenticación pasa a `asignacion` u `operacion`; una sesión restaurada no la sobrescribe.

## Design system y huecos

- `Heading`, `Text` y `Button` de `@quivo/design-system-native`; `Input` compartido para la placa, que usa el Input nativo del design system.
- Tokens `colors`, `space`, `radius`, `fontSize`, `duration` y `fontStyle`. El teclado circular y los puntos del PIN son piezas locales porque el paquete nativo no ofrece esos controles.
- Las transparencias de puntos y teclas se expresan con `opacity` sobre `colors.light.white`; los únicos hex en la pantalla son los cinco colores originales del degradado aprobado.

## Fuera y dudas

- No se modificaron `use-auth-movil.ts`, el esquema, la API, `@quivo/shared`, el mapa, el fondo ni el logo. No se hicieron commits ni se usaron Metro o `adb`.
- Falta comprobar visualmente en el Motorola E13 que el texto de error y el teclado caben juntos a 360×640 dp con la escala de fuente configurada por el conductor.

## Verificación

- `npx tsc --noEmit -p .`: correcto.
- `npx eslint src`: correcto, 0 errores y 8 advertencias en archivos fuera de esta pantalla.
- `npx vitest run`: 88 archivos y 1083 tests aprobados.
- `npx prettier --check` sobre los cinco archivos de código modificados: correcto.
