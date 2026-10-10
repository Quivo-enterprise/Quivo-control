# SRS §1 — Autenticación, roles, multi-tenant (RLS) y auditoría

> Parte del [SRS](README.md). Reconstruido desde el código de `main@64125f7` el 2026-10-10 (sin el documento original de requisitos). Rutas relativas a la raíz del repo. "No encontrado" = buscado y ausente; "no verificado" = no comprobado en ejecución.

Convenciones de ID:
- RF-81..84 y RNF-15/16/17 existen en `docs/documento-tecnico-cto.md` (§3 L93, §4.1 L108, §5 L154, §9 L205), pero **el doc solo da el rango, no el enunciado individual**. Mi asignación 81/82/83/84 y 15/17 dentro del rango es **inferida-validar**. Seguro: RNF-16 = aislamiento entre sindicatos (§4.1 L108); RNF-15/17 = roles/permisos (§5 L154, citados juntos).
- Todo lo demás: `RF-AUTH-xnn` / `RNF-AUTH-xnn` provisional.
- Abreviaturas de archivo: `AM` = `apps/api/src/modules/auth-movil/auth-movil.service.ts`; `AMC` = `apps/api/src/modules/auth-movil/auth-movil.controller.ts`; `AS` = `apps/api/src/modules/auth/auth.service.ts`; `AC` = `apps/api/src/modules/auth/auth.controller.ts`; `DBA` = `packages/db/src/auth.ts`; `AUD` = `apps/api/src/common/audit/audit.interceptor.ts`.

---

## 1. Requisitos funcionales

### 1.1 Auth web (admin) — Better-Auth

| ID | Enunciado | Fuente | Estado | Código | Test |
|---|---|---|---|---|---|
| RF-AUTH-W01 | El sistema debe autenticar a los roles administrativos con email + contraseña (`POST /v1/auth/login`) y responder `accessToken`, `refreshToken` y `user {id,email,rol,sindicatoId}`. | doc §5 L152 | implementado | `AS:69-82`, `AS:270-285`; contrato `packages/shared/src/auth/login.ts:9-12,15-39` | `apps/api/src/modules/auth/auth.service.test.ts:12` |
| RF-AUTH-W02 | El sistema debe responder 401 "Credenciales inválidas" ante cualquier `APIError` de Better-Auth en el login (sin distinguir email inexistente de contraseña errónea). | código | implementado | `AS:76-81` | `auth.service.test.ts:103` |
| RF-AUTH-W03 | El sistema NO debe exponer ruta pública de alta (sign-up); las cuentas admin se crean solo por seed/operación interna. | código | implementado (por ausencia de ruta; `emailAndPassword.disableSignUp` queda en false a propósito) | `DBA:143-147`, `DBA:151-153`; `AC:21-70` (solo login/refresh/logout/admin) | — (ningún test asegura la ausencia de la ruta) |
| RF-AUTH-W04 | El access token debe ser un JWT firmado (JWKS asimétrico) con claims `sub`, `rol`, `sindicatoId` (null para `admin_quivo`). | doc §5 L153 (el doc dice `user_id`; ver §5.1) | implementado | `DBA:166-173` | `apps/api/src/common/auth/jwt-auth.guard.integration.test.ts:14` |
| RF-AUTH-W05 | El sistema debe rotar el refresh token en cada `POST /v1/auth/refresh` (compare-and-swap sobre `session.id` + `token`) devolviendo `accessToken` y `refreshToken` nuevos (token siguiente = HMAC-SHA256 del anterior con clave derivada de `JWT_SECRET`). | doc §5 L153; QUI-359 | implementado | `AS:97-140`, `AS:30-32,57-59` | `auth.service.test.ts:12,41` |
| RF-AUTH-W06 | Ante reuso de un refresh token ya rotado (o carrera del CAS), el sistema debe revocar **todas** las sesiones del usuario y responder 401. | código (QUI-359) | implementado | `AS:104-117` (reuso), `AS:129-134` (carrera) | `auth.service.test.ts:41` |
| RF-AUTH-W07 | El sistema debe tolerar hasta 3 rotaciones de retraso al resolver el token presentado (pestañas rezagadas) para logout y para detectar reuso. | código | implementado | `AS:42`, `AS:178-188` | `auth.service.test.ts:78` |
| RF-AUTH-W08 | El sistema debe revocar la sesión server-side en `POST /v1/auth/logout` (204), incluso con un token de rotación vieja; si no resuelve a ninguna sesión, responde 204 sin error. | código (QUI-251) | implementado | `AC:42-46`, `AS:156-165` | `auth.service.test.ts:12,78` |
| RF-AUTH-W09 | Solo `admin_quivo` debe poder listar el directorio de usuarios (`GET /v1/auth/admin/users`: id, nombre, email, rol, sindicatoId; sin hashes ni sesiones). | código | implementado | `AC:50-55`, `AS:193-204` | `auth.service.test.ts:110` (servicio); el `@Roles` de `AuthController` no está en `roles-matrix.test.ts` |
| RF-AUTH-W10 | Solo `admin_quivo` debe poder restablecer la contraseña de cualquier usuario (`POST /v1/auth/admin/reset-password`, 204): re-hashea, crea la cuenta `credential` si faltaba, revoca todas las sesiones del usuario y audita (`accion=reset_password`, diff solo con el email). | código | implementado | `AC:60-69`, `AS:218-262` (audit `AS:250-261`) | `auth.service.test.ts:127,160` |
| RF-AUTH-W11 | La contraseña nueva del reset debe tener 8–128 caracteres; la contraseña de login solo exige no vacía. | código | implementado | `packages/shared/src/auth/login.ts:68-71` y `:15-18` | — |
| RF-AUTH-W12 | El reset de contraseña debe responder 404 si el email no existe. | código | implementado | `AS:222-225` | `auth.service.test.ts:160` |
| RF-AUTH-W13 | El panel web debe persistir la sesión (`user`, `token`, `refreshToken`) en `localStorage` bajo `quivo.session` y restaurarla al abrir. | código | implementado | `apps/web/src/lib/auth/auth-context.tsx:40,108-118,174-191` | — (sin test del contexto) |
| RF-AUTH-W14 | El panel web debe renovar el access token 30 s antes de su `exp` (decodifica el JWT sin verificar, solo UX) y cerrar sesión local si el refresh falla. | código | implementado | `auth-context.tsx:42,120-152`; `apps/web/src/lib/auth/jwt.ts:27-47` | `apps/web/src/lib/auth/jwt.test.ts` (solo el decode) |
| RF-AUTH-W15 | El panel web debe sincronizar sesión entre pestañas vía el evento `storage` (rotación y logout en otra pestaña). | código (QUI-359) | implementado | `auth-context.tsx:209-260` | — |
| RF-AUTH-W16 | El panel web debe revocar la sesión server-side al cerrar sesión (best-effort: el cierre local procede aunque la API falle). | código (QUI-251) | implementado | `auth-context.tsx:275-286`; `apps/web/src/lib/auth/api-client.ts:35-43` | — |
| RF-AUTH-W17 | El panel web debe redirigir a `/login` sin sesión y a `/` si el rol no está en `roles` del módulo; el menú solo muestra los módulos permitidos al rol. | doc §5, RNF-16 (comentario `nav-items.ts:4`) | implementado | `apps/web/src/components/require-auth.tsx:9-45`; `apps/web/src/lib/nav-items.ts:19-125,131-133` | no localizado (**no verificado**) |
| RF-AUTH-W18 | Bajo `NODE_ENV!=='production'` y `NEXT_PUBLIC_DEV_BYPASS_AUTH==='true'`, el panel debe permitir una sesión simulada (`admin_quivo`/`admin_sindicato`) sin backend. | código | implementado (solo dev) | `auth-context.tsx:51-71,158-172` | — |
| RF-AUTH-W19 | El sistema debe permitir a `admin_quivo` crear/editar/desactivar usuarios administrativos (`admin_sindicato`, `operador`…) desde la API. | doc §5 (implícito) | **pendiente / no encontrado**: solo seed (`packages/db/prisma/seed.ts:132-144`) y reset de contraseña | — | — |

