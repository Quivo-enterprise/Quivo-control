# QUIVO Control

Plataforma SaaS **multi-tenant** para gestión de sindicatos de transporte público.

- **Web admin** (Next.js): CRUD de sindicatos, socios, vehículos, conductores, líneas, rutas/variantes, paradas y puntos de control; rotaciones; sanciones; dashboard de cumplimiento; auditoría.
- **App móvil conductor** (Expo, Android): offline-first, GPS en background durante el recorrido, validación local de puntos de control (geofence), outbox local y sincronización idempotente por lotes.
- **API** (NestJS/Fastify): monolito modular, PostgreSQL 16 + PostGIS con RLS multi-tenant, Redis + BullMQ para ingesta GPS.

## Estructura del monorepo (pnpm + Turborepo)

```
quivo-control/
├── apps/
│   ├── api/              NestJS (Fastify): auth, CRUD, rotaciones, tracking, sync, reportes
│   ├── web/              Next.js admin
│   └── mobile/           Expo app conductor (Android)
├── packages/
│   ├── shared/           Zod schemas, tipos, constantes (contrato API)
│   └── db/               Prisma schema + migraciones + seeds
└── docs/                 handoff, plan maestro, documento técnico
```

> Scaffold creado (QUI-211). `apps/api` tiene el esqueleto NestJS real (QUI-214) y
> `apps/mobile` el arnés del spike GPS (QUI-216) — ver `docs/spike-gps.md`. `apps/web`
> sigue siendo placeholder hasta M1/QUI-227 (Next.js). `packages/db` (Prisma) llega en QUI-217.

## Desarrollo

Requisitos: Node 22.x (ver `.nvmrc`), pnpm 11.x, Docker (para Postgres+PostGIS y Redis locales).

```bash
pnpm install        # instala los 5 workspaces
pnpm build          # turbo run build
pnpm lint           # turbo run lint
pnpm typecheck      # turbo run typecheck
pnpm test           # turbo run test
```

## Documentación

| Doc                                                              | Contenido                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`docs/handoff.md`](docs/handoff.md)                             | Estado vivo del proyecto: qué hay, decisiones, próximos pasos    |
| [`docs/plan-maestro.md`](docs/plan-maestro.md)                   | Stack aprobado, arquitectura, fases, verificación                |
| [`docs/documento-tecnico-cto.md`](docs/documento-tecnico-cto.md) | Documento técnico completo (modelo de datos, API, sync, riesgos) |

## Gestión

- **Linear:** [QUIVO Control — MVP](https://linear.app/quivo-tech/project/quivo-control-mvp-1d41fa072abf) — 6 milestones (M0–M5), cycles de 2 semanas, Sprint 1 = Cycle 12: 2026-07-20 → 2026-08-03.
- **Flujo git:** rama por issue → PR → CI → merge a `main`. Nunca commit directo a `main`.
