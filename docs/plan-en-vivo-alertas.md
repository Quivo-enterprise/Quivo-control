# Plan — /en-vivo: fotos, alertas por infracción y acciones rápidas (2026-10-12)

## Contexto
El CTO armó un demo en `~/Downloads/Quivo-control` (rama `mock/sandbox`, flag `NEXT_PUBLIC_MOCK_FLOTA`). Ahí, en `/en-vivo`:
- Los marcadores son fotos del trufi.
- Parpadean en 3 niveles según la infracción activa.
- El click abre una ficha con acciones: WhatsApp, sancionar, asignar parada.

Quiere esto en el producto real, mejorado y sobre Google Maps.

**Premisa corregida (verificado por exploración): el demo es 100 % mock.** En el sistema real no existe:
- **Detección de infracciones.** Sanciones y reglas son manuales. El servidor nunca declara un PC omitido; el "omitido" del móvil es solo UI y no se sincroniza.
- **Foto de vehículo.** No hay campo, no hay subida en la app y no hay cámara ni image-picker instalados.
- **Teléfono del conductor.**
- **Bucket.** Hay 0 buckets GCS.

**Bug colateral (verificado leyendo el código):** `media.service.ts` guarda los logos de línea en el disco del contenedor de Cloud Run. Ese disco es efímero y la API corre hasta en 3 instancias. Consecuencia: los logos se pierden en cada deploy y una instancia puede no tener el archivo de otra. El impacto en prod está **no verificado**. Se corrige en el PR C.

### Decisiones del CTO (2026-10-12)
- Infracciones automáticas: **desvío de ruta y PC omitido**, por ahora.
- Niveles: **leve / grave / gravísima**, la `gravedad` existente de las Reglas.
- Foto **del vehículo**: la sube el conductor desde la app y el admin la ve en el panel.
- Contacto: **WhatsApp + Llamar**, con un teléfono nuevo en Conductor.
- Sanción **sin plazo**: se usa el flujo de sanciones existente.

### Qué se descarta del demo, y por qué
- **"Asignar siguiente parada":** el concepto no existe en el dominio real y no hay caso de uso operativo.
- **Plazo de la sanción:** el CTO lo descartó.
- **Placa oculta en el marcador:** el operador identifica por placa, así que se mantiene el chip de placa.
- **Panel de simulación:** era solo para el demo.

## Mejoras sobre el demo
- **Parpadeo solo si la infracción está `abierta`.** Al pulsar "Atender" deja de parpadear, pero el ícono de severidad queda fijo. En el demo todo parpadeaba hasta sancionar, lo que provoca fatiga de alarmas.
- **El nivel del marcador es el máximo de las infracciones abiertas.** Si hay varias, el ícono muestra el número.
- **Frecuencias de parpadeo:** leve 1600 ms, grave 1000 ms y gravísima 600 ms. Todas quedan por debajo de 3 Hz (WCAG 2.3.1).
  - Hay una señal que no depende del color: el ícono de severidad.
  - Con `prefers-reduced-motion`, el anillo queda fijo en el color de la severidad.
  - El `aria-label` incluye la infracción.
- **HUD con contadores por nivel.** Ejemplo: "1 gravísima · 2 graves · 3 leves". Cada contador es un filtro "solo con alertas".
- **Botón "Siguiente alerta".** Recorre los vehículos con infracciones abiertas, de la más grave a la menos, y es usable con teclado.
- **Un solo panel de vehículo**, que reemplaza el drawer de telemetría actual (no se agrega un segundo panel).
  - **Cabecera:** foto, placa, chip de línea, conductor, frescura y velocidad en km/h (`speed` ya llega en el poll y hoy no se muestra).
  - **Acciones rápidas** (botón con ícono y texto):
    - Seguir.
    - WhatsApp: `wa.me` con un mensaje prellenado con placa, línea y la infracción abierta, si hay.
    - Llamar: `tel:`. El número también se muestra y se puede copiar, porque en escritorio `tel:` no hace nada.
    - Ver recorrido: va a `/reportes/recorridos/[id]`.
    - Si no hay teléfono, los botones de contacto se ocultan y aparece el texto "Sin teléfono · Agregar", con enlace a conductores.
  - **Infracciones de la sesión.** Cada una muestra el tipo, la hora, la duración y el detalle, por ejemplo "a 180 m de la ruta" o "PC 3 omitido". Acciones de cada una:
    - "Ver en mapa": centra en el lugar de la infracción.
    - **Atender.**
    - **Descartar**, con motivo.
    - **Sancionar**: abre `NuevaSancionModal` prellenado con la regla por tipo, el sujeto conductor, el motivo autogenerado, la `fechaHecho` y la `evidenciaRef` (ids de la infracción y del recorrido). Al crear la sanción, la infracción queda `sancionada`.
  - Puntos de control y estadísticas pasan a una sección plegable.

