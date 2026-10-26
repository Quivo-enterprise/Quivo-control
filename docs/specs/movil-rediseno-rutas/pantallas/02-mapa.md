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

## Fase 2b — En ruta (`recorrido`) — spec aparte, después de revisar la 2a
Navegación, siguiente parada, velocidad integrada a una zona, vecinos con semáforo dentro de la barra o
de la hoja, y aviso de punto registrado.

## Fase 2c — Situaciones — spec aparte
Fila en el punto maestro, pausa, vuelta completada, designación a Molinos y errores de GPS o conexión.

## Criterio de aceptación (2a)
- En 360×640 y en 412×915, márgenes iguales de 12 en los cuatro lados. La barra y la hoja ocupan el
  ancho completo y el riel toca la hoja.
- Con el aviso de foto activo no se abre una segunda fila de barra: el aviso va en el slot.
- Ningún texto repetido entre título y botón. Una sola acción primaria visible.
- No cambia ninguna lógica: los `onPress` llaman a lo mismo de hoy.
- typecheck, lint y test en verde. Informe en `resultados/pantalla-02a-<tu-nombre>.md`.
