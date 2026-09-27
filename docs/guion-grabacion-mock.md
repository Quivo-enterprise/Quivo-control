# Lista de tomas — panel del delegado (mock) para el guion V3

> Panel **100% simulado** (decisión del CTO, 2026-09-27). En edición, rotular las tomas de E07/E08 con
> «Demostración». No hay backend: todo vive en el navegador y se reinicia al recargar.
> Capturas de referencia por toma: `docs/tomas/`.

## Preparación (una vez, antes de rodar)
1. En `~/Downloads/Quivo-control` (rama `mock/sandbox`):
   ```
   pnpm --filter @quivo/design-system build
   cd apps/web
   NEXT_PUBLIC_MOCK_FLOTA=true NEXT_PUBLIC_DEV_BYPASS_AUTH=true NEXT_PUBLIC_MOCK_GRABACION=true pnpm exec next dev --port 3110
   ```
   Se graba con `next dev` a propósito: el bypass de login está bloqueado en builds de producción
   (`apps/web/src/lib/auth/auth-context.tsx`, `isDevBypassEnabled`). El indicador «N» de Next queda
   desactivado en `next.config.ts` de la copia. La primera carga de cada vista tarda unos segundos
   (compilación): recorrer todas las vistas una vez antes de rodar.
2. Abrir `http://localhost:3110/en-vivo` en pantalla completa (F11). Zoom del navegador 100 %.
3. **Tecla `S`** muestra/oculta el panel de simulación (operador). En modo grabación arranca oculto y
   sin el badge «Modo simulación».
4. Entre tomas, si algo quedó sucio: panel de simulación → **Reiniciar demo** → confirmar en el diálogo (o recargar la página).
5. Para la toma en celular (E05): DevTools → modo dispositivo 390×844, o abrir desde el teléfono en la
   misma red con la IP de la PC (`http://<ip-pc>:3110/en-vivo`).

## Controles
- **Filtro de línea** (arriba izq.): Todas · Z12 · Línea 120.
- **Menú de vistas**: Mapa · Salidas · Novedades (badge) · Análisis · Configuración.
- **Franja KPI** (siempre visible en Mapa): En ruta · En cola · Finalizados · Sin señal · Atascados · Novedades.
- **Panel de simulación** (tecla `S`), secciones: Infracciones · Tráfico (Atasco, Desvío no autorizado,
  Hora pico) · Salidas (Fuera de orden, Finalizar recorrido) · Conductor (Reporte del conductor + tipo) ·
  Señal (Perder señal, Recuperar señal) · Demo (Pausar/Reanudar, Reiniciar demo).
  Si hay una ficha de trufi abierta, el escenario se aplica a **ese** trufi; si no, a uno visible al azar
  (el panel muestra «Aplicado a 2345-ABC»; si el escenario no aplica, muestra el motivo en rojo).
- **Marcadores en cola**: en cada terminal se ve solo el primero de la cola, con la pastilla **«+N en cola»**.
  La pastilla de estado (Atascado, En cola…) va **encima** del marcador.
- **Paradas con alta demanda**: punto pulsante; el texto «~N esperando» aparece al pasar el mouse.
- **Escape** cierra el panel que tiene el foco (o el último abierto), de a uno.
- En celular, el panel de simulación se oculta solo mientras hay una ficha o vista abierta y vuelve al cerrarla.

## E05 — Aparece QUIVO Control (02:04–02:36)
| Timecode | Toma | Acción en el panel |
|---|---|---|
| 02:18–02:25 | Delegado revisa el panel desde PC | Vista **Mapa**, filtro **Todas**, sin clics. Trufis en movimiento. |
| 02:18–02:25 (alt.) | …desde celular | 390×844: tocar un trufi → ficha como hoja inferior. Las pestañas de la ficha se deslizan de costado (degradé a la derecha = hay más); la pestaña elegida se centra sola. |
| 02:25–02:31 | Sindicato organiza la información | Menú → **Salidas**. |

