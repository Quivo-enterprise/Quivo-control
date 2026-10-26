# Pantalla 02c — codex-trabajo1

## Archivos tocados

- `apps/mobile/src/features/operacion/operation-screen.tsx`: organiza los avisos en el slot prioritario, mueve allí GPS, designación, vuelta y foto; ancla el contador junto a la velocidad y conserva sus condiciones de visibilidad; ajusta el modal de incidencia.
- `apps/mobile/src/features/operacion/slot-avisos.tsx`: conserva un solo aviso visible, admite mensajes de dos líneas y un icono warning.
- `apps/mobile/src/features/operacion/vuelta-completada-banner.tsx`: se vuelve contenido del slot, sin posición propia ni medición; conserva su animación y duración, y muestra la acción `Listo`.
- `apps/mobile/src/features/vuelta-actual/aviso-designacion.tsx`: se vuelve contenido del slot con mensaje compacto y acción ghost; el contador queda en la misma zona inferior que la velocidad.

## Design system y huecos

Se usan `Burbuja`, `Button`, `Text`, `Heading`, `dsColors`, `dsSpace`, `dsElevation` y `quivoBubble`. No se agregan dependencias ni colores sueltos. `QuivoConfirmDialog` no ofrece un espacio para contenido arbitrario; el modal Reportar incidencia sigue usando el esqueleto local de `operation-screen.tsx`, con la cuadrícula de hasta tres columnas solicitada previamente y sin iconos.

## Contratos y límites

- No se modificaron callbacks de cierre, acciones, colas ni temporizadores del aviso de vuelta. Los componentes de designación y foto conservan sus reglas internas de visibilidad.
- `NextControlSheet` conserva la prop `gpsError`; se le pasa `null` porque el mismo aviso se presenta en el slot para evitar duplicarlo. No se editó el archivo de codex-trabajo2.
- Se mantuvieron las condiciones existentes de conexión y GPS. En particular, el aviso de conexión respeta `!settings.trabajarOffline && isOffline`; generalizarlo a todo estado offline habría cambiado una condición de visibilidad.
- El contador y la velocidad conservan sus condiciones actuales y comparten una fila inferior para no ocultar ninguno.
- No se tocaron los diálogos compartidos, que pertenecen a codex-trabajo2.

## Verificación

- Prettier aplicado; `git diff --check` sin observaciones.
- `npx tsc --noEmit -p .`: aprobado.
- `npx eslint src`: 0 errores; 7 advertencias `react-hooks/exhaustive-deps` existentes.
- `npx vitest run`: 88 archivos y 1091 tests aprobados.

No se ejecutaron Metro ni adb. No se hicieron commits ni comandos de git que escriban.