### 1.2 Autorización por rol (RNF-15/17 + guards)

| ID | Enunciado | Fuente | Estado | Código | Test |
|---|---|---|---|---|---|
| RF-AUTH-R01 | El sistema debe rechazar con 401 toda request a endpoint protegido sin `Authorization: Bearer`, o con JWT inválido/expirado/sin `sub` o sin `rol` string. | doc §5 | implementado | `apps/api/src/common/auth/jwt-auth.guard.ts:19-34` | `jwt-auth.guard.test.ts:19,26,34` |
| RF-AUTH-R02 | El sistema debe rechazar con 403 las requests cuyo rol no figure en `@Roles(...)` del handler/clase; sin `@Roles`, deja pasar a cualquier autenticado. | doc §5 L154 | implementado | `common/auth/roles.guard.ts:13-25`; `roles.decorator.ts:6` | `roles.guard.test.ts:21-38` |
| RF-AUTH-R03 | La matriz de roles por controller debe quedar fijada por test (un cambio de `@Roles` rompe el test). | código (QUI-251) | implementado | matriz §3 | `common/auth/roles-matrix.test.ts:44-82` (22 controllers; **no** `AuthController`, `MediaController`, `MobilityPublicationController`, `EnVivoController`) |
| RF-AUTH-R04 | `admin_quivo` debe figurar en todo `@Roles` de los controllers de administración (super-admin). | doc §5 | implementado | `roles-matrix.test.ts:77-82` | idem |
| RF-AUTH-R05 | Solo `admin_quivo` debe poder gestionar sindicatos (CRUD). | doc §5; RNF-16 | implementado | `apps/api/src/modules/sindicatos/sindicatos.controller.ts:23` | `roles-matrix.test.ts:46` |
| RF-AUTH-R06 | Solo `admin_quivo` y `admin_sindicato` deben usar reglas, sanciones, rotaciones, auditoría, credenciales móviles, errores de sync, reportes y exportes; `operador` solo el CRUD núcleo (socios, vehículos, conductores, líneas, rutas, variantes, paradas, puntos de control) + publicación de movilidad pública. | doc §5 (parcial) | implementado | matriz §3 | `roles-matrix.test.ts:45-68` |
| RF-AUTH-R07 | Solo `admin_quivo` debe poder crear/editar un vehículo de tipo `otro`; otros roles reciben 400. | código | implementado | `apps/api/src/modules/vehiculos/vehiculos.service.ts:343-347` | no localizado (**no verificado**) |
| RF-AUTH-R08 | Los roles `supervisor`, `socio`, `pasajero` (y `conductor` como usuario web) deben tener acceso definido a la API. | doc §5 L154 | **pendiente**: existen en `RolSchema` (`packages/shared/src/enums/roles.ts:9-17`) pero ningún `@Roles` los incluye → 403 en todo endpoint admin | — | — |
| RF-AUTH-R09 | Las capacidades que la API da a `operador` deben estar disponibles en la UI web. | doc §5 | **contradicción**: `nav-items.ts` no incluye `operador` en ningún módulo (ver §5.2) | `nav-items.ts:19-125` | — |

### 1.3 Multi-tenant (RNF-16) y RLS

| ID | Enunciado | Fuente | Estado | Código | Test |
|---|---|---|---|---|---|
| RNF-16a | Toda query de datos de negocio debe correr en una transacción que fija `app.rol` y `app.sindicato_id` con `set_config(...,true)` (local a la transacción) desde los claims del JWT. | doc §4.1 L108 | implementado | `packages/db/src/tenant-context.ts:20-28` (set_config L25-26) | `packages/db/src/rls.integration.test.ts:21` |
| RNF-16b | La base debe aplicar RLS (`ENABLE` + `FORCE`) con política `tenant_isolation` en 18 tablas: sindicatos, socios, vehiculos, conductores, lineas, audit_log, rotaciones, reglas, sanciones, historial_estados_vehiculo, desafios_auth_movil, sesiones_operativas, intentos_auth_movil, cumplimientos_pc, eventos_operativos, sync_errors, gps_points (y particiones), gps_sesion_resumen. | doc §4.1 | implementado | `packages/db/prisma/migrations/20260730152500_rls_multi_tenant/migration.sql:44-112` + `20260731060000`, `20260731150000`, `20260801090000`, `20260801153000`, `20260802160000`, `20260815120000`, `20260829180000`, `20260907100000`, `20260922100000` | `rls.integration.test.ts:214-349` (sindicatos, socios, vehículos, conductores, líneas, rotaciones, reglas, sanciones, gps_points; **no** audit_log, sesiones, desafíos, intentos, cumplimientos, eventos, sync_errors) |
| RNF-16c | `admin_quivo` debe tener bypass explícito vía `app.rol='admin_quivo'` (no vía rol de Postgres). | código (QUI-218) | implementado | `20260730152500…/migration.sql:29-31,48-49` | `rls.integration.test.ts:264,349` |
| RNF-16d | El cliente de runtime debe usar el rol `quivo_app` (NOSUPERUSER, NOBYPASSRLS) vía `RUNTIME_DATABASE_URL`; fuera de `development` su ausencia aborta el arranque. | código (QUI-218) | implementado | `20260730152500…/migration.sql:11-16`; `packages/db/src/client.ts:41-66` | `rls.integration.test.ts` (corre con ese rol) |
| RNF-16e | `WITH CHECK` debe impedir INSERT/UPDATE de filas a nombre de otro sindicato. | código | implementado | políticas en la migración L51-111 | `rls.integration.test.ts:249,256,299,306,331,338` |
| RNF-16f | Un recurso de otro tenant debe responder 404 (nunca 403), para no revelar su existencia. | código | implementado (patrón por servicio) | `socios.service.ts:31-39,53-66`; `common/geo/tenant-checks.ts:11-20,22-34` | `socios.service.test.ts:55`; `rutas.service.test.ts:83`; `vehiculos.service.test.ts:74` |
| RNF-16g | Para tablas sin RLS ni `sindicatoId` propio (`rutas`, `variantes`, `paradas`, `puntos_control`) la barrera de tenant debe resolverse hasta `linea` (con RLS) y tratar lo no visible como inexistente (404). | código | implementado **solo a nivel aplicación** (sin RLS en esas tablas; ver §5.2) | `tenant-checks.ts:11-34`; usos `rutas.service.ts:36,48,55,75`, `variantes.service.ts:13,21,33,44`, `paradas.service.ts:29-67`, `control-points.service.ts:35`, `rotaciones.service.ts:37` | `rutas.service.test.ts:83` (solo rutas) |
| RNF-16h | Un `admin_sindicato`/`operador` que crea una entidad queda forzado a su propio `sindicatoId` ignorando el del body; solo `admin_quivo` elige sindicato. | código | implementado (patrón por servicio; verificado en socios) | `socios.service.ts:41-42,76-80` | `socios.service.test.ts:44` |
| RNF-16i | Un token con rol de tenant y `sindicatoId=null` debe ver cero filas (la política compara contra `''`). | inferido del diseño | inferido-validar | `tenant-context.ts:26` (`sindicatoId ?? ''`) | — |

### 1.4 Auth móvil (conductor): login de un paso

