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
- **Desvío respecto del plan (implementación de E, 2026-10-13):** "Atender" no deja el ícono de severidad fijo, sino que el marcador pierde la alerta. Causa: el LATERAL de `obtenerPosiciones` solo cuenta `estado='abierta'`. Para cumplir el plan, la API tiene que devolver también las atendidas (por ejemplo `infraccionesAtendidas`) y `map-builders` tiene que mapearlas a `alerta.parpadea=false`. El design system ya lo soporta. Queda como pendiente chico para el PR F.
- **Pendiente en móvil (≤720 px):** con el panel abierto, la hoja inferior (72vh) y el HUD dejan visible solo una franja de unos 24 px del mapa a 390×844. "Ver en mapa" centra el punto en esa franja. Mejora propuesta: que la hoja se pueda plegar a una altura mínima y que "Ver en mapa" la pliegue. No bloquea, porque por ahora designa el admin desde la web.

## Orden
A → E → B → C → D.
- E tiene sentido apenas existe A.
- C requiere el ok del CTO para el bucket.
- D requiere el APK 16 y el changelog.

Cada PR sigue la misma regla: código por un Sonnet; `/code-review`; CI por exit code; merge; borrar la rama; handoff.

## Decisiones posteriores (2026-10-12, tarde)

### Ajustes al PR A (salieron de `/code-review` y del CTO)
- **`rutas.desvioHabilitado`.** El default es `false` y el desvío solo se evalúa en rutas con geometría trazada por GPS (por ejemplo, el circuito Z12). Por ahora se habilita por SQL. Las rutas cargadas desde bocetos de My Maps darían desvíos falsos con el umbral de 100 m: la 120 tiene saltos de hasta 1,3 km entre vértices y la 16 de hasta 580 m.
- **El desvío solo se mide dentro de un recorrido**, entre `inicio_recorrido` y `fin_recorrido`. Al terminar el recorrido se cierra el desvío abierto y la máquina se reinicia.
- **Puntos con fecha futura:** se ignoran si superan `DRIFT_ALERTA_MS`, para que `ultimo_ts` no se congele.
- **Ventana de `pc_omitido`:** el recorrido termina en la referencia y los cumplimientos de un recorrido posterior no cuentan. Hay una tolerancia de 120 s porque inicio y fin usan el reloj del sistema y los cumplimientos el GNSS.
- **`pc_omitido` es solo alerta** (decisión del CTO): no se puede sancionar y la API devuelve 409. La sanción tiene que ser del conductor o del vehículo de la infracción.
- **Atención:** la primera atención no se pisa. Los fallos de detección van al logger, no a `sync_errors`.

### Sanciones reales del sindicato (CTO)
Son compensatorias y se cumplen en la misma línea:
1. Ingresar fuera de horario: una vuelta más.
2. No cumplir el turno: repetirlo al día siguiente.
3. No cumplir las vueltas establecidas: las que faltan se hacen al día siguiente en nocturno. El horario depende de cuántas falten.
4. Alteración de ruta (= desvío): una vuelta más.

Aplicación: el admin confirma y el sistema agenda la asignación compensatoria. El nocturno empieza a las 17:01; si se deben 3 vueltas, se puede empezar desde las 15:00.

### Operación de la Línea 16 (CTO)
- **El ciclo:**
  - Todos salen de Salomón Romero hacia Honduras (el punto "RETORNO LINEA 16").
  - En Honduras, el control designa quién vuelve a Salomón y quién va a Molinos (el ramal Putucu).
  - La vuelta termina en la terminal de llegada. La siguiente sale de ahí, otra vez hacia Honduras.
- **Cupos de vueltas por día:**
  - Lunes a viernes: 4 a Salomón y 1 a Molinos.
  - Sábado: 2 y 1.
  - Domingo: 3 y 1.
- **Salidas de la mañana:** de 7 a 8, con 6 minutos entre una y otra y después 7. Más tarde quedan a criterio del admin.
- **Alternancia de choferes:** 3 días en la 120 (la troncal) y 1 día en la 16. Más adelante se van a cargar otras líneas con el mismo esquema.
- **Carga:** `scripts/cargar-linea-16.ts` (por la API).
  - Una sola ruta `circuito` que cubre toda la red: 215 vértices.
  - Puntos de control: Salomón (0) y Molinos (1), no obligatorios; Honduras (2), obligatorio.
  - Resultado: una vuelta que no pasa por Honduras genera `pc_omitido` y las terminales no generan falsos omitidos.

