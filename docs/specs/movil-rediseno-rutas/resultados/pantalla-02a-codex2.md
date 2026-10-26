# Pantalla 02a — codex-trabajo2

## Archivos tocados

- `apps/mobile/src/features/operacion/driver-route-card.tsx`: barra de 60 dp a ancho completo, estado y salida, avatar de 44 dp con `onAbrirPerfil` opcional.
- `apps/mobile/src/features/operacion/next-control-sheet.tsx`: resumen de jornada sin título repetido, nombre de parada en una línea durante `listo` y asa centrada.
- `apps/mobile/src/features/vehiculo-foto/aviso-foto-vehiculo.tsx`: aviso de una línea con icono, acción y cierre de 44 dp.

## Design system

- `Avatar`, `Badge` y `Text` en la barra; `Button`, `Heading` y `Text` en la hoja; `Text` en el aviso.
- Colores y espaciado mediante `dsColors`, `dsSpace` y `quivoBubble`; las superficies usan `Burbuja` y `HojaBurbuja` existentes.

## Huecos y puntos pendientes

- No hay componente nativo de aviso compacto con icono, acción y cierre; se compuso localmente con `Burbuja` y `Pressable`.
- El asa mide 36×4 dp usando `touch - padding` y `dsSpace.xs`; queda a 8 dp del borde superior de la hoja.
- codex-trabajo1 debe conectar `onAbrirPerfil` y quitar el `Pressable` exterior en `operation-screen.tsx`, además de alojar el aviso de foto en el slot único. No toqué ese archivo.
- La comprobación visual de 360×640 y 412×915 queda para el supervisor en el Motorola; el resumen de una línea puede recortarse en ancho reducido con nombres o códigos largos.

## Verificación desde `apps/mobile`

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src`: exit 0; 0 errores y 7 advertencias `react-hooks/exhaustive-deps` en `splash-screen.tsx` (1), `use-auth-movil.ts` (1), `operation-screen.tsx` (2) y `use-gps-operativo.ts` (3).
- `npx vitest run`: exit 0; 88 archivos y 1091 pruebas aprobados.
