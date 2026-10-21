> **Estado: aprobado por el CTO el 20/10/2026. Sin implementar.** Se desarrolla en ramas; los merges esperan a después del día D (24/10) para no romper el congelamiento.

# Plan — Fila de salida con frecuencias en Salomón Romero (línea 16)

## Contexto

Hoy los trufis de la L16 salen de Salomón Romero (SR) "en orden de llegada, cada 6 min de 7 a 8, después 7, después a
criterio" (dato del CTO, memoria de operación), y eso lo controla una persona a mano. El CTO quiere automatizarlo:

- al llegar a SR, cada chofer queda en la fila por orden de llegada;
- ve su posición, el trufi de adelante, la espera total y su hora de salida;
- recibe un aviso 1 minuto antes;
- un botón con cuenta regresiva se habilita en su turno;
- el panel fija las frecuencias para todos, por grupo o por trufi, con franjas horarias opcionales ("de 7 a 8 cada 10").

Una frecuencia aplicada vale el resto del día, hasta que se cambie.

**No existe nada de esto en el código.** `docs/plan-cola-terminales.md` (septiembre, aparcado) es una propuesta vieja.
Su defecto queda corregido acá: el ancla de la hora de salida es la última salida real, nunca `now()`.

**Decisiones del CTO (20/10):**
- La frecuencia de un trufi o grupo es la espera **después de que sale el de adelante**. Hay una sola fila.
- Cada parada tiene una **frecuencia base**. Las reglas del día valen hasta medianoche y al otro día vuelve la base.
- **Se bloquea el botón SALIR, no COMENZAR RUTA.** El GPS arranca como hoy. Salir antes queda registrado como salida
  anticipada.
- **Admin y control (rol `operador`)** manejan la fila y las frecuencias. Los grupos de trufis los arma solo el admin.

## Correcciones a la idea original (sin complacencia)

1. **COMENZAR RUTA se toca una vez por día, no una por vuelta.** Las vueltas abren y cierran solas al pasar por SR
   (`ingesta-worker/vueltas.ts`). Una cuenta regresiva en ese botón solo serviría para la 1.ª salida. Por eso la
   cuenta va en un botón **SALIR** nuevo, dentro de la tarjeta de la fila, en el mismo lugar del sheet.
2. **Bloquear el arranque del GPS es contraproducente.** Un chofer apurado sale sin tocar el botón y perdemos el GPS
   de esa vuelta. Con el GPS siempre activo, salir antes queda detectado.
3. **El aviso de "falta 1 minuto" con la pantalla apagada no está garantizado.** Hoy la app solo despierta por eventos
   del GPS, cada 60 s con el trufi quieto. Se programa una notificación local con `expo-notifications`, que ya está
   instalado. Hay que probar en los teléfonos si Android la entrega a tiempo. Con la app abierta (`useKeepAwake`) sí
   es exacto.
4. **El reloj del teléfono no es confiable.** Hoy la app no corrige el desfase. La respuesta trae la hora del
   servidor y la app calcula la cuenta regresiva con ese desfase. El servidor valida igual al tocar SALIR.
5. **No entra antes del sábado 24.** El congelamiento empieza el jueves. Va después de D, con piloto de pasantes.

## Flujo del chofer

1. **EMPEZAR DÍA**: igual que hoy (`inicio_jornada`).
2. **COMENZAR RUTA**: igual que hoy, arranca el GPS. Se toca en la parada o llegando.
3. **Entrada a la fila, automática.** La app detecta que está dentro de la zona de SR, que es el PC `rol='terminal'`
   con su `radioToleranciaM` de 150 m. Entonces manda `POST /mobile/fila/llegada` con posición, precisión y hora del
   fix.
   - El servidor valida la distancia con `ST_DWithin`.
   - La llegada se registra con la hora del servidor, para que nadie se adelante cambiando el reloj del teléfono.
   - Si la detección falla, hay un botón de respaldo: "Estoy en la fila".
   - Sin conexión, no hay fila: la llegada cuenta recién cuando entra el request.
4. **Tarjeta de la fila** (ver Móvil): posición, placa de adelante, espera total, hora de salida y SALIR con cuenta
   regresiva.
