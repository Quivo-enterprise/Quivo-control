# Pantalla 02a — codex-trabajo1

## Cambios

- `operation-screen.tsx`: la barra superior ocupa el ancho útil y pasa `onAbrirPerfil` a `DriverRouteCard`; el avatar abre Perfil. Los avisos de permiso GPS y señal débil se ubican en un único slot con prioridad. Se conservaron los callbacks existentes.
- `slot-avisos.tsx`: selecciona un aviso visible por prioridad y mantiene montados los demás mientras esperan. Incluye la fila de aviso con icono, texto de una línea, acción secundaria y cierre opcional.
- `operation-screen.tsx`: riel derecho ordenado como Reportar, WhatsApp L16, centrar/ver ruta, brújula y debug. El botón Centrar de reposo se integró al riel; acompaña `sheetPanY` y queda separado de la hoja por `quivoBubble.gap`.
- `quivo-theme.ts`: se añadió `sheetEstimatedHeight` con comentario para la posición provisional del riel antes de medir la hoja.

## Verificación

- `npx tsc --noEmit -p .`: correcto.
- `npx eslint src`: 0 errores, 7 advertencias de dependencias de hooks existentes en otros archivos o líneas no modificadas de `operation-screen.tsx`.
- `npx vitest run`: 88 archivos y 1091 tests aprobados.
- `git diff --check`: correcto.

## Pendiente según la spec

Los avisos de designación, vuelta completada y situaciones generales quedan para la fase 2c. Los estados visuales de la hoja y la implementación de la barra pertenecen a codex-trabajo2. No se hizo validación en dispositivo porque la tarea prohíbe Metro y adb.

## Ajuste posterior solicitado

La foto del vehículo se integró en la misma barra superior: se muestra su miniatura cuando existe y, si falta, un control circular con auto y «+» que abre la captura. Se quitó el aviso de foto del slot para evitar la segunda fila. El avatar conserva la apertura de Perfil. Se modificó `driver-route-card.tsx`, se creó `foto-vehiculo-control.tsx` y se actualizó `operation-screen.tsx`. Tras el ajuste: typecheck correcto, ESLint sin errores (7 advertencias preexistentes) y 1091 tests aprobados.

## Ajuste de interacción

Toda la barra superior abre Perfil. El control «+» intercepta su toque y conserva la acción de tomar foto (o abrir Ajustes cuando corresponde). Typecheck y ESLint de los archivos modificados correctos.

La cabecera se amplió 4 dp por lado para dar más espacio al estado, la foto y el perfil. El slot de avisos conserva sus márgenes. Prettier y typecheck correctos; ESLint sin errores, con dos advertencias de hooks ya existentes en `operation-screen.tsx`.

La cabecera también se subió 4 dp: ahora queda a 8 dp del área segura superior y a 8 dp de cada lateral. Prettier, typecheck y `git diff --check` correctos.

Corrección visual posterior: `App.tsx` ya envuelve la operación en un `SafeAreaView`, por lo que sumar `insets.top` en `OperationScreen` duplicaba la separación superior. La cabecera ahora queda a 8 dp del área segura real. La tarjeta subió de 60 a 76 dp de altura y se quitó el avatar de iniciales «CD»; toda la tarjeta sigue abriendo Perfil. Prettier, typecheck y ESLint de los archivos editados correctos (dos advertencias de hooks preexistentes).

Los bloques interiores de línea y foto/auto ahora se estiran a la altura útil de la cabecera, con 8 dp de relleno y radio interior de 22 dp, para seguir la curva de la burbuja exterior. Prettier, typecheck, ESLint de ambos componentes y `git diff --check` correctos.
