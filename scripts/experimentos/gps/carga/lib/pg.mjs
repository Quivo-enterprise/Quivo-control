import pg from 'pg';

const { Pool, Client } = pg;

export const PUERTO_HOST = Number(process.env.QUIVO_CARGA_PUERTO ?? 55432);

// --- Modo remoto (docs/plan-experimento-puntos-gps.md §10, paso B') -----------------------
// Si QUIVO_CARGA_DATABASE_URL está seteada, TODO este módulo apunta a esa instancia (la
// Cloud SQL temporal `quivo-carga-temp` creada por cloudsql/crear.sh, o — para probar este
// harness sin GCP — un Postgres local efímero propio con `sslmode=disable`) en vez del
// contenedor Docker `quivo-carga-pg`. Es la ÚNICA superficie que cambia: generador.mjs,
// lecturas.mjs, precargar.mjs, seed.mjs, exportar-estado.mjs y correr-punto.mjs/
// correr-matriz.mjs no saben si están hablando con Docker local o con Cloud SQL — solo
// llaman a adminUrl()/runtimeUrl()/runtimePool() de acá.
//
// La URL en QUIVO_CARGA_DATABASE_URL es la del rol SUPERUSER (`postgres`, contraseña
// aleatoria generada por crear.sh, ver ~/.quivo-carga-temp.env) — el mismo rol "dueño de
// las tablas" que `adminUrl()` ya representaba en local. `runtimeUrl()` deriva la URL del
// rol `quivo_app` reemplazando SOLO usuario/contraseña y conservando host/puerto/DB/query
// (incluido `sslmode`): `quivo_app` existe con contraseña 'quivo_app_dev' HARDCODEADA en la
// migración RLS (packages/db/prisma/migrations/20260730152500_rls_multi_tenant/
// migration.sql:14) — no es configurable por env, es la misma en local y en remoto una vez
// que corrió `cloudsql/migrar.sh` (`prisma migrate deploy`).
const DATABASE_URL_REMOTO = process.env.QUIVO_CARGA_DATABASE_URL || null;
export const ES_REMOTO = DATABASE_URL_REMOTO !== null;

// Hallazgo 10 de revisión (2026-09-22): si `QUIVO_CARGA_DATABASE_URL` está seteada pero NO
// apunta al host que `crear.sh` guardó en `QUIVO_CARGA_TEMP_IP` (env viejo de una corrida
// anterior, host pegado a mano, typo, o — el caso que de verdad importa evitar — apuntar por
// accidente a `quivo-control-prod`), este harness escribiría carga real contra CUALQUIER
// Postgres que esa URL nombre, sin ningún control. Refusar de entrada con un error claro es
// más barato que descubrirlo por las métricas de la base equivocada.
if (DATABASE_URL_REMOTO !== null) {
  const hostRemoto = new URL(DATABASE_URL_REMOTO).hostname;
  const hostEsperado = process.env.QUIVO_CARGA_TEMP_IP;
  if (!hostEsperado) {
    throw new Error(
      'QUIVO_CARGA_DATABASE_URL está seteada pero QUIVO_CARGA_TEMP_IP no — ' +
        'este harness en modo remoto REQUIERE ambas (las exporta cloudsql/crear.sh en ' +
        '~/.quivo-carga-temp.env). Sin QUIVO_CARGA_TEMP_IP no hay forma de confirmar que ' +
        'QUIVO_CARGA_DATABASE_URL apunta a la instancia temporal esperada y no a otra cosa ' +
        '(p.ej. producción). Abortado.',
    );
  }
  if (hostRemoto !== hostEsperado) {
    throw new Error(
      `QUIVO_CARGA_DATABASE_URL apunta a host '${hostRemoto}', pero QUIVO_CARGA_TEMP_IP ` +
        `dice '${hostEsperado}' — no coinciden. Este harness se niega a correr contra un host ` +
        'que no sea el que crear.sh registró como la instancia temporal (evita escribir carga ' +
        'real contra la base equivocada por un env viejo/editado a mano). Abortado.',
    );
  }
}