5. **Aviso T−1 min:** en pantalla, con sonido, vibración y voz, más la notificación programada.
6. **Turno:** SALIR se habilita.
   - Tocar SALIR registra `salidaTs` y libera la fila.
   - Si se va sin tocarlo, la app detecta la salida de la zona (radio × 1,5 en 2 fixes, el mismo criterio de re-armado
     de `geofence.ts`) y la registra como salida por geocerca.
   - Como respaldo en el servidor, el worker da por salido a un trufi en fila apenas cumple otro PC de la ruta.
   - Si sale antes de su hora, la fila guarda `anticipada=true` y el panel la marca.
7. **Vuelta y regreso a SR:** vuelve a entrar a la fila solo (paso 3).
8. **FINALIZAR RUTA o cerrar sesión:** sale de la fila con estado `retirado`.

El conteo de vueltas no cambia: abrir y cerrar sigue en el worker, sin tocar.

## Reglas de cálculo (función pura en `packages/shared`, con tests)

- **Orden:** por `ordenTs`. Arranca igual a `llegadaTs`; "mover al final" lo pone en `now()`.
- **Frecuencia del trufi v en el instante t:** se busca en este orden:
  1. regla del día por **trufi**;
  2. regla por **grupo** del trufi;
  3. regla para **todos**;
  4. **base** de la parada.

  Dentro de un mismo nivel, una regla con franja que contiene t le gana a una sin franja, y entre iguales gana la más
  reciente. Una regla sin franja vale desde que se crea hasta medianoche. Las reglas anuladas no cuentan.
- **Hora de salida del 1.º:** `ETA₁ = max(últimaSalidaReal + f(v₁, últimaSalidaReal), llegada₁)`. Si en el día no
  hubo ninguna salida, `ETA₁ = llegada₁`.
- **Del 2.º en adelante:** `ETAₚ = max(ETAₚ₋₁, ahora si el 1.º está demorado) + f(vₚ, ETAₚ₋₁)`. `ahora` solo corre la
  estimación de los de atrás para mostrarla. No hay despacho automático, así que nunca puede pasar lo de la cola
  "congelada" del plan viejo.
- **Habilitado:** solo el 1.º y solo cuando `ahora ≥ ETA₁`. Si está demorado más de X minutos, el control decide
  (despachar, mover al final o retirar). No hay sanción automática en v1.
- **Espera total:** `ETA_mía − ahora`. Trufis delante: `posición − 1`.

## Modelo de datos (una migración, SQL manual con RLS como `20261013140000_vueltas_molinos`)

| Tabla / columna | Qué |
|---|---|
| `puntos_control.frecuenciaSalidaMin` int null | Base de la parada. CHECK: solo con `rol='terminal'`, entre 1 y 120. |
| `grupos_vehiculo` (id, sindicatoId, nombre, estado) + `grupo_vehiculo_miembros` (grupoId, vehiculoId, PK compuesta) | Grupos de trufis. **Un trufi pertenece a un solo grupo**: unique en `vehiculoId`, para que la precedencia no sea ambigua. |
| `frecuencia_reglas` | Columnas: id, sindicatoId, puntoControlId, fecha (día de Bolivia), alcance (`todos`/`grupo`/`vehiculo`), grupoId?, vehiculoId?, minutos, desdeMin?, hastaMin? (minuto del día local), creadaPor, creadaEn, anuladaEn?, anuladaPor?. CHECK de coherencia alcance/ids y desde < hasta. Se anula, nunca se borra (auditoría). |
| `fila_salida` | Columnas: id, sindicatoId, puntoControlId, fecha, sesionId, vehiculoId, llegadaTs, ordenTs, salidaTs?, salidaOrigen (`boton`/`geocerca`/`deteccion`/`panel`)?, anticipada bool, estado (`en_fila`/`salio`/`retirado`). Unique parcial `(vehiculoId) WHERE estado='en_fila'` (idempotencia de la llegada). Índice `(puntoControlId, fecha, estado, ordenTs)`. |

`puntos_control` no tiene RLS propio: se accede siempre con el filtro de línea y sindicato, como en el worker. Las
tablas nuevas sí llevan `tenant_isolation`.

## API (`apps/api/src/modules/salidas/`, módulo nuevo)

