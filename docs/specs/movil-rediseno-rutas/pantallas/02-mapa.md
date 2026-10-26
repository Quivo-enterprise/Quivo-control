# Pantalla 2 — Mapa (operación), por fases

Lee `README.md` y **`pantallas/reglas-burbujas.md`**: aquí se aplican al pie de la letra. El mapa en sí
(`features/mapa/`) no se toca. Las fases las define `faseControl` (`features/jornada/fase-control.ts`):
`jornada` (día sin iniciar), `listo` (día iniciado, sin ruta) y `recorrido`. El supervisor prepara en el
teléfono el entorno de cada fase; tú no necesitas provocarlas.

## Lo que se vio en el teléfono (fase `jornada`)
- La barra superior ocupa solo un 40 % del ancho y deja un hueco a la derecha.
- Arriba hay unos 34 dp hasta la barra, pero a los costados solo 10. Abajo, la hoja queda a unos 30 dp del borde.
- El aviso de foto abre una segunda fila arriba y se come altura.
- El riel flota a media altura, desconectado de la hoja.
- La hoja dice "Día sin iniciar" y el botón "Empezar día": dicen lo mismo dos veces.

## Fase 2a — Reposo (`jornada` y `listo`)

### Barra superior (`driver-route-card.tsx`), de ancho completo
`[ 120 ]  EN ESPERA · Salida 12:00                    ( PQ )`
- A la izquierda, el círculo de la línea (44, color de la línea, como hoy).
- En medio, la pastilla de estado (`Badge`) y, en la misma línea o debajo, `Salida HH:MM` en `Text` sm `secondary`.
- A la derecha, el `Avatar` del conductor (44), que abre Perfil. Hoy el que abre Perfil es toda la tarjeta:
  pasa a ser el avatar, con `accessibilityLabel="Abrir perfil"`.
- Altura: `touch + 2·padding` = 60.

### Slot de avisos (en `operation-screen.tsx`)
- Componente nuevo `src/features/operacion/slot-avisos.tsx`, que recibe una lista de avisos con prioridad y
  muestra solo el primero. Prioridades: permisos/GPS > designación > vuelta completada > foto.
- Por ahora entran `AvisoFotoVehiculo` y el aviso de permisos que hoy sale en rojo arriba. Los demás los
  conecta la fase 2c.
- El aviso es una burbuja de una línea: icono en círculo de 44, texto, una acción `ghost` y una ✕ de 44.

### Riel derecho
- Se ancla justo encima de la hoja, a `gap`, y acompaña su arrastre (`sheetPanY`, como hoy).
- Orden de arriba hacia abajo: Reportar, WhatsApp (L16), centrar/ver ruta y brújula (solo en navegación).
  El botón de debug al final y solo en `__DEV__`.

### Hoja inferior (`next-control-sheet.tsx`), estados de reposo
- **`jornada`**: una sola fila de resumen y el botón.
  - Resumen: `Línea 120 · Salida 12:00 · 8 puntos`, en `Text` md, con un icono de ruta en círculo de 44.
  - Botón primario de 52: `Empezar día`. Sin el título "Día sin iniciar".
- **`listo`**: `Siguiente parada` (Text sm secondary) / `Punto de control N` (Heading), los puntos de
  progreso y el botón primario `Iniciar ruta`. Deja el espacio del nombre de la parada: si el texto es
  largo, se corta en una línea con `numberOfLines={1}`.
- Padding de la hoja: `padding` (8) más un margen interior de 8 para el texto, es decir, 16 al borde del texto.
- Asa de arrastre de 36×4, centrada, a 8 del borde superior.

### Reparto de trabajo (en paralelo, sin pisarse)
- **codex-trabajo1**: `operation-screen.tsx` (posiciones, slot de avisos, riel) y `slot-avisos.tsx` (nuevo).
- **codex-trabajo2**: `driver-route-card.tsx`, `next-control-sheet.tsx` y `vehiculo-foto/aviso-foto-vehiculo.tsx`
  (que se adapte al formato de aviso de una línea).
