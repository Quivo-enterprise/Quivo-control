# Pantalla 01b — fondo del login

## Archivos tocados

- `apps/mobile/src/features/auth/components/fondo-login.tsx`: componente `FondoLogin` con variantes `a`, `b` y `c`, base índigo y manchas radiales animadas. Respeta la preferencia de reducir movimiento y detiene las animaciones al desmontarse.
- `docs/specs/movil-rediseno-rutas/resultados/pantalla-01b-fondo.md`: este informe.

## Design system

- `dsColors.primary`, `dsColors.primaryStrong` y `dsColors.accent` alimentan el fondo y las manchas; proceden de `@quivo/design-system-native` mediante el puente de la app.
- El índigo noche `INDIGO_NOCHE` se declara y explica al inicio del componente porque no existe como token.
- No se usaron componentes de interfaz del design system: el fondo es puramente decorativo.

## Huecos y recomendación

- Hueco de tokens: falta un índigo noche de marca para fondos oscuros.
- Recomiendo la variante `a`: mantiene el índigo dominante y el naranja como brillo discreto, lo que favorece la lectura del texto blanco.
- El supervisor debe conectar `FondoLogin` en `vehicle-login-screen.tsx` y evaluar las tres variantes en el teléfono. No hice capturas ni pruebas visuales en Android.

## Verificación

Desde `apps/mobile`:

- `npx tsc --noEmit -p .`: salida 0, sin errores.
- `npx eslint src`: salida 0, 0 errores y 8 advertencias `react-hooks/exhaustive-deps` en archivos no modificados (`vector-logo.tsx`, `splash-screen.tsx`, `use-auth-movil.ts`, `operation-screen.tsx` y `use-gps-operativo.ts`).
- `npx vitest run`: salida 0, 88 archivos de pruebas y 1083 pruebas aprobadas. La suite imprime mensajes esperados de fallos simulados en `headless-task.test.ts`.
