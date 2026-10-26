# Pantalla 02c — codex-trabajo2

## Archivos ajustados

- `apps/mobile/src/features/operacion/next-control-sheet.tsx`: conserva `gpsError` en la API pero deja de dibujarlo; en pausa presenta la hora en tamaño md y la fila de terminal sustituye el bloque de parada y progreso.
- `apps/mobile/src/features/operacion/driver-route-card.tsx`: la columna cambia a fondo warning y texto legible cuando el recorrido está en pausa.
- `apps/mobile/src/features/fila-salida/fila-salida-card.tsx`: fila integrada como bloque sin burbuja anidada; muestra turno y demora cuando aplican, aviso de antigüedad y acceso a la fila con las variantes de acción requeridas. La zona informativa mantiene el gesto de arrastre y los callbacks de los botones no cambian.
- `apps/mobile/src/shared/components/quivo-confirm-dialog.tsx`: unifica icono circular, título, mensaje, acciones y superficie; permite contenido personalizado con `children` para las opciones de Reportar incidencia.
- `apps/mobile/src/shared/components/cerrar-sesion-dialog.tsx`: sin cambios; ya usa `QuivoConfirmDialog` y hereda el esqueleto común.

## Design system

Se usan `Button`, `Badge`, `Heading`, `Text`, `dsColors`, `dsSpace`, `dsRadius`, `dsElevation` y `quivoBubble`. No se agregaron tokens ni se encontró un hueco que requiera un componente nuevo.

## Integración fuera de estos archivos

`operation-screen.tsx` pertenece a codex-trabajo1. Debe trasladar `gpsError` al slot de avisos y usar `children` de `QuivoConfirmDialog` para que Reportar incidencia adopte esta familia visual. No se tocaron hooks ni lógica de fila.

## Verificación

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src`: exit 0, sin errores; 7 advertencias de `react-hooks/exhaustive-deps` en `splash-screen.tsx`, `use-auth-movil.ts`, `operation-screen.tsx` y `use-gps-operativo.ts`.
- `npx vitest run`: exit 0; 88 archivos y 1091 pruebas aprobados.
- Prettier: aplicado a los archivos permitidos.

## Ajuste visual posterior

Se quitó “Salís a las …”. “En espera” se mantiene únicamente como badge de estado, junto con “Es tu turno” y “Demorado” cuando corresponden; también se conserva el aviso “sin actualizar”.