- **Contrato entre los dos**:
  - codex2 **no cambia las props** de `DriverRouteCard` ni de `NextControlSheet`, salvo agregar
    `onAbrirPerfil?: () => void` a `DriverRouteCard`.
  - codex1 conecta `onAbrirPerfil` y quita el `Pressable` que hoy envuelve la tarjeta.
  - La altura de la barra es fija (60) y la usan los dos.

## Fase 2b — En ruta (`recorrido`)

### Lo que se vio en el teléfono
- **Vecinos**: una burbuja aparte bajo la barra, de 80 % del ancho. Las dos filas se necesitan, pero
  sumadas a la barra de la línea ocupan unos 200 dp arriba.
- **Velocidad**: bien ubicada abajo a la izquierda, pero flota a una altura propia en vez de anclarse a la hoja.
- **Hoja**: "Pausar ruta" (outline) y "Finalizar ruta" (rojo lleno) en dos filas de 52. El rojo lleno grita
  más que todo lo demás, aunque es una acción que se usa una vez por vuelta.
- **Siguiente parada**: no dice a qué distancia está. Los puntos de progreso empiezan 7 dp más a la
  izquierda que el texto.
- **Aviso de punto registrado**: va a `insets.top + edge + 64`, fuera del slot de avisos.

### Barra superior en ruta: línea vertical + vecinos (`driver-route-card.tsx` y `vecinos-ruta/`)
**Decisión del responsable**: las dos burbujas de vecinos (Delante y Detrás) **se quedan**, siempre
visibles y con la **silueta del vehículo**, que próximamente se pintará con el color de cada vehículo. Para
ahorrar espacio, la línea se vuelve una columna vertical a su lado y todo queda en **una sola burbuja**:
```
┌──────────────────────────────────────────────────┐
│ ┌──────┐  ┌────────────────────────────────────┐ │
│ │      │  │ 🚐  DELANTE   1234ABC      420 m   │ │
│ │ 120  │  └────────────────────────────────────┘ │
│ │      │  ┌────────────────────────────────────┐ │
│ │EN RUTA│ │ 🚐  DETRÁS    5678DEF      1,2 km  │ │
│ └──────┘  └────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```
- **Columna de la línea**: 64 de ancho y alto de las dos filas (2 × 52 + `gap`). Fondo del color de la
  línea, radio `innerRadius`. `120` en Oxanium 700 grande y, abajo, el estado (`EN RUTA` / `EN PAUSA`) en
  Text xs blanco, que puede partirse en dos líneas. Tocarla abre Perfil (`onAbrirPerfil`).
- **Filas de vecinos** (52 cada una, radio `innerRadius`, fondo `surfaceSoft`):
  - `SiluetaVehiculo` a la izquierda (40×24). El color sale de `color-vehiculo.ts` como hoy; deja la prop de
    color lista para cuando llegue el dato.
  - Etiqueta `DELANTE` / `DETRÁS` en Text xs `secondary` sobre la placa en Oxanium 700 de 18. Si hay número
    interno, va al lado en Text sm `secondary`.
  - La distancia a la derecha, en Oxanium 700 de 20 con `tabular-nums`.
  - **Delante** lleva el semáforo del #274: borde de 2 y distancia en `success`, `warning` o `danger` según
    `estadoDistanciaVecino`. En `alerta`, el fondo de la fila pasa a `danger` suave. Detrás queda neutro.
  - **Nadie** o **sin dato**: la fila **se mantiene** (el layout no salta), con la silueta en línea punteada
    `textTertiary` y el texto `Nadie delante` / `Sin datos` en `secondary`.
  - Si los datos son viejos, un punto `warning` en la esquina de la fila y la etiqueta dice `hace 2 min`.
- **Una sola burbuja** de ancho completo: la columna y las filas van dentro, con `padding` y `gap`.
  Reemplaza a la barra de la 2a y al panel suelto de vecinos de hoy.
- En reposo (`jornada` y `listo`), la barra es la de la 2a. La versión con vecinos es solo para `recorrido`.

### Velocidad
- **Se queda abajo a la izquierda**, como estaba: una píldora (`PildoraBurbuja`) anclada **justo encima de
  la hoja**, a `gap`, a la misma altura que el riel de la derecha y moviéndose con la hoja (`sheetPanY`).
  Velocidad y riel quedan simétricos a los dos lados.