// cloudsql/crear.sh guarda DATABASE_URL con `sslmode=require` tal cual (es lo que pide el
// runbook — "SSL obligatorio"). El driver `pg` (pg-connection-string@2.14, ver
// node_modules/pg-connection-string/index.js:106-158) NO implementa la semántica real de
// libpq para `sslmode` salvo que se pase también `uselibpqcompat=true`: sin eso, `require`
// solo emite un warning de deprecación y deja `rejectUnauthorized` en el default de Node
// (`true`), lo que haría fallar la conexión contra el certificado de Cloud SQL (no es una
// CA públicamente confiable, y este harness no descarga/fija el CA cert de la instancia).
// Con `uselibpqcompat=true`, `require` pasa a significar lo que dice libpq: cifrar, sin
// verificar la cadena de certificados — exactamente "SSL obligatorio" sin gestión de CA.
// Se normaliza ACÁ (una sola vez, para admin y runtime) para que el DATABASE_URL guardado
// en ~/.quivo-carga-temp.env y usado por `migrar.sh` (prisma, otro driver, no entiende ese
// parámetro) se mantenga literal; solo los scripts .mjs (que pasan por este módulo) ven la
// versión normalizada.
function normalizarSslParaDriverPg(url) {
  const u = new URL(url);
  if (u.searchParams.has('sslmode') && !u.searchParams.has('uselibpqcompat')) {
    u.searchParams.set('uselibpqcompat', 'true');
  }
  return u;
}

// Rol dueño de las tablas (superuser en dev — igual que packages/db/.env DATABASE_URL):
// se usa solo para seed/precarga/DDL, NUNCA para medir la ruta real de ingesta (esa corre
// como `quivo_app`, ver runtimePool()).
export function adminUrl() {
  if (DATABASE_URL_REMOTO) return normalizarSslParaDriverPg(DATABASE_URL_REMOTO).toString();
  return `postgresql://quivo:quivo_dev@localhost:${PUERTO_HOST}/quivo_control`;
}

// Rol de runtime real (`quivo_app`, NOSUPERUSER NOBYPASSRLS, creado por la migración
// 20260730152500_rls_multi_tenant) — el mismo que usa apps/api vía RUNTIME_DATABASE_URL.
// Usar este rol para medir es lo que hace que la medición atraviese RLS de verdad (FORCE
// ROW LEVEL SECURITY no es un no-op acá, a diferencia de si midiéramos con el rol admin).
export function runtimeUrl() {
  if (DATABASE_URL_REMOTO) {
    const u = normalizarSslParaDriverPg(DATABASE_URL_REMOTO);
    u.username = 'quivo_app';
    u.password = 'quivo_app_dev';
    return u.toString();
  }
  return `postgresql://quivo_app:quivo_app_dev@localhost:${PUERTO_HOST}/quivo_control`;
}

export function adminClient() {
  return new Client({ connectionString: adminUrl() });
}

export function runtimePool(max = 10) {
  return new Pool({ connectionString: runtimeUrl(), max });
}

// Log de arranque sin filtrar la contraseña — cada script del harness lo llama una vez al
// inicio para que quede explícito en el log contra QUÉ instancia corre (evita el error de
// operación más caro de este experimento: medir por accidente contra el contenedor
// equivocado, o pensar que se está en remoto cuando no).
export function logObjetivo(nombreScript) {
  if (DATABASE_URL_REMOTO) {
    const u = new URL(DATABASE_URL_REMOTO);
    console.error(
      `[${nombreScript}] modo REMOTO -> host=${u.hostname} puerto=${u.port || 5432} db=${u.pathname.slice(1)} ` +
        `sslmode=${u.searchParams.get('sslmode') ?? '(default)'}`,
    );
  } else {
    console.error(`[${nombreScript}] modo LOCAL -> localhost:${PUERTO_HOST}/quivo_control (Docker quivo-carga-pg)`);
  }
}
