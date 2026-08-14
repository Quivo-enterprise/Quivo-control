# QUIVO Control — Documento Técnico (CTO)

**Documento:** Respuesta técnica al documento de requerimientos de Producto (`QUIVOcontrol.md`)
**Área emisora:** Tecnología / CTO
**Estado:** Aprobado como base de construcción (plan maestro: `docs/plan-maestro.md`)
**Fecha:** 2026-07-19
**Método de decisión:** Deliberación multi-agente (council `council-20260719-083140`) + investigación verificada. Criterios: velocidad de desarrollo del MVP y escalabilidad a muchos usuarios simultáneos.

---

## 1. Stack tecnológico recomendado

**Decisión: TypeScript punta a punta, monolito modular, PostgreSQL como única base de datos.**

| Capa                | Tecnología                                                                     | Justificación                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lenguaje            | TypeScript en backend, web y móvil                                             | Un solo lenguaje para equipo pequeño = máxima velocidad de MVP. Tipos y validadores compartidos eliminan bugs de contrato API.                                                            |
| Backend             | NestJS con adapter Fastify                                                     | Estructura modular por dominio (RNF-28/29/30), inyección de dependencias, throughput HTTP alto con Fastify.                                                                               |
| ORM                 | Prisma (CRUD) + SQL crudo (ingesta GPS)                                        | Prisma acelera el 90% del MVP que es CRUD; la ruta caliente de ingesta usa multi-row insert / `COPY` sin pasar por ORM.                                                                   |
| Base de datos       | PostgreSQL 16+ con PostGIS                                                     | Relacional + geoespacial + series de tiempo en un solo motor operable por un equipo pequeño.                                                                                              |
| Cola de trabajos    | Redis + BullMQ                                                                 | Absorbe ráfagas de sincronización; desacopla recepción de eventos de su procesamiento.                                                                                                    |
| Auth                | Better-Auth + JWT + RLS de Postgres                                            | No construir auth a mano. Doble barrera de tenant (claims + RLS).                                                                                                                         |
| Web admin           | Next.js (App Router) + Tailwind + TanStack Query                               | Dashboard interno; ecosistema React del equipo; CI/deploy en Vercel ya integrado al flujo.                                                                                                |
| App móvil           | Expo (React Native) + EAS Build                                                | Tooling EAS operativo en el equipo; dev-builds soportan módulos nativos.                                                                                                                  |
| GPS background      | `react-native-background-geolocation` (Transistorsoft, licencia única ~US$400) | Estándar de facto en fleet tracking; nativo Swift/Kotlin; maneja Doze/App Standby; Expo config plugin. La alternativa gratuita (`expo-location`) es insuficiente en Android de gama baja. |
| Storage local móvil | expo-sqlite (patrón outbox)                                                    | Asignación diaria + rutas + puntos de control descargados; cola de eventos pendientes de sync.                                                                                            |
| Mapas               | MapLibre GL + tiles OSM                                                        | Costo cero en MVP; API compatible con Mapbox si se necesita upgrade.                                                                                                                      |
| Infra inicial       | Railway o Fly.io (API + worker + Redis) + Postgres gestionado                  | Deploy en minutos, bajo costo, camino de escalado claro.                                                                                                                                  |
| Monorepo            | pnpm workspaces + Turborepo                                                    | Paquete `shared` con schemas Zod = contrato único entre las tres apps.                                                                                                                    |

**Alternativas evaluadas y descartadas (council):**

- **Go en backend** (propuesta Gemini): mayor throughput por core, pero el cuello de botella real es la base de datos, no el runtime — el batching + cola lo neutraliza. Costo: segundo lenguaje para el equipo. Descartado por criterio de velocidad.
- **Flutter en móvil**: depende del mismo SDK nativo de Transistorsoft; no aporta ventaja que justifique aprender Dart.
- **Microservicios día 1**: rechazado por unanimidad — destruye velocidad de MVP en equipo pequeño.
- **TimescaleDB día 1**: verificado que NO está disponible en RDS/Aurora/Neon gestionados. Se usa particionado nativo de Postgres (portable); Timescale/Tiger Cloud queda como palanca de escala posterior.

---

## 2. Arquitectura general

**Monolito modular** con un worker separado por proceso (mismo código, entrypoint distinto):

