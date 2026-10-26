# codex-trabajo2 · Iteración 2

## Archivos tocados

- `apps/mobile/src/shared/components/quivo-header.tsx`: añade `onBack` y `backLabel` opcionales; conserva el espacio simétrico cuando no hay acción.
- `apps/mobile/src/features/auth/assignment-selection-screen.tsx`: conecta el regreso al encabezado y elimina la zona táctil superpuesta.
- `apps/mobile/src/features/auth/splash-screen.tsx`: deja un único texto «Reintentar».
- `apps/mobile/src/features/perfil/perfil-screen.tsx`: rediseña identidad, tarjetas y navegación; mantiene sincronización, actualización y cierre de sesión.
- `apps/mobile/src/features/perfil/ajustes-screen.tsx`: usa el encabezado común, tarjetas y filas táctiles con interruptores; conserva ajustes y rescate de datos.
- `apps/mobile/src/features/vehiculo-foto/foto-vehiculo-section.tsx`: usa superficie de burbuja, estado, cargador y botón común.
- `apps/mobile/src/features/vehiculo-foto/aviso-foto-vehiculo.tsx`: adopta la superficie de aviso del mapa con texto y acciones legibles.

## Design system

`Heading`, `Text`, `Avatar`, `Badge` y `Divider` en Perfil; `Text`, `Badge`, `Divider` y `Switch` en Ajustes; `Text`, `Badge` y `Loader` en Foto. El botón compartido usa el `Button` nativo cuando corresponde. Se usan `Burbuja` y `HojaBurbuja` sin modificarlas.

## Huecos y pendientes

- El design system no tiene diálogo ni botón de icono; siguen las piezas compartidas locales.
- `Avatar` y `Badge` internos del paquete nativo aún usan `fontWeight` directo; requiere corrección del propietario del design system para garantizar Oxanium/Montserrat en Android.
- La variante `danger` + `outline` no existe como combinación en el botón nativo; el cierre de sesión usa contorno local con borde `danger`.
- Revisar visualmente a 360 dp en el Motorola; aquí no se levantó Metro ni emulador.
- El PIN visible del login se deja sin cambios por indicación del supervisor.

## Verificación

- Prettier local: archivos tocados formateados.
- `pnpm --filter @quivo/mobile typecheck`: `pnpm` no pudo abrir su almacén (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, sistema de archivos de solo lectura). Equivalente local `tsc --noEmit -p apps/mobile/tsconfig.json`: código 0 en la última ejecución. Una ejecución anterior falló por `apps/mobile/src/features/fila-salida/fila-salida-card.tsx:35` durante cambios concurrentes de otro propietario; el error ya no aparece.
- `pnpm --filter @quivo/mobile lint`: mismo bloqueo de `pnpm`. Equivalente local `eslint src`: código 0, cero errores y 9 advertencias en otros archivos o preexistentes.
- `pnpm --filter @quivo/mobile test`: mismo bloqueo de `pnpm`. Equivalente local `vitest run --passWithNoTests`: 87 archivos y 1079 pruebas aprobadas.

No se hicieron commits ni se inició Metro.
