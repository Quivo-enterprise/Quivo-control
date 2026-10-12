# Plan — /en-vivo: zoom, latencia y Google Maps en el panel web (2026-10-12)

## Context
El CTO miró /en-vivo desde el teléfono mientras manejaba con la app. Encontró tres problemas:
- (a) La web iba varios metros atrás de la app.
- (b) Al hacer zoom, el siguiente movimiento lo quitaba.
- (c) La web tiene que usar Google Maps.

**Premisa corregida:** el panel no usa Leaflet. Usa **MapLibre GL** (`packages/design-system/src/ui/route-map-impl.tsx`, 1648 líneas, tiles OpenFreeMap). Quedan solo reglas CSS `.leaflet-*` muertas en `apps/web/app/globals.css:1089-1119,1414-1453`.

### Causas raíz (exploración + lectura puntual)
- **(b) Zoom (confirmado leyendo el código).** `page.tsx:251-271` no pasa `fitMode`. El comentario de `:257` dice `'once'`, pero en la práctica se usa el default `'auto'`. En `route-map-impl.tsx:1587-1592`, el efecto `'auto'` llama a `fitBounds` cada vez que cambia `boundsSignature`, que incluye los markers de todos los vehículos. Como el poll trae posiciones nuevas cada 5 s, el encuadre se recalcula y se pierde el zoom del usuario.
  - Secundario: `page.tsx:175-246` hace `return` anticipado en loading, error y flota vacía. Eso desmonta el mapa y lo recrea con el zoom por defecto.
- **(a) Latencia.** Con la app viva son entre ~5 y 15 s. Términos:
  - Captura con `distanceFilter: 15` m: 2-4 s.
  - **Drenado del outbox con piso de 10 s** (`PISO_ENTRE_INTENTOS_DRENAJE_MS`, `apps/mobile/.../outbox.ts:1244`), que además espera al siguiente fix: 0-10 s.
  - Ingesta BullMQ: unos 1-2 s.
  - Poll web `refetchInterval: 5_000` (`apps/web/src/lib/en-vivo/use-en-vivo.ts:63`): 0-5 s.
  - La animación del vehículo seleccionado reparte `intervalMs` entre los puntos nuevos, lo que suma un retraso igual al intervalo. Los demás vehículos saltan de golpe.
  - Límite físico: la app mueve el vehículo con GPS local a 1 Hz, sin red, y ese canal nunca se sube. **La web nunca va a igualar a la app.** El objetivo es unos 3-6 s.
- **(c) Google Maps.** No existe en la web: no hay paquete ni env. `RouteMap` lo usan:
  - `/en-vivo` (+`panel-frescura.tsx`)
  - `reportes/recorridos/[id]`
  - `rutas` (editor)
  - `reglas/regla-preview.tsx`
  - `vehiculos/vehicle-form-panel.tsx`
  - `lineas/line-form-panel.tsx`
  - `apps/landing/.../FleetPanelPreview.tsx`

### Decisiones del CTO (2026-10-12)
- Google Maps en **todo el panel, por fases**: primero /en-vivo y al final se borra MapLibre (un solo motor, alineado con ADR 0004).
- Latencia: **ajustar polling**, sin SSE.
- API key y Map ID: **los crea el chairman con gcloud**, mostrando el comando al CTO antes de correrlo.

## Reglas de proceso
- El chairman (Opus) diseña inline. Todo el código lo escriben subagentes `general-purpose` con `model: "sonnet"`, un PR por bloque.
- UI: es un cambio de motor y componentes, no una dirección visual nueva. Va por camino único (`impeccable`) para los markers y controles. Se verifica con Playwright y puppeteer.
- Cada PR pasa `/code-review`. Los `fix:` pasan además `/codex-debug verify-fix`. Después: CI, merge, borrar la rama y actualizar `docs/handoff.md`.
- Al aprobar el plan: volcarlo a `docs/plan-en-vivo-google.md` con un puntero en el handoff.
- La parte móvil exige el APK 15. Antes del build se pasa el changelog al CTO.

## PR 1 — `fix(web)`: /en-vivo respeta el zoom del usuario
- `page.tsx`: pasar `fitMode="once"`. El encuadre solo ocurre al montar y con "Reencuadrar" (`fitKeyOverride`). `followPoint` sigue con `panTo` sin tocar el zoom (`route-map-impl.tsx:1621-1629`).
- Mantener el mapa montado siempre. Loading, error y flota vacía pasan a ser overlays sobre el mapa, no `return` anticipado. `PanelJornada` sigue visible en el estado vacío.
- Test: extraer la decisión de encuadre a una función pura (`debeEncuadrar({fitMode, fitKey, estadoPrevio, hayPuntos})`). Agregar vitest para estos casos:
  - `'once'` no reencuadra al cambiar los markers.
  - Sí reencuadra al cambiar `fitKey`.
  - Este contrato es el que después hereda el motor Google.

## PR 2 — `perf`: bajar la latencia de /en-vivo
- **Web** (`use-en-vivo.ts`): `usePosicionesEnVivo` pasa a `refetchInterval: 2_000`. Revisar la clave del `@Throttle` de 300 req/min (`en-vivo.controller.ts:29`): son unas 30 req/min por pestaña, así que hay que confirmar que no se sature con varios admins detrás del mismo NAT.
- **Web, animación:** el vehículo seleccionado se pone al día en ~1 s (`min(1000, intervalo)`), no repartiendo todo el intervalo. Ese reparto es retraso agregado.
  - La interpolación de todos los vehículos va directo en el motor Google (PR 3), para no hacerla dos veces.
