# Plan — Pausar / Reanudar recorrido (piloto 21/10, 15:00)

Rama `feat/pausa-recorrido`, en el worktree `../Quivo-control-pausa`. Decisión del CTO del 21/10 a las 11:30: entra **hoy**, antes del piloto de las 15:00.

## Problema

Para almorzar, el chofer usa FINALIZAR RUTA a mitad de vuelta. Eso tiene cuatro efectos:

- La vuelta queda `abierta_al_cierre` y no cuenta.
- Se disparan `pc_omitido` por todos los PC que faltan (`detectarPcOmitidosAlFinRecorrido`).
- Si estaba en la fila de SR, pierde el lugar (`fila-backstop.ts`).
- Al volver, COMENZAR RUTA no retoma la vuelta.

## Decisiones (CTO)

- **El GPS sigue activo durante la pausa.** Se sigue rastreando para que la pausa no sirva para esconderse.
- **Sin límite de duración.** /en-vivo muestra desde cuándo está en pausa y el admin decide. La alerta automática queda para después, con datos del piloto.
- **El trufi en pausa sale de "vecinos de ruta".** El filtro ya exige `recorridoEstado = 'en_curso'` (`vecinos-ruta.service.ts:235`).
- **La pausa no es un fin:**
  - La vuelta sigue `en_curso`.
  - No hay `pc_omitido` al pausar.
  - Los PC que cumple durante la pausa cuentan normal.
  - Si al reanudar se saltó un tramo, el `pc_omitido` en vivo lo marca solo.
- **Decisión del chairman:** durante la pausa no se evalúa `desvio_ruta`, porque almorzar fuera del trazado es legítimo. Si en la pausa se saltea un tramo, lo cubre `pc_omitido`.
- **Decisión del CTO (21/10):** hay que pausar **antes** de salir de la ruta. Salir y después pausar es infracción: la pausa no cierra ni reinicia un desvío que ya estaba en curso.
- **Pausa y fila (review):** con el recorrido `en_pausa`, el servidor rechaza la llegada a la fila con 409 y la app no la intenta.
- **Estados (review):** `pausa_recorrido` solo aplica desde `en_curso` y `reanudar_recorrido` solo desde `en_pausa`. Así una pausa tardía no reabre un recorrido `finalizado`, y una segunda pausa no mueve el "desde".
- **Pausar estando `en_fila`:** pierde el lugar (`retirado`), igual que con `fin_recorrido`.

## Alcance

1. **shared:** `TipoEventoSyncSchema` suma `pausa_recorrido` y `reanudar_recorrido`, con payload `{ sesionId }`. Si hay un estado de recorrido o de frescura en los schemas de /en-vivo, se suma `en_pausa`.
2. **db:** migración que amplía el CHECK de `sesiones_operativas."recorridoEstado"` a `('en_curso','en_pausa','finalizado')`. También el CHECK de tipos de `eventos_operativos`, si existe.
3. **API y worker:**
   - El sync acepta los tipos nuevos.
   - `pausa_recorrido` lleva a `en_pausa` y `reanudar_recorrido` a `en_curso`, con el mismo guard por `recorridoEstadoTs`.
   - Vueltas, `construirRecorridos` y `pc_omitido`: los tipos nuevos se ignoran.
   - Desvío: no se evalúan puntos dentro de una ventana de pausa.
   - Backstop de la fila: `pausa_recorrido` retira, igual que `fin_recorrido`.
   - /en-vivo: estado "en pausa" con `pausaDesdeTs`.
4. **web /en-vivo:** chip "En pausa · desde HH:MM" en la lista y en el mapa.
5. **app (OTA, sin cambios nativos):**
   - Con la ruta en curso, el botón principal es **PAUSAR**.
   - En pausa se muestra "En pausa desde HH:MM", con **REANUDAR** como botón principal y "Terminar el día" como secundario (es el FINALIZAR RUTA de hoy).
   - El GPS no se detiene.
   - El estado de pausa sobrevive al reinicio de la app.

## Orden de despliegue

Primero la migración, la API y el worker (r24). Después la web. Recién entonces la OTA, porque una API vieja podría rechazar el lote con un tipo desconocido.

## Rollback

- API, worker y web: volver a r23. La migración solo amplía un CHECK, así que es compatible con r23.
- App: republicar la OTA anterior. Con la OTA revertida, una sesión que quedó `en_pausa` queda fuera de vecinos hasta su próximo `inicio_recorrido`.

## Verificación

- `tsc` y vitest en api, shared y web, más la integración con Postgres.
- `tsc` en mobile.
- `/code-review` + `/ponytail-review`.
- Prueba en la calle del CTO:
  - Pausar a mitad de vuelta: desaparece de vecinos y /en-vivo muestra "En pausa".
  - Reanudar: la vuelta sigue y se completa en SR.
