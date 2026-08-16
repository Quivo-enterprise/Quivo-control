# Piloto con sindicato real — checklist de aceptación E2E (QUI-253)

> Actualizado el 2026-08-16 por QUI-367: umbrales numéricos y criterios de aborto.
> El gate previo se reescribió para reflejar el plan vigente
> (`docs/plan-piloto-lunes-17-agosto.md`): el piloto arranca el **lunes 17 de agosto de 2026
> con un auto**, contra el backend real en Cloud Run, con APK sideload.
> El spike GPS de 8 h (QUI-216) **ya no es gate previo** — se absorbe en la prueba del domingo.

Este documento prepara y registra el piloto; no sustituye las jornadas con choferes y Android
físicos. Completar una copia por sindicato, build y fecha. Adjuntar enlaces a la evidencia sin
incluir PIN, tokens, documentos personales ni ubicaciones fuera de la jornada.

**Cómo se lee un ítem:** cada casilla con umbral trae su número entre paréntesis. Si el valor
medido no alcanza el umbral, el ítem no se marca: se anota el valor real en la tabla de
§ Registro de mediciones y se evalúa contra § Criterios de aborto.

---

## Identificación

- [ ] Sindicato, responsable operativo y contacto técnico registrados.
- [ ] Fecha, línea/turno, build EAS (ID y versión) y ambiente registrados.
- [ ] Conductor dio consentimiento informado para el tratamiento de ubicación.
- [ ] Dispositivo, versión Android, fabricante y estado de optimización de batería listados.
- [ ] Plan de soporte, reversión y canal de incidentes comunicado al sindicato.

## Gate previo (antes de entregar el teléfono)

Bloqueantes duros — sin estos el piloto no arranca:

- [ ] `/health/live` y `/health/ready` del API en Cloud Run responden **200 por HTTPS desde
  fuera de la red del CTO**, con `db` y `redis` arriba en el readiness.
- [ ] Login del panel web contra el API desplegado (no `localhost`).
- [ ] **Aislamiento cross-tenant verificado a mano**: una sesión del segundo tenant del seed no
  lee ni escribe ningún dato del sindicato piloto. 0 filas cruzadas.
- [ ] Seed del sindicato real cargado: 1 línea, 1 ruta con geometría, puntos de control,
  1 vehículo, 1 conductor.
- [ ] **APK firmado apunta a la URL de Cloud Run**, no a `localhost` ni a una IP de LAN.
  Verificar en el APK instalado, no solo en el `.env` del build.
- [ ] APK instalado por sideload en el teléfono del conductor, sin herramientas de desarrollo.
- [ ] Sentry recibe un evento de prueba del build de release, con el tag de release correcto.
- [ ] Key de Transistorsoft válida en el build (vence **2026-09-15**; anotar días restantes).
- [ ] `mobile-preflight.mjs` pasa contra el API desplegado con la sesión exclusiva del piloto:

```bash
BASE_URL=https://<api-cloud-run>.run.app \
MOBILE_ACCESS_TOKEN='...' \
pnpm exec node tests/pilot/mobile-preflight.mjs
```

No bloqueantes (diferidos por el plan vigente, se registran como deuda abierta):

- [ ] Load test k6 (QUI-250) — diferido.
- [ ] Archivado/restauración de particiones GPS (QUI-252) — diferido; runbook en
  `docs/runbooks/retencion-gps.md`.
- [ ] Prueba negativa de RLS (QUI-363) — diferida. **Mientras no exista, el verde de la suite de
  aislamiento no prueba que las policies funcionen.** Compensado hoy por la verificación manual
  cross-tenant del gate previo.

## Prueba en teléfono real — domingo 16 (reemplaza al spike de 8 h)

Con el APK instalado y recorriendo la ruta real. Los 7 puntos del plan, con umbral:

