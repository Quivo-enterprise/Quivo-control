# Pantalla 02b — codex-trabajo1

## Archivos tocados

- `apps/mobile/src/features/operacion/operation-screen.tsx`: pasa la velocidad y el panel de vecinos a la barra mediante el contrato de 2b, retira sus burbujas sueltas, conserva Recentrar en el riel, mide la barra y coloca el aviso de control bajo ella. Pasa a la hoja la distancia ya calculada al próximo control.
- `apps/mobile/src/features/operacion/next-control-sheet.tsx`: muestra parada y distancia en una línea, alinea el progreso con el texto y pone Pausar/Reanudar y Finalizar en una fila. Finalizar usa outline rojo. Los callbacks y diálogos permanecen.
- `apps/mobile/src/features/operacion/control-feedback-toast.tsx`: usa la altura medida de la barra para ocupar el slot de avisos; conserva cola, deduplicación, vibración y tiempos.

## Design system y huecos

Se usan `Button`, `Heading`, `Text`, `Burbuja`, `HojaBurbuja` y los tokens `dsColors`, `dsRadius`, `dsSpace` y `quivoBubble`. Para Finalizar se usa el `Button` local, porque el botón nativo del design system no ofrece variante outline con texto y borde danger independientes.

## Dependencia de codex-trabajo2

`driver-route-card.tsx` aún no declara `velocidadKmh` ni `filaVecinos`; `vecinos-ruta-panel.tsx` aún no declara `enLinea`. No se tocaron esos archivos por la tabla de propiedad. La vista completa de tres zonas requiere que codex-trabajo2 implemente ese contrato. El panel queda montado como hijo de la barra durante `recorrido`, incluso si no hay vecinos visibles, para conservar la alerta por voz.

## Verificación

- Prettier aplicado y `git diff --check` sin observaciones.
- `npx tsc --noEmit -p .`: falla solo por las props pendientes de codex-trabajo2:
  - `operation-screen.tsx(495,13)`: `velocidadKmh` no existe en `DriverRouteCardProps`.
  - `operation-screen.tsx(506,19)`: `enLinea` no existe en `Props` de `VecinosRutaPanel`.
- `npx eslint src`: 0 errores, 7 advertencias `react-hooks/exhaustive-deps` preexistentes.
- `npx vitest run`: 88 archivos y 1091 tests aprobados.

No se ejecutaron Metro ni adb. No se hizo commit ni ningún comando de git que escriba.

## Corrección

El responsable corrigió la decisión de la Fase 2b. `operation-screen.tsx` ya no pasa `velocidadKmh` ni `filaVecinos`: pasa `<VecinosRutaPanel enLinea … />` por la nueva prop `vecinos` de `DriverRouteCard`. El panel sigue montado durante todo el recorrido, por lo que conserva su efecto de alerta por voz. La velocidad volvió a una `PildoraBurbuja` abajo a la izquierda, con número Oxanium 700, cifras tabulares y `km/h` secundario. Usa exactamente el mismo `fabsBottom` y `sheetPanY` que el riel derecho, de modo que ambos quedan anclados a la hoja y se mueven juntos. `next-control-sheet.tsx` y `control-feedback-toast.tsx` conservan los cambios válidos de la entrega anterior.

La dependencia de codex-trabajo2 cambió: `vecinos-ruta-panel.tsx` ya acepta `enLinea`, pero `driver-route-card.tsx` todavía declara `filaVecinos` y `velocidadKmh`; falta que declare y renderice `vecinos?: ReactNode`. No se tocó ese archivo. Verificación tras la corrección:

- Prettier aplicado a `operation-screen.tsx`; `git diff --check` sin observaciones.
- `npx tsc --noEmit -p .`: **1 error pendiente** en `operation-screen.tsx(501,13)`: la prop `vecinos` aún no existe en `DriverRouteCardProps`.
- `npx eslint src`: 0 errores, 7 advertencias `react-hooks/exhaustive-deps` ya presentes.
- `npx vitest run`: 88 archivos y 1091 tests aprobados.

No se hicieron commits ni se ejecutaron Metro o adb.

## Ajuste de los controles inferiores

Por indicación posterior, los botones de acción conservan la columna vertical a la derecha. La columna alinea sus controles al centro y la brújula centra su contenido dentro del objetivo táctil de 44 dp. La velocidad permanece a la izquierda, anclada a la hoja con el mismo `fabsBottom` y `sheetPanY`, ahora sin icono y con el valor y `km/h` centrados en su píldora. `Recentrar` conserva su acción y aparece en la columna también durante el recorrido con cámara libre.

- Prettier aplicado y `git diff --check` sin observaciones.
- `npx tsc --noEmit -p .`: aprobado; codex-trabajo2 ya integró la prop `vecinos` pendiente.
- `npx eslint src`: 0 errores, 7 advertencias `react-hooks/exhaustive-deps` existentes.
- `npx vitest run`: 88 archivos y 1091 tests aprobados.

No se hicieron commits ni se ejecutaron Metro o adb.
