# Propuestas UX del equipo — qué entra en este rediseño

Fuentes (en la máquina del responsable, `~/Descargas`):
- `QUIVO_Control_QA_UXUI_Propuesta_Visual.pdf` (11 láminas, "Propuesta conceptual, no implementada").
- `Notas Entrevistas Exp Usuario.pdf` (notas a mano de entrevistas con conductores).

**La UI la manda el lenguaje de Rutas y el design system** (`README.md`). De estas propuestas se toma la **UX**:
qué se muestra, cuándo, dónde y en qué orden. Lo que necesita backend o datos nuevos queda fuera (lista al final).

## Principio que repiten las dos fuentes
**El mapa es el protagonista.** Durante la ruta, la pantalla muestra solo lo que el conductor usa manejando;
lo administrativo se va al menú (Perfil).

## Lo que entra (solo frontend, con datos que la app ya tiene)

### UX-1 · Cabecera mínima según el estado (lámina 03 y 04; entrevistas: "Línea: sí, con su color")
- Insignia de la línea (`contexto.linea.codigo`) **con el color de la línea** (`contexto.linea.color`, con respaldo
  al primario) + estado: **EN ESPERA** (sin recorrido), **EN RUTA** (recorrido activo), **EN PAUSA** (pausado).
- **"Salida HH:MM"** (`contexto.asignacion.horaSalida`, con `formatHoraBolivia`) solo **antes de iniciar** el
  recorrido y si el dato existe. En ruta se oculta.
- Nada de "Día iniciado", lugar, nombre del conductor, sindicato ni placa (las entrevistas: "no usa esto").
- Tocar la cabecera abre Perfil (como hoy).

### UX-2 · Velocidad abajo, sin distancia al control (lámina 02 punto 03; entrevistas: "velocidad abajo")
- Se quita de arriba la tarjeta de distancia al próximo control.
- La velocidad (`gps.posicionActual?.speedKmh`) pasa a una píldora pequeña **abajo a la izquierda**, encima de la
  hoja, solo con recorrido activo. "Centrar" (modo libre) se apila encima de ella, no la reemplaza.

### UX-3 · Hoja inferior compacta: reducir, no eliminar (láminas 04 y 06)
- En ruta: etiqueta pequeña "Siguiente parada", **nombre de la parada** en grande, puntos de progreso y
  "Finalizar ruta". Objetivo: **casi la mitad de alto** que hoy.
- Se retiran de la vista principal: "#N" del control, la píldora "Vuelta N" y el contador textual de puntos
  (la vuelta y el progreso siguen disponibles para el lector de pantalla en la etiqueta del stepper).
- "Vía Molinos" se mantiene cuando aplica (es información de la ruta, no administrativa).
- Antes de iniciar: "Día sin iniciar" + la acción principal, igual de compacto.

### UX-4 · Vehículos vecinos arriba, placa grande y proximidad por color (láminas 02, 04 y 05; entrevistas pág. 2)
- Se ubican arriba, debajo de la cabecera. Cada fila: lado (DELANTE / ATRÁS), **placa grande** y distancia.
- Estados por distancia, con borde e icono además del color (nunca solo color):
  - **Normal** (> 500 m): borde neutro.
  - **Atención** (≤ 500 m): borde `warning`.
  - **Cerca** (≤ 300 m): borde `danger` y texto "Vehículo de adelante demasiado cerca" / "Vehículo de atrás
    demasiado cerca".
- **Sin voz**: en las entrevistas los conductores pidieron que no tenga voz (la lámina 05 la propone, manda la
  entrevista). Los umbrales van como constantes con nombre en el componente, para ajustarlos tras validar.

### UX-5 · Reportes más visibles y rápidos (lámina 02 punto 04, lámina 09; entrevistas: lista de reportes)
- El botón de observación pasa a ser el de **Reportar**, el más visible de la columna de acciones.
- En el modal, antes del campo de texto: píldoras de motivo rápido **Bloqueo o trancadera · Falla mecánica ·
  Salud o emergencia · Almuerzo · Combustible**. Tocar una completa el texto (el conductor puede agregar detalle).
  Se envía por el **mismo** flujo de observación que existe hoy (no hay endpoint nuevo).
- "Fantasma" queda fuera hasta que se defina qué significa.

### UX-6 · Orden de salida antes de salir (lámina 03 punto 3)
- En la tarjeta de fila de salida: hora de salida y "Sales detrás de PLACA" con los datos que ya trae la fila.
  "Quién sale después de mí" solo si el dato ya existe en `use-fila-salida`; si no, va a pendientes.

## Fuera de este rediseño (necesita backend, datos o decisión) — no inventar pantallas vacías
- Botón de WhatsApp del grupo (falta el enlace oficial por grupo).
- Hoja de ruta del día, historial mensual con calendario y registro de compañeros por día.
- Mi grupo de trabajo y Autocontrol (ACTIVO / INACTIVO).
- Sanciones: distintivo en la insignia, "Cumplir sanción" y vuelta sancionatoria.
- Pausa con motivo (hoy existe pausar/reanudar sin motivo; el motivo necesita contrato).
- Sonido por cada punto de control y alerta de voz de proximidad.
- Marcador del vehículo más grande (es del mapa, que no se toca en este rediseño).
- Decisiones abiertas de la lámina 11: alineación del encabezado, "fantasma", distancia vs velocidad vs km,
  audio recurrente, pausas GPS, control de sanciones, paradas vs checkpoints.
