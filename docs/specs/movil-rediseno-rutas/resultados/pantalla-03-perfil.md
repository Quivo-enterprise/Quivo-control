# Pantalla 03 — Perfil

## Archivos tocados

- `apps/mobile/src/features/perfil/perfil-screen.tsx`: vehículo primero, conductor en una fila, listas de opciones y aplicación, y cierre de sesión al final. Se conserva la navegación, sincronización, actualización y diálogo de salida.
- `apps/mobile/src/features/vehiculo-foto/foto-vehiculo-section.tsx`: foto 16:9 con chapa y cámara, vista ampliada, estados vacíos/carga/error y detalle de fecha. El hook y los destinos de las acciones permanecen.
- `apps/mobile/src/shared/components/placa-chapa.tsx`: chapa reutilizable con Oxanium, borde de marca y escala de texto.

## Design system y huecos

Se usan `Avatar`, `Divider`, `Heading`, `Loader`, `Text` y tokens de `@quivo/design-system-native`, además de `HojaBurbuja` y `BotonBurbuja`. El botón local existente envuelve el diseño nativo y permite pasar texto escalado; el `Button` nativo no expone `allowFontScaling` para su etiqueta. `QuivoHeader` y las iniciales internas de `Avatar` tampoco exponen esa opción; no se modificaron porque están fuera de los archivos permitidos. La silueta existente, usada como estado vacío, define internamente su color y no acepta `textTertiary`; cambiar esa API también queda fuera de alcance.

## Verificación

- `npx tsc --noEmit -p .`: correcto.
- `npx eslint src`: 0 errores, 7 advertencias `react-hooks/exhaustive-deps` en archivos ajenos a este cambio.
- `npx vitest run`: 88 archivos y 1091 tests aprobados.
- Prettier aplicado a los tres archivos y `git diff --check` sin observaciones.

No se ejecutaron Metro ni adb; la revisión visual en el Motorola queda para el supervisor. No se hizo commit.

## Ajuste posterior solicitado

La tarjeta del conductor se colocó primero. La foto del vehículo queda debajo, sin título de sección, con proporción 5:2 para reducir su altura. Se redujeron separaciones verticales para mostrar las filas de Opciones, Aplicación y Cerrar sesión en la pantalla del Motorola; el `ScrollView` sigue disponible cuando el texto grande necesita más altura. TypeScript, ESLint de los dos archivos modificados y los 1091 tests volvieron a pasar.

## Detalles posteriores

Se amplió el espacio de la tarjeta del conductor: avatar de 56 dp, nombre en hasta dos líneas y datos con la pastilla de estado en una fila aparte. Con foto, el modelo y la fecha van en una tarjeta translúcida sobre la imagen; la línea inferior desaparece. En Perfil se reemplazó el carácter `‹` del encabezado por un icono de flecha centrado en un objetivo táctil de 44 dp, con los colores y el radio de QUIVO. TypeScript, ESLint de los archivos modificados y los 1091 tests pasan.

## Burbuja unificada y anclaje inferior

Conductor y vehículo comparten una sola superficie, separados por `Divider`; la sección de foto usa `embedded` para no duplicar sombra ni relleno. El contenido del `ScrollView` se organiza desde el borde inferior y el botón Cerrar sesión queda a `edge` más la zona segura. La pastilla EN ESPERA se eliminó; EN VIVO solo aparece durante el recorrido. TypeScript, ESLint de los archivos tocados y 1091 tests pasan. Falta comprobar el ajuste visual en el Motorola.

## Geometría de opciones y margen inferior

`App.tsx` ya envuelve la operación en `SafeAreaView`; Perfil duplicaba `insets.top` y `insets.bottom`. Se dejó solo `edge` (12 dp) en el encabezado y bajo Cerrar sesión, igual que en los costados. Los títulos Opciones y Aplicación se alinearon al borde exterior de sus burbujas. Las filas ahora usan `surfaceSoft`, radio interior de 22 dp, relleno simétrico de 8 dp y separación uniforme de 8 dp. El espacio antes de Cerrar sesión es 24 dp en total (gap 8 + margen 16). TypeScript, ESLint del archivo y 1091 tests pasan.

## Corrección de opciones

Se restauraron las filas sencillas con divisores, como estaban antes del ajuste de `surfaceSoft`. Cada icono, flecha y divisor queda a 12 dp visibles del borde de la burbuja (8 dp de relleno exterior + 4 dp de fila), con el mismo margen a izquierda y derecha. Se conserva la corrección del margen inferior de Cerrar sesión. TypeScript, ESLint del archivo y 1091 tests pasan.

## Dos burbujas iguales

La cabecera del perfil ahora usa dos burbujas del mismo ancho, en dos columnas: conductor a la izquierda y vehículo a la derecha. El estado EN VIVO se ubica arriba de la burbuja del conductor y sus datos debajo; EN ESPERA sigue omitido. En vehículo, el modelo queda arriba a la derecha sobre la foto y el botón “+” para tomar o cambiar foto queda abajo a la derecha. La placa se muestra abajo a la izquierda; tocar la foto aún la amplía. El estado sin foto, carga y error conserva su tratamiento. TypeScript, ESLint de ambos archivos y 1091 tests pasan. No se ejecutaron Metro ni adb.

## Flechas y ritmo de filas

Las flechas `›` y el indicador de carga se centran ahora dentro de una celda de 44 dp, igual que el círculo del icono izquierdo. Las filas de Opciones y Aplicación bajaron de 52 a 48 dp; el hueco visual entre iconos vecinos pasa de aproximadamente 9 a 5 dp, conservando un objetivo táctil mayor que 44 dp. TypeScript, ESLint del archivo y 1091 tests pasan.

## Reconstrucción geométrica de las filas

Los dos extremos de cada fila interactiva usan ahora el mismo círculo de 44 dp y radio 22. La burbuja tiene radio 30 y relleno de 8 dp, de modo que los centros quedan concéntricos a 30 dp de las esquinas. La flecha se dibuja con un trazado SVG simétrico dentro del círculo; el separador está centrado en una franja de 4 dp entre filas. TypeScript, ESLint del archivo y 1091 tests pasan.

## Ritmo de separación corregido

La franja entre filas se igualó a `quivoBubble.gap` (8 dp), el mismo espacio que rodea los controles dentro de la burbuja. El divisor queda centrado en esa franja. Prettier, TypeScript, ESLint del archivo y 1091 tests pasan.

## Botón de cambio de clave

El botón de llave conserva su destino y usa borde de marca con respuesta al toque. La confirmación y el aviso de “Próximamente” ahora aparecen en `QuivoConfirmDialog`, sin alertas nativas para este flujo. Se conservan Cancelar, Continuar y Entendido. TypeScript, ESLint del archivo y 1091 tests pasan.

## Diálogo sin icono

Se quitó la llave del diálogo de cambio de clave. `QuivoConfirmDialog` acepta `icon={null}` solo para ocultar el icono en este caso; los demás usos conservan el icono predeterminado. TypeScript, ESLint de ambos archivos y 1091 tests pasan.
