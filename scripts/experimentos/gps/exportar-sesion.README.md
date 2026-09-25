# exportar-sesion.cjs — cómo correrlo contra `quivo-control-prod`

Experimento de puntos GPS (`docs/plan-experimento-puntos-gps.md`, paso A). **Esta ejecución
la corre el chairman**, no un subagente (mismo criterio que `docs/plan-costos-2000.md` §10.1),
después de revisar el comando completo y de correr `verificar-export.mjs` sobre el archivo.

## 0. Por qué no hay otro camino

Cloud SQL en `quivo-control-prod` tiene **IP privada únicamente** — no es alcanzable desde una
laptop ni con `cloud-sql-proxy` (`docs/infra-gcp-prod.md`). El único vehículo dentro de la VPC
es el Cloud Run Job `quivo-migraciones`, que acepta un override de comando por ejecución vía
`--args` (`scripts/deploy-gcp.sh:473-541`, mismo patrón ya usado y verificado en
`docs/plan-costos-2000.md` §10.2/§12 para la medición de agosto). La imagen del job es
`node:22-alpine` **sin `psql`** — el único cliente disponible es el paquete `pg`, por eso el
vehículo es un script Node (`node -e`) y no un `.sql` plano.

## 1. Por qué el script no puede tener comillas simples ni ciertos patrones

El job tiene `--command=/bin/sh`. `--args` usa el delimitador alternativo de gcloud
(`^%%^item1%%item2`, no comas — hay un bug de producción confirmado donde `--args` con comas
se parte en argumentos separados, ver el comentario grande en `scripts/deploy-gcp.sh` justo
antes de `ROTATE_JS`). El comando final que corre DENTRO del contenedor es:

```
/bin/sh -c "cd /app/packages/db && node -e '<CONTENIDO DE exportar-sesion.cjs>'"
```

El contenido de `exportar-sesion.cjs` queda envuelto en **comillas simples** a nivel de shell.
Por eso:
- **Cero comillas simples** en el archivo — una sola rompe la comilla que lo envuelve y el
  resto del contenido se interpreta como comandos de shell sueltos.
- **Cero `$(`** — sustitución de comando; con la comilla simple rota (ver arriba) o incluso
  sin romperla, es la puerta de ejecución arbitraria más directa.
- **Cero `%%`** — es el delimitador que el propio `--args` usa para separar `-c` del script;
  si el script lo contiene, gcloud lo parte ahí y el contenedor recibe un script trunco.
- **Cero comentarios `//`** — regla dura adicional del encargo (no una necesidad estricta del
  shell, pero elimina una fuente de errores si algún editor normaliza saltos de línea).

`verificar-export.mjs` falla el build (exit 1) si alguna de estas condiciones no se cumple, o
si aparece una palabra clave mutante de SQL (INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE/CREATE/
GRANT) fuera de un identificador legítimo.

## 2. Comando exacto

```bash
# 0) Verificación local (obligatoria antes de tocar prod):
node scripts/experimentos/gps/verificar-export.mjs

# 1) Aplanar el script a un string sin saltos de línea reales (mismo criterio que
#    ROTATE_JS en scripts/deploy-gcp.sh: evita cualquier duda sobre cómo gcloud serializa
#    un valor de --args con saltos de línea embebidos). tr cambia \n por espacio; como el
#    archivo no tiene comentarios de una línea, aplanarlo no cambia el significado.
SCRIPT="$(tr '\n' ' ' < scripts/experimentos/gps/exportar-sesion.cjs)"

# 2) Guarda: si el script llegara a contener el delimitador %%, fallar ACÁ, no dentro del
#    contenedor (mismo criterio que fail_if_delimiter_collision en deploy-gcp.sh).
case "$SCRIPT" in
  *%%*) echo "ABORTAR: el script contiene %%, colisiona con el delimitador de --args" >&2; exit 1 ;;
esac

# 3) Comando final. --update-env-vars SESION_ID es OPCIONAL: sin él, el script usa la
#    sesión con más gps_points del resumen (la letra a). Con él, fuerza una sesión puntual.
gcloud run jobs execute quivo-migraciones \
  --project=quivo-control-prod \
  --region=southamerica-west1 \
  --args="^%%^-c%%cd /app/packages/db && node -e '${SCRIPT}'" \
  --wait
```