```
┌─────────────┐   ┌─────────────┐
│  Web Admin  │   │  App Móvil  │
│  (Next.js)  │   │   (Expo)    │
└──────┬──────┘   └──────┬──────┘
       │ HTTPS/JSON      │ HTTPS/JSON (batch sync)
       ▼                 ▼
┌───────────────────────────────────┐
│         API (NestJS/Fastify)      │
│  auth │ sindicatos │ socios │ ... │
│  tracking (recibe batch, encola)  │
└──────────────┬────────────────────┘
     ▲         │ jobs
     │         ▼
┌────┴─────┐ ┌──────────────┐ ┌──────────────────┐
│ Postgres │ │ Redis/BullMQ │ │ Worker (ingesta)  │
│ +PostGIS │ │              │ │ inserta GPS por   │
│ +RLS     │◄┴──────────────┴─│ lote, valida PC   │
└──────────┘                  └──────────────────┘
```

Principios:

- Cada módulo de dominio es autocontenido (controller + service + repository); comunicación entre módulos solo por interfaces públicas. Esto hace que extraer un módulo como servicio sea cirugía menor, no reescritura.
- El endpoint de sync **no procesa**: valida, encola y responde. El worker procesa. Así el pico de "toda la flota sincroniza a la vez" no tumba la API.
- La validación de puntos de control corre en dos lugares: en el móvil (feedback inmediato al conductor, offline) y en el worker (fuente de verdad auditada, RF-39).

---

## 3. Estructura de repositorio

```
quivo-control/                  monorepo (pnpm + turborepo)
├── apps/
│   ├── api/                    NestJS
│   │   └── src/modules/
│   │       ├── auth/           login, JWT, roles, guards
│   │       ├── sindicatos/     RF-01..04
│   │       ├── socios/         RF-05..09
│   │       ├── vehiculos/      RF-10..14
│   │       ├── conductores/    RF-15..19
│   │       ├── lineas/         RF-20..23
│   │       ├── rutas/          rutas, variantes, paradas (RF-24..33)
│   │       ├── control-points/ RF-34..39
│   │       ├── reglas/         estatutos, reglas, sanciones (RF-40..50)
│   │       ├── rotaciones/     RF-51..57
│   │       ├── tracking/       sesiones, ingesta GPS, eventos (RF-58..66)
│   │       ├── sync/           batch endpoint, idempotencia (RF-67..73)
│   │       ├── reportes/       dashboard, reportes (RF-74..80)
│   │       └── auditoria/      RF-81..84
│   ├── web/                    Next.js admin
│   └── mobile/                 Expo app conductor
├── packages/
│   ├── shared/                 Zod schemas, tipos, enums, constantes
│   └── db/                     Prisma schema, migraciones, seeds, políticas RLS
└── docs/                       plan-maestro.md, este documento, handoff.md, ADRs
```

---

## 4. Modelo de base de datos

### 4.1 Decisión multi-tenant

**Base compartida con `sindicato_id` en cada tabla + Row-Level Security.** Un sindicato jamás ve datos de otro (RNF-16) mediante dos barreras: el claim `sindicato_id` del JWT define el contexto (`SET app.sindicato_id`), y las políticas RLS lo hacen imposible de saltar aunque una query olvide el filtro. Schema-per-tenant queda descartado salvo requisito legal futuro de aislamiento físico.

### 4.2 Entidades principales

```
sindicatos(id, nombre, estado, ...)
usuarios(id, sindicato_id?, rol, email, ...)          -- admin QUIVO: sindicato_id NULL
socios(id, sindicato_id, datos, estado)
vehiculos(id, sindicato_id, socio_id, placa, tipo, marca, modelo, color,
          capacidad, estado)                           -- estado: activo/inactivo/suspendido/mantenimiento
conductores(id, sindicato_id, datos, estado)
lineas(id, sindicato_id, codigo, nombre, color, descripcion)
rutas(id, linea_id, sentido, geometria GEOGRAPHY(LINESTRING), estado)
variantes(id, ruta_id, ...)
paradas(id, ruta_id, tipo, orden, coord GEOGRAPHY(POINT))
puntos_control(id, ruta_id, orden, coord GEOGRAPHY(POINT),
               radio_tolerancia_m, obligatorio BOOL)
estatutos / reglas(id, sindicato_id, tipo, gravedad, aplica_a, relacion)
sanciones(id, sindicato_id, regla_id, sujeto(vehiculo|conductor|socio),
          estado, evidencia_ref)                       -- estado: pendiente/aplicada/anulada/apelada/pagada
rotaciones(id, sindicato_id, periodo, estado)          -- borrador/publicada
asignaciones(id, rotacion_id, vehiculo_id, conductor_id?, ruta_id,
             fecha, horario, orden, vence_at)          -- RF-57: vence al fin de jornada
sesiones_operativas(id, asignacion_id, vehiculo_id, conductor_id,
                    device_id, inicio, fin, estado)
gps_points(event_id UUID PK, sesion_id, ts, coord, speed, accuracy,
           battery, synced_at)                         -- PARTICIONADA por rango de ts (pg_partman)
eventos_recorrido(event_id UUID PK, sesion_id, tipo, ts, payload JSONB)
cumplimientos_pc(sesion_id, punto_control_id, ts, distancia_m, cumplido,
                 validado_por(app|worker))
audit_log(id, sindicato_id, usuario_id, entidad, entidad_id, accion,
          diff JSONB, ts)
```

