# Infraestructura GCP de producción — `quivo-control-prod`

Estado al 2026-09-08. Este documento describe **la infraestructura que existe**, cómo se
creó y por qué. El *cómo desplegar* vive en `scripts/deploy-gcp.sh`; el *por qué* de las
decisiones de arquitectura, en `docs/adr/0002-gcp.md`.

## Por qué un proyecto nuevo

El proyecto anterior (`quivo-piloto`, número `424426714260`) fue **descartado y borrado**.
Todo lo que apunte a esa URL o a ese número de proyecto está muerto. Al 2026-09-08 quedaban
dos referencias sin migrar, ambas al servicio borrado
`https://quivo-api-424426714260.southamerica-west1.run.app`:

- `scripts/deploy-web.sh` (todo el script — se reemplaza por `scripts/deploy-gcp.sh`)
- `apps/mobile/eas.json` (`EXPO_PUBLIC_API_URL`)

## Identidad del proyecto

| Dato | Valor |
|---|---|
| Project ID | `quivo-control-prod` |
| Número de proyecto | `741758083365` |
| Región (todo) | `southamerica-west1` |
| Cuenta de facturación | `016F26-6DB017-B5B1E7` |
| Cuenta operadora | `cloud@tuquivo.com` |

Todos los comandos y scripts pasan `--project=quivo-control-prod` **explícito**. El default
de `gcloud config` es estado global de la máquina, no del repo: un script que dependa de él
despliega al proyecto equivocado, sin avisar, en cuanto alguien abra otra terminal.

## APIs habilitadas

`run` · `sqladmin` · `redis` · `artifactregistry` · `cloudbuild` · `secretmanager` ·
`vpcaccess` · `compute` · `servicenetworking`

## Recursos creados

### Artifact Registry
Repo docker `quivo` en `southamerica-west1`.
Prefijo de imágenes: `southamerica-west1-docker.pkg.dev/quivo-control-prod/quivo`

### Red
- VPC: `default` (modo AUTO, la que trae el proyecto).
- **Private services access**: rango global `quivo-sql-rango` = `10.60.0.0/16`, peereado
  contra `servicenetworking.googleapis.com`. Es el prerequisito de la IP privada de Cloud
  SQL — sin él, `gcloud sql instances create --no-assign-ip` falla.
- **Serverless VPC connector**: `quivo-conector`, rango `10.8.0.0/28`, `e2-micro`, 2–3
  instancias. Es lo que le da a Cloud Run acceso a la red privada (Redis y, por el
  connector de Cloud SQL, la base).

### Cloud SQL — `quivo-db`
| Dato | Valor |
|---|---|
| Versión | POSTGRES_16 |
| Edición | **ENTERPRISE** |
| Tier | `db-g1-small` |
| Zona | `southamerica-west1-b`, `--availability-type=zonal` (sin HA) |
| Almacenamiento | SSD 10 GB, auto-increase |
| IP | **privada únicamente**, `10.60.0.3` |
| Connection name | `quivo-control-prod:southamerica-west1:quivo-db` |
| Backups | diarios 07:00, retención 7 |
| Base de datos | `quivo_control` |
| Usuario owner | `postgres` (password CSPRNG rotada 2026-09-08, en el secreto `DATABASE_URL`) |

**Trampa 1 — la edición.** El default de `gcloud sql instances create` pasó a ser
`ENTERPRISE_PLUS`, que **rechaza** los tiers compartidos:

```
ERROR: (gcloud.sql.instances.create) HTTPError 400: Invalid request: Invalid Tier
(db-g1-small) for (ENTERPRISE_PLUS) Edition.
```

Hay que pasar `--edition=ENTERPRISE` explícito. Sin ese flag, la única salida es saltar a
un tier `db-perf-optimized-N-*`, muchísimo más caro y absurdo para el piloto.

**Trampa 2 — sin IP pública no hay migraciones desde la laptop.** A diferencia del
despliegue anterior (IP pública con `requireSsl: false`, marcado como higiene pendiente en
su propio análisis de costos), esta instancia no es alcanzable desde internet. Eso es
deliberado, pero tiene una consecuencia operativa que hay que respetar: **`prisma migrate
deploy` no se puede correr desde una máquina local**, ni siquiera con `cloud-sql-proxy`
(el proxy sigue necesitando ruta de red hacia la IP privada). Las migraciones corren en un
**Cloud Run Job** dentro de la VPC, con la misma imagen de la API. Ver `scripts/deploy-gcp.sh`.

### Memorystore Redis — `quivo-redis`
| Dato | Valor |
|---|---|
| Tier | BASIC (sin réplica) |
| Tamaño | 1 GiB |
| Versión | `redis_7_2` |
| Connect mode | `DIRECT_PEERING` sobre la red `default` |
| Host:puerto | `10.51.123.11:6379` |
| AUTH | **habilitado** |

