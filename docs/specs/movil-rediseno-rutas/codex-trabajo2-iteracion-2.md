# codex-trabajo2 · Iteración 2 — Perfil, Ajustes y foto del vehículo

Lee `docs/specs/movil-rediseno-rutas/README.md`, tu informe de la iteración 1 y las **correcciones del supervisor**
anotadas al final de este archivo (si las hay, van primero).
Usa las primitivas de `src/shared/components/burbuja/` (de codex-trabajo1) y tus componentes compartidos migrados.
No crees variantes nuevas de botón, tarjeta, diálogo ni burbuja.

## A) Correcciones de la iteración 1
Aplica primero todo lo que el supervisor anote abajo, en "Correcciones".

## B) Perfil — `src/features/perfil/perfil-screen.tsx`
- Cabecera con `quivo-header` (‹ circular de 44 px, título "Perfil" centrado).
- Bloque de identidad: `Avatar` del design system (con estado EN VIVO / EN ESPERA si ya se muestra), nombre con
  `Heading`, CI/sindicato con `Text` `textSecondary`. Sin datos repetidos (si el nombre ya aparece, no va otra vez abajo).
- Secciones (vehículo, línea, turno, etc.) como tarjetas-cápsula con filas de 44 px mínimo, icono a la izquierda en
  círculo, valor a la derecha, `Divider` del design system entre filas.
- Filas que navegan (Ajustes) con chevron ›; la acción "Cerrar sesión" como `Button` `danger` `outline` al final,
  con el diálogo de cierre migrado.

## C) Ajustes — `src/features/perfil/ajustes-screen.tsx`
- Misma cabecera y mismo patrón de tarjetas-cápsula que Perfil (principio 6).
- Cada ajuste: fila con título + descripción corta y `Switch` del design system a la derecha, toda la fila táctil.
- Agrupa en secciones con título pequeño (`Text` `sm`, `textTertiary`, mayúscula inicial, no todo en mayúsculas).
- No cambies qué ajustes existen, sus valores por defecto ni `use-operacion-settings.tsx`.

## D) Foto del vehículo — `src/features/vehiculo-foto/`
- `foto-vehiculo-section.tsx`: tarjeta-cápsula con la foto en radio interior concéntrico, estado (sin foto / subiendo /
  lista / error) con `Badge` y `Loader`, acción única "Tomar foto" / "Cambiar foto" con `Button`.
- `aviso-foto-vehiculo.tsx`: aviso en burbuja con el mismo esqueleto que los avisos del mapa de codex-trabajo1
  (lee su versión en `operation-screen.tsx` y cópiala; no inventes otra).

## Criterio de aceptación
- Perfil y Ajustes se ven como la misma familia que las tarjetas de Rutas y que la hoja del mapa.
- 360 dp sin textos cortados; filas y controles ≥ 44 px; cero hex sueltos en lo que tocaste.
- typecheck, lint y test en verde. Informe en `docs/specs/movil-rediseno-rutas/resultados/codex-trabajo2-iteracion-2.md`.

## Correcciones del supervisor (iteración 1)
_(el supervisor completa esta sección antes de lanzar la iteración 2)_
