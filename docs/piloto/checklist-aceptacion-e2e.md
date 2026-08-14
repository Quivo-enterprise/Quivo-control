# Piloto con sindicato real — checklist de aceptación E2E (QUI-253)

Este documento prepara y registra el piloto; no sustituye las jornadas con choferes y
Android físicos. Completar una copia por sindicato, build y fecha. Adjuntar enlaces a la
evidencia sin incluir PIN, tokens, documentos personales ni ubicaciones fuera de la jornada.

## Identificación

- [ ] Sindicato, responsable operativo y contacto técnico registrados.
- [ ] Fecha, línea/turno, build EAS y ambiente registrados.
- [ ] Choferes dieron consentimiento informado para el tratamiento de ubicación.
- [ ] Dispositivos, versión Android, fabricante y estado de optimización de batería listados.
- [ ] Plan de soporte, reversión y canal de incidentes comunicado.

## Gate previo

- [ ] M4 requerido para validación está disponible en staging y no hay hallazgos de seguridad
  bloqueantes abiertos.
- [ ] Bucket de archivo GPS tiene versionado/cifrado y la restauración fue ensayada en staging.
- [ ] Load test QUI-250 terminó sin pérdida, errores del worker ni cola fallida.
- [ ] Spike GPS físico: jornada de 8 h, batería <5% y ningún hueco >2 min.
- [ ] Build Android firmado distribuido por EAS e instalado sin herramientas de desarrollo.
- [ ] `mobile-preflight.mjs` pasa con la sesión exclusiva del piloto:

```bash
BASE_URL=https://staging-api.example.com \
MOBILE_ACCESS_TOKEN='...' \
pnpm exec node tests/pilot/mobile-preflight.mjs
```

## Configuración administrativa

- [ ] Sindicato real creado/validado sin duplicados.
- [ ] Socios, vehículos y conductores de la muestra cargados y revisados por el responsable.
- [ ] Línea, ruta/variante, paradas y puntos de control coinciden con la operación real.
- [ ] Radios de tolerancia se revisaron caminando/conduciendo en campo.
- [ ] Rotación publicada sin doble asignación; fecha, turno y vencimiento son correctos.
- [ ] Usuario de otro sindicato no puede leer ni modificar estos datos.

## Inicio de jornada móvil

- [ ] Login del vehículo funciona con credencial emitida por el sindicato.
- [ ] Identificación del conductor funciona y la app muestra claramente conductor, vehículo,
  línea, sentido y turno activos.
- [ ] Paquete del día descarga ruta, paradas y puntos de control y queda disponible sin red.
- [ ] Asignación vencida produce una advertencia clara y evita iniciar por error.
- [ ] Un chofer no técnico puede iniciar el recorrido en dos taps o menos sin ayuda.

## Jornada en campo

- [ ] El mapa mantiene ubicación y ruta legibles con sol, movimiento y dispositivo de gama baja.
- [ ] Estado GPS, offline y eventos pendientes son visibles sin bloquear la tarea principal.
- [ ] Tracking continúa con pantalla apagada, Doze y cambios de conectividad.
- [ ] Cada punto de control da feedback inmediato y no se valida fuera del radio configurado.
- [ ] Inicio, fin, GPS, cumplimiento y observaciones se persisten primero en outbox.
- [ ] Una llamada/multitarea/reinicio recupera el estado sin inventar ni perder eventos.
- [ ] Finalizar recorrido requiere confirmación y no ocurre por un toque accidental.

## Recuperación de conectividad

- [ ] Tras un corte real, la app muestra pendientes y sincroniza automáticamente al volver la red.
- [ ] Solo los `event_id` acusados cambian a sincronizados.
- [ ] Reenviar el mismo lote tres veces no duplica GPS, cumplimientos ni eventos operativos.
- [ ] Un evento inválido queda en `sync_errors` con motivo visible; nada se descarta en silencio.
- [ ] La cola drena y el recorrido queda reconstruible de principio a fin.

## Validación administrativa posterior

- [ ] Dashboard refleja cumplimiento por línea, vehículo y ruta para el periodo correcto.
- [ ] Reconstrucción muestra traza, timeline y diferencias app/worker de cada punto de control.
- [ ] Reportes CSV de recorridos, sanciones y actividad abren y concuerdan con la muestra manual.
- [ ] Una sanción de prueba vincula evidencia del recorrido y respeta transiciones/auditoría.
- [ ] Auditoría permite hallar actor, acción, fecha, entidad y diff de los pasos críticos.
- [ ] Datos del piloto siguen aislados al repetir consultas con un usuario de otro sindicato.

## Adopción y cierre

- [ ] Cada chofer completa la escala 1–5: facilidad de login, inicio, lectura del mapa, estado de
  sync y finalización.
- [ ] Registrar tareas en las que pidió ayuda, taps erróneos y textos que no entendió.
- [ ] Incidentes incluyen hora, dispositivo, build, conectividad y request/event ID; nunca secrets.
- [ ] Fricciones se convierten en issues con severidad, evidencia y frecuencia observada.
- [ ] Responsable del sindicato firma aceptación, aceptación condicionada o rechazo con motivo.
- [ ] Go/no-go y acciones bloqueantes tienen dueño y fecha.

## Evidencia mínima de cierre

Conservar: salida del preflight, reporte k6, métricas de batería/huecos GPS, IDs de sesiones y
eventos de muestra, capturas anonimizadas, reportes exportados, encuesta agregada, incidentes y
acta go/no-go. QUI-253 solo puede pasar a Done después de ejecutar este checklist en campo.
