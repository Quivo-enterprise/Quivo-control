# Reglas a cargar en prod antes del piloto (29/10)

Prod tiene **0 reglas** en `/reglas` → "Sancionar" queda inutilizable (QA H29, `qa-en-vivo-2026-10-27.md`).
Se cargan a mano en `/reglas` → "Nueva regla", sindicato **Sindicato Piloto — Producción**.

## Cómo enlaza el sistema
- La infracción automática toma la regla **activa** cuyo `tipo` coincide exacto
  (`apps/api/src/modules/ingesta-worker/infracciones.logic.ts:13-18`); si hay varias, la de
  `updatedAt` más reciente. Con regla, la infracción hereda su gravedad y `reglaId`.
- El modal Sancionar preselecciona `inf.reglaId`; si no hay, una regla activa `desvio_ruta`; si no hay,
  queda vacío (`apps/web/src/lib/en-vivo/alertas.ts:238-253`).
- El modelo no tiene monto: la sanción compensatoria va en **Descripción**.
- Campos obligatorios del formulario: Nombre, Tipo (escribir el `tipo` exacto de abajo), Gravedad,
  Aplica a, Sindicato (admin global).

## Obligatorias (cubren infracciones automáticas sancionables)
| Nombre | Tipo (exacto) | Gravedad | Aplica a | Descripción (sanción) |
|---|---|---|---|---|
| Alteración de ruta (desvío) | `desvio_ruta` | grave | conductor | Una vuelta más, en la misma línea. |
| Molinos omitido | `molinos_omitido` | grave | conductor | Alteración de ruta: una vuelta más, en la misma línea. |

## Opcionales (solo sanción manual, no hay infracción automática)
| Nombre | Tipo | Gravedad | Aplica a | Descripción (sanción) |
|---|---|---|---|---|
| Ingreso fuera de horario | `fuera_de_horario` | leve | conductor | Una vuelta más. Primera salida 7:00–8:00 (tolerancia: definir). |
| Turno no cumplido | `turno_incumplido` | grave | conductor | Repetir el turno al día siguiente. |
| Vueltas incumplidas | `vueltas_incumplidas` | grave | conductor | Las faltantes al día siguiente en nocturno (desde 17:01; desde 15:00 si debe 3). Cupo L16: L–V 5, sáb 3, dom 4 (incluye Molinos). |

**No necesitan regla:** `pc_omitido`, `espera_corta` (solo alerta; la API rechaza sancionarlas).

Fuentes: `docs/plan-en-vivo-alertas.md:167-176`, `docs/plan-molinos-designacion.md:35`, memoria
`operacion-lineas-tiquipaya`. Las gravedades de las opcionales son propuesta, no decisión del CTO.