| # | Punto | Umbral de aceptación | Medición |
|---|---|---|---|
| 1 | Tracking en background con pantalla apagada | 0 interrupciones en ≥60 min continuos | |
| 2 | Sobrevive a matar la app y a un reboot | Reanuda solo en ≤5 min, sin re-login | |
| 3 | Consumo de batería | ≤10% por hora de tracking; **objetivo ≤5%/h** | |
| 4 | Huecos entre puntos GPS | Ningún hueco >2 min; ≥95% de intervalos ≤60 s | |
| 5 | Detección automática de puntos de control | ≥90% de los pasos detectados; 0 detecciones fuera del radio | |
| 6 | Outbox sincroniza contra Cloud Run | p95 de acuse ≤5 min tras recuperar red; 0 eventos perdidos | |
| 7 | Recorrido reconstruido en el panel web | Traza completa de punta a punta, sin tramos faltantes | |

**Fallback si el punto 1 o el 2 falla categóricamente:** el lunes se corre con registro manual
del conductor. Degradado, pero el piloto no se cae delante del sindicato. Decidirlo el domingo
por la noche, no el lunes a la mañana.

## Configuración administrativa

- [ ] Sindicato real creado/validado sin duplicados.
- [ ] Vehículo y conductor del piloto cargados y revisados por el responsable.
- [ ] Línea, ruta/variante, paradas y puntos de control coinciden con la operación real.
- [ ] Radios de tolerancia revisados caminando/conduciendo en campo.
- [ ] Rotación publicada sin doble asignación; fecha, turno y vencimiento correctos.
- [ ] Usuario de otro sindicato no puede leer ni modificar estos datos (0 filas cruzadas).

## Inicio de jornada móvil

- [ ] Login del vehículo funciona con credencial emitida por el sindicato.
- [ ] Identificación del conductor funciona y la app muestra conductor, vehículo, línea, sentido
  y turno activos.
- [ ] Paquete del día descarga ruta, paradas y puntos de control y queda disponible sin red.
- [ ] Asignación vencida produce una advertencia clara y evita iniciar por error.
- [ ] El conductor inicia el recorrido en **≤2 taps y sin ayuda**, en ≤60 s desde abrir la app.

## Jornada en campo

- [ ] El mapa mantiene ubicación y ruta legibles con sol, movimiento y dispositivo de gama baja.
- [ ] Estado GPS, offline y eventos pendientes visibles sin bloquear la tarea principal.
- [ ] Tracking continúa con pantalla apagada, Doze y cambios de conectividad
  (umbral: 0 interrupciones no explicadas en toda la jornada).
- [ ] Cada punto de control da feedback inmediato (≤2 s) y no se valida fuera del radio.
- [ ] Inicio, fin, GPS, cumplimiento y observaciones se persisten primero en outbox.
- [ ] Una llamada/multitarea/reinicio recupera el estado sin inventar ni perder eventos
  (umbral: 0 eventos inventados, 0 perdidos).
- [ ] Finalizar recorrido requiere confirmación y no ocurre por un toque accidental.

## Recuperación de conectividad

- [ ] Tras un corte real, la app muestra pendientes y sincroniza automáticamente al volver la red.
- [ ] Solo los `event_id` acusados cambian a sincronizados.
- [ ] Reenviar el mismo lote **tres veces no duplica** GPS, cumplimientos ni eventos operativos
  (umbral: 0 duplicados).
- [ ] Un evento inválido queda en `sync_errors` con motivo visible; nada se descarta en silencio.
- [ ] La cola drena por completo al final de la jornada (umbral: 0 pendientes al cierre) y el
  recorrido queda reconstruible de principio a fin.

## Validación administrativa posterior

- [ ] Dashboard refleja cumplimiento por línea, vehículo y ruta para el periodo correcto.
- [ ] Reconstrucción muestra traza, timeline y diferencias app/worker de cada punto de control.
- [ ] Reportes CSV de recorridos, sanciones y actividad abren y concuerdan con el conteo manual
  (umbral: diferencia 0 entre CSV y conteo manual del día).
- [ ] Una sanción de prueba vincula evidencia del recorrido y respeta transiciones/auditoría.
- [ ] Auditoría permite hallar actor, acción, fecha, entidad y diff de los pasos críticos.
- [ ] Datos del piloto siguen aislados al repetir consultas con un usuario de otro sindicato.

## Adopción y cierre

- [ ] El conductor completa la escala 1–5: facilidad de login, inicio, lectura del mapa, estado
  de sync y finalización (umbral: ningún ítem por debajo de 3).