Redis **no es opcional**: `apps/api/src/modules/sync/sync-queue.service.ts:30` monta BullMQ
sobre `REDIS_URL`, y `apps/api/src/health/health.service.ts` lo incluye en el chequeo — sin
Redis, `/v1/health/ready` responde `degraded` y el propio script de deploy aborta.

AUTH vino DISABLED por default y se habilitó antes de desplegar nada. La auth string se lee
con `gcloud redis instances get-auth-string quivo-redis --region=southamerica-west1` y va
dentro del secreto `REDIS_URL`, con formato `redis://:<auth>@10.51.123.11:6379`.

## Deuda de seguridad conocida: la password de `quivo_app`

`packages/db/prisma/migrations/20260730152500_rls_multi_tenant/migration.sql:14`:

```sql
CREATE ROLE quivo_app LOGIN PASSWORD 'quivo_app_dev' NOSUPERUSER NOBYPASSRLS;
```

Esa password está **en el repo**. `quivo_app` es el rol de *runtime* (el que usa
`RUNTIME_DATABASE_URL`, sujeto a RLS), así que en producción no puede quedarse con ella.

La migración **no** se modifica: ya está aplicada en otros entornos, y su `IF NOT EXISTS`
significa que re-correrla no pisa la password. La rotación la hace `scripts/deploy-gcp.sh`
con un `ALTER ROLE quivo_app PASSWORD ...` ejecutado dentro de la VPC después de las
migraciones, usando un valor CSPRNG guardado una sola vez en Secret Manager.

## Cargas de trabajo previstas

| Nombre | Tipo | Imagen | Comando |
|---|---|---|---|
| `quivo-api` | Cloud Run service | `Dockerfile` (raíz) | `node apps/api/dist/main.js` |
| `quivo-worker` | Cloud Run **Worker Pool** | la **misma** imagen | `node apps/api/dist/worker.js` |
| `quivo-web` | Cloud Run service | `apps/web/Dockerfile` | Next standalone |
| `quivo-migraciones` | Cloud Run **Job** | la misma imagen que la API | `prisma migrate deploy` |

El worker es un Worker Pool y no un service porque `apps/api/src/worker.ts` usa
`NestFactory.createApplicationContext` — no escucha ningún puerto, así que un service normal
fallaría el arranque, y además escalaría a cero sin tráfico HTTP, matando al worker a mitad
de consumir la cola. El razonamiento completo está en el CMD del `Dockerfile` de la raíz.

`quivo-web` **no** lleva Cloud SQL, ni VPC connector, ni secretos: el panel es un SPA con
cáscara Next que pega directo contra la API desde el navegador.

## El orden del deploy no es negociable

1. Build + push de la imagen de la API.
2. Job `quivo-migraciones` (y la rotación de `quivo_app`). Si falla, se aborta sin desplegar.
3. Deploy de `quivo-api` → se lee su URL real.
4. Build de la imagen del panel **con `--build-arg NEXT_PUBLIC_API_URL=<URL de la API, sin `/v1`>`**.
5. Deploy de `quivo-web` → se lee su URL real.
6. `gcloud run services update quivo-api --update-env-vars CORS_ORIGIN=<URL del panel, sin barra final>`.
7. Deploy del worker pool.
8. Verificar `/v1/health/ready` = `{"status":"ok","db":"up","redis":"up"}`.

Las dos restricciones que fuerzan este orden:

- **`NEXT_PUBLIC_*` se hornea en build time.** Next las inlinea en los chunks de JS
  (`apps/web/Dockerfile`). Setearlas como variable de entorno del servicio de Cloud Run
  después del deploy **no tiene ningún efecto** sobre el JS ya compilado; el panel sale con
  el fallback `http://localhost:3000` y roto, sin error visible hasta que alguien lo prueba.
  Por eso el panel no se puede construir antes de que la API exista.
- **`CORS_ORIGIN` es un string exacto, no una lista.** `apps/api/src/main.ts` usa
  `origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000'`. Un carácter de más (una
  barra final) rompe el preflight y el panel no puede ni loguear. Y esa URL solo existe
  después de desplegar el panel.

## Pendiente

- **`apps/mobile/eas.json`**: `EXPO_PUBLIC_API_URL` sigue apuntando al servicio borrado. Hay
  que actualizarlo con la URL real de `quivo-api` **después** del primer deploy, antes de
  generar el APK.
- **`apps/landing` no tiene destino de deploy documentado.** Es un hueco, no una decisión.
- Sin CD: el deploy es manual vía script, por decisión explícita de alcance para el MVP.
  Tampoco hay Terraform — esta infraestructura se creó con `gcloud` a mano y este documento
  es su único registro.
