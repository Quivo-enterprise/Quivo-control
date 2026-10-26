# codex-trabajo2 · Iteración 1 — Componentes compartidos al design system y flujo de entrada

Lee primero `docs/specs/movil-rediseno-rutas/README.md` y cúmplelo. Trabajas en `apps/mobile`.
En paralelo, codex-trabajo1 rehace la pantalla del mapa y crea `src/shared/components/burbuja/`: no los toques.

## A) Componentes compartidos — `src/shared/components/`
Migrar a `@quivo/design-system-native` **sin cambiar su API pública** (mismos nombres de props y mismo significado;
codex-trabajo1 y el resto de la app los siguen usando igual).
- `Button.tsx`: envolver el `Button` del design system. Mapea las variantes actuales a las del design system; si alguna
  no existe allá, resuélvela con tokens y anótala como hueco. Píldora, alto ≥ 44 px, `loading`, deshabilitado legible.
- `Input.tsx`: envolver el `Input` del design system manteniendo `controlSize`, `inputShellStyle`, `multiline`, error y label.
  Radio de píldora en una línea; radio `quivoBubble.innerRadius` en multilínea.
- `Card.tsx`: sobre el `Card` del design system (fondo `surfaceCard`, borde `borderSubtle`, radio `radius.lg`, padding `space.md`).
- `quivo-confirm-dialog.tsx` y `cerrar-sesion-dialog.tsx`: un único patrón de diálogo. Tarjeta con radio
  `quivoBubble.radius`, padding parejo, título con `Heading`, mensaje con `Text`, acciones con `Button`
  (una sola `primary`/`danger`, la otra `outline`), mismo ancho, en fila si caben a 360 dp y en columna si no.
  Fondo oscurecido con token, sin blur decorativo. Mantén las mismas props (`visible`, `variant`, `title`, `message`,
  `cancelLabel`, `confirmLabel`, `onCancel`, `onConfirm`).
- `quivo-header.tsx`: cabecera de pantallas internas: botón ‹ de 44 px circular bordeado (como el ‹ de la ficha de Rutas),
  título con `Heading`, espacio simétrico a la derecha para que el título quede centrado.

## B) Flujo de entrada — `src/features/auth/`
- `vehicle-login-screen.tsx`: **el fondo y el logo están aprobados, no se tocan.** Solo los controles: campos con el
  `Input` migrado, botón Ingresar con `Button` `accent` o `primary` (uno solo), error debajo del campo en `danger`,
  nota informativa como aviso con radio concéntrico. Ritmo de espaciado de la escala.
- `splash-screen.tsx`: estados "Preparando tu jornada", "Error de conexión" y "Esto está tardando" con `Loader`,
  `Heading`, `Text` y `Button` del design system ("Reintentar" como única acción principal). Mismos textos.
- `assignment-selection-screen.tsx`: cada asignación como tarjeta-cápsula seleccionable (patrón de tarjetas de línea de
  Rutas: insignia de línea, turno, hora de salida, ruta/sentido), ítem presionado/seleccionado con `accentSoft` y borde
  acento, alto táctil completo, sin descripciones duplicadas.
- `components/vector-logo.tsx`: no se toca.

## Fuera de esta iteración
Perfil, Ajustes y foto del vehículo (iteración 2, cuando ya existan las primitivas de burbuja de codex-trabajo1).

## Criterio de aceptación
- Ningún archivo fuera de tu propiedad cambió.
- Las pantallas que usan `Button`, `Input`, `Card` y los diálogos siguen compilando sin tocar sus llamadas.
- 360 dp sin textos cortados; controles ≥ 44 px; cero hex sueltos en lo que tocaste.
- typecheck, lint y test en verde. Informe en `docs/specs/movil-rediseno-rutas/resultados/codex-trabajo2-iteracion-1.md`.