- **Móvil** (`outbox.ts:1244`): `PISO_ENTRE_INTENTOS_DRENAJE_MS` de 10 s a 3 s. A 30 km/h el drenado sigue al fix. Cálculo: ~20 POST/min como máximo más el heartbeat, por debajo del límite de 60 req/min por dispositivo.
  - Verificar que el lease SQLite de 60 s se libera al terminar cada drenado. Si no se libera, el piso real seguiría siendo 60 s.
  - Ajustar los tests de `drenaje-oportunista`. Sale en el APK 15.
- Puede dividirse en 2a (web, se despliega sola) y 2b (móvil).

## PR 3 — `feat(design-system)`: motor Google Maps y /en-vivo migrado
- Dependencia: `@vis.gl/react-google-maps`, con versión exacta y de al menos 2 semanas de antigüedad. Se verifica en npm al implementar.
- Archivo nuevo `packages/design-system/src/ui/route-map-google.tsx`. Implementa **el mismo contrato `RouteMapProps`**: `routes`, `markers`, `stops`, `zones`, `fitMode`/`fitKey`, `followPoint`, `onUserPan`, `defaultCenter`/`defaultZoom`, `animatedVehicle`, `loading`.
  - `RouteMap.tsx` gana `engine?: 'maplibre' | 'google'`, que durante la migración tiene default `'maplibre'`.
  - Reusar código puro existente:
    - `isWithinCentralViewport`
    - `vehicle-marker-animation.ts`
    - `route-map-geometry.ts`
    - `map-builders.ts`
  - Polylines y zonas con `google.maps.Polyline`/`Polygon` imperativos vía `useMap`.
  - Vehículos con `AdvancedMarker` y HTML propio, que mantiene placa, `estadoFrescura`, `pinType: 'vehicle'` y el click que selecciona la sesión.
  - **Todos los vehículos interpolan** hacia la nueva posición en ~1 s con rAF. `prefers-reduced-motion` salta directo.
- **Cámara Google:**
  - `fitBounds` solo según `debeEncuadrar` (PR 1).
  - Follow con `panTo` solo si el punto sale del 60% central; nunca toca el zoom.
  - `dragstart` y el zoom del usuario disparan `onUserPan`. Para distinguir el zoom del usuario de los cambios programáticos, usar una bandera mientras corren nuestros `fitBounds`/`panTo`.
- **Estilo:** Map ID (vector) con `colorScheme` light/dark siguiendo el tema del panel. `gestureHandling: 'greedy'` en móvil para que el pinch funcione en el teléfono.
- `page.tsx` de /en-vivo y `panel-frescura.tsx` pasan a `engine="google"`.
- **Env:** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` y `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Son build-time en Next, así que:
  - Agregar build args a la imagen web en `scripts/deploy-gcp.sh`.
  - Agregarlas a `.env.example`.
  - Si falta la key, mostrar un aviso claro en el mapa, no una pantalla rota.
- **Infra (chairman, con el comando confirmado por el CTO antes de correrlo):**
  - `gcloud services enable maps-backend.googleapis.com --project quivo-control-prod`
  - `gcloud services api-keys create --display-name=quivo-web-maps --allowed-referrers=<dominio web>/*,http://localhost:3000/* --api-target=service=maps-backend.googleapis.com`
  - Map ID: no verifiqué que exista un comando de CLI para crearlo. Si no existe, se crea en la consola (Map Management). Para desarrollo local, `DEMO_MAP_ID`.

## PR 4..N — migrar el resto y borrar MapLibre
- Un PR por grupo, en este orden:
  1. `reportes/recorridos/[id]`
  2. `reglas/regla-preview`, `vehiculos/vehicle-form-panel`, `lineas/line-form-panel`
  3. **`rutas` (editor), el último**: arrastre de puntos y pinType `pulse` necesitan equivalentes en Google
- PR final:
  - `engine` pasa a default `'google'` y después se borra el prop.
  - Se borran `route-map-impl.tsx` y la dependencia `maplibre-gl`.
  - Se borra el CSS `.leaflet-*` muerto.
  - Se actualizan ADR 0004 y `docs/plan-ubicacion-fluida.md:172`, porque están desactualizados.
- **Landing (`FleetPanelPreview`): se decide al llegar a esta fase.** Recomendación: una imagen estática, para no cobrar cargas de mapa por tráfico público.

## Fuera de alcance
- SSE/push.
- Subir el canal visual de 1 Hz.
- Rumbo (`heading`) en `gps_sesion_resumen`, para rotar el marker. Candidato a un PR posterior.

## Verificación
- **PR 1:**
  - vitest de `debeEncuadrar`.
  - Playwright sobre el panel local con flota sembrada: zoom manual, esperar 3 polls, y `getZoom()` sin cambios. Lo mismo después de pan.
  - "Reencuadrar" sí reencuadra.
- **PR 2:**
  - SQL de solo lectura: p50/p95 de `ultimo_ingreso_ts - ultimo_fix_ts` en `gps_sesion_resumen`, antes y después del APK 15.
  - En calle (CTO): el teléfono con la app y otro con /en-vivo; el retraso tiene que ser de pocos segundos.
  - Tests del drenado.
- **PR 3:**
  - `tsc`, vitest, build de web y design-system.
  - Playwright/puppeteer en /en-vivo con el mapa Google en modo claro y oscuro: vehículos interpolando, el click abre el detalle, follow y Reencuadrar funcionan, el zoom se mantiene, el pinch funciona en el viewport del móvil.
  - Consola sin errores de la key.
- **Cada PR:** CI verde y `web-design-guidelines` en los PRs de UI.
