# Glosario del dominio — QUIVO Control

Términos del negocio y del sistema, en el sentido en que los usa el código. Si un documento usa un término distinto, manda este glosario. Si cambia el significado, se actualiza acá en el mismo PR.

| Término | Definición | Dónde vive |
|---|---|---|
| **Sindicato** | Organización de transporte. Es el **tenant**: todo dato operativo pertenece a uno y RLS aísla uno de otro | `Sindicato`, `packages/db/src/tenant-context.ts` |
| **Socio** | Propietario de uno o más vehículos dentro de un sindicato | `Socio` |
| **Vehículo** | Unidad de transporte (trufi, minibús, micro). Se identifica por placa normalizada; tiene estado e historial de estados | `Vehiculo`, `HistorialEstadoVehiculo` |
| **Conductor** | Persona que maneja. Se identifica por CI; entra a la app con placa + PIN | `Conductor` |
| **Línea** | Servicio comercial con nombre (p. ej. Z12, 120), de un sindicato y una ciudad | `Linea`, `MobilityCity` |
| **Ruta** | Recorrido de una línea con sentido y geometría | `Ruta` |
| **Variante** | Alternativa de recorrido de una ruta | `Variante` |
| **Parada** | Punto de subida y bajada sobre la ruta, a ≤100 m de la geometría | `Parada` |
| **Punto de control (PC)** | Punto de la ruta, con radio de tolerancia y orden, que el vehículo tiene que pasar. Cumplirlo genera evidencia | `PuntoControl`, `packages/shared/src/entities/punto-control.ts` |
| **Radio de tolerancia** | Distancia a la que un fix cuenta como paso por el PC. Se guarda por PC (`radioToleranciaM`); en prod es 150 m | `PuntoControl.radioToleranciaM` |
| **Radio de aviso / de confirmación** | 150 m para la voz de aproximación y 40 m para el anuncio de llegada. Solo afectan el feedback al chofer, no la evidencia | `RADIO_AVISO_M`, `RADIO_CONFIRMACION_M` |
| **Rotación** | Plan de asignaciones de un sindicato para un período. Estados: `borrador` y `publicada`. "Anular" la devuelve a borrador | `Rotacion` |
| **Asignación** | Vehículo + conductor (opcional) + ruta + fecha + horario. Vence al fin de la jornada | `Asignacion` |
| **Jornada** | Día operativo en hora de Bolivia (UTC-4) | `apps/api/src/common/tiempo/jornada.ts` |
| **Paquete del día** | Datos que la app descarga para operar offline: asignación, ruta, paradas y PC | `packages/shared/src/sync/paquete-dia.ts` |
| **Sesión operativa** | Login activo de un vehículo con su conductor en un dispositivo. **No es el recorrido** | `SesionOperativa` |
| **Recorrido** | Lo que el conductor inicia y finaliza con los botones de la app. Su estado (`recorridoEstado`) incluye `finalizado` | `plan-ubicacion-fluida.md`, Fase A |
| **Pasada / vuelta** | Cada paso por un mismo PC dentro de una sesión. Distingue las vueltas de un circuito | `geofence.ts` |
| **Fix** | Una posición GPS capturada | SDK de GPS |
| **Heartbeat** | Evento periódico (60 s) del SDK de GPS sin movimiento | `background-geolocation.config.ts` |
| **Evento** | Observación inmutable del móvil (punto GPS, PC, inicio/fin de recorrido) con `eventId` UUIDv7 del cliente | `packages/shared/src/sync/evento.ts` |
| **Outbox** | Cola local en SQLite donde se persiste cada evento antes de enviarlo | `apps/mobile/src/db/outbox.ts` |
| **Acuse** | Confirmación del servidor (202) por `eventId`. Hoy significa "encolado", no "persistido" | `apps/api/src/modules/sync` |
| **Ingesta** | Proceso del worker que inserta los puntos y decide el cumplimiento con `ST_DWithin` | `apps/api/src/modules/ingesta-worker` |
| **Cumplimiento** | Registro de que un PC se pasó, decidido por el servidor | `CumplimientoPc` |
| **Evidencia** | Puntos GPS, cumplimientos y eventos que respaldan el control o una sanción. No se borra | RNF-37 |
| **Frescura** | Estado de un vehículo en `/en-vivo`: `reportando`, `detenido`, `perdido`, `sin_datos`, `finalizado` | `apps/api/src/modules/reportes/en-vivo.service.ts` |
| **Captura vs transporte** | Falla de grabar vs falla de enviar. Al chofer solo se le muestran las de captura | `docs/estados-red-vs-captura.md` |
| **Regla / sanción** | Norma del sindicato y su aplicación a un sujeto. Estados de la sanción: pendiente, aplicada, anulada, apelada, pagada | `Regla`, `Sancion` |
| **Publicación pública** | Estado `publicStatus` de líneas, rutas, variantes y paradas para la API de pasajeros | ADR de public-mobility |
| **Acompañante** | Persona que viaja a bordo en el piloto y anota los pasos a mano (verdad de campo) | `docs/piloto/planilla-acompanante.md` |
| **Placas de prueba** | `9001TST` (Z12) y `9004TST` (120): vehículos de prueba en producción | `docs/handoff.md` |