Índices clave: `gps_points(sesion_id, ts)`, GiST sobre columnas `GEOGRAPHY`, `asignaciones(sindicato_id, fecha)`, `audit_log(sindicato_id, ts)`.

### 4.3 Series de tiempo GPS

`gps_points` particionada por día con `pg_partman`; retención (decisión §15.4): **6 meses caliente**, luego archivo a object storage (S3/R2) — nunca se borra evidencia. Palanca de escala futura: migrar la tabla a TimescaleDB (Tiger Cloud o self-hosted) sin tocar el código de aplicación — misma SQL.

---

## 5. Autenticación, roles y permisos

- **Better-Auth** sobre Postgres: email+password para roles administrativos; para conductores, **login por vehículo** (decisión de Producto, §15.3): credencial de vehículo emitida por el sindicato; el conductor se identifica al iniciar la sesión operativa.
- JWT con claims: `user_id`, `sindicato_id`, `rol`. Access token corto + refresh token; en móvil, sesión larga renovable offline (el token puede expirar durante un recorrido sin cortar el tracking — el sync reautentica al volver la conexión).
- Roles (RNF-15/17): `admin_quivo`, `admin_sindicato`, `operador`, `supervisor`, `socio`, `conductor`. Guards de NestJS por módulo/acción + RLS como barrera final.
- Cambios críticos siempre auditados (ver §9).

---

## 6. Estrategia offline de la app móvil

1. **Descarga previa (RF-68):** al iniciar jornada con conexión, la app baja el "paquete del día": asignación vigente, ruta (geometría), paradas y puntos de control. Se guarda en SQLite con `vence_at`; si la asignación venció, la app lo advierte (RF-73).
2. **Operación sin red (RF-67):** iniciar recorrido, tracking GPS, detección local de puntos de control (distancia haversine contra radio de tolerancia) y registro de eventos funcionan 100% contra SQLite. Cero dependencia de red durante el recorrido.
3. **Outbox:** todo evento (punto GPS, inicio/fin de recorrido, cumplimiento de PC, observación) nace con **UUIDv7 generado en el dispositivo** + `device_id` + `ts` y se escribe primero en la tabla outbox local. Nada se envía sin estar persistido localmente (RNF-09: pérdida de internet ≠ pérdida de evidencia).

**GPS y batería (preguntas 11–12 de Producto):**

- Frecuencia MVP: **punto cada 10 s o cada 50 m en movimiento**, con detección de movimiento del SDK (en parada prolongada no se registra — ahorro de batería). Objetivo: <5% de batería por jornada.
- Transistorsoft usa motion-detection nativa y buffering; la app escribe en SQLite por lotes, no punto a punto.

---

## 7. Estrategia de sincronización (sin duplicados)

- **Envío por lotes:** al detectar conexión, la app envía `POST /sync/batches` con hasta ~500 eventos por request (gzip). Reintento con backoff exponencial ante fallo (RNF-36).
- **Idempotencia (respuesta a pregunta 10):** el `event_id` UUIDv7 nace en el cliente. El worker inserta con `INSERT ... ON CONFLICT (event_id) DO NOTHING`. Reenviar el mismo lote N veces produce exactamente los mismos datos — cero duplicados (RF-72, RNF-33/34) sin lógica de deduplicación exótica. UUIDv7 además ordena temporalmente (índices eficientes).
- **Flujo:** API valida el lote (schema Zod compartido, auth, tenant) → encola en BullMQ → responde `202` con acuse por `event_id` → worker inserta por lote y ejecuta validación de puntos de control server-side. La app marca como sincronizado solo lo acusado; lo demás reintenta.
- **Conflictos (RNF-37):** nunca se borra evidencia; discrepancias (p. ej. cumplimiento validado en app pero no en server) se marcan como observación para revisión del supervisor.
- **Errores de sync (RNF-35):** lotes rechazados quedan registrados con motivo en tabla `sync_errors` y visibles en el admin.