### Reglas fijas de vueltas de la Línea 16 (el CTO las llama "inamovibles")
- Una vuelta se cuenta solo cuando el circuito vuelve a Salomón Romero (SR→SR).
- Los cupos de SR son fijos: 4 de lunes a viernes, 2 el sábado y 3 el domingo.
- **Todos** los móviles suben a Molinos una vez por día. El control decide cuándo, según la necesidad.
- El CTO quiere que el sistema **sugiera la frecuencia de envíos a Molinos** para tener un estándar. La 16 tiene entre 120 y 130 móviles.
- Cálculo inicial, sin verificar: con 125 móviles en 15 h de servicio sale un envío cada ~7 min, y con 30 min de espera arriba quedan ~4 móviles en cola en Molinos.
- Se ajusta con las horas reales de llegada a Molinos que registre el piloto. Falta que el CTO confirme el horario de servicio.

### PR F (nuevo, después de E): jornada, vueltas y sanciones compensatorias
- **Cupos de vueltas SR→SR** por línea y día de la semana, más la obligación de subir 1 vez por día a Molinos.
- **Sugerencia de envío a Molinos:** el próximo móvil a enviar se elige entre los que todavía no subieron hoy, con un intervalo objetivo configurable.
- **Conteo de vueltas en el servidor:** una vuelta es SR → Honduras → SR, marcada "vía Molinos" si pasó por el PC Molinos (corregido 2026-10-13; antes decía terminal → Honduras → terminal).
- **Detecciones nuevas:**
  - Ingreso fuera de horario: contra `Asignacion.horaPresentacion`/`horaSalida`, con tolerancia configurable.
  - Turno no cumplido.
  - Vueltas faltantes al cierre de la jornada.
- **Sanción compensatoria:** el sistema propone la asignación del día siguiente en la misma línea (nocturno, o desde las 15:00 si se deben 3 o más vueltas) y el admin la confirma.
- **Designación de destino** (pedido del CTO, 2026-10-13; reemplaza el descarte de "asignar parada" del demo, que se hizo sin conocer la designación de Honduras):
  - En `/en-vivo`, el panel del vehículo ofrece "Designar destino: Salomón Romero / Molinos". Se resalta cuando la vuelta llega a Honduras.
  - **Quién designa:** en la operación pueden hacerlo el control de Honduras y la oficina, pero en esta versión **solo el admin del panel web** (`admin_sindicato`/`admin_quivo`).
  - **Sugerencia:** "Sugerido: Molinos" para el vehículo que todavía no subió hoy, según la regla de 1 de cada N llegadas. Decide el admin.
  - **Registro:** cada designación guarda quién, cuándo, la sesión y la vuelta. Así se puede auditar la regla de Molinos 1×/día.
  - **Cuándo:** se puede designar en cualquier momento del viaje mientras el vehículo no haya llegado a Molinos hoy (CTO, 2026-10-17; docs/plan-molinos-cualquier-momento.md). Si ya pasó la bifurcación en el regreso, vale para la próxima vuelta.
  - **Recorrido Molinos (corrección del CTO, 2026-10-13):** Honduras → regreso normal → en el desvío (vértice 43) sube el ramal Putucu → Molinos → baja → **sigue hasta Salomón Romero**. Molinos es una pasada intermedia del regreso y toda vuelta termina en SR. La geometría prod actual (circuito que **termina** en Molinos) no representa esto: hace falta una variante "vía Molinos" = circuito + ida y vuelta por Putucu.
  - **App del chofer (CTO): sí cambia.** Requiere APK nuevo.
    - Aviso visual en pantalla, como el del punto de control.
    - Ruta ajustada: Honduras → Molinos → Salomón Romero.
    - Hoy no hay push hacia el chofer. La app tiene que consultar su designación mientras la sesión está activa (poll o respuesta del sync). Por eso el aviso aparece con la app abierta; en segundo plano no está garantizado.
  - **Verificación:** si la vuelta designada a Molinos llega a SR sin pasar por el PC Molinos, se genera una alerta.
  - **Conteo (CTO):** la vuelta se completa solo al volver a SR, sea directa desde Retorno L16 o vía Molinos.
  - **Espera en Molinos: 30 min (CTO).** El sistema mide la permanencia en el PC Molinos (entrada y salida de la geocerca). **Si sale antes de 30 min: alerta leve** (confirmado por el CTO el 2026-10-13).
  - **Total obligatorio por chofer (CTO, 2026-10-13).** La vuelta vía Molinos es adicional a las directas:
    - Lunes a viernes: 5 = 4 directas + 1 vía Molinos.
    - Sábado: 3 = 2 + 1.
    - Domingo: 4 = 3 + 1.
  - La fórmula de frecuencia de Molinos (N = directas + 1) queda confirmada.
- **Falta definir con el CTO:** la tolerancia de "fuera de horario".

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