Si se necesita fijar una sesión puntual en vez de "la de más puntos":

```bash
gcloud run jobs update quivo-migraciones \
  --project=quivo-control-prod --region=southamerica-west1 \
  --update-env-vars=SESION_ID=<uuid-de-la-sesion>
# después correr el "3) Comando final" de arriba, y ANTES de terminar la sesión de trabajo
# quitar la variable (--remove-env-vars=SESION_ID) para no dejarla pegada al job compartido.
```

**Antes de ejecutar**, el chairman relee el comando completo (regla del plan, riesgo real: un
`--args` mal armado puede terminar corriendo el comando default persistido del job,
`prisma migrate deploy` — evaluado y acotado en `docs/plan-costos-2000.md` §10.2: peor caso,
no-op contra una imagen que ya se migró sola en su propio deploy, pero se revisa igual).

## 3. Bajar los logs

La salida (los bloques `===BEGIN ...===`/`===END ...===` y el `===COUNT ...===` final) sale
por stdout, que Cloud Run manda a Cloud Logging como `textPayload`. Después de que el `execute
--wait` de arriba termine (o usando el nombre de ejecución que devuelve, tipo
`quivo-migraciones-xxxxx`):

```bash
EXECUTION="quivo-migraciones-xxxxx"   # nombre real de la ejecución (lo imprime execute --wait)

gcloud logging read \
  "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"quivo-migraciones\" AND labels.\"run.googleapis.com/execution_name\"=\"${EXECUTION}\"" \
  --project=quivo-control-prod \
  --order=asc \
  --format="value(textPayload)" \
  > /tmp/export-sesion-gps.log
```

`--order=asc` es obligatorio: `parsear-logs.mjs` reconstruye los bloques asumiendo que las
líneas llegan en el mismo orden en que el script las imprimió.

## 4. Parsear los logs a CSV

```bash
node scripts/experimentos/gps/parsear-logs.mjs /tmp/export-sesion-gps.log
```

Escribe `sesiones_resumen.csv`, `gps_points_sesion.csv`, `puntos_control_ruta.csv` y
`cumplimientos_pc_sesion.csv` en `scripts/experimentos/gps/datos/` (gitignoreado — son datos
de producción con coordenadas reales, nunca se versionan). **Falla fuerte** (exit 1, sin
escribir ningún CSV) si no encuentra el marcador `===COUNT ...===` final o si el número de
filas parseadas de `gps_points_sesion` no coincide con ese marcador — evidencia de que el log
llegó truncado (hallazgo de revisión: un `process.exit(0)` inmediato en Node puede cortar
stdout en pipe antes de que termine de escribirse; por eso `exportar-sesion.cjs` no lo usa).

## 5. Verificación (criterios de `docs/plan-experimento-puntos-gps.md` §5)

- El script no contiene statements mutantes: `node scripts/experimentos/gps/verificar-export.mjs`
  (exit 0 esperado).
- La ejecución del job termina en exit 0 (`gcloud run jobs executions describe ${EXECUTION}
  --project=quivo-control-prod --region=southamerica-west1`).
- El conteo exportado (`===COUNT gps_points_sesion=<n>===`) coincide con el conteo real en
  `gps_points` para esa sesión — `parsear-logs.mjs` ya lo valida contra sí mismo (el bloque
  parseado tiene que tener exactamente `<n>` filas); para comparar contra la tabla real,
  `sesiones_resumen.csv` trae la columna `puntos` de la misma sesión, calculada con un
  `count()` en SQL independiente del bloque `gps_points_sesion`.