| ID | Enunciado | Fuente | Estado | Código | Test |
|---|---|---|---|---|---|
| RF-AUTH-M01 | El sistema debe autenticar al conductor con **placa + PIN del conductor + deviceId** en un solo request (`POST /v1/mobile/auth/sesion`, HTTP 200). | doc §15.3 (superado, ver §5.1); `docs/archivo/plan-auth-movil-quivo.md` | implementado | `AMC:43-49`; `AM:270-392`; `packages/shared/src/auth/mobile.ts:171-175` | `auth-movil.service.test.ts:634` |
| RF-AUTH-M02 | La placa debe normalizarse (trim, mayúsculas, quitar no alfanuméricos) y resolverse a un vehículo `activo` por `placaNormalizada` (0 o 1 resultado, índice único parcial). | código | implementado | `AM:1173-1178`, `AM:766-787` | `packages/db/src/vehiculo-placa-unicidad.test.ts`; `auth-movil.service.test.ts:620` |
| RF-AUTH-M03 | El PIN móvil debe tener 6–12 dígitos; el `deviceId` 8–128 caracteres `[A-Za-z0-9._:-]`. | código | implementado | `mobile.ts:20-28` | `apps/mobile/src/features/auth/vehicle-login-schema.test.ts`; `packages/shared/src/auth/mobile.test.ts` |
| RF-AUTH-M04 | El sistema debe identificar al conductor comparando el PIN contra los conductores con asignación **vigente hoy** (fecha Bolivia, `estado=vigente`, `venceAt>ahora`, rotación `publicada`, conductor `activo`) del vehículo (nivel 1; máx. 3 por `@@unique(vehiculoId,fecha,horario)`). | plan-auth-movil | implementado | `AM:792-813`, `AM:286-291`, `AM:45` | `auth-movil.service.test.ts:634` |
| RF-AUTH-M05 | El sistema debe hacer siempre K=3 verificaciones scrypt (reales o dummy) en nivel 1 y ante placa desconocida, para que el tiempo no filtre cuántos candidatos hay ni si la placa existe. | código | implementado | `AM:45`, `AM:877-888`, `AM:276-282`, `AM:1180-1188` | `auth-movil.service.test.ts:620` |
| RF-AUTH-M06 | Si el nivel 1 no resuelve, el sistema debe probar un nivel 2 (conductores con cualquier asignación en [hoy-30d, hoy+7d], tope 20, excluyendo los del nivel 1) **solo para decidir 409 vs 401**; nunca autentica. | código | implementado | `AM:49-51`, `AM:815-875` | `auth-movil.service.test.ts:719` |
| RF-AUTH-M07 | Si el PIN es válido (nivel 1 o 2) y no hay asignación vigente hoy con rotación publicada, el sistema debe responder 409 "`<nombre>`, hoy no tenés una rotación publicada para `<placa>`". | código | implementado | `AM:332`, `AM:340-342`, `AM:1204-1208` | `auth-movil.service.test.ts:719` |
| RF-AUTH-M08 | El 409 de nivel 2 NO debe resetear ni incrementar el contador de fallos. | código (hallazgo H1) | implementado | `AM:316-332` | `auth-movil.service.test.ts:753` |
| RF-AUTH-M09 | Placa desconocida, PIN incorrecto o PIN coincidente con >1 conductor deben responder el mismo 401 "Placa o PIN incorrectos". | código | implementado | `AM:276-282,297-311,1194-1198` | `auth-movil.service.test.ts:620,799,860` |
| RF-AUTH-M10 | Si >1 conductor coincide con el PIN, el sistema debe contarlo como fallo, reportar la colisión a log + Sentry y responder 401. | código | implementado | `AM:297-300`, `AM:976-985` | `auth-movil.service.test.ts:860` |
| RF-AUTH-M11 | Si el conductor tiene exactamente 1 asignación hoy, el sistema debe crear la sesión operativa y devolver `status:'autenticado'` con tokens y `contexto`. | código | implementado | `AM:343-353`, `AM:992-1064` | `auth-movil.service.test.ts:634` |
| RF-AUTH-M12 | Si el conductor tiene ≥2 asignaciones hoy, el sistema debe devolver `status:'seleccion_requerida'` con `seleccionToken` de un solo uso (TTL `MOBILE_CHALLENGE_TTL_SECONDS`, 300 s por defecto, ligado a `deviceId` y `conductorId`) y la lista de asignaciones. | código | implementado | `AM:355-391`; `mobile.ts:185-199` | `auth-movil.service.test.ts:662` |
| RF-AUTH-M13 | `POST /v1/mobile/auth/sesion/asignacion` debe consumir el `seleccionToken` (un uso, mismo `deviceId`, no vencido) y crear la sesión de la asignación elegida; cualquier fallo → 401 "Placa o PIN incorrectos". | código | implementado | `AM:397-440`; `AMC:51-56` | `auth-movil.service.test.ts:894` (deviceId distinto) |
| RF-AUTH-M14 | Al crear una sesión operativa, el sistema debe **cerrar todas las sesiones activas previas del mismo vehículo o del mismo `deviceId` dentro del mismo sindicato**, en la misma transacción que crea la nueva. | plan §2.4.5 | implementado | `AM:1033-1041` | `auth-movil.service.test.ts:449` |
| RF-AUTH-M15 | El sistema debe aplicar lockout progresivo **por vehículo** (no por IP): fallos 1–3 sin espera; desde el 4º, espera `min(2^(fallos-3),60)` s (2,4,8,16,32,60…). Con bloqueo vigente responde 429 con `retryAfterSeconds` en cuerpo y header `Retry-After`, **antes** de cualquier scrypt. | plan §1.g.2 | implementado | `AM:890-901` (chequeo), `AM:931-953` (backoff), `lockout-movil-exception.filter.ts:11-19`, `auth-movil.exceptions.ts:9-13` | `auth-movil.service.test.ts:799,826` |
| RF-AUTH-M16 | El contador de fallos debe incrementarse atómicamente (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) y resetearse a 0 (`bloqueadoHasta=null`) cuando el PIN se verifica en nivel 1 con exactamente 1 candidato. | código (H2) | implementado | `AM:931-943`, `AM:960-967`, `AM:294-296` | `auth-movil.service.test.ts:799,931` |
| RF-AUTH-M17 | El contador de fallos no decae por tiempo (solo se limpia con un éxito). | código | inferido-validar | `AM:944-951` (sin reset temporal) | — |
| RF-AUTH-M18 | El access token móvil es un bearer opaco (`mobile_at_` + 32 bytes base64url), TTL por defecto 900 s (`MOBILE_ACCESS_TTL_SECONDS`); el refresh opaco (`mobile_rt_`) TTL por defecto 2 592 000 s = 30 d (`MOBILE_REFRESH_TTL_SECONDS`); solo se persiste su SHA-256. | doc §5 L153 (sin números) | implementado | `token-opaco.ts:5-25`; `AM:1003-1012`, `AM:1241-1244` | `token-opaco.test.ts:5` |
| RF-AUTH-M19 | `AuthMovilGuard` debe validar el access token (existe, `estado='activa'`, no revocado, no vencido) y poblar `sesionMovil {sesionId,sindicatoId,asignacionId,vehiculoId,conductorId,deviceId}`; en fallo, 401 "Sesión móvil inválida o expirada". | código | implementado | `auth-movil.guard.ts:73-96`; `AM:442-462` | `auth-movil.guard.test.ts:36-146` |
| RF-AUTH-M20 | El guard debe cachear en memoria, por hash de token, los tokens ya rechazados (TTL 5 min, tope 10 000 entradas, evicción FIFO) y no cachear errores de infraestructura. | código (QUI-240) | implementado | `auth-movil.guard.ts:13,18,98-127` | `auth-movil.guard.test.ts:93,111` |
| RF-AUTH-M21 | `POST /v1/mobile/auth/refresh` debe rotar el par access/refresh (CAS sobre `refreshTokenHash`), conservar el `refreshExpiresAt` original (vencimiento absoluto, no deslizante) y guardar el hash anterior. | código | implementado | `AM:488-537` (L535) | `auth-movil.service.test.ts:177` |
| RF-AUTH-M22 | Si el refresh token no corresponde a una sesión vigente (desconocido/rotado, cerrada, revocada o vencida), el sistema debe responder 401 con `codigo:'SESION_NO_VIGENTE'` y el mismo `message`. | código (Entrega 28) | implementado | `auth-movil.exceptions.ts:31-39`; `AM:494-501,524-530`; `mobile.ts:18` | `auth-movil.service.test.ts:198,214,235` |
| RF-AUTH-M23 | `POST /v1/mobile/auth/logout` (público, 204) debe cerrar la sesión por hash de refresh; si no matchea y viene `deviceId`, cerrar la sesión activa de ese `deviceId` **solo si** el token presentado coincide con `refreshTokenHashAnterior` (prueba de posesión); si no, no-op silencioso. | código (hallazgo 5) | implementado | `AM:585-612`; `AMC:64-68` | `auth-movil.service.test.ts:277,310,344,368,391` |
| RF-AUTH-M24 | `GET /v1/mobile/auth/contexto-operativo` y `GET /v1/mobile/perfil` deben devolver el contexto (asignación, vehículo, conductor, sindicato, línea, ruta) de la sesión; 401 si está revocada/no activa. | código | implementado | `AMC:70-74,77-88`; `AM:464-477`, `AM:1123-1171` | test directo no localizado (**no verificado**) |
| RF-AUTH-M25 | La app debe generar un `deviceId` estable (`android:<uuid>`) la primera vez y persistirlo en SecureStore. | código | implementado | `apps/mobile/src/shared/security/sesion-movil-store.ts:42-47,165-171` | — |
| RF-AUTH-M26 | La app debe guardar tokens y contexto en `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) en dos claves separadas (credenciales / contexto) para que un refresh no pise el contexto. | código | implementado | `sesion-movil-store.ts:42-47,60-86,117-129` | `sesion-movil-store.contexto.test.ts` |
| RF-AUTH-M27 | Al abrir, la app debe restaurar la sesión desde disco; si `refreshTokenExpiresAt` pasó o el contexto está corrupto, borrarla y volver a login; si es válida, entrar a operación (aun sin red) y reconciliar en segundo plano (refresh si el access venció). | doc §5 L153 ("sesión larga renovable offline") | implementado | `apps/mobile/src/features/auth/use-auth-movil.ts:223-312,314+` | `use-auth-movil.restaurar-sesion.test.ts`, `…refrescar.test.ts` |
| RF-AUTH-M28 | Ante `SESION_NO_VIGENTE` la app debe borrar la sesión local y volver al login con "Tu sesión ya no es válida en este dispositivo…"; **si hay recorrido GPS activo**, esperar a que el chofer toque "Finalizar" antes de borrar (para no perder `fin_recorrido`). | código (Entrega 28) | implementado | `use-auth-movil.ts:~95-160` (`borrarSesionYVolverALogin`, `cerrarSesionPorNoVigente`); `apps/mobile/src/shared/api/auth-movil-api.ts:53-62` | `use-auth-movil.sesion-no-vigente.test.ts`, `sesion-movil-store.no-vigente.test.ts` |
| RF-AUTH-M29 | La app debe coordinar refresh y logout con un lease (`refresh-sesion`, TTL 20 s) para que dos contextos JS no rompan la rotación; el logout espera el lease (TTL + 5 s) y revoca con el refresh leído de disco. | código | implementado | `apps/mobile/src/db/outbox.ts:1268`; `use-auth-movil.ts:1177,1251+` | `use-auth-movil.refresh-lease.test.ts`, `…logout.test.ts` |
| RF-AUTH-M30 | Si el logout no puede revocar en el servidor (sin red), la app debe encolar una revocación pendiente (máx. 3 intentos no-red, piso de 10 s entre pasadas) y tratar al chofer como deslogueado al reabrir. | código | implementado | `use-auth-movil.ts:1332,1369,1382-1450`; `sesion-movil-store.ts:174-342` | `use-auth-movil.revocacion-pendiente.test.ts`, `sesion-movil-store.revocaciones.test.ts` |
| RF-AUTH-M31 | Tras un 401 al validar la sesión restaurada, la app debe reintentar el refresh con backoff [2 s, 8 s, 30 s] y, agotado, marcar `sesionNoRevalidada` sin borrar la sesión; circuit breaker: 5 fallos abren, backoff 30 s→5 min, "irrecuperable" tras 5 min abierto. | código | implementado | `use-auth-movil.ts:483-486,1474`; `apps/mobile/src/shared/api/refresh-circuit-breaker.ts:62-78` | `refresh-circuit-breaker.test.ts`, `use-auth-movil.obtener-access-token.test.ts` |
| RF-AUTH-M32 | La app debe mostrar mensajes por estado: 429 "Espera N segundos" (con `retryAfterSeconds`), 401 "Las credenciales no son válidas", 409 el mensaje del backend, red "No se pudo conectar…". Timeout de request 12 s. | código | implementado | `apps/mobile/src/shared/api/auth-movil-api.ts:53-86`; `shared/api/http-client.ts:1` | — |
| RF-AUTH-M33 | `/v1/sync/batches` debe exigir sesión móvil válida y limitar por dispositivo (60 req/min por `deviceId`, no por IP). | código (QUI-240) | implementado (límite del dominio sync) | `apps/api/src/modules/sync/sync.controller.ts:44-48` | `sync-device-throttler.guard.test.ts` |
| RF-AUTH-M34 | Cuando un admin cambia el PIN de un vehículo/conductor, el sistema debe cerrar sus sesiones activas e invalidar sus desafíos sin consumir, y auditarlo (`accion=actualizar_credencial_movil`, diff = conteos, sin PIN ni hash). | plan-auth-movil §11 | implementado | `AM:661-717`, `AM:1067-1085` | `auth-movil.service.test.ts:413` |
| RF-AUTH-M35 | Solo `admin_quivo` y `admin_sindicato` pueden fijar (`PUT`) o generar (`POST …/generar`, 6 dígitos CSPRNG, devuelto una sola vez) el PIN de vehículos y conductores de su ámbito; 404 si la entidad no es visible. | código | implementado | `credenciales-moviles.controller.ts:12-53`; `AM:640-659,661-717,1227-1229` | `roles-matrix.test.ts:63`; `auth-movil.service.test.ts:413` |
| RF-AUTH-M36 | PIN y credencial deben almacenarse solo como hash (scrypt de `better-auth/crypto`). | plan-auth-movil §8 | implementado | `AM:667`, `AM:1180-1188` | `auth-movil.service.test.ts:413` |
| RF-AUTH-M37 | **Legado**: `POST /mobile/auth/vehiculo` + `/conductor` (challenge de 2 pasos, máx. 5 intentos por desafío, TTL 300 s, ligado a `deviceId`) sigue activo salvo `MOBILE_LEGACY_AUTH_ENABLED=false`, que responde 410. | código | implementado (activo por defecto) | `AM:87-239`, `AM:1216-1221`, `AM:38`; `AMC:29-39` | `auth-movil.service.test.ts:111,120,132,488` |
| RF-AUTH-M38 | El sistema debe invalidar el access token móvil cuando el vehículo o el conductor pasa a inactivo, o cuando la asignación vence. | inferido | **no encontrado**: `validarAccessToken` solo mira `estado/revokedAt/accessExpiresAt` | `AM:442-462` | — |

### 1.5 Auditoría (RF-81..84)

| ID | Enunciado | Fuente | Estado | Código | Test |
|---|---|---|---|---|---|
| RF-81 (inferido) | El sistema debe registrar en `audit_log` las acciones críticas marcadas `@Auditable` (crear, editar, anular y acciones específicas: publicar, aplicar, apelar, pagar). | doc §9 L205 | implementado | `common/audit/audit.decorator.ts:16-19`; `AUD:50-89`; mapa método→acción `AUD:9-14` | `audit.interceptor.test.ts:70-148` |
| RF-82 (inferido) | Cada registro debe incluir usuario (`usuarioId`), fecha/hora (`ts`, default `now()`) y `sindicatoId`. | doc §9 | implementado | `packages/db/prisma/schema.prisma:417-430` (modelo `AuditLog`); `AUD:75-83` | `audit.interceptor.test.ts:88` |
| RF-83 (inferido) | Cada registro debe incluir entidad, id de entidad, acción y `diff` JSONB. | doc §9 | **parcial**: `diff` = body de la request (no antes/después); sin body = `{}` | `AUD:30-33` (comentario), `AUD:82` | `audit.interceptor.test.ts:111` |
| RF-84 (inferido) | `admin_quivo` y `admin_sindicato` pueden consultar la auditoría (`GET /v1/auditoria`) filtrando por entidad, acción, usuario y rango de fechas (día calendario Bolivia, `hasta` exclusivo al día siguiente), orden `ts desc`, paginación `skip`, tope 200 filas por página. | doc §9 ("consultable desde el admin") | implementado | `auditoria.controller.ts:14-23`; `auditoria.service.ts:14-37`; `packages/shared/src/entities/auditoria.ts:21-28` | `auditoria.service.test.ts:107-136`; `auditoria.controller.integration.test.ts:125,140` |
| RF-AUTH-A01 | `admin_sindicato` ve únicamente la auditoría de su sindicato (RLS); `admin_quivo` la de todos. | doc §4.1/§9 | implementado | `auditoria.service.ts:11-13,28`; migración L101-112 | `auditoria.service.test.ts:107,114` |
| RF-AUTH-A02 | El registro debe escribirse antes de devolver la respuesta; si el insert falla, la request falla. | código | implementado (no atómico con la acción, ver §5.2) | `AUD:64-87` (`concatMap`) | fallo no cubierto (**no verificado**) |
| RF-AUTH-A03 | El `sindicatoId` del registro se toma de la entidad devuelta, o de su `id` si la entidad es un sindicato, o del tenant del actor; para `admin_quivo` sobre rutas/variantes/paradas/puntos de control queda `null`. | código (limitación declarada) | implementado con limitación | `AUD:34-40,99-107` | `audit.interceptor.test.ts:88,133` |
| RF-AUTH-A04 | Reset de contraseña y cambio de PIN móvil deben auditarse a mano (no por interceptor) para no filtrar secretos en `diff`. | código | implementado | `AS:214-217,250-261`; `AM:1067-1085` | `auth.service.test.ts:127`; `auth-movil.service.test.ts:413` |
| RF-AUTH-A05 | El sistema debe auditar login, logout, intentos fallidos, lockouts y revocaciones de sesión (web y móvil). | doc §5 L155 ("cambios críticos siempre auditados") — alcance dudoso | **no encontrado** (solo log + Sentry de colisión de PIN, `AM:976-985`) | — | — |
| RF-AUTH-A06 | `audit_log` debe ser inmutable (append-only) para el rol de runtime. | inferido (RNF-37, "nunca se borra evidencia") | **no encontrado**: `quivo_app` tiene `SELECT, INSERT, UPDATE, DELETE` sobre todas las tablas (`20260730152500…/migration.sql:19-20`), sin trigger ni REVOKE sobre `audit_log` | — | — |
| RF-AUTH-A07 | Los `GET` no deben auditarse. | código | implementado | `AUD:9-14` | `audit.interceptor.test.ts:79` |

---

## 2. Requisitos no funcionales

| ID | Enunciado | Fuente | Estado | Código | Test |
|---|---|---|---|---|---|
| RNF-15/17 (inferido) | El control de acceso se aplica con guards de NestJS por controller (JWT → roles) y RLS como barrera final. | doc §5 L154 | implementado a granularidad **controller** (no por acción), salvo `MediaController.subirLogo` | `common/auth/jwt-auth.guard.ts`, `roles.guard.ts`; `@UseGuards(JwtAuthGuard, RolesGuard)` por controller | `roles-matrix.test.ts` |
| RNF-16 | Un sindicato nunca ve ni modifica datos de otro (ver §1.3). | doc §4.1 | implementado (RLS en 18 tablas + app-level en rutas/variantes/paradas/puntos_control; `asignaciones` indirecta vía `rotacion`) | §1.3 | `rls.integration.test.ts` |
| RNF-AUTH-S01 | Access token web (JWT): TTL por defecto **15 min** (`JWT_ACCESS_TTL`). | código | implementado | `DBA:167-168`; `.env.example:33` | — |
| RNF-AUTH-S02 | Sesión/refresh web: TTL por defecto **7 días** (`JWT_REFRESH_TTL`; antes 30 d, bajado en QUI-356). | código | implementado | `DBA:160-163`; `.env.example:34` | — |
| RNF-AUTH-S03 | Móvil: access **900 s (15 min)**, refresh **2 592 000 s (30 d, absoluto)**, desafío/`seleccionToken` **300 s**; configurables por env, valor no entero positivo cae al default. | código | implementado | `AM:1005-1012,361,1241-1244`; `.env.example:35-37` | — |
| RNF-AUTH-S04 | `JWT_SECRET` debe tener ≥32 caracteres y no contener marcadores de placeholder; fuera de `development`, ausencia/invalidez aborta el arranque. | código (QUI-356) | implementado | `DBA:21-128` | `packages/db/src/auth.test.ts:45-79` |
| RNF-AUTH-S05 | Rate limit global: **100 req / 60 s por IP**. | código (QUI-251) | implementado | `apps/api/src/app.module.ts:37,72` | — |
| RNF-AUTH-S06 | `POST /v1/auth/login`: **5 req / 60 s por IP**. | código | implementado | `AC:29` | — |
| RNF-AUTH-S07 | `POST /v1/mobile/auth/{vehiculo,conductor,sesion,sesion/asignacion}`: **5 req / 60 s por IP**; `POST /v1/mobile/auth/refresh`: **20 req / 60 s por IP**. | código | implementado | `AMC:30,36,45,53,59` | — |
| RNF-AUTH-S08 | `POST /v1/auth/refresh`, `/v1/auth/logout` y `/v1/mobile/auth/logout` solo tienen el límite global (100/min por IP); riesgo declarado en el propio código. | código | implementado (por omisión) | `AC:35-46`; `AMC:64-68`; `AS:34-42` | — |
| RNF-AUTH-S09 | `/v1/sync/batches`: **60 req / 60 s por `deviceId`** (throttler 'device'), sin límite por IP. | código | implementado | `sync.controller.ts:44-48` | `sync-device-throttler.guard.test.ts` |
| RNF-AUTH-S10 | Espera máxima del lockout móvil: **60 s** (desde el 9º fallo). Tope bajo a propósito para que la placa pública no sirva de botón de denegación. | plan §1.g.2 | implementado | `AM:903-906,947` | `auth-movil.service.test.ts:826` |
| RNF-AUTH-S11 | Tokens móviles persistidos solo como SHA-256 hex; los de Better-Auth (`session.token`) se guardan **en claro** (limitación del adaptador, documentada). | código | implementado / limitación | `token-opaco.ts:16-25`; `AS:91-96` | `token-opaco.test.ts:5` |
| RNF-AUTH-S12 | Caché negativa del guard móvil: TTL 5 min, 10 000 entradas máx. | código | implementado | `auth-movil.guard.ts:13,18` | `auth-movil.guard.test.ts:111` |
| RNF-AUTH-S13 | CORS: orígenes por `CORS_ORIGIN` (default `http://localhost:3000`), `methods` explícitos. | código | implementado | `apps/api/src/main.ts:57-62` | — |
| RNF-AUTH-S14 | El tiempo de respuesta del login móvil no debe revelar existencia de placa ni cantidad de candidatos (padding K=3); el nivel 2 queda **sin padding** (hasta 20 scrypt; limitación documentada). | código | implementado con limitación | `AM:45,815-820,877-880` | `auth-movil.service.test.ts:620` |
| RNF-AUTH-S15 | Las tablas Better-Auth (`user`, `session`, `account`, `verification`, `jwks`) no llevan RLS (el login lee `user` antes de conocer el tenant). | código | implementado (decisión declarada) | `20260730152500…/migration.sql:33-38` | — |
| RNF-AUTH-S16 | El access token web revocado por logout/reset sigue válido hasta su `exp` (≤15 min): `JwtAuthGuard` solo verifica firma (stateless) y no consulta la sesión. | código | implementado / riesgo aceptado | `jwt-auth.guard.ts:11-16,29` | — |
| RNF-AUTH-S17 | El panel web guarda `accessToken` y `refreshToken` en `localStorage` (expuesto a XSS). | código | implementado / riesgo | `auth-context.tsx:108-118` | — |
| RNF-AUTH-S18 | Los datos de sesión del conductor en SecureStore no migran entre dispositivos (`…_THIS_DEVICE_ONLY`). | código | implementado | `sesion-movil-store.ts:45-47` | — |
| RNF-AUTH-S19 | Falta de `RUNTIME_DATABASE_URL` fuera de `development` debe abortar el arranque (para no degradar a un rol con BYPASSRLS). | código | implementado | `packages/db/src/client.ts:41-66` | — |

