# Pantalla 4 — Elegir turno (selección de asignación)

Lee `README.md` y `pantallas/reglas-burbujas.md`. Archivo: `apps/mobile/src/features/auth/assignment-selection-screen.tsx`.
Aparece después del PIN cuando el vehículo tiene **más de una asignación vigente**. Es un paso de entrada,
así que pertenece a la familia del login, no a la del mapa.

## Lo que se ve hoy
- Fondo gris claro: al pasar del login (aurora índigo) a esta pantalla cambia todo, y otra vez al entrar al mapa.
- Cada tarjeta es tocable **y además** tiene adentro el botón `Seleccionar turno`: son dos blancos para lo mismo.
- `Volver a comenzar` aparece dos veces: en la cabecera y abajo.
- La hora de salida, que es lo que de verdad distingue un turno de otro, es una pastilla chica.
- El orden es el que llega del servidor.

## Diseño
- **Fondo**: `<FondoLogin variante="a" />`, el mismo del login. La aurora sigue hasta que entra el mapa.
- **Cabecera** sobre el fondo: ‹ de 44 a la izquierda (blanco al 16 % con el ícono blanco,
  `accessibilityLabel="Volver"`, que llama a `onBack`), el título `Elige tu turno` (Heading lg blanco) y debajo
  `Tu vehículo tiene más de un turno hoy.` (Text sm, blanco al 80 %). Se quita el botón de abajo.
- **Lista**: una burbuja blanca por asignación, de ancho completo, a `gap` una de otra. **Toda la burbuja es
  el botón** (`accessibilityRole="button"`) y no lleva botón interno.
  ```
  ┌──────────────────────────────────────────────┐
  │ ┌──────┐  Línea 120 — Cercado         Próximo │
  │ │ 120  │  12:00                               │
  │ │      │  Turno tarde · Ruta ida            ›  │
  │ └──────┘                                      │
  └──────────────────────────────────────────────┘
  ```
  - A la izquierda, la **columna de la línea**, igual a la de la barra del mapa en ruta: 64 de ancho, alto
    de la burbuja, color de la marca (`resolverMarcaLinea`) y logo si hay.
  - El nombre de la línea en `Heading` sm, en una línea.
  - La **hora de salida** grande: Oxanium 700 de 28 con `tabular-nums`. Sin hora, `Sin hora de salida` en
    Text md `secondary`.
  - `Turno tarde · Ruta ida` en Text sm `secondary` y un › a la derecha.
  - La pastilla `Próximo` (`primary`) marca la asignación cuya salida es la más cercana desde ahora.
- **Orden**: por hora de salida ascendente, y las que no tienen hora al final. Es solo presentación y se
  hace en el componente.
- **Cargando**: la burbuja tocada muestra un `Loader` en lugar del ›; todas quedan deshabilitadas
  (opacidad 0,6 las demás).
- **Error**: una burbuja de aviso de una línea (como las del slot) bajo la cabecera, con
  `accessibilityRole="alert"`.
- Si hay más turnos de los que entran en pantalla, la lista hace scroll y la cabecera queda fija.
- **Accesibilidad**: la etiqueta de cada burbuja es
  `"Línea 120, turno tarde, salida 12:00, próximo"`. Texto grande no aplica (es antes de la sesión), pero
  respeta el escalado del sistema.

## Archivos
- Solo `apps/mobile/src/features/auth/assignment-selection-screen.tsx`. Puedes crear componentes nuevos en
  `src/features/auth/components/`.
- Usa `FondoLogin` sin modificarlo. No toques `use-auth-movil.ts`, `App.tsx` ni las props del componente.

## Criterio de aceptación
- Login → elegir turno → mapa sin saltos de fondo hasta el mapa.
- Un toque elige el turno, y la hora de salida se lee de un vistazo.
- 360×640 con tres turnos: se ven los tres sin scroll.
- typecheck, lint y test en verde. Informe en `resultados/pantalla-04-asignacion.md`.

## Corrección del responsable (después de la primera entrega)
"No me gusta: tenemos más pantalla, que sea más bonito". En el teléfono se vio:
- Dos burbujas chicas arriba y el 70 % de la pantalla vacío.
- La columna de la línea **vacía**: no muestra `120`.
- `Línea 120 — Línea 120`: el nombre duplicado.
- Sin el subtítulo.
- El turno de las 12:00, que ya pasó, se ve igual que uno futuro.

### Nuevo diseño: tarjetas tipo boleto que llenan la pantalla
- **Cabecera** (sobre la aurora): ‹ de 44 a la izquierda; debajo, grande y alineado a la izquierda,
  `Elige tu turno` (Heading xl blanco). Abajo, `Hoy tienes 2 turnos · lunes 26 de octubre` (Text md, blanco al
  80 %, con la fecha en hora de Bolivia).
- **Las tarjetas se reparten la altura disponible**: cada una con `flex: 1` y un **mínimo de 200 dp**. Con 2
  turnos ocupan media pantalla cada uno; con 3, un tercio; con más, scroll con el mínimo.
- **Cada tarjeta** (burbuja blanca, radio 30, entera tocable):
  ```
  ┌────────────────────────────────────────────┐
  │▌120   Línea 120                  [Próximo] │  ← franja del color de la línea, 56 de alto
  │                                            │
  │   19:00                                    │  ← Oxanium 700 de 56, tabular-nums
  │   en 6 h 17 min                            │  ← Text md secondary (relativo, se actualiza cada minuto)
  │                                            │
  │   (🌙 Turno noche) (↺ Ruta vuelta) (⏱ Presentarse 18:45) │  ← pastillas, con wrap
  │                                     Elegir ›│
  └────────────────────────────────────────────┘
  ```
  - **Franja superior** del color de la marca (`resolverMarcaLinea`), con texto en el color de texto de la
    marca: el código grande (Oxanium 700 de 28), el nombre **solo si es distinto del código** (para no repetir
    `Línea 120`) y la pastilla `Próximo` a la derecha. Logo si existe.
  - **Hora de salida** gigante. Debajo, el relativo: `en 6 h 17 min` o, si ya pasó, `hace 43 min` en
    `warning`. Sin hora: `Sin hora de salida`.
  - **Pastillas** con icono:
    - el turno (`sunny` mañana, `partly-sunny` tarde, `moon` noche);
    - el sentido de la ruta;
    - `Presentarse HH:MM` si llega `horaPresentacion`.
  - Abajo a la derecha, `Elegir ›` en `primaryText`. Al tocar, el › cambia por un `Loader`.
  - Un turno **ya pasado** queda con la hora en `textSecondary`, sin `Próximo`, pero se puede elegir igual
    (no cambia la lógica).
- **Accesibilidad**: la etiqueta de cada tarjeta es
  `"Línea 120, turno noche, salida 19:00, en 6 horas 17 minutos, próximo"`.
- Lo puro (relativo, próximo, orden e ícono del turno) va en `src/features/auth/turnos-core.ts`, con tests de
  vitest en `turnos-core.test.ts`.

### Criterio de aceptación de la corrección
- Con 2 turnos, las tarjetas llenan la pantalla sin hueco abajo (márgenes de `edge`).
- La columna o franja de la línea siempre muestra el código.
- Nunca se repite el nombre de la línea.
- Se distingue de un vistazo cuál es el próximo y cuál ya pasó.
