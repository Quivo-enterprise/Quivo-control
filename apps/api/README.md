# @quivo/api

Esqueleto NestJS (adapter Fastify) — monolito modular por dominio (doc técnico §2, §3).

## Correr en local

```bash
docker compose up -d              # Postgres+PostGIS (puerto 5434) + Redis, desde la raíz del repo
cp ../../.env.example .env        # relativo a apps/api/ — ajustar DATABASE_URL al puerto 5434 si difiere
pnpm --filter @quivo/db prisma:migrate:dev  # crea las tablas (una vez, o tras cambiar el schema)
pnpm --filter @quivo/db prisma:seed         # usuarios demo (ver sección Auth más abajo)
pnpm --filter @quivo/api build
pnpm --filter @quivo/api start     # node dist/main.js — sirve en :3001 (PORT en .env)
```

> Puerto **3001**, no 3000: `apps/web` (`next dev`) ya usa el 3000. Si corrés ambas apps
> al mismo tiempo para probar el login end-to-end, necesitan puertos distintos —
> `NEXT_PUBLIC_API_URL` en `apps/web/.env.local` ya apunta a `http://localhost:3001`.

> El script `dev` (`tsx watch`) sirve para las apps `web`/`mobile`, pero **no** para `api`:
> `tsx`/esbuild no emiten metadata de decoradores TypeScript, y NestJS la necesita para
> inyección de dependencias por tipo. Para iterar en la API, compilar con `tsc` (o `tsc --watch`)
> y correr el JS emitido con `node`/`node --watch`.

## Endpoints

- `GET /v1/_internal/ping` — liveness simple, sin tocar DB/Redis.
- `GET /v1/health` — readiness: verifica Postgres y Redis, 200 si ambos están `up`, 503 si no.
  Se sirve bajo `/v1` (no como `/health` sin versionar): `setGlobalPrefix(..., { exclude })`
  rompe el hook de logging de `nestjs-pino` sobre Fastify para las rutas excluidas — se
  prefirió mantener logging consistente en todas las rutas sobre la convención de un
  health-check sin prefijo.
- `POST /v1/_internal/validate-demo` — endpoint de diagnóstico: valida el body contra
  `CrearSindicatoSchema` de `@quivo/shared` usando el pipe global de Zod. Se retira cuando
  el módulo `sindicatos` real (QUI-220) exponga su propio CRUD.
- `POST /v1/public/demo-request` — recibe una solicitud de demostración desde
  `control.myquivo.com`, valida y guarda nombre, sindicato, ciudad y cantidades. Devuelve
  el mensaje preparado y el enlace de WhatsApp para que el visitante continúe la
  conversación. Está limitado a 5 solicitudes por minuto y no requiere autenticación.
- `POST /v1/auth/login` / `POST /v1/auth/refresh` (QUI-219) — ver sección Auth abajo.

### Mobility pública para QUIVO Rutas

- `GET /v1/public/mobility/cities` — catálogo de ciudades y estado de cobertura.
- `GET /v1/public/mobility/lines?cityId=cochabamba&q=...` — líneas publicadas de una ciudad.
- `GET /v1/public/mobility/stops?cityId=cochabamba&q=...` — paradas publicadas de una ciudad.
- `GET /v1/public/mobility/lines/:id?cityId=cochabamba`, `/routes/:id` y `/stops/:id` —
  detalles con comprobación de ciudad.
- `POST /v1/public/mobility/journeys/search` acepta `cityId`; si se omite, conserva
  compatibilidad y usa `cochabamba` durante la migración de clientes.

La migración `20260819100000_mobility_city_scope` debe aplicarse antes de desplegar esta
versión de la API y antes de habilitar los feature flags
`VITE_MOBILITY_CITY_FILTER` / `EXPO_PUBLIC_MOBILITY_CITY_FILTER` en QUIVO Rutas.

La migración `20260906120000_demo_requests` debe aplicarse antes de activar el formulario
de la landing. En producción, `CORS_ORIGIN` debe incluir exactamente
`https://control.myquivo.com` y `DEMO_WHATSAPP_NUMBER` debe contener el número público de
WhatsApp en formato internacional, solo con dígitos.

#### Activación de `api.myquivo.com`

La API se publica como el servicio `quivo-api` de Cloud Run en
`southamerica-west1`. Después de desplegar una imagen que incluya esta migración, crea el
mapping de dominio personalizado `api.myquivo.com` en Cloud Run y agrega en el Zone Editor
de cPanel el registro DNS que Google indique para ese mapping (normalmente un CNAME de
verificación). No apuntes el subdominio a la IP compartida de HostGator: esa IP solo sirve
la landing estática y no ejecuta este proceso NestJS.