## E07 — El mismo día, el delegado (03:48–05:24)
| Timecode | Narración (resumen) | Acción en el panel |
|---|---|---|
| 03:48–04:03 | cuántos trabajan, dónde, puntos de control | **Mapa**: encuadrar la franja KPI. Clic en un trufi → pestaña **Resumen** → chips **Puntos de control X/N**. Opcional: filtro **Z12**. |
| 04:03–04:17 | orden de salida, horarios, recorridos 24 h | Menú → **Salidas**: bloque **Cola de salida** (hora programada por posición) → tabla **Salidas de hoy** → **Recorridos del día (00–24 h)**. |
| 04:17–04:32 | desvío / fuera de orden / reporte → revisar y actuar | `S` → **Desvío no autorizado** y **Reporte del conductor** → `S`. Menú → **Novedades** → clic en la novedad → **Ver en mapa** (abre la ficha; en Resumen, la infracción «Desvío de ruta» → elegir acción → **Confirmar**) → volver a **Novedades** → escribir la nota → **Marcar atendida**. Para un reporte: **Crear infracción** (tipo + Crear) o **WhatsApp**. |
| 04:32–04:49 | atascados, desvíos, alta demanda, horas pico | `S` → **Atasco** + **Hora pico** (queda «Hora pico: activa») → `S`. Mapa: pastilla **Atascado** + tramo rojo punteado; paradas con alta demanda (punto pulsante; pasar el mouse para ver «~N esperando»). **Hacer zoom** al tramo: a vista ciudad las etiquetas se superponen. Menú → **Análisis**: barras por hora (llenas = hoy, punteadas = típico para las horas que faltan), franjas de hora pico sombreadas y la hora actual marcada «AHORA». |
| 04:49–05:05 | organizar salidas, coordinar con conductores | **Salidas**: aviso **Alta demanda** → flecha **Adelantar** de un trufi en la cola → **Despachar siguiente** → ícono WhatsApp **Avisar al conductor** (no enviar: número ficticio). |
| 05:05–05:16 | historial, horarios, sanciones, designación de paradas | Ficha de un trufi, una pestaña por plano: **Recorridos** → **Horario** → **Sanciones** → **Paradas** (elegir parada → **Asignar**). |
| 05:16–05:24 | cierre | Menú → **Mapa**, filtro de la línea del relato, sin paneles abiertos. |

## E08 — Pensado para la realidad de la ruta (05:24–06:23)
| Timecode | Narración | Acción en el panel |
|---|---|---|
| 05:42–05:53 | pérdida de señal: se sigue guardando | Abrir la ficha del trufi del relato → `S` → **Perder señal** → `S`. El marcador queda congelado en gris con **«Sin señal · hace m:ss»** (verificado: no se mueve). Dejar 10–15 s. |
| 05:53–06:01 | recupera señal y sincroniza | `S` → **Recuperar señal** → «Sincronizando N puntos…» (~3 s) → el marcador salta; el tramo guardado se resalta 4 s. |
| 06:01–06:10 | configuración | Menú → **Configuración** → **Z12 / Línea 120** (la línea se resalta en el mapa) → **Hora inicio / Hora fin / Frecuencia** → **Nombre de la parada** → **Es punto de control** + **Radio de tolerancia (m)** → **Guardar cambios**. Los círculos de tolerancia solo se ven con zoom. |

## Reglas de dirección (del guion, siguen aplicando)
- Un dato o acción por plano; no pantallas completas ilegibles (usar zoom de cámara o del navegador).
- No presentar decisiones automáticas: siempre se ve al delegado tomando la acción.
- WhatsApp: los números de los conductores son **ficticios** — no enviar el mensaje en cámara.
- La foto del trufi `z12-1` es de Wikimedia (CC BY 2.0, MollySVH) — si aparece en plano, créditos en
  el video. El resto son placeholders.
