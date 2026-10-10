# SRS — Especificación de requisitos de software de QUIVO Control

> **Versión 0.1 (borrador reconstruido), 2026-10-10.** Formato: ISO/IEC/IEEE 29148, versión liviana.
>
> **Cómo se armó:** el documento original de requisitos (`QUIVOcontrol.md`, RF-01..84 + RNF, y la especificación `QV-ESP-ESP-CTL-2026-001`) no está en el repo ni en el equipo. Por decisión del CTO (2026-10-10), este SRS se **reconstruye desde el código de `main@64125f7`** y desde las decisiones que hay en `docs/`. Por eso:
> - Describe lo que el sistema **hace hoy** y marca lo que falta respecto de lo que se esperaba.
> - Todo lo que no tiene fuente escrita está marcado `inferido-validar`. **No es requisito aprobado hasta que el CTO lo valide** (ver §7).
> - Si aparece el original, se reconcilia contra él y se sube la versión.
>
> Plan que lo origina: [`../plan-saneamiento.md`](../plan-saneamiento.md), Fase 1.

## 1. Propósito y alcance

QUIVO Control es una plataforma para que los **sindicatos de transporte público de Bolivia** controlen que sus vehículos cumplan las rutas asignadas, con **evidencia GPS** de cada recorrido.

| Componente | Qué es | Usuarios |
|---|---|---|
| App del conductor (`apps/mobile`, Android, Expo/RN) | Login de vehículo y conductor, asignación del día, recorrido con captura GPS en segundo plano, detección de puntos de control, operación offline | Conductor |
| Panel administrativo (`apps/web`, Next.js) | Catálogo (sindicatos, socios, vehículos, conductores, líneas, rutas, puntos de control), rotaciones, reglas y sanciones, reportes, mapa `/en-vivo`, auditoría | Admin Quivo, admin de sindicato |
| API + worker (`apps/api`, NestJS + BullMQ) | REST `/v1`, sync de eventos, ingesta y validación de cumplimiento con PostGIS, retención GPS | Todos (vía apps) |
| API pública de movilidad (`/v1/public/mobility`) | Lectura de líneas publicadas para pasajeros | Pasajero (app futura) |
| Landing (`apps/landing`) | Sitio comercial y solicitud de demo | Público |

**Fuera de alcance hoy:** iOS, app de pasajero, fotos como evidencia, sanciones automáticas (ver §4, RF-49/50), Google Play (distribución por APK sideload).

## 2. Stakeholders y personas

| Rol (`packages/shared/src/enums/roles.ts`) | Descripción | Estado en el código |
|---|---|---|
| `admin_quivo` | Operador de la plataforma; ve todos los sindicatos | Activo |
| `admin_sindicato` | Administra un sindicato (tenant) | Activo |
| `operador` | Carga de catálogo | Permisos en la API, **sin módulos en el panel** (§7, P-ROL) |
| `supervisor`, `socio` | Lectura y control de flota propia | **En el enum, sin permisos en ningún endpoint** |
| `conductor` | Usa la app móvil (auth propia, no Better-Auth) | Activo en el móvil |
| `pasajero` | Consumidor de la API pública | Sin app |

Otros stakeholders:
- CTO: decide producto y arquitectura.
- Sindicatos piloto: líneas Z12 y 120.
- Acompañantes del piloto: verdad de campo (`docs/piloto/`).

## 3. Restricciones y supuestos

- **Plataforma móvil:** solo Android. Captura GPS con `react-native-background-geolocation` (Transistorsoft), cuya licencia hay que comprar antes del 2026-10-25.
- **Infraestructura:** GCP `southamerica-west1` ([ADR 0002](../adr/0002-gcp.md)): Cloud Run para api, web, worker y job de migraciones; Cloud SQL Postgres 16 + PostGIS con IP privada; Memorystore Redis; Secret Manager.
- **Multi-tenant:** una sola base con `sindicatoId` y RLS de Postgres. El rol de runtime es `quivo_app`, sin BYPASSRLS.
- **Hora oficial:** la jornada es el día calendario de Bolivia (UTC-4, sin horario de verano).
- **Conectividad:** la app tiene que funcionar sin red durante el recorrido (offline-first).
- **Mapas:**
  - El panel usa Leaflet/MapLibre sobre OSM.
  - La app usa Leaflet en un WebView. Google nativo se está evaluando en el spike S2.
  - El ruteo por calles (OSRM) **no está desplegado en prod** (verificado el 2026-10-10: no hay `OSRM_URL` en `quivo-api`), así que la ruta a un punto se dibuja como línea recta.

## 4. Requisitos funcionales

Detalle por dominio. Cada requisito lleva `ID | enunciado | fuente | estado | código | test`.