---

## 3. Matriz de roles × capacidades (de los `@Roles` reales)

Leyenda: ✔ permitido; ✘ 403; "—" no aplica. `supervisor`, `socio`, `conductor` (como usuario web) y `pasajero` **no aparecen en ningún `@Roles`** → ✘ en todo endpoint con guard. "Tenant" = RLS por `sindicatoId` del JWT; `admin_quivo` ve todos. Prefijo de rutas `/v1`.

| Controller / endpoint | `@Roles` (archivo:línea) | admin_quivo | admin_sindicato | operador | supervisor / socio / conductor / pasajero |
|---|---|---|---|---|---|
| `POST /auth/login`, `/auth/refresh`, `/auth/logout` | públicos (`AC:28-46`) | ✔ | ✔ | ✔ | ✔ (públicos) |
| `GET /auth/admin/users`, `POST /auth/admin/reset-password` | `admin_quivo` (`AC:52,62`) | ✔ | ✘ | ✘ | ✘ |
| `/sindicatos` (CRUD) | `admin_quivo` (`sindicatos.controller.ts:23`) | ✔ | ✘ | ✘ | ✘ |
| `/socios` | `admin_quivo, admin_sindicato, operador` (`socios.controller.ts:24`) | ✔ | ✔ (tenant) | ✔ (tenant) | ✘ |
| `/vehiculos` (incl. `verificar-placa`, `:id/estado`, `historial-estados`) | idem (`vehiculos.controller.ts:26`) | ✔ | ✔ | ✔ | ✘ |
| `/conductores` | idem (`conductores.controller.ts:22`) | ✔ | ✔ | ✔ | ✘ |
| `/lineas`; `POST /media/lineas/logo` | idem (`lineas.controller.ts:22`; `media.controller.ts:34`) | ✔ | ✔ | ✔ | ✘ |
| `/lineas/:lineaId/rutas`, `/rutas` | idem (`rutas.controller.ts:19`) | ✔ | ✔ | ✔ | ✘ |
| `/rutas/:rutaId/variantes`, `/variantes` | idem (`variantes.controller.ts:19`) | ✔ | ✔ | ✔ | ✘ |
| `/rutas/:rutaId/paradas`, `/paradas` | idem (`paradas.controller.ts:19`) | ✔ | ✔ | ✔ | ✘ |
| `/rutas/:rutaId/puntos-control`, `/puntos-control` | idem (`control-points.controller.ts:19`) | ✔ | ✔ | ✔ | ✘ |
| `PATCH /mobility-publications/resource/:id` | idem (`mobility-publication.controller.ts:16`) | ✔ | ✔ | ✔ | ✘ |
| `/reglas` | `admin_quivo, admin_sindicato` (`reglas.controller.ts:21`) | ✔ | ✔ | ✘ | ✘ |
| `/sanciones` (+ aplicar/anular/apelar/pagar) | idem (`sanciones.controller.ts:22`) | ✔ | ✔ | ✘ | ✘ |
| `/rotaciones` (+ publicar/anular, asignaciones) | idem (`rotaciones.controller.ts:24`) | ✔ | ✔ | ✘ | ✘ |
| `GET /auditoria` | idem (`auditoria.controller.ts:16`) | ✔ (todos) | ✔ (su tenant) | ✘ | ✘ |
| `PUT/POST /mobile/credenciales/*` | idem (`credenciales-moviles.controller.ts:14`) | ✔ | ✔ | ✘ | ✘ |
| `GET /sync-errores` | idem (`sync-errores.controller.ts:16`) | ✔ | ✔ | ✘ | ✘ |
| `GET /reportes/cumplimiento` | idem (`cumplimiento.controller.ts:15`) | ✔ | ✔ | ✘ | ✘ |
| `GET /reportes/recorridos[/:id]` | idem (`recorridos.controller.ts:15`) | ✔ | ✔ | ✘ | ✘ |
| `GET /reportes/en-vivo[...]` (throttle propio, 300/min) | idem (`en-vivo.controller.ts:30-31`) | ✔ | ✔ | ✘ | ✘ |
| `GET /reportes/exportar/{recorridos,cumplimiento,sanciones,actividad}` | idem (`exportes.controller.ts:29`) | ✔ | ✔ | ✘ | ✘ |
| `POST /mobile/auth/{sesion,sesion/asignacion,refresh,logout}`, legado `/vehiculo`,`/conductor` | públicos con throttle (`AMC:29-68`) | — | — | — | credenciales de conductor (placa + PIN) |
| `GET /mobile/auth/contexto-operativo`, `GET /mobile/perfil`, `GET /mobile/asignacion-del-dia`, `GET /mobile/ruta-a-punto`, `POST /sync/batches` | `AuthMovilGuard` (`AMC:70-88`; `tracking/paquete-dia.controller.ts:11-12`; `tracking/ruteo.controller.ts:9-10`; `sync/sync.controller.ts:48`) | ✘ | ✘ | ✘ | solo token móvil de sesión operativa (el "conductor" real) |
| `GET /media/lineas/:filename`, `GET /public/mobility/lines`, `POST /public/demo-request`, `GET /health*`, `GET /_internal/ping`, `POST /_internal/validate-demo` | sin guard (`media.controller.ts:23`; `public-mobility.controller.ts:38`; `demo-requests.controller.ts:14`; `health.controller.ts`; `common/ping/ping.controller.ts:10,20`) | ✔ | ✔ | ✔ | ✔ (públicos) |