---

## 8. API inicial (propuesta)

REST JSON, versionada (`/v1`), contrato en `packages/shared` (Zod → OpenAPI generado):

```
POST /v1/auth/login | /refresh
CRUD /v1/sindicatos | /socios | /vehiculos | /conductores
CRUD /v1/lineas | /lineas/:id/rutas | /rutas/:id/variantes | /paradas | /puntos-control
CRUD /v1/reglas | /sanciones (+ transiciones de estado)
POST /v1/rotaciones           GET /v1/rotaciones/:id
POST /v1/rotaciones/:id/publicar
GET  /v1/mobile/asignacion-del-dia          -- paquete offline completo
POST /v1/mobile/sesiones (iniciar/finalizar recorrido)
POST /v1/sync/batches                       -- ingesta idempotente
GET  /v1/reportes/cumplimiento?por=linea|vehiculo|ruta
GET  /v1/reportes/recorridos | /recorridos/:id (reconstrucción, RNF-24)
GET  /v1/auditoria
```

---

## 9. Estrategia de auditoría, logs y errores

- **Auditoría (RF-81..84):** interceptor de NestJS sobre acciones críticas (crear/editar/autorizar/publicar/anular/aplicar) escribe en `audit_log`: usuario, fecha, entidad, diff JSONB. Consultable desde el admin.
- **Logs:** pino (JSON estructurado) con `request_id` y `sindicato_id` en cada línea; agregación en el proveedor de infra (o Axiom/Betterstack).
- **Errores:** Sentry en las tres apps (API, web, móvil) — imprescindible en móvil, donde no hay consola del dispositivo del chofer.
- **Métricas mínimas:** profundidad de cola BullMQ, latencia de inserts, lag de sync por dispositivo.

---

## 10. Despliegue e infraestructura

**Inicial (MVP):** Railway o Fly.io — 3 procesos (API, worker, Redis) + Postgres gestionado con PostGIS. Vercel para el web admin. EAS para builds/distribución de la app (Android primero). Costo estimado: US$50–150/mes.

**Camino de escalado (en orden, sin reescritura):**

1. Réplicas de lectura de Postgres para dashboard/reportes.
2. Escalar workers de ingesta horizontalmente (ya separados por proceso).
3. Particionado agresivo + compresión del histórico GPS (o migración a TimescaleDB/Tiger Cloud).
4. Extraer `tracking/sync` como servicio propio solo si los números lo exigen.

---

## 11. Orden de construcción (pregunta 16)

| Fase | Contenido                                                                                           | RF cubiertos      |
| ---- | --------------------------------------------------------------------------------------------------- | ----------------- |
| 0    | Monorepo, CI, Postgres+PostGIS, auth+RLS, esqueleto API. **En paralelo: spike GPS** (gate go/no-go) | —                 |
| 1    | Núcleo administrativo (CRUD completo en web admin)                                                  | RF-01..39         |
| 2    | Rotaciones: generar, editar, publicar, consumir                                                     | RF-51..57         |
| 3    | App móvil: login operativo, paquete offline, tracking, PC, outbox, sync                             | RF-58..73         |
| 4    | Dashboard, reportes, auditoría visible, reglas/sanciones                                            | RF-40..50, 74..84 |
| 5    | Hardening: load test de ingesta (k6), auditoría RLS, security review                                | RNF               |

Cada fase cierra con PR + CI + merge + actualización de `docs/handoff.md`.

---

## 12. Riesgos técnicos y mitigaciones (pregunta 17)