| § | Dominio | Rango RF original | Archivo |
|---|---|---|---|
| 1 | Autenticación web y móvil, roles, multi-tenant (RLS), auditoría | RF-81..84, RNF-15/16/17 | [01-auth-tenant-auditoria.md](01-auth-tenant-auditoria.md) |
| 2 | Catálogo: sindicatos, socios, vehículos, conductores, líneas, rutas, variantes, paradas, puntos de control, movilidad pública | RF-01..39 | [02-catalogo.md](02-catalogo.md) |
| 3 | Rotaciones y asignaciones, reglas y sanciones, reportes, `/en-vivo`, exportes | RF-40..57, RF-74..80 | [03-rotaciones-reglas-reportes.md](03-rotaciones-reglas-reportes.md) |
| 4 | Operación del conductor: paquete del día, recorrido, captura GPS, detección de PC, outbox, sync, ingesta, retención | RF-58..73, RNF-09, RNF-33..37 | [04-operacion-gps-sync.md](04-operacion-gps-sync.md) |

**Numeración:** `docs/documento-tecnico-cto.md` §3 solo conserva los **rangos** de RF por módulo, no el enunciado de cada número. Donde el código cita un número (p. ej. RF-39, RF-57, RF-72, RNF-35), se conserva. El resto usa IDs provisionales por dominio: `RF-AUTH-*`, `RF-CAT-*`, `RF-OPS-*`, `RF-GPS-*`. Su mapeo al número original queda pendiente (§7).

**Modelo de datos:** [`../datos/modelo.md`](../datos/modelo.md) (ERD, diccionario de los 29 modelos, RLS, particiones, migraciones).

## 5. Requisitos no funcionales (resumen)

El detalle está en cada dominio. Esta tabla junta los que gobiernan el diseño.

| ID | Requisito | Valor | Fuente | ¿Medido? |
|---|---|---|---|---|
| RNF-16 | Aislamiento entre sindicatos | 0 filas cross-tenant | `documento-tecnico-cto.md` §4.1; checklist del piloto A3 | Parcial: hay test RLS, pero 5 tablas no tienen RLS (§6) |
| RNF-09 | Ningún evento se envía sin estar persistido localmente; idempotencia por `eventId` UUIDv7 | 0 perdidos, 0 duplicados | §6–7 del doc técnico | Por tests; en campo, no |
| RNF-SYNC | Latencia de sync tras recuperar red | p95 ≤5 min (aceptación), objetivo ≤1 min | `piloto/checklist-aceptacion-e2e.md` | Medido p95 de 684–814 s, antes del rediseño del drenado |
| RNF-PANEL | Estado del recorrido visible en el panel | "Finalizado" ≤30 s (criterio de prueba) | `plan-ubicacion-fluida.md` | No. Depende del sync |
| RNF-BAT | Consumo de batería | **3 definiciones en conflicto** (§7) | doc técnico, código, checklist | No |
| RNF-GPS | Huecos de GPS durante el recorrido | Ninguno >2 min | checklist | No, con la app propia |
| RNF-ESC | Escala objetivo | 2 sindicatos, 2000–3000 vehículos, ~300 pts/s pico | doc técnico §15.2 | Experimento de carga local; el k6 de gate nunca corrió |
| RNF-RET | Retención GPS | 6 meses caliente, luego archivo | doc técnico §4.3; `runbooks/retencion-gps.md` | Archivado **deshabilitado** (`GPS_ARCHIVE_ENABLED=false`, sin bucket) |
| RNF-37 | La evidencia nunca se borra | — | doc técnico | Parcial: el veredicto de la app no se guarda |
| RNF-COST | Costo mensual de infraestructura | Piloto US$255–290; 2000 conductores US$703–1270 | ADR 0002; `costos-gcp-2000.md` | Estimado |
| RNF-UX | Iniciar recorrido en ≤2 taps; WCAG AA; doble codificación color + icono | — | doc técnico §12; `categorizacion-colores-y-estados.md` | Auditoría parcial (QUI-339) |

## 6. Hallazgos de la reconstrucción (resumen priorizado)

Son brechas entre lo esperado y lo que hace el código. Todas se detectaron leyendo código y las de prioridad alta se verificaron a mano. Pasan al backlog de [`plan-saneamiento.md`](../plan-saneamiento.md).