Observaciones:
- `operador` queda fuera de reglas, sanciones, rotaciones, reportes y credenciales móviles.
- No hay diferenciación por acción dentro de un controller (todo-o-nada: no existe "solo lectura").
- `POST /_internal/validate-demo` está sin guard (solo throttle global); su comentario dice que se retira al existir el módulo real (`ping.controller.ts:15-19`) y sigue publicado.

---

## 4. Secuencias

### 4.1 Login web (admin)

```mermaid
sequenceDiagram
  autonumber
  participant U as Admin (panel web)
  participant W as apps/web (AuthProvider)
  participant A as API /v1/auth
  participant B as Better-Auth + Postgres
  U->>W: email + contraseña
  W->>A: POST /v1/auth/login {email,password}  (throttle 5/60s/IP)
  A->>B: auth.api.signInEmail
  alt cualquier APIError
    A-->>W: 401 "Credenciales inválidas"
  else ok
    B-->>A: session.token (opaco, en claro en tabla session) + user
    A->>B: auth.api.getToken (Bearer session.token)
    B-->>A: JWT (sub, rol, sindicatoId, exp=+15m, firma JWKS)
    A-->>W: 200 {accessToken, refreshToken=session.token, user}
    W->>W: localStorage 'quivo.session'; agenda refresh a (exp-30s)
  end
  Note over W,A: Cada request: Bearer accessToken -> JwtAuthGuard (verifyJWT, stateless) -> RolesGuard -> servicio abre withTenantContext(rol, sindicatoId)
  W->>A: POST /v1/auth/refresh {refreshToken}
  A->>B: getSession (tolera hasta 3 rotaciones atrás)
  alt token no vigente (reuso) o CAS perdido
    A->>B: DELETE todas las sesiones del usuario
    A-->>W: 401 -> W limpia sesión local
  else vigente
    A->>B: UPDATE session SET token=HMAC(token) WHERE id AND token
    A-->>W: 200 {accessToken, refreshToken nuevos}
  end
  U->>W: Cerrar sesión
  W->>A: POST /v1/auth/logout {refreshToken} (best-effort, 204)
  A->>B: DELETE session por id (aunque el token sea de rotación vieja)
```

