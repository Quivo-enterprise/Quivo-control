# @quivo/shared

Contrato único entre `apps/api`, `apps/web` y `apps/mobile`: enums, schemas Zod de
entidades núcleo y el schema del evento de sync. Ver `docs/documento-tecnico-cto.md` §1 y §8.

## Contenido

- `enums/` — roles (`RolSchema`) y estados (vehículo, socio, conductor, sindicato, sanción, rotación).
- `entities/` — schemas núcleo: `SindicatoSchema`, `SocioSchema`, `VehiculoSchema`, `ConductorSchema`
  (y sus variantes `Crear*Schema` para payloads de creación). Se amplían en las issues CRUD de M1
  (QUI-220..223) a medida que se conocen todos los campos de cada entidad.
- `sync/` — `EventoSyncSchema` y `SyncBatchSchema`: contrato de `POST /v1/sync/batches` (RF-67..73).
  `eventId` se valida como **UUIDv7** (idempotencia de sync, RF-72).
- `primitives.ts` — validadores base reutilizables (`uuidSchema`, `uuidV7Schema`).
- `openapi/` — registro y generación de un documento OpenAPI 3.0 a partir de los schemas Zod.

## Generar el documento OpenAPI

```bash
pnpm --filter @quivo/shared openapi:generate
```

Escribe `packages/shared/openapi.json` (no se commitea — está en `.gitignore`; se regenera
en CI/local cuando se necesite, ej. para servir docs de API o validar contrato).

## Uso desde otra app del monorepo

```ts
import { SindicatoSchema, RolSchema, EventoSyncSchema } from '@quivo/shared';
```
