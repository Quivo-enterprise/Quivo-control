# Pantalla 02b — codex-trabajo2

## Archivos tocados

- `apps/mobile/src/features/operacion/driver-route-card.tsx`: agrega `velocidadKmh` y `filaVecinos`; muestra velocidad en ruta, foto en reposo y anima la aparición/expansión de la fila.
- `apps/mobile/src/features/vecinos-ruta/vecinos-ruta-panel.tsx`: agrega `enLinea` opcional; el panel en línea devuelve la fila compacta y conserva montados sus efectos de voz.
- `apps/mobile/src/features/vecinos-ruta/vecinos-ruta-card.tsx`: agrega chips compactos con semáforo y detalle desplegable de placa, interno y antigüedad, que se repliega al tocar de nuevo o a los 6 segundos.

## Design system y reglas visuales

- Usa `Badge`, `Text`, `Heading` y `fontStyle()` para estado, velocidad, placas y datos.
- Colores, espaciado, radios y duración salen de `dsColors`, `dsSpace`, `dsDuration` y `quivoBubble`.
- La alerta delantera conserva el semáforo existente y el fondo peligro suave; números de velocidad y distancia usan cifras tabulares.
- La animación respeta reducir movimiento: en ese modo solo hace fundido.

## Compatibilidad e integración

- `enLinea` es opcional. Sin ella, el panel conserva su overlay anterior.
- La alerta por voz y sus efectos de estado permanecen antes de las decisiones de render, incluso si no se muestra la fila.
- `operation-screen.tsx` pertenece a codex-trabajo1: debe pasar `velocidadKmh` y `<VecinosRutaPanel enLinea ... />` en `filaVecinos`, manteniendo el panel montado durante el recorrido.
- No se tocaron hooks, `estado-vecinos.ts`, mapa, GPS, base de datos ni API. No se detectaron huecos del design system.

## Verificación

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src`: exit 0, 0 errores y 7 advertencias preexistentes de `react-hooks/exhaustive-deps` en `splash-screen.tsx` (1), `use-auth-movil.ts` (1), `operation-screen.tsx` (2) y `use-gps-operativo.ts` (3).
- `npx vitest run`: exit 0; 88 archivos y 1091 pruebas aprobados.
- Prettier y `git diff --check`: correctos.

## Corrección

Esta sección reemplaza el contrato y el diseño descritos arriba, conforme a la revisión de Fase 2b.

### Archivos ajustados

- `apps/mobile/src/features/operacion/driver-route-card.tsx`: `DriverRouteCard` recibe `vecinos?: ReactNode`; en ruta muestra una única burbuja a ancho completo con columna de línea de 64 dp y las filas vecinas a su lado. Solo la columna abre Perfil. Se retiraron `filaVecinos` y `velocidadKmh`; en reposo se conserva la tarjeta previa.
- `apps/mobile/src/features/vecinos-ruta/vecinos-ruta-card.tsx`: agrega las dos filas persistentes Delante y Detrás, con silueta de 40 × 24 dp, placa, distancia y prop de color lista para la silueta. El semáforo y el fondo de alerta solo se aplican a Delante. Vacío y sin datos mantienen la fila con silueta punteada.
- `apps/mobile/src/features/vecinos-ruta/vecinos-ruta-panel.tsx`: `enLinea` renderiza ambas filas, incluyendo “Buscando…” antes de recibir datos. El efecto de alerta por voz se mantiene montado y sin cambios.
- `apps/mobile/src/features/vecinos-ruta/silueta-vehiculo.tsx`: admite dimensiones explícitas para el tamaño solicitado y conserva el modo fantasma con colores del design system.

### Design system

Se usan `Burbuja`, `Heading`, `Text`, `Badge` y `fontStyle()`; dimensiones, tipografía y colores salen de `quivoBubble`, `dsSpace`, `dsFontSize` y `dsColors`. No hizo falta agregar tokens ni hay huecos del design system para esta corrección.

### Integración y límites

`operation-screen.tsx` queda fuera de los archivos de esta corrección. La integración actual pasa el panel con `enLinea` por `vecinos`; la velocidad permanece en la pantalla de operación. No se modificaron `estado-vecinos.ts`, `use-vecinos-ruta.ts`, mapa, GPS, base de datos ni API.

### Verificación de la corrección

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src`: exit 0, 0 errores y 7 advertencias existentes de `react-hooks/exhaustive-deps`.
- `npx vitest run`: exit 0; 88 archivos y 1091 pruebas aprobados.
- Prettier y `git diff --check`: correctos.
