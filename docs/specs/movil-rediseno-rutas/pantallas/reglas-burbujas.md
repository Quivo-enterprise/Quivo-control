# Reglas de las burbujas (obligatorias en toda pantalla encima del mapa)

Valores en dp. Los tokens están en `src/shared/theme/quivo-theme.ts` (`quivoBubble`) y en
`src/shared/theme/design-system.ts` (`dsSpace`, `dsColors`). **Ningún número suelto**: si falta un
valor, se agrega a `quivoBubble` con un comentario.

## 1. Medidas
| Nombre | Valor | Para qué |
|---|---|---|
| `edge` | 12 | Margen de **toda** burbuja a los 4 bordes de la pantalla. Arriba se cuenta desde `insets.top` y abajo desde `insets.bottom`. |
| `gap` | 8 | Separación entre burbujas apiladas o vecinas, y entre controles dentro de una burbuja. |
| `padding` | 8 | Relleno interior de una burbuja. |
| `touch` | 44 | Alto mínimo de todo control (botón de icono, pastilla, fila). Las acciones principales usan 52. |
| `innerRadius` | 22 | Radio de los controles que van dentro de una burbuja. |
| `radius` | 30 | Radio de la burbuja: `innerRadius + padding`, siempre concéntrico. |

## 2. Simetría
- Mismo margen (`edge`) a izquierda, derecha, arriba y abajo. Nada "flota" a una distancia distinta.
- Una burbuja ocupa **todo el ancho útil** (`left: edge`, `right: edge`) o **se alinea a un borde** (el
  riel a la derecha). Nunca una burbuja ancha a medias que deja un hueco sin uso al lado.
- Los textos de una burbuja empiezan en la misma línea vertical (la que marca `padding`). Si la burbuja
  tiene un icono en círculo, el texto de las filas siguientes se alinea con el texto, no con el icono.

## 3. Zonas (máximo tres a la vez, y siempre en el mismo lugar)
1. **Barra superior**: una sola burbuja de ancho completo. Nada más se apila arriba salvo el **slot de avisos**.
2. **Riel derecho**: una burbuja vertical de botones de 44, anclada a la derecha, **justo encima de la
   hoja** (a `gap` de su borde superior). Sube y baja con la hoja.
3. **Hoja inferior**: ancho completo, anclada abajo a `edge`.
- **Slot de avisos**: debajo de la barra superior, a `gap`. Se muestra **un solo** aviso a la vez, el de
  mayor prioridad. Los demás esperan. Los avisos (foto, permisos, designación, vuelta completada) nunca
  abren una fila nueva cada uno.
- Lo que no entra en estas zonas (velocidad, vecinos) se integra a una de ellas. No se crean burbujas sueltas.

## 4. Jerarquía
- **Una sola acción primaria** (botón lleno `primary`) por pantalla visible. Las demás van en `outline` o `ghost`.
  `danger` lleno solo en una confirmación de algo destructivo.
- El título no repite al botón: si el botón dice "Empezar día", el título no dice "Día sin iniciar".
- Cada burbuja tiene un solo propósito. Si necesita dos títulos, son dos burbujas o una lista con `Divider`.

## 5. Superficie
- Fondo `quivoBubble.surface` (opaco), borde de 1 en `quivoBubble.border` y `dsElevation(3)`. La hoja usa `dsElevation(4)`.
- Dentro, los controles van sobre `surfaceSoft` o `primarySubtle`. Nunca se apila una burbuja con sombra dentro de otra.

## 6. Tipografía y color
- `Heading` y `Text` del design system, o `fontStyle()`. Nada de `fontWeight` suelto, `textMuted` ni `variant="muted"`.
- Los números que cambian (velocidad, distancias, cuentas regresivas) usan `fontVariant: ['tabular-nums']`.
- Cero hex sueltos: colores de `dsColors`.

## 7. Movimiento
- Al aparecer y desaparecer: fundido + 8 dp de desplazamiento, `dsDuration.base`, con driver nativo.
- Nada se mueve sin un motivo. Con reducir movimiento activado, solo fundidos.
