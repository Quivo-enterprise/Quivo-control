# Plan técnico — QUIVO Control: Stack tecnológico y arquitectura

## Contexto

Producto (CPO) entregó `QUIVOcontrol.md`: plataforma SaaS multi-tenant para gestionar sindicatos de transporte público — web admin (CRUD de sindicatos/socios/vehículos/conductores/líneas/rutas/puntos de control, rotaciones, dashboard) + app móvil offline-first que registra GPS durante recorridos, valida puntos de control y sincroniza eventos al recuperar conexión. Criterios de decisión pedidos: **velocidad de desarrollo del MVP** y **escalabilidad a muchos usuarios simultáneos** (miles de vehículos emitiendo GPS, sync en ráfagas).

Se convocó council (sesión `council-20260719-083140`, 2 agentes: Claude + Gemini) y se verificó con investigación web. Este documento es la síntesis del chairman + plan de construcción.

## Veredicto del council

**Consenso (ambos agentes, confianza alta):**

- **Monolito modular**, NO microservicios desde el día 1 (matarían la velocidad del MVP con equipo pequeño). Módulos con bordes limpios para extraer servicios después.
- **PostgreSQL única DB**: PostGIS para geo (geofencing de puntos de control, geometría de rutas) + particionado temporal para puntos GPS. Una sola DB que operar/backupear.
- **Multi-tenant shared-schema**: `sindicato_id` en cada tabla + **Row-Level Security** de Postgres. Schema-per-tenant descartado (overhead operativo sin requisito legal que lo exija).
- **Idempotencia de sync**: UUID generado en el cliente por evento + `INSERT ... ON CONFLICT (event_id) DO NOTHING`. Reintentos tras corte de red = cero duplicados (cumple RF-72, RNF-33/34).
- **Ingesta por lotes + cola**: la app sincroniza batches, el backend encola y un worker inserta multi-row. El pico del "lunes a la mañana cuando toda la flota sincroniza" lo absorbe la cola, no el request handler.

**Divergencia:**

- Backend: Claude propuso TypeScript (Fastify/NestJS); Gemini propuso Go. El argumento de Gemini (throughput de ingesta) es real pero el cuello es la DB, no el runtime — batching + cola lo neutralizan. Gemini asumió "ecosistema Go existente en el workspace" (falso).
- Móvil: Expo/React Native vs Flutter. Ambos dependen del mismo SDK nativo de background geolocation (Transistorsoft, API idéntica en ambos).
- Web: Next.js vs React SPA (Vite).

**Decisión del chairman: TypeScript punta a punta.** Razón decisiva: el entorno del equipo ya es TS/React/Expo (tooling de Expo EAS instalado, patrones React/RN/Prisma en uso). Un solo lenguaje + tipos compartidos entre API, web y móvil = máxima velocidad de MVP sin sacrificar el techo de escala (el batching lo protege). Flutter/Go implicarían aprender 2 lenguajes nuevos — contra el criterio #1.

## Stack decidido (el porqué y para qué)

| Capa                | Elección                                                                                   | Por qué / para qué                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo            | pnpm workspaces + Turborepo                                                                | Tipos y validadores Zod compartidos entre backend/web/móvil; elimina bugs de contrato API                                                                                                                                                                                                                 |
| Backend             | **NestJS (adapter Fastify)**, monolito modular                                             | Módulos por dominio (RNF-28/29/30); Fastify = throughput HTTP alto; DI y estructura que un equipo pequeño mantiene                                                                                                                                                                                        |
| ORM                 | Prisma para CRUD; SQL crudo (multi-row insert/`COPY`) para ingesta GPS                     | Prisma acelera el 90% CRUD del MVP; la ruta caliente de ingesta no pasa por ORM                                                                                                                                                                                                                           |
| DB                  | **PostgreSQL 16+ con PostGIS**; `gps_points` particionada por rango de tiempo (pg_partman) | PostGIS: geofencing por radio de tolerancia (RF-36/39), geometrías de ruta (RF-28). Particionado nativo mantiene portabilidad de hosting — TimescaleDB NO está en RDS/Aurora/Neon gestionados (verificado); migrar a Tiger Cloud/self-hosted Timescale queda como palanca de escala, no dependencia día 1 |
| Cola                | Redis + BullMQ                                                                             | Absorbe ráfagas de sync; workers insertan por lote; separar workers a proceso propio es el primer paso de escalado y ya queda preparado                                                                                                                                                                   |
| Auth                | Better-Auth + JWT con claims (`sindicato_id`, `rol`) + **RLS en Postgres**                 | RNF-14–17: doble barrera — el JWT define el tenant, RLS lo hace imposible de saltar aunque una query olvide el filtro. No construir auth a mano                                                                                                                                                           |
| Web admin           | **Next.js (App Router)** + Tailwind + TanStack Query                                       | Dashboard interno sin SEO; Next.js por ecosistema del equipo y deploy/CI en Vercel ya integrado al flujo                                                                                                                                                                                                  |
| Móvil               | **Expo (React Native)** + EAS Build                                                        | Tooling EAS ya operativo; dev-builds soportan módulos nativos                                                                                                                                                                                                                                             |
| GPS background      | **react-native-background-geolocation (Transistorsoft)** — licencia paga única ~US$400     | Estándar de facto en fleet tracking; nativo Swift/Kotlin bajo el capó, maneja Doze/App Standby; config plugin de Expo (sin tocar manifests). `expo-location` gratis se muere con los battery killers de Android gama baja — riesgo inaceptable para el corazón del producto                               |
| Storage local móvil | expo-sqlite como **outbox** (rutas del día, puntos de control, cola de eventos)            | RF-67–73: descarga de asignación diaria + eventos GPS locales + reintentos de sync                                                                                                                                                                                                                        |
| Mapas               | MapLibre GL + tiles OSM (upgrade a Mapbox si hace falta)                                   | Costo cero en MVP; misma API que Mapbox si se migra                                                                                                                                                                                                                                                       |
| Infra inicial       | **GCP** (ADR 0002, 2026-08-14): Cloud Run (API) + Worker Pool (ingesta) + Cloud SQL PG16/PostGIS + Memorystore + Secret Manager; web en Firebase App Hosting; Terraform | La cuenta de GCP se reactivó; el ADR 0001 (Railway vs Fly.io) quedó anulado sin haberse ejecutado                                                                                                                                                                                                                                          |