| Riesgo                                                                           | Impacto                              | Mitigación                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GPS background muere en Android gama baja (Doze, battery killers de fabricantes) | Mata el corazón del producto         | **Spike semana 1** con Transistorsoft en dispositivo barato real: 8h tracking, medir batería y huecos. Plan B: módulo nativo Kotlin (Foreground Service) dentro de la app Expo |
| Fuga de datos entre sindicatos (bug de query)                                    | Crítico de confianza                 | RLS activo en todas las tablas + test automatizado cross-tenant en CI + security review antes de cada release                                                                  |
| Saturación de escritura en Postgres con la flota creciendo                       | Degradación de ingesta               | Batching + cola desde día 1; particionado; palancas de §10 en orden                                                                                                            |
| Doble asignación / rotación inconsistente                                        | Conflicto operativo real en la calle | Constraints únicos por (vehículo, fecha, horario); publicación atómica de rotación                                                                                             |
| Reloj del dispositivo mal configurado                                            | Eventos con timestamps falsos        | Registrar `ts` de dispositivo + `received_at` de servidor; detectar drift y marcarlo como observación                                                                          |
| Adopción por usuarios no técnicos (RNF-01..05)                                   | Producto correcto pero no usado      | Flujo móvil de máximo 2 taps para iniciar recorrido; pilotos con un sindicato real desde Fase 3                                                                                |

---

## 13. Recursos y tiempos (pregunta 18)

**Equipo mínimo:** 2–3 desarrolladores full-stack TS (uno con foco móvil) + Producto para validación con sindicato piloto.

**Estimación MVP (criterios de aceptación §8 del doc de Producto):**

| Fase                       | Duración estimada               |
| -------------------------- | ------------------------------- |
| 0 — Fundaciones + spike    | 1–2 semanas                     |
| 1 — Núcleo administrativo  | 3–4 semanas                     |
| 2 — Rotaciones             | 2 semanas                       |
| 3 — Móvil + offline + sync | 4–5 semanas                     |
| 4 — Dashboard + auditoría  | 2–3 semanas                     |
| 5 — Hardening + piloto     | 2 semanas                       |
| **Total**                  | **~14–18 semanas** con 2–3 devs |

Costos no-personal: licencia Transistorsoft ~US$400 única, infra US$50–150/mes, cuentas de tiendas (Google Play US$25).

---

## 14. Respuestas rápidas a las 18 preguntas de Producto (§9)

1. **Stack:** ver §1. 2. **Monolito modular** (§2). 3. **Monorepo pnpm/Turborepo** (§3). 4. **Arquitectura:** §2. 5. **DB:** §4. 6. **Sí — base compartida con `sindicato_id` + RLS** (§4.1). 7. **Better-Auth + JWT + roles + RLS** (§5). 8. **Offline:** paquete del día + outbox (§6). 9. **Base local: SQLite (expo-sqlite)** (§6). 10. **UUIDv7 cliente + `ON CONFLICT DO NOTHING`** (§7). 11. **GPS: 10 s / 50 m en movimiento, adaptativo** (§6). 12. **Batería: motion-detection + lotes; objetivo <5%/jornada** (§6). 13. **Mapas: MapLibre + OSM** (§1). 14. **Despliegue: Railway/Fly.io + Vercel + EAS** (§10). 15. **Logs/errores/auditoría:** §9. 16. **Orden de módulos:** §11. 17. **Riesgos:** §12. 18. **Recursos/tiempos:** §13.

---

## 15. Preguntas de Producto — respondidas (2026-07-19)

Respondidas por el CPO; #4 y #5 decididas por Tecnología con su aval.

1. **Plataforma: solo Android en MVP.** iOS queda post-MVP. Simplifica Fase 3: sin builds/distribución iOS, spike GPS solo sobre Android.
2. **Volumen año 1: 2 sindicatos, 2000–3000 vehículos en total.** Implica ~8–9M puntos GPS/día (~300 pts/s pico sostenido, ~1 GB/día) — dentro del diseño aprobado (batching + BullMQ + particiones); sin cambios de stack.
3. **Credencial: login por vehículo** (el chofer rota entre vehículos). Credencial de vehículo emitida por el sindicato; el conductor se identifica al iniciar la sesión operativa (`sesiones_operativas` vincula `vehiculo_id` + `conductor_id` + `device_id`).
4. **Retención GPS crudo: 6 meses caliente** en Postgres (particiones diarias, pg_partman) — cubre apelaciones de sanciones. Luego archivo a object storage (S3/R2); **nunca se borra evidencia** (RNF-37). Derivados (recorridos, cumplimientos): permanentes.
5. **Evidencia de sanciones en MVP: solo datos de recorrido auto-vinculados** (GPS, `cumplimientos_pc`, desvíos de ruta). Fotos desde la app = post-MVP (evita storage de archivos + upload offline + UI extra).