- Formato: ícono de velocímetro, número en Oxanium 700 con `tabular-nums` y `km/h` en Text sm.
- Excepción a la regla 3: la píldora de velocidad cuenta como parte de la zona inferior, el espejo del riel.

### Vecinos (`features/vecinos-ruta/`)
- `VecinosRutaPanel` deja de ser un overlay absoluto: con la prop `enLinea` renderiza las dos filas para
  meterlas en la barra. Sin `enLinea` se comporta como hoy, por compatibilidad. Sin ningún dato todavía,
  muestra las dos filas en estado `Buscando…`, para que la barra tenga siempre la misma altura en ruta.
- La lógica del hook, el semáforo y la **alerta por voz** del #274 no cambian. La voz sale de un efecto del
  panel, así que el panel tiene que seguir **montado** en ruta.

### Hoja en ruta (`next-control-sheet.tsx`)
- **Fila de parada**: `Siguiente parada` (Text sm `secondary`). Debajo, `Punto de control N` (Heading lg,
  una línea) y, a la derecha y en la misma línea, la distancia (`a 350 m`, Oxanium 700, `tabular-nums`).
  Sin distancia, no se muestra nada.
- Los puntos de progreso se alinean con el texto (misma sangría).
- **Acciones**: una sola fila con dos botones de 52 a medias:
  - `Pausar` en outline;
  - `Finalizar` en outline **danger** (borde y texto rojos).
  - Ninguno va lleno. Los diálogos de confirmación siguen como hoy.
- Asa y padding como en la 2a.

### Aviso de punto registrado (`control-feedback-toast.tsx`)
- Va en la posición del slot de avisos: bajo la barra, a `gap`. Se calcula con la altura real de la barra,
  que `operation-screen` ya mide (`onLayout`). Mientras se ve, tapa el slot; no se apila.
- Cola, deduplicación, vibración y duración: sin cambios.

### Reparto (en paralelo, sin pisarse)
- **codex-trabajo2**: `driver-route-card.tsx` y todo `features/vecinos-ruta/` (excepto la lógica de
  `estado-vecinos.ts` y `use-vecinos-ruta.ts`).
- **codex-trabajo1**: `operation-screen.tsx`, `next-control-sheet.tsx` y `control-feedback-toast.tsx`.
- **Contrato**:
  - `DriverRouteCard` agrega `vecinos?: ReactNode`. Si llega, dibuja el layout de línea vertical + vecinos.
  - En ruta, codex1 le pasa `<VecinosRutaPanel enLinea … />` como `vecinos` y quita el overlay suelto de vecinos.
  - codex1 ancla la píldora de velocidad encima de la hoja, a la izquierda, espejo del riel.
  - `NextControlSheet` agrega `distanciaProximaParadaM?: number | null` (codex1 es dueño de los dos lados).

### Criterio de aceptación (2b)
- Arriba hay una sola burbuja (línea vertical + Delante + Detrás). Abajo, la velocidad y el riel quedan
  simétricos, pegados a la hoja.
- Las dos filas de vecinos siempre están, con su silueta, y la barra mide siempre lo mismo en ruta.
- El mapa gana unos 70 dp frente a hoy.
- La alerta por voz de vecinos sigue funcionando (el panel queda montado en ruta).
- Ningún botón rojo lleno en ruta.
- typecheck, lint y test en verde. Informe en `resultados/pantalla-02b-<tu-nombre>.md`.

## Fase 2c — Situaciones — spec aparte
Fila en el punto maestro, pausa, vuelta completada, designación a Molinos y errores de GPS o conexión.

## Criterio de aceptación (2a)
- En 360×640 y en 412×915, márgenes iguales de 12 en los cuatro lados. La barra y la hoja ocupan el
  ancho completo y el riel toca la hoja.
- Con el aviso de foto activo no se abre una segunda fila de barra: el aviso va en el slot.
- Ningún texto repetido entre título y botón. Una sola acción primaria visible.
- No cambia ninguna lógica: los `onPress` llaman a lo mismo de hoy.
- typecheck, lint y test en verde. Informe en `resultados/pantalla-02a-<tu-nombre>.md`.
