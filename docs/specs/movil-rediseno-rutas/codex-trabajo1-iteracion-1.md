# codex-trabajo1 · Iteración 1 — Primitivas de burbuja y pantalla del mapa

Lee primero `docs/specs/movil-rediseno-rutas/README.md` y `ux-propuestas-equipo.md` y cúmplelos.
Esta iteración aplica **UX-1, UX-2, UX-3 y la parte visible de UX-5** (las propuestas del equipo). Trabajas en `apps/mobile`.
En paralelo, codex-trabajo2 migra `src/shared/components/*` y las pantallas de auth: no los toques.

## A) Primitivas de burbuja — `src/shared/components/burbuja/` (nuevo)
Una sola forma de hacer cada cosa (principio 6 de Rutas). Todo sobre `quivoBubble` y los tokens del design system.
- `Burbuja`: contenedor flotante. `padding`/`gap` = `quivoBubble.padding`/`gap`, radio `quivoBubble.radius`,
  superficie, borde con tinte de marca y `elevation` según el README. Props: `style`, `children`, `direction` (`row` | `column`).
- `BotonBurbuja`: botón solo icono de 44 × 44, circular, icono centrado. Obligatorio `accessibilityLabel`.
  Variantes: `neutral` (icono primario sobre superficie) y `activo` (fondo `accentSoft`, icono `accentStrong`).
  Estado presionado con opacidad/escala sutil (`duration.fast`).
- `PildoraBurbuja`: píldora de 44 px de alto con icono + texto (ej. "Centrar", "Vuelta 2", "Vía Molinos").
  Radio `quivoBubble.innerRadius` cuando va dentro de una `Burbuja`, píldora completa cuando va suelta.
- `HojaBurbuja`: contenedor de la hoja inferior (radio superior `quivoBubble.radius`, margen lateral `quivoBubble.edge`,
  separada del borde inferior por `quivoBubble.edge` + safe-area, como las burbujas inferiores de Rutas).
  Solo presentación: el arrastre (`panY`, `onAlto`) sigue viviendo en `NextControlSheet`.
- `index.ts` que exporte las cuatro. Comentarios breves en español, como el resto del repo.

## B) Pantalla de operación — `src/features/operacion/operation-screen.tsx`
Solo `StyleSheet` y JSX de presentación; la lógica, los efectos y los callbacks quedan idénticos.
1. **Cabecera — UX-1** (`DriverRouteCard`): `Burbuja` arriba a la izquierda (margen `edge` + safe-area) con
   insignia de la línea en su color (cuadro con el código, como la insignia de Rutas) y estado como `Badge` del design
   system con punto: EN ESPERA / EN RUTA / EN PAUSA (`gps.pausadoDesde` indica pausa). "Salida HH:MM" solo antes de
   iniciar y si `contexto.asignacion.horaSalida` existe. Sigue siendo el botón que abre Perfil (cambia su
   `accessibilityLabel` a algo como "Línea 16, en ruta. Abrir perfil"). Puedes agregar props a `DriverRouteCard`.
2. **Columna de FABs — UX-5** (observación, info de registro, brújula, ver ruta, debug): una sola `Burbuja` vertical
   a la derecha con `BotonBurbuja` dentro (gap 8). El de observación pasa a ser **Reportar** y es el más visible
   (primero arriba, variante con fondo de acento; `accessibilityLabel` "Reportar un problema"). La brújula, un poco
   más grande dentro de su círculo de 44. Quita los hex `#3127B1` / `#FD9E15`: usa tokens.
3. **Velocidad y "Centrar" — UX-2**: se quita `NavigationInstructionCard` de arriba (distancia al control). La velocidad
   va en una `PildoraBurbuja` pequeña abajo a la izquierda, sobre la hoja y siguiendo su arrastre (`sheetPanY`), solo con
   recorrido activo. "Centrar" (modo libre) se apila encima de la velocidad.
4. **Avisos en `topOverlay`** (permiso GPS, sesión no revalidada, sesión vencida, asignación vencida, error de paquete,
   offline): un patrón único de aviso en burbuja: icono + texto + (si hay) `Button` del design system en `danger`
   a todo el ancho, radio interior concéntrico. Mismos textos y mismo `accessibilityRole="alert"`.
5. `SenalGpsDebilChip`: al lenguaje de píldora.

## C) Hoja inferior compacta — UX-3 — `src/features/operacion/next-control-sheet.tsx`
- Envolver con `HojaBurbuja`. Asa de arrastre centrada (40 × 4, `borderStrong`).
- En ruta: etiqueta pequeña "Siguiente parada" (`Text` `sm`, `textTertiary`), **nombre de la parada** con `Heading`
  (agrega la prop `nombreProximaParada` y pásala desde `operation-screen.tsx` con el nombre del próximo punto que
  ya calcula), puntos de progreso y "Finalizar ruta". Sin "#N", sin píldora "Vuelta N", sin contador textual.
  "Vía Molinos" se mantiene como `PildoraBurbuja` cuando aplica. Objetivo: **casi la mitad de alto** que hoy.
- Antes de iniciar: "Día sin iniciar" con `Heading` + la acción principal, igual de compacto.
- Stepper de puntos: círculos de igual tamaño, el actual en acento, estados distinguibles por forma además del color.
  Mantén la etiqueta accesible de progreso y agrégale la vuelta ("Vuelta 2, punto 3 de 16").
- Acciones del recorrido (Empezar día, Iniciar, Pausar/Reanudar, Finalizar) con `Button` del design system:
  un solo `primary`; Finalizar en `danger` u `outline` según el grupo; alto ≥ 48 px; `loading` donde ya había spinner.
- Textos de ayuda y error: `Text` del design system, error en `danger` debajo de la acción.
- **No cambies** cuándo se muestra cada estado. La única prop nueva permitida es `nombreProximaParada`.

## Fuera de esta iteración
Toast de control, banners de vuelta/designación, modales de observación e info, fila de salida, vecinos de ruta
(iteración 2). `route-map.tsx` (marcadores y trazado) no se toca.

## Criterio de aceptación
- En ruta, el mapa ocupa claramente más pantalla que hoy (comparar contra la lámina 04 de la propuesta).
- En 360 dp de ancho no hay textos cortados ni solapes entre cabecera, avisos, FABs y hoja.
- Todo control táctil ≥ 44 px; acciones del recorrido ≥ 48 px.
- Cero hex sueltos en los archivos que tocaste (salvo colores de línea que vienen de datos).
- typecheck, lint y test en verde. Informe en `docs/specs/movil-rediseno-rutas/resultados/codex-trabajo1-iteracion-1.md`.
