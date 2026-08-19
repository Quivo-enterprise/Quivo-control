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

La API, el panel administrativo y la aplicación Android ya tienen implementación funcional.
La app móvil incorpora login vehículo -> chofer, contexto de asignación, sesión segura y el
arnés GPS/outbox original; ver `docs/archivo/plan-auth-movil-quivo.md` y `docs/spike-gps.md`.

## Desarrollo

Requisitos: Node 22.x (ver `.nvmrc`), pnpm 11.x, Docker (para Postgres+PostGIS y Redis locales).

```bash
pnpm install        # instala los 5 workspaces
pnpm dev            # levanta Postgres, Redis, API, web y la app móvil
pnpm build          # turbo run build
pnpm lint           # turbo run lint
pnpm typecheck      # turbo run typecheck
pnpm test           # turbo run test
```

`pnpm dev` aplica las migraciones, ejecuta el seed idempotente y abre API, web y app móvil
en tres terminales independientes (Konsole o Alacritty). Cada ventana se puede detener
con `Ctrl+C` o cerrar por separado. Sin entorno gráfico usa una sola terminal; este modo
también se puede forzar con `QUIVO_SINGLE_TERMINAL=1 pnpm dev`. Los contenedores quedan
activos y se pueden apagar con `docker compose down`.

El lanzador detecta la IP LAN de la PC y configura Expo para conectarse al backend mediante
`http://<ip-lan>:3001`. Se puede indicar otra interfaz con
`QUIVO_HOST_IP=192.168.x.x pnpm dev`.

La app usa un módulo GPS nativo y no funciona dentro de Expo Go. Antes del primer arranque
en un Android nuevo hay que conectar el dispositivo por ADB y ejecutar
`pnpm --filter @quivo/mobile android`; después `pnpm dev` reutiliza ese cliente de desarrollo.
El firewall de la PC debe aceptar TCP `3001` y `8081` desde la red local del teléfono.

## Documentación

| Doc                                                              | Contenido                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`docs/handoff.md`](docs/handoff.md)                             | Estado vivo del proyecto: qué hay, decisiones, próximos pasos    |
| [`docs/plan-maestro.md`](docs/plan-maestro.md)                   | Stack aprobado, arquitectura, fases, verificación                |
| [`docs/documento-tecnico-cto.md`](docs/documento-tecnico-cto.md) | Documento técnico completo (modelo de datos, API, sync, riesgos) |
| [`docs/plan-piloto-lunes-17-agosto.md`](docs/plan-piloto-lunes-17-agosto.md) | Alcance, fases y fechas vigentes; hardening diferido; entorno local |
| [`docs/deuda-abierta.md`](docs/deuda-abierta.md)                 | Hallazgos de seguridad y escalabilidad todavía abiertos           |
| [`docs/archivo/README.md`](docs/archivo/README.md)               | Índice de los documentos archivados y por qué murieron            |

## Gestión

- **Linear:** [QUIVO Control — MVP](https://linear.app/quivo-tech/project/quivo-control-mvp-1d41fa072abf) — 6 milestones (M0–M5), cycles de 2 semanas, Sprint 1 = Cycle 12: 2026-07-20 → 2026-08-03.
- **Flujo git:** rama por issue → PR → CI → merge a `main`. Nunca commit directo a `main`.