**Seguridad y aislamiento**
1. Alta y edición manual de asignaciones (`apps/api/src/modules/rotaciones/rotaciones.service.ts:219-258`) no validan que `vehiculoId`, `conductorId` y `rutaId` sean del sindicato del actor. Las FK de Postgres no aplican RLS. Verificado en código; falta un test que lo reproduzca.
2. `rutas`, `variantes`, `paradas`, `puntos_control` y `asignaciones` no tienen `sindicatoId` ni RLS. El aislamiento depende de `asegurarLineaVisible` y `asegurarRutaVisible` en cada método.
3. `audit_log` es mutable (`quivo_app` tiene UPDATE y DELETE). No se auditan login, fallos, lockouts ni revocaciones. La auditoría no es atómica con la acción.
4. La sesión móvil sobrevive a la desactivación del vehículo o del conductor y al vencimiento de la asignación.
5. Exportes CSV sin neutralizar fórmulas (`apps/api/src/modules/reportes/csv.util.ts:5-10`). `POST /_internal/validate-demo` está abierto sin auth.

**Integridad de la evidencia**
6. El 202 de sync significa "encolado en Redis", no "persistido". El job BullMQ no tiene reintentos y Redis está en `volatile-lru`. Una fila GPS mala manda el lote entero a `sync_errors`, que no tiene reproceso.
7. Un evento que no pasa Zod devuelve 400 para el lote entero. El cliente lo reintenta para siempre y bloquea los eventos más nuevos.
8. El veredicto y las distancias de la app no se persisten junto al del worker, así que no se puede auditar la discrepancia (RNF-37).

**Funcionales**
9. "Anular" una rotación la devuelve a borrador, pero el paquete del día no mira el estado: el móvil sigue recibiendo la asignación.
10. "Recorridos completados" cuenta logouts, no "Finalizar". El gráfico "Tendencia 7 días" del inicio tiene datos sintéticos (`apps/web/app/(dashboard)/page.tsx:157`).
11. La regla del vehículo "fantasma" (>45 min sin fix) está decidida pero no implementada.
12. Los ids de ciudad no coinciden: `la-paz`/`el-alto` en shared y `la-paz-el-alto` en la base. Ninguna línea puede quedar en La Paz desde el panel.
13. `sindicato.estado = inactivo` no tiene efecto. Un sindicato inactivo sigue publicado en la API pública.
14. Los logos de línea se guardan en el disco local de Cloud Run, que es efímero.
15. OSRM no está desplegado en prod, así que la ruta a un punto se dibuja como línea recta.

## 7. A validar por el CTO (decisiones abiertas)

Cada dominio lista unas 15 preguntas (§6 de cada archivo). Estas son las que bloquean el diseño:

| # | Decisión | Opciones | Dominio |
|---|---|---|---|
| P-NUM | Numeración RF-01..84 | Mapear los IDs provisionales a números por orden natural, o mantener los provisionales | Todos |
| P-ROL | Alcance de `operador`, `supervisor` y `socio` en el piloto | Definir permisos, o quitarlos del enum y la API | §1, §2, §3 |
| P-AUTH | Login legado de 2 pasos (PIN del vehículo) | Eliminarlo del modelo, la UI y la API (en prod ya está apagado) | §1 |
| P-RLS | Tablas sin RLS | Agregar RLS con subquery a `lineas`/`rotaciones`, o desnormalizar `sindicatoId` | §1, §2 |
| P-AUD | Auditoría | Agregar eventos de seguridad, inmutabilidad (REVOKE + trigger) y diff antes/después | §1 |
| P-ACK | Semántica del acuse de sync | Aceptar "encolado", o exigir reintentos BullMQ + `noeviction` + reproceso de `sync_errors` | §4 |
| P-BAT | Umbral único de batería | <5 %/jornada, <5 %/8 h, ≤10 %/h u objetivo ≤5 %/h | §4 |
| P-RADIO | Radio por defecto del punto de control | 150 m (prod) vs 100 m (seed) vs 30 m (panel), con mín/máx | §2, §4 |
| P-ANULAR | "Anular" rotación | Estado terminal `anulada` y qué pasa con las sesiones abiertas | §3 |
| P-COMPLETADO | Definición de recorrido completado | "Finalizar" tocado, ≥N % de PC, o logout | §3 |
| P-CIUDAD | Id canónico de ciudad y selector en el panel | `la-paz-el-alto` vs `la-paz`/`el-alto` | §2 |
| P-SESION | Vida de la sesión móvil | Morir al desactivar o vencer; TTL de 30 días absoluto o deslizante | §1 |

## 8. Trazabilidad y mantenimiento

- Cada PR que cambie comportamiento actualiza la fila correspondiente: estado, código y test.
- Un requisito nuevo entra con ID provisional del dominio y fuente (decisión del CTO, ADR o issue).
- La matriz requisito→test vive en las columnas *Test* de cada dominio. Las filas con "—" son el backlog de pruebas ([`../calidad/linea-base.md`](../calidad/linea-base.md)).
