# Despliegue del panel web admin a Cloud Run

> **⚠️ ARCHIVADO el 2026-08-19.** Ejecutado el 2026-08-16 (PR #23): el panel está desplegado en
> Cloud Run. El procedimiento vigente y automatizado es `scripts/deploy-web.sh`.

## Contexto

Mañana lunes 17 de agosto arranca el piloto real de campo con un auto y un conductor. El
backend está desplegado y verificado en Cloud Run (`southamerica-west1`), y el APK del conductor
está compilado y verificado.

**Falta el panel web.** `gcloud run services list` devuelve un solo servicio, `quivo-api`:
`apps/web` nunca se desplegó, y en Artifact Registry solo existen imágenes `api`. Sin el panel,
el punto 7 del checklist de aceptación —"el recorrido se reconstruye correctamente en el panel
web"— no se puede ejecutar, y el CTO no tiene forma de ver los datos que el piloto genere.

El Dockerfile de `apps/web` ya existe (QUI-354, PR #15) y nunca se ejerció. El ADR 0002 ya
decidió Cloud Run para el panel y descartó Firebase App Hosting por no tener región sudamericana.

Resultado buscado: el panel sirviendo en Cloud Run, con login funcionando contra el API real, y
el procedimiento versionado para que no dependa de esta sesión.

## Lo que hace fácil este deploy

`apps/web` es un SPA con cáscara Next: todo `page`/`layout` salvo `app/layout.tsx` es
`'use client'`, y `apps/web/package.json:13-31` no incluye `better-auth`, `@quivo/db` ni
`@prisma/client`. El navegador pega directo contra el API con `Authorization: Bearer`, y la
sesión vive en `localStorage` (`auth-context.tsx:40`), no en cookies.

**Consecuencia:** el servicio de Cloud Run del panel **no necesita** conector de Cloud SQL, ni
VPC connector, ni secretos de base, ni `JWT_SECRET`. Solo servir el bundle. Es un servicio mucho
más simple que el del API.

## Las dos trampas

**1. `NEXT_PUBLIC_API_URL` se hornea en build time.** El Dockerfile la toma como `--build-arg`
(`Dockerfile:60-63`); si falta, cae al fallback `'http://localhost:3000'` del código y el panel
sale roto sin avisar. Un error acá obliga a reconstruir la imagen entera.

Va **sin** `/v1`: el código concatena el prefijo en cada llamada
(`client.ts:36` → `` `${API_URL}/v1${path}` ``). Valor correcto:
`https://quivo-api-424426714260.southamerica-west1.run.app`

**2. CORS es un huevo-gallina, y hoy está sin configurar.** `apps/api/src/main.ts:51-54` usa
`origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000'` — **un string único**, no un array.
El servicio desplegado no tiene `CORS_ORIGIN` seteado, así que hoy solo aceptaría `localhost`.
Sin arreglarlo, el navegador bloquea el preflight y el panel no puede ni loguear.

Se resuelve porque la URL de Cloud Run es predecible: `<servicio>-<número-proyecto>.<región>.run.app`.
El API es `quivo-api-424426714260.southamerica-west1.run.app`, así que el panel será
`https://quivo-web-424426714260.southamerica-west1.run.app`. Se verifica después del deploy y se
corrige si difiere. Sin barra final: la comparación de origen es exacta.

## Datos de infraestructura ya confirmados

| Qué | Valor |
|---|---|
| Proyecto / número | `quivo-piloto` / `424426714260` |
| Región | `southamerica-west1` |
| Artifact Registry | `southamerica-west1-docker.pkg.dev/quivo-piloto/quivo` |
| Service account | `424426714260-compute@developer.gserviceaccount.com` |
| Cloud SQL | `quivo-piloto:southamerica-west1:quivo-control-db` (el panel **no** lo usa) |

## Pasos

### 1. Construir y publicar la imagen

Build multi-stage con `turbo prune` desde la raíz del repo (el Dockerfile asume ese contexto).
Forzar `--platform linux/amd64` explícitamente: Cloud Run no corre arm64.

```bash
docker buildx build --platform linux/amd64 \
  -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://quivo-api-424426714260.southamerica-west1.run.app \
  --build-arg NEXT_PUBLIC_DEV_BYPASS_AUTH=false \
  -t southamerica-west1-docker.pkg.dev/quivo-piloto/quivo/web:v1 \
  --push .
```

Este Dockerfile nunca corrió. Es el primer punto donde puede aparecer un bloqueante nuevo —
igual que pasó cinco veces con el build del APK. Si falla, diagnosticar contra el
`node_modules` real, no contra la doc.

### 2. Verificar la imagen antes de desplegar

Correrla local mapeando el puerto y confirmar que responde y que **la URL horneada es la
correcta**, no `localhost:3000`:

```bash
docker run --rm -p 8080:8080 -e PORT=8080 <imagen>
curl -s localhost:8080 | grep -o 'quivo-api[^"]*' | head
```

Barato, y evita gastar una vuelta de deploy para descubrir un `--build-arg` mal pasado.

### 3. Desplegar el servicio

```bash
gcloud run deploy quivo-web \
  --image southamerica-west1-docker.pkg.dev/quivo-piloto/quivo/web:v1 \
  --region southamerica-west1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 0 --max-instances 3 \
  --service-account 424426714260-compute@developer.gserviceaccount.com
```

Sin `--add-cloudsql-instances`, sin `--vpc-connector`, sin secretos: el panel no toca la base.
`min-instances 0` porque el panel tolera arranque en frío; el API queda en 1 como está.

### 4. Confirmar la URL real y abrir CORS en el API

Leer la URL efectiva (`gcloud run services describe quivo-web --format='value(status.url)'`) y
contrastarla con la predicha. Después, sobre el API:

```bash
gcloud run services update quivo-api --region southamerica-west1 \
  --update-env-vars CORS_ORIGIN=<url-del-panel>
```

**Esto crea una revisión nueva del API la noche antes del piloto.** Es el paso de mayor riesgo
del plan. Inmediatamente después hay que reverificar que el API sigue sano:

```bash
curl -s https://quivo-api-424426714260.southamerica-west1.run.app/v1/health/ready
# esperado: {"status":"ok","db":"up","redis":"up"}
```

Si el readiness no vuelve `ok`, revertir a la revisión anterior con
`gcloud run services update-traffic quivo-api --to-revisions=<revisión-previa>=100`. El APK del
conductor depende de ese servicio; el panel no vale romperlo.

### 5. Verificar el panel de punta a punta

No alcanza con que cargue el HTML. Con Playwright MCP contra la URL real:

1. El panel carga y renderiza el login.
2. Login con `admin@quivo.local` — **confirma que CORS quedó bien**, porque el login es el primer
   fetch cross-origin (`api-client.ts:8` → `POST /v1/auth/login`).
3. Navegar a la vista que usa el piloto: que el sindicato piloto aparezca y que se vea el
   vehículo/conductor sembrados.
4. Revisar la consola del navegador: cero errores de CORS o de red.

El punto 2 es el que realmente valida el deploy. Los puntos 3 y 4 validan que el panel sirve para
lo que se necesita mañana.

### 6. Dejarlo versionado

- `scripts/deploy-web.sh` — los pasos 1-4 parametrizados, con la URL del API y el proyecto como
  variables arriba, y un comentario explicando por qué `NEXT_PUBLIC_API_URL` va sin `/v1` y por
  qué `CORS_ORIGIN` tiene que ser exacto. Ambas cosas son no obvias y se van a olvidar.
- `docs/handoff.md` — el panel desplegado, su URL, y que `CORS_ORIGIN` ahora acopla los dos
  servicios: si el panel cambia de URL, el API deja de aceptarlo.
- Linear: cerrar lo que corresponda del despliegue del panel y anotar en **QUI-370** (Terraform)
  que ahora hay dos servicios fuera de IaC, no uno.

### 7. Cerrar

Rama, commit, PR, esperar CI, mergear. Sin atribución de IA.

## Riesgo aceptado por el CTO

El panel queda público con `admin@quivo.local` / `Quivo123!`, contraseña hardcodeada en
`packages/db/prisma/seed.ts:35` y publicada en `CREDENCIALES.md:52`. Esa cuenta tiene rol
`admin_quivo`, que **bypassea RLS por diseño** (`seed.ts:623-624`), y ahora sobre la base que
contendrá la evidencia del piloto. Decisión del CTO del 2026-08-16: se cambia después. Queda
registrado acá y en el handoff, no vuelve a levantarse.

## Verificación final

- `curl` al panel devuelve 200 y el HTML contiene la URL del API de Cloud Run, no `localhost`.
- Login real funciona desde el navegador contra el API desplegado, sin errores de CORS.
- `/v1/health/ready` del API sigue devolviendo `{"status":"ok","db":"up","redis":"up"}` después
  de la revisión nueva.
- El sindicato piloto y su vehículo/conductor se ven en el panel.
- `scripts/deploy-web.sh` commiteado y CI en verde.

## Qué NO entra

- Terraform (QUI-370, post-piloto).
- Dominio propio o certificado: se usa la URL de `run.app`.
- Job de CI que despliegue: hoy no existe deploy automatizado para ningún servicio.
- Rotación de credenciales (decisión del CTO arriba).