La secuencia de producción es: aplicar la migración con el usuario de migraciones, desplegar
la imagen con `RUNTIME_DATABASE_URL` y `JWT_SECRET` desde Secret Manager, configurar
`CORS_ORIGIN=https://control.myquivo.com,https://<panel-publico>` y comprobar primero
`GET /v1/health/live`, luego `GET /v1/health/ready` y finalmente
`POST /v1/public/demo-request`.

### Auth operativa móvil

- `POST /v1/mobile/auth/vehiculo` — placa + PIN + dispositivo; emite desafío corto.
- `POST /v1/mobile/auth/conductor` — documento + PIN + desafío; crea sesión operativa.
- `POST /v1/mobile/auth/refresh` — rota access y refresh opacos.
- `POST /v1/mobile/auth/logout` — revoca la sesión.
- `GET /v1/mobile/auth/contexto-operativo` — recupera asignación, línea y ruta.
- `PUT /v1/mobile/credenciales/{vehiculos|conductores}/:id` — provisiona/rota PIN con
  sesión administrativa autorizada; nunca devuelve la credencial.

Los secretos móviles se persisten sólo como hashes. Rotar un PIN revoca sesiones activas
relacionadas. Pino elimina `Authorization`, cookies y `Set-Cookie` de todos los logs HTTP.

## Auth (QUI-219)

Better-Auth + JWT (doc técnico §5: "no construir auth a mano"). La instancia de
Better-Auth vive en `packages/db/src/auth.ts` (no acá) porque tanto el seed como
`@better-auth/cli generate` — que produce `packages/db/prisma/schema.prisma` — necesitan
importarla, y `packages/db` no puede depender de `apps/api`; este módulo (`auth.controller.ts`/
`auth.service.ts`) solo llama a `auth.api.*` y reempaqueta la respuesta al contrato que
espera `apps/web` (`accessToken`/`refreshToken`/`user`, ver `@quivo/shared`).

- El **access token** es un JWT de vida corta (`JWT_ACCESS_TTL`, default 15m) firmado con
  un par de claves asimétrico (JWKS) que Better-Auth genera y guarda cifrado en la DB — no
  es un HMAC con `JWT_SECRET` directo. Trae `rol`/`sindicatoId` como claims custom.
- El **refresh token** es el token de sesión opaco de Better-Auth (`JWT_REFRESH_TTL`,
  default 30d) — `POST /v1/auth/refresh` lo valida y emite un access token nuevo.
- Solo hay rutas de `login`/`refresh` — no hay ruta pública de sign-up (el control de
  acceso real es "la ruta no existe", no un flag de Better-Auth).
- Guards de autorización por rol y RLS de Postgres quedan para QUI-220+, cuando existan
  endpoints/tablas de dominio reales que proteger.

### Levantar la base y sembrar usuarios demo

```bash
pnpm --filter @quivo/db prisma:migrate:dev   # crea las tablas (User/Session/Account/Verification/Jwks)
pnpm --filter @quivo/db prisma:seed          # 2 usuarios demo, ver abajo
```

| Email                   | Password    | Rol               | sindicatoId                            |
| ----------------------- | ----------- | ----------------- | -------------------------------------- |
| `admin@quivo.local`     | `Quivo123!` | `admin_quivo`     | —                                      |
| `admin@sindicato.local` | `Quivo123!` | `admin_sindicato` | `11111111-1111-4111-8111-111111111111` |

El seed es idempotente (si el usuario ya existe, lo omite) — se puede correr de nuevo sin
problema. Si cambia `packages/db/src/auth.ts` (nuevos `additionalFields`, un plugin
nuevo), hay que regenerar el schema con
`pnpm --filter @quivo/db exec better-auth generate --config src/auth.ts --output prisma/schema.prisma`
y crear una migración nueva (`prisma:migrate:dev`) — no editar `schema.prisma` a mano.

> `@better-auth/cli` está pineado en `1.4.22` (igual que `better-auth`): es la versión más
> reciente publicada del CLI y todavía no soporta la línea `1.6.x` de `better-auth` (bug de
> compatibilidad conocido en el paquete). Si se sube `better-auth`, hay que verificar que
> el CLI ya lo soporte.

## Estructura

Ver `src/modules/README.md` para la convención de módulos de dominio (un módulo por
carpeta, comunicación solo vía `index.ts`).

## Logging, salud y observabilidad

- `nestjs-pino`: JSON estructurado, `request_id` (UUID, generado por Fastify) en cada línea
  de request completada.
- Sentry se inicializa en `main.ts` si `SENTRY_DSN` está seteado (no falla si está vacío).
