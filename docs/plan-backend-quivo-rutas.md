# Plan de mejora del backend para QUIVO Rutas

Fecha: 2026-08-18  
Alcance: `apps/api`, `packages/shared`, `packages/db` y el worker de QUIVO Control.

## Objetivo

Convertir QUIVO Control en una frontera backend estable para dos audiencias distintas:

1. administración y operación interna de sindicatos;
2. experiencia pública de pasajeros en QUIVO Rutas.

La identidad será centralizada en Better Auth, pero los permisos y datos de pasajero
quedarán separados de los roles administrativos y de las tablas operativas.

## Estado actual y brechas

- Better Auth ya resuelve `login`, `refresh` y `logout` para usuarios administrativos.
- Los roles actuales son `admin_quivo`, `admin_sindicato`, `operador`, `supervisor`,
  `socio` y `conductor`; no existe un rol pasajero.
- `/v1/public/mobility` ya expone líneas, rutas, paradas, QR y planner, pero no tiene
  paginación completa, proximidad, preferencias del pasajero ni una política específica
  de abuso por endpoint.
- No existen registro de pasajeros, perfil, favoritos, lugares guardados, dispositivos,
  notificaciones, suscripciones ni entitlements.
- El worker BullMQ existe para ingesta GPS; se reutilizará para entregas de notificaciones.
- Hay dos inconsistencias de configuración que deben cerrarse antes de producción: el
  puerto por defecto de la API y el puerto Redis usado por el health check.

## Decisiones de arquitectura

### Identidad

- Añadir `pasajero` al contrato compartido de roles.
- Mantener Better Auth como única fuente de identidad; no crear otro sistema de usuarios.
- Separar los endpoints administrativos de los endpoints de pasajero:
  `/v1/auth/*` para sesión común y `/v1/passenger/*` para recursos de usuario.
- El registro público siempre fuerza `rol = pasajero`; nunca acepta un rol enviado por el
  cliente.
- Los datos de experiencia (favoritos, alertas, planes, dispositivos) son dominio de
  QUIVO Rutas y no se mezclan con sindicatos, vehículos ni sesiones operativas.

### Seguridad de sesión

- Access token corto y refresh token revocable, con rotación y detección de reutilización.
- Web: preferir cookie `HttpOnly`, `Secure`, `SameSite` en vez de guardar refresh tokens
  en `localStorage`.
- Móvil: Secure Store y deep links; ningún secreto privado dentro del bundle.
- Verificación de email, recuperación de contraseña, cierre de todas las sesiones y
  eliminación/exportación de cuenta.
- Rate limiting específico para registro, login, refresh, recuperación y QR; respuestas
  anti-enumeración para no revelar si existe un correo.

### Notificaciones

- Registro de dispositivos por usuario (`expo`, `fcm` o `apns`), con token hash, estado,
  plataforma, versión y último uso.
- Preferencias por categoría: cambios de línea, alertas de servicio, recordatorios,
  campañas y sistema.
- Bandeja persistida de notificaciones, lectura individual/todas y deep link seguro.
- Cola BullMQ separada para entrega; reintentos con backoff, idempotencia, expiración y
  limpieza de tokens inválidos.
- Los eventos salen del backend (publicación/desvío/incidencia/alerta guardada); el
  cliente nunca puede enviarse notificaciones a sí mismo.

### Planes y capacidades

- Catálogo configurable de planes (`free`, `plus`, futuros planes) y capacidades, no
  límites codificados en componentes.
- Suscripción por usuario con estado, periodo, trial, cancelación y proveedor de pago.
- Servicio de entitlements reutilizable por API y worker; respuesta de capacidades en
  `/v1/passenger/me` para que móvil/web puedan adaptar la UI.
- El MVP puede iniciar con plan gratuito y otorgamientos internos; checkout y webhooks
  de proveedor se habilitan después sin cambiar el contrato de capacidades.

## Fases de implementación

### Fase 0 — Fundaciones y contrato

- Validar variables críticas al arrancar (DATABASE, JWT, CORS, Redis, URLs).
- Corregir defaults API/Redis y documentar entornos local, LAN, staging y producción.
- Error envelope único con `requestId`, códigos estables y redacción de secretos.
- CORS por allowlist, headers de seguridad, límites de body y rate limits por ruta.
- Contratos Zod compartidos + OpenAPI para cada endpoint nuevo.
- Pruebas de arranque, health/readiness, CORS, validación y throttling.

### Fase 1 — Identidad de pasajero

Endpoints previstos:

```text
POST /v1/auth/passenger/register
POST /v1/auth/login
POST /v1/auth/refresh
POST /v1/auth/logout
GET  /v1/passenger/me
PATCH /v1/passenger/me
POST /v1/passenger/auth/verify-email
POST /v1/passenger/auth/forgot-password
POST /v1/passenger/auth/reset-password
GET  /v1/passenger/sessions
DELETE /v1/passenger/sessions/:id
DELETE /v1/passenger/me
```

