#!/usr/bin/env bash
# Publica una actualización OTA (EAS Update) del canal `production` y sube sus source maps a
# Sentry. NO se ejecuta automáticamente; correrlo a mano desde apps/mobile:
#
#   ./scripts/publicar-ota.sh "mensaje del update"
#
# Requisitos / avisos:
# - Árbol de git LIMPIO (si no, el update no corresponde a ningún commit).
# - runtimeVersion = fingerprint (ver fingerprint.config.js): un OTA solo llega a APKs con el
#   MISMO fingerprint. Todo cambio NATIVO (dependencia con código nativo, plugin, permisos,
#   versión de SDK) cambia el hash: ese cambio exige un APK nuevo (`eas build`), un OTA no lo
#   alcanza. Compará con `npx expo-updates fingerprint:generate --platform android` antes.
# - SENTRY_AUTH_TOKEN debe estar exportado, o definido en ~/.quivo-sentry-env (0600; el script lo
#   carga si existe), para subir los source maps.
# - El bundle se compila con las variables EXPO_PUBLIC_* del shell/entorno de EAS. Las de
#   `eas.json` -> build.production.env NO se aplican a `eas update`; este script las toma de ahí
#   si no están definidas (si faltaran, la app quedaría sin API_URL/DSN).
set -euo pipefail

cd "$(dirname "$0")/.."

MENSAJE="${1:-}"
if [[ -z "$MENSAJE" ]]; then
  echo "Uso: $0 \"mensaje del update\"" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: el árbol de git no está limpio. Commiteá o descartá los cambios antes de publicar." >&2
  exit 1
fi

echo "RECORDATORIO: si este cambio toca código NATIVO (dependencias, plugins, permisos, SDK),"
echo "un OTA NO sirve: hay que generar un APK nuevo. El fingerprint de abajo debe coincidir con"
echo "el del APK instalado en los teléfonos."
npx expo-updates fingerprint:generate --platform android
read -r -p "¿Continuar con la publicación en el canal production? [y/N] " RESP
[[ "$RESP" == "y" || "$RESP" == "Y" ]] || { echo "Cancelado."; exit 1; }

# Token de Sentry local (no versionado); si no existe se sigue sin él (se omite la subida).
if [[ -f "$HOME/.quivo-sentry-env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.quivo-sentry-env"
fi

# EXPO_PUBLIC_* y SENTRY_* (ORG/PROJECT) de producción desde eas.json (sin pisar lo ya exportado).
eval "$(node -e '
  const env = require("./eas.json").build.production.env;
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("EXPO_PUBLIC_") || k.startsWith("SENTRY_")) {
      console.log(`export ${k}="\${${k}:-${v}}"`);
    }
  }
')"

# 0) Reconstruir las dependencias workspace (@quivo/shared resuelve vía dist/, git-ignorado). Sin
#    esto un `dist/` viejo se empaqueta en el OTA (incidente 2026-10-17). Igual que el hook
#    `eas-build-post-install` de package.json. `set -e` corta si falla.
(cd ../.. && pnpm --filter "@quivo/mobile^..." build)

# 1) Exportar el bundle (con source maps) a ./dist con las
#    EXPO_PUBLIC_* de eas.json exportadas arriba, verificarlo y recién después publicar: un bundle
#    rancio nunca llega a publicarse.
#    SIN `eas env:exec`: no inlinea las EXPO_PUBLIC_* exportadas arriba y el OTA salió sin API_URL
#    (incidente 2026-10-18). CON `--clear`: la caché de transformación de Metro reutiliza el
#    transform hecho sin las variables.
rm -rf dist
npx expo export --clear --platform android --dump-sourcemap --dump-assetmap --output-dir dist
node ../../scripts/assert-bundle-singletons.mjs dist
# Las EXPO_PUBLIC_* deben estar literalmente en el bytecode Hermes. GPS_CANAL_VISUAL no se
# chequea: solo se usa en `=== '1'` y Metro lo pliega a un booleano (el literal no aparece).
for v in EXPO_PUBLIC_API_URL EXPO_PUBLIC_SENTRY_DSN; do
  [[ -n "${!v:-}" ]] || { echo "ERROR: $v vacía; NO se publica." >&2; exit 1; }
  grep -aqF -- "${!v}" dist/_expo/static/js/android/*.hbc \
    || { echo "ERROR: $v no quedó inlineada en el bundle; NO se publica." >&2; exit 1; }
done

# 2) Publicar el bundle ya exportado y verificado.
npx eas-cli update --skip-bundler --platform android --input-dir dist --channel production --environment production --message "$MENSAJE"

# 3) Source maps del bundle del update a Sentry. Docs de Sentry (Expo > Uploading Source Maps >
#    EAS Update): `dist` es el directorio de salida por defecto de `eas update`. El paquete
#    `@sentry/expo-upload-sourcemaps` existe desde @sentry/react-native 8.9.0; con 7.x (este
#    repo: ~7.2.0) se invoca el bin incluido en el SDK. Org/proyecto salen del plugin de Sentry
#    en app.config.ts (SENTRY_ORG/SENTRY_PROJECT).
if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  echo "AVISO: SENTRY_AUTH_TOKEN no está definido; se omite la subida de source maps." >&2
  exit 0
fi
npx --package=@sentry/react-native sentry-expo-upload-sourcemaps dist
