# Pantalla 05 — Ajustes

## Archivos

- `apps/mobile/src/features/perfil/ajustes-screen.tsx`: agrupa los ajustes por recorrido, pantalla y conexión; convierte el registro automático en una fila informativa y reorganiza la ayuda para enviar el recorrido guardado.

## Design system

- Usa `Heading`, `Text`, `Switch`, `Divider`, `Button`, `dsColors`, `dsSpace`, `dsRadius`, `dsElevation` y `quivoBubble`.
- Se mantiene `useTextScale()` junto con `settings.textoGrande` en los textos de la pantalla.
- No hicieron falta tokens nuevos ni componentes externos al design system.

## Comportamiento y textos

- Los ajustes, sus valores y sus acciones se mantienen. El registro automático aparece como información sin interruptor.
- Se quitaron las pastillas redundantes y las pistas permanentes. La burbuja de ayuda aparece cuando hay puntos guardados o un estado que informar; conserva la confirmación y la acción de rescate existentes.
- Los mensajes visibles describen el recorrido guardado y su preparación para envío sin términos internos.
- Se conservaron los comentarios que explican las protecciones del rescate.

## Fuera de alcance

- No se modificaron hooks, lógica del rescate, perfil ni archivos fuera de `features/perfil/`, salvo este informe.
- No se hizo validación visual en dispositivo.

## Verificación

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src`: exit 0, sin errores y con 7 advertencias `react-hooks/exhaustive-deps` en archivos fuera de esta pantalla.
- `npx vitest run`: exit 0; 89 archivos y 1097 pruebas aprobados.
- Prettier: aplicado a `ajustes-screen.tsx`.
