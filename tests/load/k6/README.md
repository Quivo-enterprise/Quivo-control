# Load test de ingesta GPS (QUI-250)

El escenario sostenido genera por defecto 300 puntos/s en tres lotes de 100. Después corre
una ráfaga de reconexión de flota con 20 lotes/s de 500 eventos. El runner registra la
profundidad máxima de BullMQ y, al terminar, espera el drenaje y compara los acuses de la
API con las filas realmente insertadas en `gps_points`.

Usar una sesión móvil exclusiva para la prueba; de lo contrario, actividad real del mismo
dispositivo puede contaminar la comparación exacta.

```bash
export BASE_URL=https://staging-api.example.com
export MOBILE_ACCESS_TOKEN='...'
export SESSION_ID='uuid-de-sesion-operativa'
export DEVICE_ID='device-id-del-token'
export DATABASE_URL='postgresql://...'
export REDIS_URL='redis://...'
bash tests/load/k6/run-sync-ingestion.sh
```

Variables útiles: `SUSTAINED_DURATION`, `BURST_START_TIME`, `BURST_DURATION`,
`SUSTAINED_EVENTS_PER_SECOND`, `BURST_BATCHES_PER_SECOND`, `REQUEST_COMPRESSION=gzip` e
`INGESTION_DRAIN_TIMEOUT_MS`. Los umbrales por defecto son p95 <500 ms sostenido, p95
<1500 ms en ráfaga y menos de 1% de lotes rechazados.

El resultado es válido solo si `lostEvents` y `syncErrors` son cero, BullMQ no acumuló jobs
fallidos y el proceso sale con código 0. Conservar la salida de k6 y el JSON final como
evidencia del ensayo de staging.