## PR A — `feat(api)`: modelo y detección de infracciones
- **Tabla nueva `infracciones`** (migración + RLS `tenant_isolation`, ENABLE+FORCE).
  - Columnas: `id, "sindicatoId", sesion_id, vehiculo_id, conductor_id, linea_id, tipo ('desvio_ruta'|'pc_omitido'), gravedad (leve|grave|gravisima), regla_id NULL, estado ('abierta'|'atendida'|'sancionada'|'descartada'), inicio_ts, fin_ts NULL, lat, lng, detalle jsonb, sancion_id NULL, atendida_por, atendida_en, nota, dedupe_key UNIQUE`.
  - Índice `(sesion_id, estado)`.
- **Gravedad configurable sin UI nueva.**
  - Si el sindicato tiene una Regla activa con `tipo='desvio_ruta'` o `tipo='pc_omitido'`, se usan su `gravedad` y su `regla_id`.
  - Si no, se usan defaults: desvío → `grave`, PC omitido → `leve`.
  - Estos tipos reservados se agregan como sugerencias en `/reglas`.
- **Desvío**, en el worker, después de `insertarGpsPoints`, en `ingesta-worker.service.ts`:
  - Por cada sesión del lote, una sola consulta SQL calcula `ST_Distance(punto, rutas.geometria)` para los puntos nuevos con `accuracy ≤ 30 m`. La ruta se obtiene por `sesion → asignacion → ruta`.
  - Máquina de estados en la tabla `sesion_desvio_estado` (`sesion_id` PK, `fuera_desde_ts`, `puntos_fuera`, `ultimo_ts`, `infraccion_id`).
  - Se abre cuando hay **≥ 3 puntos consecutivos a más de 100 m durante ≥ 45 s**. Los 100 m reusan `RUTA_PROXIMIDAD_TOLERANCIA_METROS`.
  - Se cierra (`fin_ts`) con 2 puntos a menos de 60 m (histéresis). Cerrar no cambia el estado de atención.
  - Los puntos con `ts ≤ ultimo_ts` (tardíos del outbox) no mueven la máquina. Es una limitación documentada.
  - `detalle` guarda `distanciaMaxM`, `duracionS` y `puntos`.
  - **A verificar al implementar:** si una asignación puede usar una variante autorizada. Si puede, el desvío se mide contra la variante y no contra la ruta base, para evitar falsos positivos.
- **PC omitido**, en `procesarCumplimientoEnTx` y en el procesamiento de `fin_recorrido`:
  - La ventana es el recorrido actual: desde el último `inicio_recorrido` de la sesión.
  - **En vivo:** cuando llega un cumplimiento `cumplido` del PC de orden k, cada PC `obligatorio` y activo de esa ruta con orden < k que no tenga cumplimiento en la ventana pasa a omitido.
  - **Al `fin_recorrido`:** los PC obligatorios restantes sin cumplir pasan a omitido.
  - Dedupe: `pc_omitido:{sesion}:{pc}:{inicioRecorridoTs}`.
  - El descarte manual cubre el caso de un geofence que falló aunque el conductor pasó.
- **Posiciones en vivo** (`en-vivo.service.ts` `obtenerPosiciones`):
  - Se agrega un `LEFT JOIN LATERAL` que agrega las infracciones abiertas por sesión y devuelve `infraccionNivel` y `infraccionesAbiertas`.
  - También devuelve `vehiculoId` y `conductorId`.
  - Se actualiza el zod `PosicionEnVivo` en `packages/shared/src/entities/en-vivo.ts`.
- **Endpoints** (roles `admin_quivo`/`admin_sindicato`, `@Auditable` en las escrituras, `withTenantContext`):
  - `GET /reportes/en-vivo/:sesionId/infracciones`.
  - `PATCH /infracciones/:id` con `{accion:'atender'|'descartar', nota?}`.
  - `POST /infracciones/:id/sancionar`: crea la Sanción reusando `SancionesService.crear` y vincula `sancion_id` en la misma transacción.