**Camino de escalado (en orden, sin reescritura):** 1) réplicas de lectura para dashboard → 2) workers de ingesta en proceso separado (ya están detrás de la cola) → 3) TimescaleDB/particionado agresivo + compresión para histórico GPS → 4) extraer módulo de ingesta como servicio (los bordes del monolito modular lo permiten).

**Riesgo técnico #1 (identificado por el council):** GPS background en Android real de choferes (gama baja, Doze, battery killers). Mitigación: **spike de validación en semana 1** — app esqueleto con Transistorsoft en dispositivo Android barato, 8h de tracking, medir batería y pérdida de puntos. Si falla, plan B: módulo de tracking nativo Kotlin (Foreground Service) dentro de la app Expo.

## Estructura del repo

```
quivo-control/            (monorepo pnpm + turborepo)
├── apps/
│   ├── api/              NestJS: módulos auth, sindicatos, socios, vehiculos,
│   │                     conductores, lineas, rutas, control-points, rotaciones,
│   │                     tracking (ingesta), sync, reportes, auditoria
│   ├── web/              Next.js admin
│   └── mobile/           Expo app conductor
├── packages/
│   ├── shared/           Zod schemas, tipos, constantes (contrato API)
│   └── db/               Prisma schema + migraciones + seeds
└── docs/                 handoff.md, plan, ADRs
```

## Modelo de datos (núcleo)

`sindicatos` → `socios` → `vehiculos`; `conductores`; `lineas` → `rutas` (geometría PostGIS `LINESTRING`) → `variantes`, `paradas`, `puntos_control` (`POINT` + radio_tolerancia + orden + obligatorio); `rotaciones` → `asignaciones` (vehículo+conductor+ruta+horario+fecha, vencen por jornada — RF-57); `sesiones_operativas` → `gps_points` (particionada, `event_id` UUID único cliente) + `eventos_recorrido`; `reglas`/`sanciones` (con evidencia); `audit_log`. Todas con `sindicato_id` + RLS.

## Fases de construcción

1. **Fase 0 — Fundaciones + spike GPS (semana 1):** monorepo, CI, Postgres+PostGIS, auth+RLS, esqueleto NestJS. En paralelo: spike Transistorsoft en Android real (gate go/no-go del stack móvil).
2. **Fase 1 — Núcleo administrativo:** CRUD sindicatos/socios/vehículos/conductores/líneas/rutas/variantes/paradas/puntos de control (web admin). RF-01–39.
3. **Fase 2 — Rotaciones:** generación/edición/publicación; API que consume la app. RF-51–57.
4. **Fase 3 — App móvil + offline + sync:** login operativo, descarga de asignación, tracking, detección de puntos de control (geofence local), outbox, sync idempotente por lotes. RF-58–73.
5. **Fase 4 — Dashboard + auditoría + reportes:** cumplimiento por línea/vehículo/ruta, historial, audit log. RF-74–84.
6. **Fase 5 — Hardening:** load test de ingesta (simular flota sincronizando a la vez), índices, RLS audit, `/security-review`.

Cada fase cierra con commit → push → PR → CI → merge + actualización de `docs/handoff.md` (flujo del usuario).

## Verificación

- Spike GPS: 8h tracking en Android gama baja, <5% batería/día, sin huecos >2min.
- Sync idempotente: test que reenvía el mismo batch 3 veces → cero duplicados en DB.
- RLS: test automatizado de que usuario de sindicato A no lee filas de sindicato B.
- Load test (k6): ráfaga de N dispositivos sincronizando batches simultáneos → cola drena sin pérdida.
- Criterios de aceptación §8 del documento de Producto como checklist E2E final.

## Pendientes al ejecutar

- Guardar `synthesis.json` de la sesión council + regenerar viewer (`~/.council/Documents/council-20260719-083140/`).
- Persistir este plan en `docs/plan-stack-quivo.md` del repo nuevo al crearlo (regla 8 del flujo).
- ~~Preguntas abiertas para Producto~~ **Respondidas (2026-07-19)** — ver `docs/documento-tecnico-cto.md` §15: solo Android; 2 sindicatos / 2000–3000 vehículos año 1; login por vehículo; GPS crudo 6 meses caliente + archivo S3/R2; evidencia de sanciones = solo datos de recorrido (fotos post-MVP). Frecuencia GPS confirmada: 10 s / 50 m en movimiento, adaptativo.