Archivos de menos de 400 líneas cada uno, por el trinquete de la Fase 3:
- `salidas.logic.ts`: armado de datos para la función pura de shared.
- `fila.service.ts`: llegada, salida, acciones y estado.
- `frecuencias.service.ts`: reglas y base.
- `grupos.service.ts`.
- `salidas-movil.controller.ts` y `salidas-panel.controller.ts`.
- Tests.

Endpoints:
- **Móvil** (`AuthMovilGuard`, `@LimitePorDispositivo`):
  - `POST /mobile/fila/llegada` con `{lat, lng, accuracy, tsFix}`. Valida zona y jornada activa. Es idempotente
    (`ON CONFLICT DO NOTHING`).
  - `POST /mobile/fila/salida` con `{origen}`. Hace un `UPDATE ... WHERE estado='en_fila'` condicional y calcula
    `anticipada`.
- **El estado de la fila viaja en `GET /mobile/vuelta-actual`** como campo `fila`, sin endpoint nuevo:
  - trae posición, placa de adelante, ETA, espera, si está habilitado y `servidorTs`;
  - reusa el polling de 20 s, el caché SQLite y la consulta desde el headless;
  - lo inyecta `VueltasMovilController`, componiendo `FilaService`, sin agrandar `vueltas.service.ts`;
  - el schema crece con un campo opcional, así que las apps viejas lo ignoran.
- **Panel** (`@Roles('admin_quivo','admin_sindicato','operador')`, `@Auditable`):
  - `GET /salidas/:puntoControlId/fila`;
  - `POST .../fila/:id/despachar`, `.../mover-al-final`, `.../retirar`;
  - `GET/POST /salidas/:puntoControlId/reglas`, `DELETE .../reglas/:id` (anula);
  - `PUT /salidas/:puntoControlId/base`;
  - CRUD de `/grupos-vehiculo`, solo admin (`operador` recibe 403).
- **Worker de ingesta**, como backstop, en la misma transacción y con el advisory lock de la sesión que ya usa
  `procesarVueltas`:
  - si una sesión con `en_fila` cumple un PC que no es la terminal, queda `salio` con origen `deteccion`;
  - con `fin_recorrido`, queda `retirado`.
- Con el logout, `retirado`. Va en el mismo lugar donde el trigger cierra la vuelta, o en el servicio de logout.

## Panel web (`apps/web/app/(dashboard)/salidas/`)

- `page.tsx`, `use-salidas.ts` (TanStack Query, poll de 5 s) y `lib/api/salidas.ts`.
- Tres bloques:
  1. **Fila en vivo:** posición, placa, llegada, hora estimada, estado (demorado o anticipada) y acciones.
  2. **Frecuencias de hoy:** la base, las reglas vigentes, un formulario con alcance, minutos y franja opcional, y
     anular.
  3. **Grupos:** solo admin.
- Formularios con el patrón de la casa: `useState` + `safeParse` del schema de shared.
- La entrada va en `nav-items.ts` con los 3 roles.

## Móvil (OTA; no necesita APK si se verifica el punto 3)

Mismo patrón que Vecinos y Molinos:
- `features/fila-salida/fila-salida-core.ts` (puro, con tests): desfase de reloj, cuenta regresiva, cuándo avisar,
  cuándo habilitar y textos.
- `use-fila-salida.ts`: lee el campo `fila` del caché de vuelta-actual, sin polling propio, y programa o cancela la
  notificación T−1.
- `fila-salida-card.tsx`: tarjeta en el sheet, con SALIR deshabilitado y la cuenta, que se habilita en el turno.
- `shared/api/fila-api.ts`: llegada y salida, con reintentos como el acuse de Molinos.
- **Detección de entrada y salida de la zona:** helper puro junto a `geofence.ts` (radio del PC terminal; salida con
  radio × 1,5 en 2 fixes), llamado desde los mismos callbacks de ubicación foreground y headless que usan vuelta-actual.
- **Aviso:** `anunciarAvisoEnCanal` (`anuncio-punto-control.ts`) para el aviso en pantalla, más
  `Notifications.scheduleNotificationAsync` con trigger de fecha para cuando la pantalla esté apagada.
- **Verificar antes de prometer:** que `expo-notifications ~0.32.17` acepte un trigger de fecha sin permiso de alarma
  exacta, y qué tanto la atrasa Android en Doze. Si exige `SCHEDULE_EXACT_ALARM`, hace falta APK y se decide aparte.