- **Tests:**
  - Máquina de desvío como función pura: umbral, histéresis, puntos tardíos, ruido de `accuracy`.
  - Reglas de PC omitido.
  - Test de RLS para la tabla nueva, siguiendo el patrón de los tests existentes.
- **Gates:** `/code-review` + `/security-review` (endpoints nuevos, RLS).

## PR B — `feat(api,web)`: teléfono del conductor
- `Conductor.telefono String?`. Validación zod de móvil boliviano (`+591` y 8 dígitos que empiezan con 6 o 7), normalizado a E.164.
- Formulario y columna en `apps/web/app/(dashboard)/conductores/page.tsx` (patrón `EntityFieldConfig`).
- `ContextoEnVivo.conductor` gana `telefono`. Solo se expone en endpoints de admin; nunca en el poll de 2 s ni en APIs públicas.
- **Gates:** `/code-review` + `/security-review` (PII).

## PR C — `feat(api,infra)`: almacenamiento GCS y foto del vehículo
- **Infra.** El chairman muestra el comando y el CTO confirma antes de correrlo, porque implica facturación.
  - Bucket `quivo-control-prod-media` en `southamerica-west1` o en la región del proyecto (verificar), con acceso uniforme.
  - `roles/storage.legacyObjectReader` para allUsers: permite GET sin poder listar.
  - Escritura con la service account de la API.
  - Los objetos se nombran con UUID no adivinable.
  - Decisión: las fotos de trufis no son sensibles, porque son vehículos públicos con placa visible. Se descartan las URLs firmadas, que además romperían la caché del poll.
- **`StorageService` compartido** (`@google-cloud/storage`, versión exacta con ≥ 2 semanas). `media.service.ts` (logos) migra a GCS, lo que corrige el bug del disco efímero. Antes de cerrar hay que revisar si hay logos en prod que se perdieron.
- **Modelo:** `Vehiculo.fotoUrl String?`, `fotoActualizadaEn DateTime?`, `fotoSubidaPor` (conductorId).
- **Endpoints:**
  - `POST /mobile/vehiculo/foto` (`AuthMovilGuard`): JSON base64, ≤ 2 MB, firma JPEG/WebP verificada como en `media.service.ts`. El vehículo es el de la sesión móvil y nunca un id enviado por el cliente.
  - `DELETE /vehiculos/:id/foto` (admin).
  - `fotoUrl` se agrega a `PosicionEnVivo` y a la respuesta de vehículos.
- **Web `/vehiculos`:** miniatura en la tabla, foto en `vehicle-details-modal.tsx` con "Quitar foto" y la fecha y el conductor que la subió.
- **Gates:** `/code-review` + `/security-review` (subida de archivos, bucket público).

## PR D — `feat(mobile)`: el conductor sube la foto (APK 16)
- `expo-image-picker` (cámara) + `expo-image-manipulator`, en la versión compatible con SDK 54. Recorte cuadrado a 512 px, JPEG ~0.7.
- **Dónde:**
  - En la pantalla `Perfil`, la sección "Foto del vehículo": muestra la actual y permite "Tomar foto" o "Reemplazar".
  - Si el vehículo no tiene foto, un aviso no bloqueante en la pantalla de operación.
- **Subida:** directa con reintento, sin pasar por el outbox, porque es binario y poco frecuente. Si no hay red, se muestra "Se enviará al reconectar" y se reintenta.
- Permiso de cámara con texto en español en `app.config.ts`.
- **Antes del build:** pasar el changelog al CTO.