Vigencias: access 15 min; sesión 7 d (`DBA:160-163`). Si Better-Auth renueva `expiresAt` al usarse (`updateAge`) **no está configurado ni verificado**; queda el default de la librería.

### 4.2 Login móvil (conductor, un paso)

```mermaid
sequenceDiagram
  autonumber
  participant C as Conductor (app Expo)
  participant S as SecureStore
  participant A as API /v1/mobile/auth
  participant D as Postgres (RLS)
  C->>S: obtenerDeviceIdMovil() ("android:<uuid>")
  C->>A: POST /sesion {placa, pin 6-12 díg, deviceId}  (5/60s/IP)
  A->>D: vehiculo activo por placaNormalizada
  alt placa desconocida
    A->>A: K=3 scrypt dummy (padding)
    A-->>C: 401 "Placa o PIN incorrectos"
  else vehículo existe
    A->>D: intentos_auth_movil.bloqueadoHasta > ahora ?
    alt bloqueado
      A-->>C: 429 {retryAfterSeconds} + Retry-After (sin scrypt)
    else
      A->>D: Nivel 1: conductores con asignación vigente hoy, rotación publicada, activos (<=3)
      A->>A: K=3 scrypt (reales + dummy)
      alt exactamente 1 PIN válido
        A->>D: fallos=0, bloqueadoHasta=null
        A->>D: asignaciones vigentes de hoy del conductor
        alt 0 asignaciones
          A-->>C: 409 "<nombre>, hoy no tenés una rotación publicada para <placa>"
        else 1 asignación
          A->>D: TX: cerrar sesiones activas (mismo vehículo o deviceId, mismo sindicato) + crear sesion_operativa
          A-->>C: 200 {status:'autenticado', accessToken 15m, refreshToken 30d, contexto}
        else >=2 asignaciones
          A->>D: crear desafio_auth_movil(conductorId, deviceId, TTL 300s)
          A-->>C: 200 {status:'seleccion_requerida', seleccionToken, asignaciones}
          C->>A: POST /sesion/asignacion {seleccionToken, asignacionId, deviceId} (5/60s/IP)
          A->>D: TX: consumir desafío (un uso) + cerrar sesiones previas + crear sesión
          A-->>C: 200 autenticado | 401 "Placa o PIN incorrectos"
        end
      else >1 PIN válido
        A->>D: +1 fallo; log + Sentry (colisión)
        A-->>C: 401 genérico
      else 0 PIN válidos
        A->>A: Nivel 2 (hasta 20 conductores, ventana -30/+7 días; solo decide 409)
        alt PIN válido en nivel 2
          A-->>C: 409 (contador de fallos NO cambia)
        else
          A->>D: +1 fallo; desde el 4º: bloqueadoHasta = min(2^(f-3),60) s
          A-->>C: 401 genérico
        end
      end
    end
  end
  C->>S: guardarSesionMovil (credenciales y contexto en claves separadas)
  loop uso normal
    C->>A: Bearer mobile_at_… -> AuthMovilGuard (401 si inexistente/revocado/vencido; caché negativa 5 min)
  end
  C->>A: POST /refresh {refreshToken} (20/60s/IP)
  alt hash vigente y sesión activa
    A->>D: CAS: rota access+refresh, guarda hash anterior, refreshExpiresAt se mantiene
    A-->>C: 200 nuevos tokens
  else
    A-->>C: 401 {codigo:'SESION_NO_VIGENTE'} -> app borra sesión (o espera "Finalizar" si hay recorrido activo)
  end
  C->>A: POST /logout {refreshToken, deviceId?} (204)
  A->>D: cerrar por hash vigente; si no, por deviceId + refreshTokenHashAnterior
```