- [ ] Registrar tareas en las que pidió ayuda, taps erróneos y textos que no entendió.
- [ ] Incidentes incluyen hora, dispositivo, build, conectividad y request/event ID; nunca secrets.
- [ ] Fricciones convertidas en issues con severidad, evidencia y frecuencia observada.
- [ ] Responsable del sindicato firma aceptación, aceptación condicionada o rechazo con motivo.
- [ ] Go/no-go y acciones bloqueantes tienen dueño y fecha.

---

## Umbrales de aceptación del piloto

Se evalúan sobre las jornadas corridas, no sobre una sola. En la primera semana con un auto,
la unidad es la jornada-día.

| Métrica | Umbral de aceptación | Objetivo |
|---|---|---|
| Jornadas reconstruibles de punta a punta | ≥95% | 100% |
| Eventos operativos perdidos | **0** | 0 |
| Eventos duplicados tras reintentos | **0** | 0 |
| Correcciones manuales sobre el total de eventos | ≤2% | 0% |
| Batería consumida por hora de tracking | ≤10%/h | ≤5%/h |
| Teléfono llega al fin de jornada sin cargar | Sí | Sí |
| Huecos GPS | ninguno >2 min | ninguno >60 s |
| p95 de sincronización tras recuperar red | ≤5 min | ≤1 min |
| Puntos de control detectados solos | ≥90% | 100% |
| Detecciones fuera del radio configurado | **0** | 0 |
| Jornadas sin que el conductor pida ayuda | ≥90% | 100% |
| Filas visibles cross-tenant | **0** | 0 |
| Crashes en Sentry por jornada | ≤1 no bloqueante | 0 |

Los umbrales en negrita son binarios: un solo caso los rompe.

## Criterios de aborto

Cada uno define **qué se hace**, no solo que algo salió mal. "Abortar" nunca significa borrar
el outbox del teléfono: los eventos pendientes son la única copia de la jornada.

| # | Disparador | Acción |
|---|---|---|
| A1 | Tracking en background muere con pantalla apagada o tras reboot y no se recupera solo | Pasar a **registro manual del conductor** por el resto de la jornada. El piloto sigue, degradado. Issue con logs de Sentry y modelo/fabricante del teléfono. |
| A2 | Se confirma **pérdida de eventos** (la app acusó sincronizado y no está en la DB) | Parar la sincronización. **No borrar ni reinstalar la app** — el outbox local es la evidencia. Escalar al CTO antes de seguir. |
| A3 | **Fuga cross-tenant**: datos del sindicato piloto visibles desde otro tenant | Parar el piloto de inmediato, revocar los tokens emitidos y no reanudar hasta cerrar la causa. Es un incidente de seguridad, no un bug de campo. |
| A4 | El teléfono no llega al fin de jornada por batería | Cargador en el vehículo el mismo día. Si se repite en 2 jornadas, revisar la configuración de tracking antes de seguir. |
| A5 | API caído >30 min sin recuperación | La app es offline-first: el conductor sigue trabajando con outbox. Avisar al sindicato solo si el corte pasa de una jornada. |
| A6 | Eventos duplicados en reintentos | Parar la sincronización de ese dispositivo y escalar: la idempotencia por `event_id` es un supuesto de todo el diseño. |
| A7 | La app crashea de forma que impide iniciar o finalizar un recorrido | Registro manual + rollback al APK anterior si existe. Issue bloqueante. |

## Registro de mediciones

Llenar por jornada. Una fila por día del piloto.

| Fecha | Jornada reconstruible | Eventos perdidos | Duplicados | Batería %/h | Hueco GPS máx | p95 sync | Ctrl detectados | Crashes | Aborto disparado |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-17 | | | | | | | | | |

## Evidencia mínima de cierre

Conservar: salida del preflight, métricas de batería y huecos GPS, IDs de sesiones y eventos de
muestra, capturas anonimizadas, reportes exportados, encuesta del conductor, incidentes,
tabla de mediciones completa y acta go/no-go firmada.

QUI-253 solo puede pasar a Done después de ejecutar este checklist en campo y de que la tabla de
mediciones cumpla los umbrales de aceptación.
