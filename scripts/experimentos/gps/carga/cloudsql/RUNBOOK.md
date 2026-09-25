# RUNBOOK — confirmación en Cloud SQL real (paso B')

`docs/plan-experimento-puntos-gps.md` §10, aprobado por el CTO 2026-09-22. Objetivo: confirmar
en una instancia Cloud SQL real (no NVMe local) los hallazgos del paso B (§8) — techo de
escritura por tier y costo de `listarHoy`/`obtenerPosiciones` — antes de fijar cifras para
finanzas.

**Quién corre qué (regla dura):** todo comando `gcloud` (crear/patchear/borrar la instancia,
leer métricas) lo corre el **CTO**, a mano, en su propia terminal — el clasificador de permisos
del agente bloquea operaciones sobre `quivo-control-prod`. Esos pasos van marcados con `!`
delante del comando. Todo lo demás (`prisma migrate deploy`, `seed.mjs`, `precargar.mjs`,
`generador.mjs`/`lecturas.mjs` vía `correr-matriz.mjs`, los `EXPLAIN`) es tráfico de aplicación
normal contra la instancia (vía `QUIVO_CARGA_DATABASE_URL`, no pasa por `gcloud`) — eso sí lo puede correr
el agente, una vez que el CTO exportó las credenciales en la shell compartida.

**No confundir con nada de lo local:** esta instancia es NUEVA (`quivo-carga-temp`), sin
relación con `quivo-carga-pg` (el contenedor Docker del paso B, en uso por el trabajo de
recalibración de `scripts/costos/*` — no tocarlo) ni con ninguna base de producción. Los
archivos de resultado de este runbook usan el prefijo de perfil `remoto-` (`remoto-c1`,
`remoto-c2`) para no pisar los `resultados/perfil-c1_*.json` / `resumen.md` ya existentes del
paso B local.

**Borrado obligatorio al cerrar** (§10: "Se borra al terminar"): el Paso 8 no es opcional. Una
instancia `db-custom-1-3840`/`-2-7680` con `edition=ENTERPRISE` corre dinero por hora mientras
exista, tier aparte.

---

## Paso 0 — prerequisitos

- `gcloud` autenticado contra el proyecto `quivo-control-prod` (lo verifica el CTO).
- `psql`, `curl`, `openssl` instalados (los usa `crear.sh`).
- `pnpm` y `node` (ya en el repo).
- Este runbook asume que el CTO y el agente comparten la misma sesión de shell (para que
  `source ~/.quivo-carga-temp.env` deje las variables disponibles para los comandos que corre
  el agente después). Si no es así, el CTO pega el contenido de `~/.quivo-carga-temp.env`
  (**sin la contraseña real en el chat/log si se puede evitar**) o exporta la variable que
  hace falta: `QUIVO_CARGA_DATABASE_URL`. Hallazgo 10 de revisión (2026-09-22): este runbook
  deliberadamente NO usa un `DATABASE_URL` genérico en la shell compartida — `crear.sh` no lo
  exporta, y `migrar.sh` arma uno solo para el subproceso de `prisma` — así ningún otro
  comando de la sesión puede apuntar por accidente a la instancia temporal (o viceversa) por
  confiar en una var genérica que quedó pegada.

## Paso 1 — crear la instancia (CTO)

```
!cd scripts/experimentos/gps/carga/cloudsql && ./crear.sh
```

Aborta solo si `quivo-carga-temp` ya existe. Detecta la IP pública actual con `curl` y la
autoriza `/32`. Genera una contraseña aleatoria (`openssl rand -hex 24`), crea la instancia
(`POSTGRES_16`, `ENTERPRISE`, `db-custom-1-3840`, 50GB SSD, zonal, sin backups,
`--ssl-mode=ENCRYPTED_ONLY`), crea la base `quivo_carga`, habilita `postgis`, y guarda todo en
`~/.quivo-carga-temp.env` (`chmod 600`, fuera del repo — **nunca se commitea**).

Tarda varios minutos (`gcloud sql instances create` bloquea hasta `RUNNABLE`).

```
!source ~/.quivo-carga-temp.env
```