Errores que ve el cliente: 400 (Zod), 401 genérico, 409 sin rotación, 429 (lockout con `retryAfterSeconds`, o throttle por IP sin él → la app muestra "Espera un minuto"), 410 (solo legado apagado). Un segundo login del mismo vehículo **cierra** la sesión del primero (RF-AUTH-M14); este verá `SESION_NO_VIGENTE` en su próximo refresh.

---

## 5. Contradicciones doc ↔ código y huecos

### 5.1 Contradicciones / desactualizaciones

1. **Credencial móvil (doc §5 L152, §15.3 L289):** el doc dice "login por vehículo: credencial de vehículo emitida por el sindicato; el conductor se identifica al iniciar la sesión operativa". El flujo principal real es **placa + PIN del conductor** en un paso (`AM:270-392`). El flujo "PIN de vehículo → desafío → documento+PIN de conductor" sigue vivo como **legado** activo por defecto (`AM:1216-1221`). Decisión de Producto desactualizada frente a la implementación.
2. **Claims JWT (doc §5 L153):** el doc dice `user_id, sindicato_id, rol`; el JWT real lleva `sub`, `rol`, `sindicatoId` (`DBA:169-172`, `jwt-auth.guard.ts:25-34`).
3. **Tokens en móvil:** el doc implica JWT + refresh para todos; el móvil usa **tokens opacos propios** (`mobile_at_/mobile_rt_`, SHA-256 en `sesiones_operativas`), no Better-Auth ni JWT (`token-opaco.ts`).
4. **"Sesión larga renovable offline" (doc §5):** el refresh móvil dura 30 d absolutos desde el login, sin renovación deslizante (`AM:535`); pasado ese plazo hay que re-loguear con red.
5. **"Guards por módulo/acción" (doc §5):** solo existe granularidad de **controller**.
6. **Roles (doc §5 L154):** `supervisor`, `socio`, `conductor` (web) y `pasajero` están en el enum pero sin permisos en ningún endpoint (RF-AUTH-R08). El rol `conductor` se usa solo como etiqueta de contexto interno (`AM:171,466,739`); ninguna política RLS lo distingue.
7. **Auditoría (doc §9):** "crear/editar/autorizar/publicar/anular/aplicar". "Autorizar" no existe como acción; sí existen `apelar` y `pagar`. "Diff JSONB" es el body de la request, no antes/después (`AUD:30-33`).
8. **Doc §8 (API):** lista `POST /v1/mobile/sesiones`, que **no existe** (equivalente: `/v1/mobile/auth/sesion`); no lista `logout`, `admin/users`, `admin/reset-password` ni `/mobile/auth/*`.
9. **Comentarios de código desalineados:** `packages/shared/src/auth/login.ts:56-58` y `AS:89` hablan de 30 d de refresh web (el default es 7 d, `DBA:161-162`); el JSDoc del lockout dice "desde el tercer fallo" (`AM:905-906`) pero el código espera recién desde el 4º (`AM:944`, `fallos <= 3`); `auth-movil-api.ts:~66` repite la fórmula.
10. **`ping.controller.ts:15-19`** dice que `validate-demo` se retira cuando exista el módulo `sindicatos`; el módulo existe y el endpoint sigue publicado sin auth.

