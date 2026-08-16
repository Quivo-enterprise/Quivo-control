# Runbook: retención y restauración GPS (QUI-252)

## Política

`gps_points` usa particiones diarias nativas de PostgreSQL. La imagen local de PostGIS no
incluye `pg_partman`; el worker ya crea particiones futuras con
`crear_particion_gps_points(date)`. En una base gestionada que ofrezca `pg_partman`, puede
delegarse la creación futura a la extensión, pero el archivador no depende de ella y
descubre las particiones desde `pg_inherits`.

El worker procesa como máximo una partición por ejecución por defecto. Para cada partición
anterior a seis meses:

1. toma un advisory lock y `ACCESS EXCLUSIVE` únicamente sobre la partición fría;
2. exporta por páginas ordenadas a CSV gzip (`quivo-gps-v1`);
3. sube a S3/R2 con conteo, tamaño y SHA-256 en metadata;
4. vuelve a descargar el objeto completo y verifica tamaño + SHA-256;
5. registra `gps_archives`, hace `DETACH PARTITION` y elimina la tabla en una transacción.

Un error hace rollback: la partición continúa disponible. Nunca activar el job antes de
probar credenciales, lifecycle/versionado del bucket y restauración en staging.

## Activación

Configurar las variables `GPS_ARCHIVE_*` y credenciales AWS del `.env.example`. El bucket
debe tener versionado, cifrado y una regla de lifecycle acordes a la política legal; no
configurar expiración automática sin autorización de Producto/Legal.

Primero ejecutar en staging con `GPS_RETENTION_MONTHS` alto y una partición sintética. Tras
validar el objeto y la restauración, usar seis meses y `GPS_ARCHIVE_ENABLED=true`. Observar
logs del proceso `worker`, la cola BullMQ `retencion-gps` y el manifiesto:

```sql
SELECT * FROM gps_archives ORDER BY "partitionDate" DESC;
```

## Restauración

1. Identificar `bucket`, `objectKey`, `rowCount` y `sha256` en `gps_archives`.
2. Descargar el objeto sin descomprimir y comparar SHA-256 y tamaño con el manifiesto.
3. Descomprimir a un volumen temporal con espacio suficiente.
4. Crear una tabla staging con la misma estructura y cargar el CSV:

```sql
CREATE TABLE gps_points_restore (LIKE gps_points INCLUDING ALL);
\copy gps_points_restore(event_id,sesion_id,device_id,ts,lat,lng,accuracy,speed,received_at,"sindicatoId")
  FROM '/ruta/gps_points_YYYYMMDD.csv' WITH (FORMAT csv, HEADER true);
SELECT count(*) FROM gps_points_restore;
```

> El CSV incluye `sindicatoId` desde `20260815120000_gps_points_sindicato_rls` (hallazgo 2,
> code-review piloto). `LIKE ... INCLUDING ALL` copia la constraint `NOT NULL` y la FK
> `gps_points_sindicatoid_fkey → sindicatos(id)` de la tabla original, así que el `\copy`
> de arriba **falla** si el CSV es de un archivo viejo sin esa columna, o si algún
> `sindicatoId` del CSV ya no existe en `sindicatos`. `LIKE` no copia las policies de RLS
> ni el `FORCE ROW LEVEL SECURITY` — `gps_points_restore` queda sin RLS propia, lo cual es
> intencional para una tabla de staging administrada a mano.

5. Comparar el conteo con `rowCount` y revisar `min(ts), max(ts)`. Para consulta puntual,
   mantener la tabla fuera del parent. Para restauración completa, crear la partición vacía,
   cargarla y adjuntarla usando exactamente el rango UTC del día; verificar antes que no
   exista otra partición solapada.
6. Registrar quién restauró, motivo, hashes y validaciones. No alterar ni eliminar el objeto
   frío después de restaurar.

## Respuesta a fallos

- Objeto incompleto/hash distinto: la transacción conserva la partición. Corregir storage y
  reintentar; una carga huérfana sin fila en `gps_archives` puede sobreescribirse.
- Lock no disponible: otra instancia está procesando; no intervenir salvo que el job quede
  activo anormalmente.
- Llegada con `ts` de una partición ya archivada: quedará como error de sync; investigar
  reloj o dispositivo offline por más de la ventana de retención antes de restaurar.