A partir de acá `$QUIVO_CARGA_DATABASE_URL` apunta a la instancia temporal (los scripts
`.mjs` la leen directo, ver la nota sobre `sslmode` en `../lib/pg.mjs`; `migrar.sh` arma un
`DATABASE_URL` efímero SOLO para el subproceso de `prisma`, ver ese script). `lib/pg.mjs`
también verifica que el host de `QUIVO_CARGA_DATABASE_URL` coincida con `QUIVO_CARGA_TEMP_IP`
— aborta con un error claro si no coinciden.

## Paso 2 — migrar (agente)

```
cd scripts/experimentos/gps/carga/cloudsql && ./migrar.sh
```

Corre `prisma migrate deploy` (las 33 migraciones reales de `packages/db`, incluida la RLS que
crea el rol `quivo_app`) contra `$QUIVO_CARGA_DATABASE_URL` (armado como `DATABASE_URL`
solo para ese subproceso, ver `migrar.sh`). No toca `gcloud`.

## Paso 3 — seed + precarga server-side (agente)

```
cd scripts/experimentos/gps/carga
node seed.mjs 1000
node precargar.mjs 500 7 1920
```

- `seed.mjs 1000`: **1.000 sesiones** (no 500) — el Paso 7 (`EXPLAIN`) necesita 1.000 filas de
  `sesiones_operativas` visibles para reproducir el N+1 medido en local (§8: `loops=1000`).
- `precargar.mjs 500 7 1920`: precarga **server-side** (detecta `QUIVO_CARGA_DATABASE_URL` y usa
  el camino `INSERT ... SELECT ... generate_series`, no fila por fila — ver la cabecera de
  `precargar.mjs`) de las primeras 500 de esas 1.000 sesiones × 7 días × 1.920 pts/sesión/día =
  6.720.000 filas, en ~35 round-trips (7 días × lotes de 100 sesiones) en vez de miles. Ajustar
  `QUIVO_CARGA_PRECARGA_LOTE_SESIONES` (default 100) si un lote individual tarda demasiado.

## Paso 4 — matriz de escritura, tier c1 (agente)

Instancia ya está en `db-custom-1-3840` (tier de creación). Solo escritura (`K=0`), sync 15s,
5 min de medición + 60s de calentamiento (default), concurrencia 8 para compensar la latencia
Bolivia→Santiago (subir a 16 si algún punto falla por throughput insuficiente sin que el p95 ni
la CPU lo expliquen — ver Paso 5):

```
cd scripts/experimentos/gps/carga
QUIVO_CARGA_K=0 \
QUIVO_CARGA_DURACION=300 \
QUIVO_CARGA_CONCURRENCIA=8 \
QUIVO_CARGA_PUNTOS='[
  {"perfil":"remoto-c1","objetivo":300,"syncS":15},
  {"perfil":"remoto-c1","objetivo":500,"syncS":15},
  {"perfil":"remoto-c1","objetivo":1000,"syncS":15},
  {"perfil":"remoto-c1","objetivo":2000,"syncS":15}
]' \
node correr-matriz.mjs
```

Si algún punto da `corridaInvalida`/throughput bajo objetivo por la latencia de red (no por CPU
saturada — comparar contra el Paso 5), repetirlo con `QUIVO_CARGA_CONCURRENCIA=16`:

```
QUIVO_CARGA_K=0 QUIVO_CARGA_DURACION=300 QUIVO_CARGA_CONCURRENCIA=16 \
QUIVO_CARGA_PUNTOS='[{"perfil":"remoto-c1-conc16","objetivo":2000,"syncS":15}]' \
node correr-matriz.mjs
```

## Paso 5 — CPU real de la instancia durante el Paso 4 (CTO)

Anotar la hora de inicio/fin real del Paso 4 (UTC) y correr, por cada corrida o para toda la
ventana del tier c1:

```
!cd scripts/experimentos/gps/carga && ./cloudsql/metricas.sh 2026-09-2XT..:..:..Z 2026-09-2XT..:..:..Z > resultados/remoto-cpu-c1.csv
```

(`resultados/` ya existe, mismo directorio que usa `correr-matriz.mjs`; el prefijo `remoto-`
evita pisar los `.csv`/`.json` del paso B local.)

