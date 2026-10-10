# Credenciales demo para desarrollo local — QUIVO Control

Guía para levantar y entrar al entorno local. **No contiene PINs, passwords ni URLs con
password**: la verdad vive en el código y en tu `.env` local.

> **Qué es demo y qué NO.** Todo lo sembrado por el seed es exclusivamente demo/desarrollo:
> sindicatos `Sindicato 1º de Mayo` y `Sindicato Unificado del Norte`, y la cuenta de
> aislamiento. **El sindicato del piloto real NO está acá** y sus credenciales no van en ningún
> archivo del repo.

## Dónde está la verdad

- Usuarios, placas, CI y PINs demo: `packages/db/prisma/seed.ts`.
- Valores por defecto de las variables del seed: `.env.example`.
- Cualquier valor sensible que no esté en esos dos lugares: pedir al CTO.

## Usuarios web demo (`apps/web`, panel en `http://localhost:3000`)

| Rol | Email | Alcance |
|---|---|---|
| SuperAdmin QUIVO | `admin@quivo.local` | Global, sin restricción de tenant |
| Admin Sindicato | `admin@sindicato.local` | Sindicato 1º de Mayo |
| Admin Aislamiento | `admin@aislamiento.local` | Solo pruebas E2E de aislamiento cross-tenant (QUI-366); RLS lo limita a su tenant |

Password: la variable `SEED_ADMIN_PASSWORD` (ver `.env.example`). Fuera de `development` el seed
exige que esté definida explícitamente.

Riesgo residual conocido: estas cuentas viven en la misma base que el sindicato piloto. Si el
piloto pasa a producción real, mover el seed demo a un entorno aparte o borrar estas cuentas.

## App móvil (QUIVO Conductor)

Login encadenado en dos pasos: (1) placa + PIN del vehículo; (2) CI + PIN del chofer. El seed
crea un vehículo y un chofer por cada sindicato demo, con la línea `L1`. Placas, CI y PINs por
defecto: ver `packages/db/prisma/seed.ts` (PINs overridables con `MOBILE_SEED_VEHICLE_PIN` y
`MOBILE_SEED_DRIVER_PIN`, ver `.env.example`).

## Sindicato piloto real (QUI-366)

No usa PIN fijo ni lo crea el seed (el seed solo siembra línea/ruta/puntos de control).
Las credenciales de prueba (1 chofer + 5 pasantes) las genera `scripts/crear-credenciales-piloto.ts`:
PIN aleatorio de 6 dígitos, impreso una sola vez por consola tras el `COMMIT`; guardarlo fuera
del repo (gestor de secretos). Es idempotente y no pisa un PIN ya entregado; `FORZAR_PIN=1`
rota los PINs a propósito. Requiere que existan la ruta Z12 (seed) y la ruta 120-circuito
(`scripts/cargar-linea-120.ts --apply`). Pedir al CTO la `DATABASE_URL` a usar.

## Infraestructura local

- Postgres (host 5434) y Redis (host 6380) por `docker-compose.yml`. Usuario/password y URLs de
  conexión: ver `.env.example` y `docker-compose.yml`.
- API: `http://localhost:3001` (`apps/api`).
- `JWT_SECRET`: solo en tu `.env` local, sin commitear. Generá el tuyo con
  `openssl rand -base64 32`. Fuera de `development` el arranque falla si falta o es un valor
  de ejemplo.

## Guía rápida

```bash
pnpm dev                              # levanta contenedores, migra, siembra y arranca API, Web y Metro
pnpm --filter @quivo/db seed          # re-ejecutar el seed
pnpm --filter @quivo/mobile android   # solo la app móvil en Android
```
