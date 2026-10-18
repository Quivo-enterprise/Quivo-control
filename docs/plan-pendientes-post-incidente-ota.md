# Plan — pendientes tras el incidente de OTA del 17–18/10

> Estado: propuesto 2026-10-18. Contexto: `docs/handoff.md`, retome del 2026-10-18 noche. Dos OTAs
> seguidos rompieron producción (shared viejo; después sin `EXPO_PUBLIC_API_URL`). Ya corregido con
> el OTA `01a15072` y el script blindado (#175, #177). Esto ordena lo que queda.

## Objetivo

1. Que la navegación al próximo PC (línea punteada) se vea donde corresponde.
2. Que cada OTA tenga source maps en Sentry.
3. Que publicar un OTA deje de depender del estado de una PC local.
4. Decidir, con datos, si Metro debe leer `@quivo/shared` desde `src`.

## Orden propuesto

| # | Tarea | Dueño | Por qué en este orden |
|---|---|---|---|
| 1 | Token de Sentry local + subir source maps del OTA `01a15072` | CTO (5 min), después Claude | `apps/mobile/dist` todavía es el bundle publicado; si se borra, se pierden esos maps |
| 2 | Fix lat/lng de la línea punteada | Claude (Sonnet) | Bug confirmado, 1 línea + test |
| 3 | OTA con el script completo (`publicar-ota.sh`) | CTO publica | Primera corrida real de punta a punta del script, con source maps |
| 4 | OTA desde CI (GitHub Actions + aprobación) | Claude, CTO aprueba | Saca la publicación de la PC local: la causa raíz real |
| 5 | `@quivo/shared` desde `src` en Metro | Decisión del CTO | Recomendación: **no por ahora** (ver abajo) |

## 1. Sentry: token y source maps

**Hallazgo:** `SENTRY_AUTH_TOKEN` ya existe en EAS (production) y las builds de APK lo usan. Es una variable
*secreta*: EAS no la entrega a la PC local, así que `publicar-ota.sh` nunca la tuvo.

**Práctica:** un token por uso (CI de EAS, publicación local o CI de GitHub), con el mínimo alcance: el
*Organization Auth Token* de Sentry ya viene limitado a `org:ci` (subir releases y maps, nada más). El token
nunca pasa por el chat ni queda en el historial de la shell.

Pasos:
1. **[CTO]** Sentry → organización `quivo-de` → Settings → Auth Tokens (Organization Tokens) → *Create New Token*,
   nombre `ota-local-cto`. Copiarlo.
2. **[CTO, en su propia terminal, NO con `!`]**:
   `read -rs T && umask 077 && printf 'export SENTRY_AUTH_TOKEN=%s\n' "$T" > ~/.quivo-sentry-env && unset T`
   (pega el token, Enter; no queda en el historial).
3. **[Claude, Sonnet]** `publicar-ota.sh`: si existe `~/.quivo-sentry-env`, hacer `source` (como
   `~/.quivo-admin-env` en los scripts de carga).
4. **[Claude]** Subir los maps del OTA `01a15072` desde el `apps/mobile/dist` actual (es exactamente el bundle
   publicado): `sentry-expo-upload-sourcemaps dist`. **No borrar `apps/mobile/dist` antes de este paso.**

Verificación: un evento nuevo de Sentry del release `0.1.0+16` muestra el archivo y la línea reales, no
`<global>` ni offsets de Hermes.

## 2. Línea punteada con lat/lng invertidos

**Confirmado por lectura** (no se vio en el teléfono):
- `apps/api/src/modules/tracking/ruteo.service.ts:43` devuelve `[lat, lng]`.
- `packages/shared/src/sync/ruteo.ts:3-6` lo documenta así.
- `apps/mobile/src/features/mapa/route-map.tsx:1305` lo lee como `([lng, lat])`.

La línea se dibuja en el Atlántico Sur (lat ≈ -65). Existe desde agosto (`06d54de` / `09c7137`) y nadie la vio
nunca. Cuando se arregle va a **aparecer por primera vez** una línea punteada desde el vehículo hasta el próximo PC.

Fix (solo mobile, no se toca el contrato de la API: los teléfonos actuales lo leen así):
- Extraer el mapeo a una función pura en el módulo del mapa (`rutaCalculadaACoords`) que lea `[lat, lng]`.
- Test: una coordenada de Tiquipaya (`[-17.37, -66.16]`) sale con `latitude ≈ -17.37`.
- Llega por OTA (es solo JS).

**Práctica (causa de fondo):** el repo usa dos convenciones de tupla (`[lng, lat]` GeoJSON y `[lat, lng]` en
ruteo) con el mismo tipo `[number, number]`. Regla a fijar en `docs/`: **GeoJSON `[lng, lat]` en todo dato y API
nueva**; `{ latitude, longitude }` solo en el borde con `react-native-maps`. No se migra el endpoint de ruteo ahora
(rompería los teléfonos con el JS actual); queda anotado para cuando haya un APK.

## 3. Primer OTA de punta a punta con el script

Se publica con el fix del punto 2 y el token del punto 1. Checklist antes de publicar (lo hace el script):
fingerprint = runtime `547d52e7…`, rebuild de shared, export `--clear`, guard de shared, `EXPO_PUBLIC_*` en el
`.hbc`. Después de publicar:
- un teléfono abre la app: login OK y versión nueva en Perfil;
- Sentry sin errores nuevos en 30 min;
- **changelog al CTO antes de publicar** (misma regla que para los APK).

**Vuelta atrás (runbook):** `npx eas-cli update:republish --group <group-id-anterior>` vuelve a publicar el update
anterior en segundos. Anotar el group id vigente antes de cada OTA (hoy: `10ffb271-1693-4e29-95d9-1dae03d2a2d5`).

## 4. OTA desde CI (recomendado)

**Problema de fondo:** los dos incidentes vienen de publicar desde una PC con estado local: un `dist/` viejo y
variables de entorno de shell. La práctica estándar es **publicar desde CI**, con checkout limpio,
`--frozen-lockfile` y build desde cero, de modo que nada local pueda colarse.

Diseño:
- `.github/workflows/ota.yml`, `workflow_dispatch` con input `mensaje`.
- `environment: production` con **aprobación obligatoria del CTO** (GitHub Environments): nadie publica sin el clic.
- Pasos: checkout del SHA de `main`, `pnpm install --frozen-lockfile`, `pnpm build`, fingerprint ==
  runtime esperado (si no, falla: hace falta APK), y `publicar-ota.sh` en modo no interactivo (flag `--si`), que
  corre los mismos guards.
- Secretos de GitHub: `EXPO_TOKEN` (token de robot de Expo con permiso solo de updates) y `SENTRY_AUTH_TOKEN`
  (otro token de Sentry, `ota-ci`). El CTO los carga con `gh secret set NOMBRE`, que pide el valor sin mostrarlo.
- Resultado: el modo automático de Claude ya no bloquea, porque Claude lanza el workflow y el CTO lo aprueba en
  GitHub. Queda historial de qué SHA se publicó y quién lo aprobó.

Alternativa evaluada: EAS Workflows (CI de Expo, que ya tiene los secretos de EAS). Descartada por ahora: el
pipeline, los guards y la CI viven en GitHub Actions, y duplicarlos en dos CIs suma mantenimiento.

## 5. `@quivo/shared` desde `src` en Metro — recomendación: no por ahora

Hechos:
- `shared` compila con `tsc` (NodeNext, ESM) y sus 148 imports relativos usan `.js`.
- Metro 0.83.3 **no** resuelve `./x.js` a `./x.ts`: haría falta un `resolveRequest` propio en
  `apps/mobile/metro.config.js`, que ya tiene uno para los singletons.
- api y web consumen `dist/` (Node y Next), así que tendrían que seguir así: mobile y servidor leerían `shared` por
  caminos distintos.

Por qué no ahora:
- Todos los caminos a producción ya reconstruyen `shared` antes de empaquetar: el hook de EAS para los APK,
  `publicar-ota.sh` para los OTA y CI.
- El guard rechaza bundles con módulos faltantes.
- Con el punto 4, el OTA sale de un checkout limpio.

Lo que queda sin cubrir es solo el desarrollo local (`expo start` con un `dist/` viejo), y eso no llega a los
teléfonos. A cambio de cerrar ese hueco se suma un resolver propio que mantener justo antes de la entrega.
Reabrir después de la entrega si molesta en desarrollo.

## Trampas

- No borrar `apps/mobile/dist` hasta subir los maps del OTA `01a15072`.
- El fix del punto 2 hace aparecer una línea que nunca se vio: avisar al CTO y a los choferes.
- Cualquier cambio en `publicar-ota.sh` se prueba con un export a scratch con y sin variables (los guards deben
  fallar sin ellas) antes de mergear.
- Codex sin cuota hasta el 16/11: correr verify-fix sobre #175/#177 y el punto 2 cuando vuelva.

## Criterios de verificación

- Punto 1: evento de Sentry con stack legible del release vigente.
- Punto 2: test verde y, en la calle, la línea punteada del vehículo al próximo PC visible y encima de las calles.
- Punto 3: Perfil muestra el update nuevo y no hay errores nuevos en Sentry.
- Punto 4: un workflow de prueba sin aprobación no publica; con aprobación, publica y sube los maps.