CSV `timestamp,metrica,valor` (`cpu`/`memory`, fracción 0-1) vía Cloud Monitoring
(`cloudsql.googleapis.com/database/cpu|memory/utilization`). Es la métrica principal en remoto
(§10) — reemplaza a `docker stats`, que en este modo no corre (`correr-punto.mjs` lo salta
automáticamente cuando detecta `QUIVO_CARGA_DATABASE_URL`).

`metricas.sh` llama a la API REST v3 `projects.timeSeries.list` por `curl` (autenticado con
`gcloud auth print-access-token`), no a `gcloud monitoring time-series list` — ese subcomando
no existe en el CLI instalado (`gcloud monitoring` solo trae `dashboards`/`policies`/
`snoozes`/`uptime`). El uso del script (args, CSV de salida) no cambió; si falla, revisa que
`gcloud auth print-access-token` funcione en la sesión del CTO.

## Paso 6 — cambiar a tier c2 (CTO) y repetir matriz (agente)

```
!cd scripts/experimentos/gps/carga/cloudsql && ./cambiar-tier.sh db-custom-2-7680
```

Whitelist estricta: solo acepta `db-custom-1-3840` o `db-custom-2-7680`, y solo sobre
`quivo-carga-temp` (hardcodeado, sin argumento de instancia). Bloquea hasta terminar el patch.

Repetir el Paso 4 con `"perfil":"remoto-c2"` y el Paso 5 (`resultados/remoto-cpu-c2.csv`)
contra esta ventana.

## Paso 7 — EXPLAIN de listarHoy/obtenerPosiciones con 1.000 sesiones (agente)

Confirmar el N+1 de §8 fuera del NVMe local, contra PD-SSD real. Con
`QUIVO_CARGA_DATABASE_URL` seteada, conectar como `quivo_app` (mismo rol que mide
`lecturas.mjs`) y correr, dentro de una transacción con el `set_config` de RLS (rol
`admin_sindicato`, `sindicatoId` del seed — ver `lecturas.mjs` para los nombres exactos de
columnas/joins, son las mismas 2 queries tal cual `en-vivo.service.ts:231-259` y `:316-354`):

```sql
BEGIN;
SELECT set_config('app.rol', 'admin_sindicato', true);
SELECT set_config('app.sindicato_id', '<sindicatoId de seed-estado.json>', true);
EXPLAIN (ANALYZE, BUFFERS) <query de listarHoy>;
EXPLAIN (ANALYZE, BUFFERS) <query de obtenerPosiciones>;
ROLLBACK;
```

Guardar ambos planes completos (no solo el tiempo total) — lo que interesa confirmar es si
`loops=1000` en el `LEFT JOIN LATERAL` se sostiene igual en PD-SSD (§8 lo atribuye a que el plan
ejecuta el LATERAL una vez por sesión visible, no a que el disco sea lento).

## Paso 8 — borrado OBLIGATORIO (CTO)

```
!cd scripts/experimentos/gps/carga/cloudsql && ./borrar.sh
```

Borra **solo** `quivo-carga-temp` (nombre hardcodeado, sin argumento), lista las instancias
restantes del proyecto para verificar que ya no aparece, y borra `~/.quivo-carga-temp.env`.
Correrlo aunque la matriz haya fallado a mitad de camino — no dejar la instancia corriendo por
costo.

---

## Qué corre cada quién (resumen)

| Paso | Comando | Quién | Toca `gcloud` |
|---|---|---|---|
| 1 | `crear.sh` | CTO | sí |
| 2 | `migrar.sh` | agente | no |
| 3 | `seed.mjs` / `precargar.mjs` | agente | no |
| 4 | `correr-matriz.mjs` (K=0) | agente | no |
| 5 | `metricas.sh` | CTO | sí |
| 6 | `cambiar-tier.sh` | CTO | sí |
| 7 | `EXPLAIN` vía `psql`/node | agente | no |
| 8 | `borrar.sh` | CTO | sí |

## Cierre

Con estos resultados, volver a `docs/plan-experimento-puntos-gps.md` §9 (paso C) para
recalibrar `SQL_TIERS_MEDIDOS` con el número CONFIRMADO en Cloud SQL real (no solo NVMe local),
y anotar el resultado en §10 del plan antes de regenerar `docs/costos-gcp-2000.md`.