Entregables:

- rol `pasajero` y perfil de pasajero separado del modelo generado de Better Auth;
- consentimiento de términos/privacidad y versión aceptada;
- validación, rate limit, auditoría sin contraseñas y pruebas de aislamiento;
- compatibilidad futura con Google/Facebook mediante OAuth/OIDC + PKCE.

### Fase 2 — Datos personales de experiencia

```text
GET/POST/PATCH/DELETE /v1/passenger/favorites/lines/:lineId
GET/POST/PATCH/DELETE /v1/passenger/places
GET/DELETE            /v1/passenger/recent-searches
GET/PATCH             /v1/passenger/preferences
POST                  /v1/passenger/feedback
```

Todos los registros se filtran por `userId`, tienen retención configurable y no exponen
datos privados en la API pública de movilidad.

### Fase 3 — Notificaciones y alertas

```text
POST/DELETE /v1/passenger/devices
GET/PATCH   /v1/passenger/notification-preferences
GET         /v1/passenger/notifications
POST        /v1/passenger/notifications/:id/read
POST        /v1/passenger/notifications/read-all
POST/DELETE /v1/passenger/alerts/lines/:lineId
POST/DELETE /v1/passenger/alerts/routes/:routeId
```

- crear modelos, índices y RLS/owner checks;
- productor de eventos de movilidad;
- cola `passenger-notifications` y worker independiente;
- proveedor Expo Push primero, adaptadores FCM/APNs después;
- métricas de entregado, rechazado, reintentado y token inválido;
- pruebas de duplicados, expiración, desconexión de Redis y reintentos.

### Fase 4 — Planes, suscripciones y entitlements

```text
GET  /v1/passenger/plans
GET  /v1/passenger/subscription
POST /v1/passenger/subscription/checkout
POST /v1/billing/webhooks/:provider
POST /v1/passenger/subscription/cancel
POST /v1/passenger/subscription/resume
```

- tablas `plans`, `plan_features`, `subscriptions`, `entitlement_grants` y eventos de
  facturación;
- guardas de capacidad para alertas avanzadas, lugares ilimitados, historial y otras
  funciones que Producto confirme;
- webhooks firmados, idempotentes y auditados;
- ninguna pantalla de movilidad básica queda bloqueada por un plan de pago.

### Fase 5 — Mobility API y planner

- **Avance 2026-08-19 — contexto multi-ciudad:** `packages/shared` ya define el catálogo
  de ciudades y `cityId` en las respuestas públicas. La migración
  `20260819100000_mobility_city_scope` crea `mobility_cities`, registra las nueve áreas
  iniciales y asigna las líneas existentes a Cochabamba por compatibilidad. La API expone
  `/v1/public/mobility/cities` y filtra líneas, rutas, paradas y planner por ciudad. La
  migración todavía no se ha ejecutado sobre una base externa; los clientes mantienen la
  bandera apagada hasta aplicar la migración y desplegar la API en ese orden.
- paginación/cursor, `total`/`nextCursor` y orden estable;
- búsqueda por código, nombre, nombre corto, operador y texto normalizado con acentos;
- endpoints de proximidad para paradas y líneas;
- ETag/`updatedAt`, cache coherente e invalidación al publicar;
- límite explícito de alternativas del planner, deduplicación y ranking determinista;
- índices PostGIS/GiST y pruebas `EXPLAIN` para evitar scans completos;
- validación estricta de UUID/QR, rotación de tokens QR y `no-store`;
- contratos de compatibilidad para la app móvil y la web de pasajero.

### Fase 6 — Calidad, despliegue y operación

- migraciones reversibles y seed de un pasajero de prueba sin credenciales reales;
- unit, integración con Postgres/PostGIS/Redis, e2e de registro→alerta→entitlement y
  pruebas de carga del catálogo/planner/notificaciones;
- pruebas de seguridad: fuerza bruta, enumeración, replay de refresh, IDOR, CORS,
  payloads grandes, tokens QR y webhooks;
- dashboards de latencia, errores, colas, entregas y sesiones activas;
- documentación OpenAPI, runbooks de notificaciones/pagos y matriz de permisos;
- rollout por feature flags, migración de datos y apagado de servicios de prueba al final.

## Criterios de aceptación globales

- Un pasajero puede registrarse, iniciar/cerrar sesión y recuperar acceso sin poder
  consultar ningún endpoint administrativo.
- Un usuario puede registrar un dispositivo, elegir preferencias y recibir una alerta
  una sola vez aunque el worker se reinicie.
- Las capacidades de un plan se resuelven server-side y no se pueden elevar cambiando
  el body o el rol del cliente.
- La app sigue viendo únicamente movilidad publicada y activa, con respuestas cacheables,
  búsquedas útiles y planner acotado.
- Los tests de RLS/owner isolation, contratos y carga pasan antes de habilitar cada fase.
