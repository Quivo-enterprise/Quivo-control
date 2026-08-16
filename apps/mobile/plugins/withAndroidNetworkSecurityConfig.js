const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/**
 * QUI-357 — plugin de Expo local (config plugin), no un paquete de npm: inyecta un
 * `network_security_config.xml` propio y lo referencia desde `AndroidManifest.xml` vía
 * `android:networkSecurityConfig`. Hace falta un plugin porque `expo-build-properties` (la
 * vía "oficial" para tocar el manifest sin plugin custom) solo expone
 * `android.usesCleartextTraffic` como booleano global — no permite apuntar a un XML propio
 * con overrides por dominio/por variante de build, que es lo que este ticket pide.
 *
 * Qué resuelve: `app.config.ts` pone `android.usesCleartextTraffic: false` (bloquea HTTP en
 * TODO build, incluido release — la parte no negociable del ticket). Pero el dev build local
 * (`pnpm dev`, `scripts/dev-all.sh`) apunta a `http://<IP-de-la-LAN>:3001` porque no hay
 * HTTPS local — sin una excepción, el dev build deja de poder pegarle a la API.
 *
 * La excepción vive bajo `<debug-overrides>`, un mecanismo NATIVO de Android (no un truco de
 * Expo): ese bloque el sistema operativo lo IGNORA por completo cuando el APK no es
 * `android:debuggable` — o sea que un build de release firmado (`eas build --profile
 * production`, gradle `assembleRelease`/`bundleRelease`, no debuggable) nunca lo lee, pase lo
 * que pase en este XML. Es justo la garantía que pide el ticket: "nunca aflojando el perfil
 * de release", aplicada por el propio Android y no por una condición de nuestro `app.config`
 * que alguien podría desalinear entre perfiles.
 *
 * Dentro de `debug-overrides` se permite cleartext a CUALQUIER dominio (no se enumeran IPs de
 * LAN una por una): la IP de la PC del developer cambia con cada red WiFi a la que se conecte
 * (oficina, casa, el lugar del piloto), y Android no soporta rangos/CIDR en
 * `<domain-config>` — solo hosts exactos. Enumerar IPs sería frágil y quedaría desactualizado
 * en el primer cambio de red. El scope real de seguridad no lo da la lista de dominios, lo da
 * `debuggable=true`: ya es un build que nadie firma ni distribuye fuera de la máquina del
 * developer.
 */
const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Perfil base (aplica siempre, incluido release): cleartext HTTP bloqueado. -->
    <base-config cleartextTrafficPermitted="false" />

    <!--
      QUI-357: excepcion SOLO para builds debuggable (dev client / 'expo run:android' sin
      '--variant release'). Android descarta este bloque entero cuando el APK no es
      debuggable, asi que el perfil de release (el que se firma y se instala en el piloto)
      queda con cleartext bloqueado sin importar lo que diga aca.
    -->
    <debug-overrides>
        <base-config cleartextTrafficPermitted="true" />
    </debug-overrides>
</network-security-config>
`;

const RESOURCE_DIR_SEGMENTS = ['app', 'src', 'main', 'res', 'xml'];
const RESOURCE_FILE_NAME = 'network_security_config.xml';

function withNetworkSecurityConfigFile(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const xmlDir = path.join(modConfig.modRequest.platformProjectRoot, ...RESOURCE_DIR_SEGMENTS);
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, RESOURCE_FILE_NAME), NETWORK_SECURITY_CONFIG_XML, 'utf-8');
      return modConfig;
    },
  ]);
}

function withNetworkSecurityConfigManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error(
        '[QUIVO][withAndroidNetworkSecurityConfig] No se encontró <application> en AndroidManifest.xml',
      );
    }
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return modConfig;
  });
}

module.exports = function withAndroidNetworkSecurityConfig(config) {
  config = withNetworkSecurityConfigFile(config);
  config = withNetworkSecurityConfigManifest(config);
  return config;
};