## Escalabilidad (30 hoy, 125 de la L16)

- Escrituras: unas 125 × 5 llegadas y salidas por día. Es despreciable.
- Lecturas: el campo `fila` va en el poll que ya existe, cada 20 s. Suma 2 consultas chicas por request (fila del día
  y reglas del día) y el cálculo es O(n), con n ≤ 125.
- Panel: 1 request cada 5 s por pantalla.
- Sin caché en v1:
  `shortcut: fila calculada en cada request, agregar CacheTtl por puntoControl si el p95 de vuelta-actual pasa 150 ms`.
- La concurrencia de llegadas la resuelven el unique parcial y la hora del servidor. La de despachos, el `UPDATE`
  condicional.

## Entrega (cada punto es un PR: Sonnet implementa, el chairman revisa)

Gates en cada PR:
- `tsc`, tests, `ci` + `acceptance`;
- `/code-review` + `/ponytail-review`;
- `/security-review` en los PR 1 y 2, porque traen endpoints nuevos, RLS y roles;
- Codex: no verificado (sin cuota).

1. **Shared + DB:** migración, schemas, `resolverFrecuencia` y `calcularFilaSalida` puros, con casos: franja, cambio
   a mitad del día, demorado, sin salidas previas, grupo contra trufi, medianoche. Test RLS cross-tenant.
2. **API:** módulo `salidas`, campo `fila` en vuelta-actual, backstop del worker. Tests de integración contra la DB:
   llegada doble, dos llegadas simultáneas, salida anticipada, roles (`operador` sin grupos).
3. **Panel `/salidas`.**
4. **Móvil:** tarjeta, detección, aviso y desfase de reloj. OTA verificando el bundle (memoria
   `ota-verificar-bundle-antes-de-publicar`).
5. **Piloto con pasantes** en SR, después del día D, antes de abrirlo a la L16.

Estimación, no medida: 1,5 a 2 semanas con revisiones y prueba en la calle.

## Archivos críticos a reusar

- `packages/shared/src/tiempo/jornada.ts`: `fechaActualBolivia`, `horaEnBolivia`.
- `packages/db/src/tenant-context.ts`: `withTenantContext`.
- `common/audit` (`@Auditable`).
- `ingesta-worker.service.ts` / `deteccion-vueltas.ts`: lock y transacción por sesión.
- `vueltas-movil.controller.ts` y `vueltas.service.ts:leerActualMovil` (respuesta de vuelta-actual).
- `VueltaActualMovilSchema` en `packages/shared/src/entities/vuelta.ts`.
- Móvil:
  - `vuelta-actual-oportunista.ts` y `db/vuelta-actual-local.ts` (canal y caché);
  - `anuncio-punto-control.ts` (aviso);
  - `geofence.ts` (criterio de zona);
  - `next-control-sheet.tsx` (dónde va la tarjeta);
  - `features/vecinos-ruta/` (patrón de carpeta).
- Web: `lib/en-vivo/use-en-vivo.ts` (poll) y `nav-items.ts`.

## Verificación

- Tests puros de shared y del core móvil (cuenta regresiva, desfase y aviso) e integración de la API contra la DB.
- Prueba de punta a punta en el entorno efímero (`carga-efimera.sh`):
  - 5 choferes sintéticos llegan a SR con 10 s de diferencia;
  - regla de "todos cada 2 min" y otra de "trufi X cada 4";
  - se verifican las ETA, la habilitación, una salida anticipada y el backstop del worker.
- En la calle, con pasantes:
  - posición y espera correctas contra un reloj real;
  - aviso T−1 con la pantalla prendida y con la pantalla apagada, medido en segundos de atraso;
  - entrada automática a la fila al volver de una vuelta.
- En el panel: crear regla, anular, mover al final, despachar. `operador` puede todo eso salvo los grupos.

## Fuera de alcance de v1 (decidir después)

- Infracción `salida_anticipada` o "fuera de horario" generada automáticamente: hoy solo queda la marca en la fila.
- Plantilla semanal de frecuencias.
- Push remoto (FCM): no existe y necesitaría APK y backend nuevos.
- Otras terminales y la L120: el modelo ya es por punto de control, así que solo hace falta cargarle la base.
