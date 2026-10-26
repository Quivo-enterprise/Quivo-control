# codex-trabajo1 · Iteración 1

## Archivos tocados

- `apps/mobile/src/shared/components/burbuja/burbuja.tsx`: crea Burbuja, BotonBurbuja, PildoraBurbuja y HojaBurbuja con geometría y tokens del sistema.
- `apps/mobile/src/shared/components/burbuja/index.ts`: exporta las cuatro primitivas.
- `apps/mobile/src/features/operacion/driver-route-card.tsx`: muestra insignia de línea, estado EN ESPERA / EN RUTA / EN PAUSA y hora de salida solo antes del recorrido.
- `apps/mobile/src/features/operacion/operation-screen.tsx`: retira la tarjeta de distancia, baja la velocidad, apila Centrar, agrupa acciones en burbuja vertical y unifica avisos con acción.
- `apps/mobile/src/features/operacion/next-control-sheet.tsx`: presenta una hoja compacta con la prop para el nombre de la próxima parada, progreso accesible, Vía Molinos y acciones del recorrido.

## Design system usado

- `Button`: avisos de operación y acciones de la hoja.
- `Text`, `Heading`: contenido de avisos, cabecera, hoja y píldoras.
- `Badge`: estado de la línea.
- Tokens `dsColors`, `dsSpace`, `dsRadius`, `dsDuration`, `dsElevation`, `dsFontFamily` y `dsFontSize` en las primitivas y pantallas.

## Huecos y datos faltantes

- El paquete nativo no trae botón circular solo icono ni contenedor de hoja flotante; se crearon `BotonBurbuja` y `HojaBurbuja` locales sobre los tokens.
- `PuntoControlPaqueteSchema` y `ParadaPaqueteSchema` no incluyen nombre: solo ID, orden y coordenadas. La prop `nombreProximaParada` quedó disponible, pero la pantalla usa el respaldo “Próxima parada”. Para mostrar un nombre real hace falta ampliar el dato del paquete y su contrato, fuera de la propiedad de esta iteración.

## Fuera de esta iteración y validación pendiente

- Los modales de observación e información, el toast, la fila de salida y los vecinos de ruta corresponden a la iteración 2.
- El supervisor debe comprobar en el Motorola E13 el alto real de la hoja y posibles solapes a 360 dp; no se levantó Metro ni se usó `adb` por instrucción expresa.
- Se respetaron los cambios concurrentes de otros archivos; no se hizo ninguna escritura en git.

## Verificación

- `pnpm --filter @quivo/mobile typecheck`: correcto, `tsc --noEmit` sin errores.
- `pnpm --filter @quivo/mobile lint`: correcto, 0 errores y 11 advertencias en archivos ajenos a esta iteración o hooks ya existentes de `operation-screen.tsx`.
- `pnpm --filter @quivo/mobile test`: 87 archivos, 1079 tests aprobados.
