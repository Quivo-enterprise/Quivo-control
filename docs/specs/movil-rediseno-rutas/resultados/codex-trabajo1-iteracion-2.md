# codex-trabajo1 · Iteración 2

## Archivos tocados

- `apps/mobile/src/features/operacion/driver-route-card.tsx`: elimina el punto duplicado del estado y conserva el Badge.
- `apps/mobile/src/features/operacion/next-control-sheet.tsx`: muestra «Punto de control N» cuando no hay nombre de parada.
- `apps/mobile/src/features/operacion/control-feedback-toast.tsx`: reemplaza la pantalla completa por una burbuja superior animada con tokens.
- `apps/mobile/src/features/operacion/vuelta-completada-banner.tsx`: comparte la burbuja del toast y ofrece «Terminar».
- `apps/mobile/src/features/vuelta-actual/aviso-designacion.tsx`: unifica designación y cancelación en burbuja con acción primaria; Molinos usa PildoraBurbuja.
- `apps/mobile/src/features/operacion/operation-screen.tsx`: usa el diálogo común para registro automático, convierte Reportar en modal de burbuja con motivos rápidos e Input multilínea, y actualiza fuentes y tokens.
- `apps/mobile/src/features/fila-salida/fila-salida-card.tsx`: presenta hora, estado, turno y acción en burbuja dentro de la hoja.
- `apps/mobile/src/features/vecinos-ruta/vecinos-ruta-card.tsx`: muestra lado, placa y distancia en filas con icono y borde según los umbrales de 500 y 300 m.
- `apps/mobile/src/features/vecinos-ruta/vecinos-ruta-panel.tsx`: ajusta márgenes al token de burbuja y deja espacio a la columna de acciones.

## Design system usado

- `Burbuja` y `PildoraBurbuja`: avisos, banner, contador, fila y vecinos.
- `Button`, `Text`, `Heading`, `Badge` e `Input`: acciones y contenido de los paneles y modales.
- Tokens `dsColors`, `dsSpace`, `dsDuration`, `dsEasing`, `dsElevation` y `fontStyle`: superficies, espaciado, animación y tipografía.

## Huecos y datos pendientes

- El design system no tiene un modal con contenido editable y motivos rápidos. Se usó una tarjeta local con radio de burbuja y botones del sistema; el modal informativo sí usa `QuivoConfirmDialog`.
- `FilaSalidaUi.vista` no expone la placa de quien sale antes ni quién sale después. No se cambió el hook ni su contrato; para mostrar «Sales detrás de PLACA» hace falta que el supervisor incorpore esos datos al contrato.
- El paquete del día tampoco expone el nombre de la parada; se muestra «Punto de control N».

## Validación visual pendiente

- No se levantó Metro ni se probó en el Moto E13, conforme a la instrucción. La build `.piloto` no puede abrir el mapa sin la API key de Google Maps.
- El toast se ancla bajo la cabecera y el banner y la designación se apilan con `top` y el alto medido del banner. Los vecinos se anclan bajo `topOverlay` y quedan fuera de su medición: al coincidir con un banner o una designación, aún puede haber solape. Hace falta resolver esa coordinación de alturas con el supervisor antes de afirmar el criterio de 360 dp.
- No se añadieron avisos de voz a vecinos.

## Verificación

- `pnpm --filter @quivo/mobile typecheck`: correcto, `tsc --noEmit` sin errores.
- `pnpm --filter @quivo/mobile lint`: correcto, 0 errores y 8 advertencias existentes de dependencias de hooks en otros archivos y en `operation-screen.tsx`.
- `pnpm --filter @quivo/mobile test`: 87 archivos y 1079 tests aprobados.
- Se ejecutaron con `XDG_CACHE_HOME=/tmp/quivo-cache` porque el almacén de pnpm predeterminado produjo `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` por sistema de archivos de solo lectura.