## PR E — `feat(design-system,web)`: marcador con foto, alertas y panel de acciones
- **`MapPoint`** (`packages/design-system/src/types.ts`): agrega `fotoUrl?`, `colorLinea?`, `alerta?: {nivel:'leve'|'grave'|'gravisima', abiertas:number, parpadea:boolean}`.
- **`crearElementoVehiculo`** (`route-map-google.tsx`):
  - Con foto: círculo de 44 px, `img` con `loading="lazy" decoding="async"` y `onerror`. Si falla la carga, vuelve al sprite actual.
  - Anillo del color de la línea, con un borde exterior oscuro de 1 px para el contraste del blanco.
  - Frescura: `perdido` en gris con opacidad 0.6, `finalizado` en gris, `detenido` con un mini ícono de reloj.
  - Se mantiene el chip de placa.
  - Alerta: ícono de severidad (lucide via iconify) más el número, y la clase `qv-gmap-veh--alerta-{nivel}` con keyframes de anillo línea↔severidad.
  - `zIndex`: seleccionado > gravísima > grave > leve > resto.
  - `firmaPunto` incluye la foto y la alerta, para que el contenido se recree solo cuando cambian.
- **CSS** en `packages/design-system/src/styles.css`:
  - Tokens `--qv-alerta-leve/grave/gravisima` para claro y oscuro.
  - Reduced motion: anillo estático.
  - Área táctil de ≥ 44 px (ya existe vía `::after`).
- **Web `/en-vivo`:**
  - `map-builders.ts` mapea `infraccionNivel`, `fotoUrl` y el color de la línea.
  - `page.tsx` recibe la leyenda, los contadores/filtro, "Siguiente alerta" y el panel unificado con acciones rápidas e infracciones.
  - Hook nuevo `useInfraccionesSesion` en `use-en-vivo.ts`, que se refresca con el poll de la sesión.
  - Mutaciones con `invalidateQueries` sobre posiciones.
  - Toasts en `aria-live` (patrón `qv-live-toast`).
- **`NuevaSancionModal`:** agrega la prop `valoresIniciales?` y un callback que llama a `POST /infracciones/:id/sancionar`. El flujo de `/reglas` no cambia.
- **UI:** es un componente puntual con dirección ya elegida por el CTO en el demo, así que va por camino único sin bake-off (regla 7.c): `impeccable` + iconify, y gate con `web-design-guidelines` + `/code-review`.
- **Si la foto, el teléfono o las infracciones todavía no existen, todo degrada:** sprite actual, sin botones de contacto y sin alerta. Por eso E puede mergearse después de A, sin esperar a C y D.

## Orden
A → E → B → C → D.
- E tiene sentido apenas existe A.
- C requiere el ok del CTO para el bucket.
- D requiere el APK 16 y el changelog.

Cada PR sigue la misma regla: código por un Sonnet; `/code-review`; CI por exit code; merge; borrar la rama; handoff.

## Fuera de alcance
- Notificar al conductor sobre la infracción (no hay push hacia el conductor).
- Exceso de velocidad.
- Plazo de sanción.
- Vehículo adelante/atrás (existe `vecinos-ruta.service.ts`; candidato posterior).
- Umbrales de desvío configurables por línea: por ahora son constantes en `packages/shared`.

## Verificación
- **A:**
  - vitest de la máquina de desvío y del PC omitido.
  - Test de integración del worker con lotes sintéticos: ida dentro de la ruta, salida de 150 m durante 60 s, regreso. Se espera 1 infracción con `fin_ts`.
  - Test de RLS: otro sindicato no ve la infracción.
  - SQL de solo lectura en local con el seed.
  - CI con `ci` + `acceptance`.
- **B/C:**
  - tsc, tests y `/security-review`.
  - Subida real a un bucket con el emulador o con el bucket real, después del ok del CTO.
  - Los logos sobreviven un redeploy.
- **D:**
  - Expo Go / MCP `mobile`: tomar la foto, subirla, ver la foto en el panel de vehículos.
  - En el APK 16, el CTO prueba en un teléfono real.
- **E:** Playwright con la API mockeada (patrón `scratchpad/ev.mjs`).
  - Marcadores con foto y con fallback por `onerror`.
  - Los 3 niveles parpadean con el período correcto (se lee `getComputedStyle`).
  - Reduced motion lo deja estático.
  - Contadores y filtro.
  - "Siguiente alerta" funciona con teclado.
  - Panel: WhatsApp (`href` correcto), tel, copiar, Atender (deja de parpadear), Descartar, y Sancionar prellenado → `POST`.
  - Modo claro y oscuro, móvil a 390 px.
  - Regresiones: `/en-vivo` mantiene 850 px de altura y el zoom.
  - `web-design-guidelines`.
- Al aprobar: volcar a `docs/plan-en-vivo-alertas.md` con puntero en el handoff, y mergear el PR #141 (docs, CI verde).