### 5.2 Huecos y riesgos (lo que el doc pide/se espera y el código no hace)

- **Eventos de seguridad sin auditar:** login, logout, fallos, lockouts, revocaciones no se registran (RF-AUTH-A05). Solo reset de contraseña y cambio de PIN, a mano.
- **`audit_log` no inmutable:** `quivo_app` puede `UPDATE/DELETE` (RF-AUTH-A06), en tensión con RNF-37 "nunca se borra evidencia" y con "cambios críticos siempre auditados".
- **Auditoría no atómica:** el insert corre después de que el handler terminó; si falla, el cliente recibe error pero la acción ya se aplicó (`AUD:64-87`). Si la respuesta no trae `id` y no hay `params.id`, **no se audita** (`AUD:69-72`).
- **Tenant sin RLS:** `asignaciones`, `rutas`, `variantes`, `paradas`, `puntos_control`, `gps_archives`, `mobility_cities`, `demo_requests` y tablas Better-Auth. En rutas/variantes/paradas/puntos el aislamiento depende de que cada método de servicio llame a `asegurarLineaVisible/asegurarRutaVisible` (fallo humano posible); `rls.integration.test.ts` no cubre esas tablas y solo `rutas.service.test.ts:83` prueba el 404 cross-tenant.
- **Tablas con RLS sin test** en `rls.integration.test.ts`: `audit_log`, `sesiones_operativas`, `desafios_auth_movil`, `intentos_auth_movil`, `cumplimientos_pc`, `eventos_operativos`, `sync_errors`, `gps_sesion_resumen`, `historial_estados_vehiculo`.
- **Sesión móvil no se invalida** al desactivar vehículo/conductor ni al vencer la asignación (RF-AUTH-M38); solo rotar PIN o un login nuevo del mismo vehículo/dispositivo cierran sesiones.
- **Access token web no revocable** (≤15 min tras logout/reset, RNF-AUTH-S16). Tokens web en `localStorage` (RNF-AUTH-S17). `session.token` de Better-Auth en claro en DB.
- **Gestión de usuarios admin** (alta/edición/baja), MFA, desactivación de usuario, política de complejidad de contraseña de login (`min(1)`): no encontrados. Recuperación por email descartada explícitamente por falta de proveedor (`AS:206-212`).
- **`operador` sin UI:** la API le permite el CRUD núcleo, pero `nav-items.ts:19-125` no lo incluye en ningún módulo; `RequireAuth` lo redirige a `/` y `/` tampoco le está permitido (`require-auth.tsx:23-26`, `nav-items.ts:19-21`) → posible bucle de redirección/loader (**no verificado en navegador**).
- **Cobertura de tests ausente:** `@Roles` de `AuthController`, `MediaController`, `MobilityPublicationController`, `EnVivoController` en `roles-matrix.test.ts`; throttles de login/refresh (nadie prueba 5/60 ni 20/60); `auth-context.tsx` y el listener `storage`.
- **Web `refresh`/`logout` sin throttle propio** (RNF-AUTH-S08), riesgo declarado en el propio código (`AS:34-42`).
- **Lockout sin decay temporal** y vector de "espera" sobre una placa pública (≤60 s por intento, acotado por 5/60 s/IP); compromiso documentado (`AM:903-906`).

---

## 6. Preguntas para el CTO

1. **Credencial vehículo vs. conductor:** ¿se descarta oficialmente el flujo legado de 2 pasos (PIN de vehículo) y se actualiza §5/§15.3? Hoy está activo por defecto (`MOBILE_LEGACY_AUTH_ENABLED !== 'false'`). ¿El PIN/`credencialHash` del vehículo se elimina del modelo y de la UI de credenciales?
2. **Numeración RF-81..84 y RNF-15/17:** ¿cuál es el enunciado exacto de cada uno? Mi mapeo (81 registrar, 82 usuario/fecha, 83 entidad+diff, 84 consulta; RNF-15 roles, RNF-17 guards) es inferido.
3. **Roles sin permisos:** `supervisor`, `socio`, `pasajero` y `conductor` (web) existen y no pueden hacer nada. ¿Cuáles tienen alcance en MVP/piloto? ¿`supervisor` es solo lectura de reportes/en-vivo? ¿`socio` ve solo sus vehículos?
4. **`operador`:** la API le da el CRUD núcleo pero no reglas/sanciones/rotaciones/reportes, y la web no le da ningún módulo. ¿Es un rol real del piloto o hay que quitarlo de la API/seed?
5. **Granularidad de permisos:** ¿hace falta separar lectura/escritura por rol dentro de un módulo (p. ej. `operador` crea pero no cambia estado de vehículo)? Hoy es todo-o-nada por controller.
6. **Auditoría:** ¿debe registrarse login/logout/fallos/lockouts/revocaciones y los accesos cross-tenant de `admin_quivo`? ¿`audit_log` debe ser inmutable a nivel base (REVOKE + trigger)? ¿`diff` debe ser antes/después en vez del body? ¿"autorizar" es una acción de negocio que falta?
7. **Atomicidad de auditoría:** ¿es aceptable que la acción quede aplicada aunque falle el insert de auditoría (hoy sí), o debe ser transaccional?
8. **Vigencia de la sesión móvil:** ¿debe morir la sesión si el vehículo/conductor se desactiva o la asignación vence? ¿Duración máxima sin re-login (hoy 30 d absolutos)? ¿Debe ser deslizante?
9. **TTLs:** ¿se confirman 15 min access / 7 d refresh web, 15 min access / 30 d refresh móvil, 300 s desafío como requisitos, o son valores de piloto?
10. **Revocación del access token web:** ¿es aceptable la ventana de ≤15 min tras logout/reset, o se requiere consulta de sesión/denylist?
11. **Tokens web en `localStorage`:** ¿aceptable para el piloto o se pasa a cookie `httpOnly`?
12. **Tablas sin RLS** (`asignaciones`, `rutas`, `variantes`, `paradas`, `puntos_control`): ¿se agrega RLS (política con subquery a `lineas`/`rotaciones`) o se mantiene el control a nivel aplicación?
13. **Alta de usuarios administrativos:** ¿cómo se crean `admin_sindicato`/`operador` en producción (hoy solo seed + reset)? ¿Se requiere pantalla/endpoint y recuperación de contraseña sin email?
14. **Lockout:** ¿se acepta que la placa pública permita imponer esperas de hasta 60 s sobre cualquier vehículo y que el contador no decaiga por tiempo?
15. **`/_internal/validate-demo`:** ¿se retira ya?
