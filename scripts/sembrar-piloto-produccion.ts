/**
 * Siembra el piloto en la base de **producción real**, hablando SOLO con la API HTTP pública
 * (`https://quivo-api-741758083365.southamerica-west1.run.app/v1` por default) — nunca con la
 * base directo. Corre en la máquina del CTO, no dentro de ningún contenedor.
 *
 * ## Migración a "un vehículo por conductor" (2026-09-09) — LEER ANTES DE CORRER
 *
 * Este script YA corrió contra producción una vez con un diseño de **2 vehículos
 * compartidos** (9001TST en Z12, 9004TST en 120 — 3 conductores por vehículo, uno por
 * horario: 126 asignaciones = 2 vehículos × 3 conductores × 21 días, en `manana`/`tarde`/
 * `noche`). El CTO pidió pasar a **6 vehículos, uno por conductor**, porque con placa
 * compartida los 3 PIN de un mismo vehículo autenticaban los 3 en esa placa — no había forma
 * de dar "una cuenta por auto". Estado destino: 126 asignaciones = 6 vehículos × 1 conductor
 * × 21 días, todas en `manana`.
 *
 * **Primer intento (abandonado): anular + crear una rotación nueva.** La primera versión de
 * esta migración anulaba la rotación vieja y creaba una SEGUNDA rotación con las 126
 * asignaciones del diseño nuevo. Se abandonó porque choca con un hecho real del schema: la
 * unicidad `@@unique([vehiculoId, fecha, horario])` (`packages/db/prisma/schema.prisma`) es
 * **global**, no está scopeada por `rotacionId` — anular la rotación vieja no borra sus filas,
 * solo las vuelve inertes para auth, así que las 42 filas "manana" que ya existían para
 * 9001TST/9004TST bloqueaban con 409 cualquier intento de recrearlas en una rotación nueva
 * (y `ActualizarAsignacionSchema` excluye `rotacionId` a propósito — no hay forma de
 * reasignarle una fila existente a otra rotación). Ese primer intento SÍ detectó el problema
 * antes de escribir nada (nunca llegó a correr con `--apply`) y quedó documentado en el
 * historial de commits de esta rama — no se repite acá para no duplicar contexto viejo.
 *
 * **Diseño actual (el que implementa este archivo): migrar la ÚNICA rotación existente in
 * situ — no se crea ninguna rotación nueva.** La clave que destraba el diseño anterior: las
 * 42 filas "manana" de los 2 vehículos preexistentes YA SON el reparto correcto (conductor #1
 * en 9001TST, conductor #4 en 9004TST — así las creó el diseño viejo, que fijaba el horario
 * por conductor: #1/#4 siempre `manana`). No hace falta tocarlas. Solo hay que:
 *
 *   1. Despublicar la rotación (`POST /v1/rotaciones/:id/anular`) para poder editarla.
 *   2. Crear 84 asignaciones nuevas, todas `manana`, en la MISMA rotación, sobre los 4
 *      vehículos NUEVOS — sin colisión posible: `@@unique([vehiculoId, fecha, horario])` es
 *      por vehículo, y estos 4 nunca tuvieron ninguna fila.
 *   3. Borrar (best-effort, ver "Bug real de la API" más abajo) sus 84 filas `tarde`/`noche`
 *      viejas (conductores #2/#3/#5/#6 sobre los 2 vehículos viejos — ya no corresponden en el
 *      diseño 1:1, pero dejarlas no rompe nada).
 *   4. Crear 4 socios y 4 vehículos nuevos (9002TST/9003TST en Z12, 9005TST/9006TST en 120) y
 *      activarlos — esto pasa ANTES del paso 1 en la ejecución real (ver "Qué hace, en orden"
 *      más abajo), no depende de la rotación.
 *   5. Publicar la rotación de nuevo — SIEMPRE, incluso si el paso 3 no borró nada.
 *
 * Resultado en el caso ideal: 126 asignaciones (42 "manana" viejas intactas + 84 "manana"
 * nuevas), una sola rotación (la misma de siempre, id sin cambiar). En la práctica puede
 * quedar por encima de 126 si el paso 3 no puede borrar alguna fila tarde/noche (ver abajo) —
 * son filas extra inofensivas, no un error.
 *
 * ### Supuesto crítico, verificado ANTES de escribir el código (no después)
 *
 * Todo este diseño depende de que una rotación pueda hacer el ciclo `publicada
 * --(anular)--> borrador --(publicar)--> publicada` más de una vez. Se confirmó leyendo
 * `apps/api/src/modules/rotaciones/rotaciones.service.ts`: `publicar()` (líneas 187-203) solo
 * exige que el estado ACTUAL sea `borrador` — no hay ningún campo ni chequeo de "ya se publicó
 * antes"; `anular()` (líneas 208-217) solo exige que el estado ACTUAL sea `publicada`. Ninguno
 * de los dos es una operación terminal. Si no hubiera sido así, esta estrategia entera no
 * habría servido y se habría parado ahí — se comprobó antes de tocar código, como corresponde.
 *
 * ### Bug real de la API, encontrado en la primera corrida `--apply` — no se arregla acá
 *
 * `eliminarAsignacion` (`rotaciones.service.ts:263-274`) hace `tx.asignacion.delete()`, un
 * DELETE duro, y `SesionOperativa.asignacion` tiene `onDelete: Restrict` (`schema.prisma`) —
 * una asignación con una sesión operativa real encima (un login de verdad) es imborrable, y la
 * API devuelve **500** en vez de un 409 legible. La primera corrida `--apply` de este diseño
 * chocó con esto de verdad: pruebas de login crearon sesiones sobre asignaciones de HOY, el
 * loop de borrado (que entonces abortaba en el primer error, y corría ANTES de crear las
 * asignaciones nuevas) murió a los 11 borrados de 84, dejando la rotación despublicada — hubo
 * que restaurarla publicándola a mano por fuera del script. Dos correcciones sobre eso, ambas
 * ya implementadas: (a) el orden de los pasos cambió para que lo esencial (crear) vaya ANTES
 * que lo cosmético (borrar) — ver "TRAMO PELIGROSO" abajo; (b) el borrado ahora es tolerante a
 * fallos — un 500 individual se registra (`estado.asignacionesImborrables`, para no
 * reintentarlo en cada corrida) y el loop sigue, nunca aborta el script. Esta tolerancia es
 * SOLO para ese loop de borrado; cualquier otra llamada sigue abortando en el primer error.
 *
 * ### ⚠️ TRAMO PELIGROSO — nadie puede loguearse mientras la rotación está despublicada
 *
 * Desde que se despublica la rotación (Paso 10) hasta que se vuelve a publicar (Paso 13),
 * TODAS las asignaciones de esa rotación —incluidas las 42 "manana" que nunca se tocan— dejan
 * de autenticar, porque el login exige `rotacion.estado='publicada'`. El orden de los pasos
 * dentro del tramo se eligió para que sea lo más corto posible: primero lo esencial (crear las
 * 84 asignaciones nuevas, Paso 11), después lo cosmético y best-effort (borrar tarde/noche,
 * Paso 12) y el Paso 13 (publicar) es OBLIGATORIO al final pase lo que pase con el Paso 12. Si
 * el proceso muere en medio del tramo, la rotación queda despublicada hasta la próxima corrida
 * — por eso cada paso persiste su progreso de inmediato y es puramente resumible, y el Paso 10
 * se autocorrige si alguien restauró el servicio publicando a mano por fuera del script (pasó
 * de verdad — ver comentario de `despublicarRotacion` en el código). Ver el comentario sobre
 * los Pasos 10-13 en el código para el detalle completo.
 *
 * Los ids reales de todo lo creado en la corrida anterior (sindicato, 2 socios, 2 líneas, 2
 * rutas, 38 puntos de control, 2 vehículos, 6 conductores con PIN, la rotación) siguen en
 * `scripts/.estado-siembra-produccion.json` — este script los lee y saltea recrearlos (ver
 * "Reanudable" más abajo).
 *
 * Crea, en este orden exacto: 1 sindicato → 6 socios (uno por vehículo, 2 ya existían) → 2
 * líneas (Z12/120, con branding) → 2 rutas con geometría real → puntos de control → 6
 * vehículos (2 ya existían, nacen `pendiente`) → los activa → 6 conductores (ya existían) →
 * les fija PIN (ya fijados) → despublica la rotación existente → crea las 84 asignaciones
 * nuevas (horario único `manana`, `DIAS_ROTACION` días desde hoy) en la MISMA rotación →
 * intenta borrar (best-effort) las 84 filas tarde/noche viejas → la vuelve a publicar (siempre).
 *
 * ## Cómo se corre
 *
 *   QUIVO_ADMIN_EMAIL=admin_quivo@... QUIVO_ADMIN_PASSWORD=... \
 *   QUIVO_PIN_1=123456 QUIVO_PIN_2=234567 QUIVO_PIN_3=345678 \
 *   QUIVO_PIN_4=456789 QUIVO_PIN_5=567890 QUIVO_PIN_6=678901 \
 *     packages/db/node_modules/.bin/tsx scripts/sembrar-piloto-produccion.ts        # dry-run
 *
 *   ...(mismas env vars)... \
 *     packages/db/node_modules/.bin/tsx scripts/sembrar-piloto-produccion.ts --apply  # aplica
 *
 * (`packages/db/node_modules/.bin/tsx` porque el root del monorepo no declara `tsx` como
 * dependencia propia — mismo motivo que el resto de `scripts/`: standalone, sin acoplarse al
 * build de ningún workspace. También funciona con `pnpm --filter @quivo/db exec tsx
 * ../../scripts/sembrar-piloto-produccion.ts` si se prefiere.)
 *
 * Variables de entorno:
 *   QUIVO_API_URL        Opcional. Default: la URL de producción de arriba.
 *   QUIVO_ADMIN_EMAIL     Obligatoria. Email del usuario `admin_quivo` ya existente.
 *   QUIVO_ADMIN_PASSWORD  Obligatoria. Su contraseña. NUNCA se loguea, ni en modo verbose.
 *   QUIVO_PIN_1..QUIVO_PIN_6  Obligatorias. PIN de cada conductor (string, 6-12 dígitos,
 *     pueden tener ceros a la izquierda — viajan como string en todo momento). Deben ser
 *     los 6 distintos entre sí (dos PIN iguales en el mismo vehículo hacen que el login
 *     móvil devuelva 401 a ambos conductores). NUNCA se loguean.
 *   QUIVO_DIAS_ROTACION   Opcional. Default 21. Cuántos días de asignaciones sembrar, desde
 *     hoy (calendario Bolivia).
 *
 * `--apply` es obligatorio para escribir algo. Sin él, el script imprime exactamente qué
 * llamadas haría (cuántas, a qué endpoint, con qué forma de datos — ocultando PIN/password) y
 * no manda ningún POST/PATCH/PUT/DELETE. Para el primer error se detiene mostrando el status
 * HTTP y el cuerpo de la respuesta — no sigue de largo, **con una excepción: 429 (rate
 * limit)** — ver "Rate limit" más abajo.
 *
 * ## Rate limit (100 req/min) — reintento automático en 429
 *
 * La API limita a 100 requests/min/IP (`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100
 * }])`, `apps/api/src/app.module.ts`) y devuelve `429 ThrottlerException` al pasarse — con
 * 126+ llamadas de escritura en una sola corrida, el script se topa con esto con toda
 * seguridad. `llamar()` (único punto de entrada HTTP, ver más abajo) atrapa el 429
 * específicamente: espera (usa el header `Retry-After` de la respuesta si viene, si no cae a
 * 60s — la ventana del throttler) y reintenta LA MISMA llamada, hasta
 * `RATE_LIMIT_MAX_REINTENTOS` veces, logueando claramente cada espera. Cualquier otro status
 * (`4xx`/`5xx` que no sea 429) sigue abortando el script entero en el primer error, sin
 * reintentar — esa propiedad no cambia.
 *
 * ## Reanudable e idempotente vía estado local — LEER ANTES DE BORRAR `scripts/.estado-
 * siembra-produccion.json`
 *
 * Ninguno de los endpoints que este script usa para crear (`POST /v1/sindicatos`,
 * `/v1/socios`, `/v1/lineas`, `/v1/lineas/:id/rutas`, `/v1/rutas/:id/puntos-control`,
 * `/v1/vehiculos`, `/v1/conductores`, `/v1/rotaciones/:id/asignaciones`) acepta un `id` — el
 * servidor siempre genera uno nuevo (`randomUUID()` en cada `*.service.ts`, confirmado
 * leyendo el código). A diferencia de los scripts que hablan con Postgres directo
 * (`cargar-circuito-z12.ts`, `crear-credenciales-piloto.ts`, que usan ids fijos + `ON
 * CONFLICT ... DO UPDATE`), este script **no puede** ser idempotente por id determinista.
 * Tampoco existe un endpoint DELETE para sindicatos/socios/líneas/rutas/puntos de
 * control/vehículos/conductores (confirmado leyendo cada controller — solo GET/POST/PATCH).
 * La única excepción es `DELETE /v1/rotaciones/:id/asignaciones/:asignacionId` (solo mientras
 * la rotación está en `borrador`) — es lo que el Paso 11 usa para borrar las 84 filas
 * tarde/noche del diseño viejo.
 *
 * La única forma de que una segunda corrida no duplique todo es que el script recuerde qué ya
 * creó. Por eso, cada vez que un POST/PUT que crea o fija algo tiene éxito en modo `--apply`,
 * el id (o el hecho de que ya se hizo) se escribe DE INMEDIATO a `scripts/.estado-siembra-
 * produccion.json` (no al final — si el proceso muere a mitad de camino, lo ya escrito ahí
 * queda). Al arrancar, el script LEE ese archivo y saltea cualquier paso que ya conste. Si se
 * borra ese archivo (o se corre desde otra máquina sin copiarlo) antes de una segunda corrida
 * con `--apply`, el script no tiene forma de saber qué ya existe en producción y VA A
 * DUPLICAR filas que después no se pueden borrar. Tratarlo como el único source of truth de
 * qué ya se aplicó — no borrarlo "para probar de nuevo".
 *
 * ## Historial: dos correcciones de un diseño anterior, ya no aplican al código actual
 *
 * Una versión previa de este script (la que creaba una rotación nueva vía `generar()`, ver
 * "Primer intento (abandonado)" más arriba) documentó acá dos correcciones sobre el contrato
 * real de `POST /v1/rotaciones` (que ese endpoint es `generar()`, auto-asigna, y no crea un
 * borrador vacío) y un bug de reanudabilidad en la limpieza de su auto-generado. El diseño
 * actual NO llama a `POST /v1/rotaciones` en ningún momento (reusa la rotación existente), así
 * que ninguna de esas dos notas aplica al código que corre hoy — se puede ver el detalle en el
 * historial de git de este archivo si hace falta, no se repite acá para no confundir con
 * contexto de un camino que ya no se toma.
 *
 * ## Otras decisiones tomadas para poder ejecutar el brief — revisar
 *
 *   - **Geometría Z12** (paso 4): el brief pide replicar `cargar-circuito-z12.ts:110-136`
 *     (subida + conector interpolado cada ~50 m vía la parada "Salomón" + bajada). Ese script
 *     ubica a Salomón dinámicamente como "el punto de control obligatorio ya activo en la
 *     ruta real, más cercano al inicio de la traza de bajada" — funciona porque edita una
 *     ruta que YA tenía puntos de control obligatorios cargados de antes. Acá no hay ruta
 *     previa (sindicato nuevo desde cero), así que no hay de dónde leer esa coordenada en
 *     vivo. Se usa la coordenada real de Salomón tal como quedó en producción
 *     (`[-66.2285535, -17.3174191]`, id `c7d48c43-...` en el snapshot
 *     `scripts/backups-z12/2026-09-08T14-30-54-529Z/puntos-control-ruta-objetivo-antes.json`)
 *     como constante — verificado en esta misma tarea que es el punto obligatorio activo más
 *     cercano al inicio de `bajada_simp.json` (201.7 m, mismo orden de magnitud que los ~200 m
 *     que documenta `cargar-circuito-z12.ts`) y que los 26 puntos de control de ese mismo
 *     snapshot caen a ≤79 m de la geometría reconstruida acá (tolerancia del servidor: 100 m,
 *     `RUTA_PROXIMIDAD_TOLERANCIA_METROS` en `apps/api/src/common/geo/proximidad-ruta.ts`) —
 *     no es un número inventado, es el dato real verificado contra la geometría que este
 *     script realmente construye.
 *   - **Puntos de control Z12** (paso 5): el brief dice "los que use cargar-circuito-z12.ts
 *     para la Z12" — ese script no trae su propio JSON de puntos, los toma de los que YA
 *     existen en la ruta real de producción. Se usan esos mismos 26 puntos (coordenada,
 *     `radioToleranciaM`, `obligatorio`), extraídos del mismo snapshot de arriba y guardados
 *     en `scripts/data/z12-circuito/puntos-control.json` para que este script sea
 *     autocontenido (no lee backups de otra corrida en tiempo de ejecución).
 *   - **Puntos de control 120 — 4 de los 16 de `puntos-control-andry.json` NO se mandan**
 *     (paso 5): `A2`, `A3`, `C2`, `C3` están sobre los ramales "Barrio Flores" y "Collpapampa"
 *     del sindicato real — a 1.2, 2.6, 2.6 y 2.7 km de la geometría tronco-only que este
 *     script crea para la línea 120 (ida + vuelta concatenadas, SIN los 8 ramales — el brief
 *     pide "dos rutas", no diez). `validarCercaniaARuta`
 *     (`apps/api/src/common/geo/proximidad-ruta.ts`) rechaza con 400 cualquier punto a más de
 *     100 m de la geometría de su ruta — confirmado calculando la distancia real
 *     punto-a-polilínea de los 16 puntos contra la geometría tronco antes de escribir este
 *     script (A1/C1/N1..N10 quedan todos a <15 m; A2/A3/C2/C3 dan 1.2-2.7 km). Mandarlos
 *     igual haría abortar el script en el primer 400. Se mandan los 12 restantes (`A1`,
 *     `N1`..`N10`, `C1`) con `orden` 0..11 en secuencia de recorrido real (terminal norte →
 *     ida → terminal sur → retorno; `C1` al final, mismo lugar físico que `A1` a ~12 m). Si
 *     el CTO quiere los 4 puntos de ramal igual, hace falta crear esas 2 rutas-ramal aparte
 *     (fuera del alcance "dos rutas" de este brief) — no se improvisó esa extensión acá.
 *   - **Socios**: 1 socio por vehículo — 6 en total desde esta migración (antes 2). Los 2 que
 *     ya existían (vehículos 9001TST/9004TST) se leen del estado legado, no se recrean.
 *   - **Reparto conductor↔vehículo** (diseño 1:1): 1 conductor por vehículo, un solo horario
 *     (`manana`) para todos — ya no hay "3 conductores por vehículo por día" (ese era el
 *     diseño viejo que esta migración reemplaza, migrando in situ la misma rotación en vez de
 *     crear una nueva — ver "Diseño actual" más arriba).
 *
 * ## Qué hace, en orden (ver detalle de cada paso en su función)
 *
 *   1. `crearSindicato`                        — POST /v1/sindicatos (ya existe, se saltea)
 *   2. `crearSocios`                           — POST /v1/socios × hasta 4 nuevos (6 en total, 2 ya existían)
 *   3. `crearLineas`                           — POST /v1/lineas × 2 (ya existen, se saltea)
 *   4. `crearRutas`                            — POST /v1/lineas/:id/rutas × 2 (ya existen, se saltea)
 *   5. `crearPuntosControl`                    — POST /v1/rutas/:id/puntos-control × (26 + 12) (ya existen)
 *   6. `crearVehiculos`                        — POST /v1/vehiculos × hasta 4 nuevos (6 en total, 2 ya existían)
 *   7. `activarVehiculos`                      — PATCH /v1/vehiculos/:id/estado × hasta 4 nuevos
 *   8. `crearConductores`                      — POST /v1/conductores × 6 (ya existen, se saltea)
 *   9. `fijarPines`                            — PUT /v1/mobile/credenciales/conductores/:id × 6 (ya fijados)
 *   10. `despublicarRotacion`                  — GET (autocorrección) + POST /v1/rotaciones/:id/anular (abre el tramo peligroso)
 *   11. `crearAsignacionesNuevas`              — POST /v1/rotaciones/:id/asignaciones × 84 (vehículos nuevos, manana) — ESENCIAL, va primero
 *   12. `verificarYBorrarAsignacionesViejas`   — GET /v1/rotaciones/:id + DELETE × hasta 84 (tarde/noche) — best-effort, tolerante a 500
 *   13. `publicarRotacion`                     — POST /v1/rotaciones/:id/publicar (cierra el tramo peligroso, OBLIGATORIO)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================================
// Resolución de rutas — mismo patrón que el resto de scripts/: independiente del cwd desde
// donde se invoque.
// ============================================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const ESTADO_PATH = path.join(REPO_ROOT, 'scripts/.estado-siembra-produccion.json');
const Z12_SUBIDA_PATH = path.join(REPO_ROOT, 'scripts/data/z12-circuito/subida_simp.json');
const Z12_BAJADA_PATH = path.join(REPO_ROOT, 'scripts/data/z12-circuito/bajada_simp.json');
const Z12_PUNTOS_PATH = path.join(REPO_ROOT, 'scripts/data/z12-circuito/puntos-control.json');
const KML_120_PATH = path.join(REPO_ROOT, 'scripts/data/linea-120/linea-120-my-maps.kml');
const PUNTOS_120_PATH = path.join(REPO_ROOT, 'scripts/data/linea-120/puntos-control-andry.json');

// ============================================================================================
// CLI args + config de entorno
// ============================================================================================

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--apply');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`
Uso:
  QUIVO_ADMIN_EMAIL=... QUIVO_ADMIN_PASSWORD=... QUIVO_PIN_1=... .. QUIVO_PIN_6=... \\
    packages/db/node_modules/.bin/tsx scripts/sembrar-piloto-produccion.ts [opciones]

Opciones:
  --apply    Aplica de verdad contra la API (POST/PATCH/PUT/DELETE reales). Sin esto, siempre
             dry-run: imprime el plan y no manda ninguna escritura.
  --help     Esta ayuda.

Variables de entorno (ver cabecera del archivo para el detalle completo):
  QUIVO_API_URL         Opcional. Default: API de producción.
  QUIVO_ADMIN_EMAIL      Obligatoria.
  QUIVO_ADMIN_PASSWORD   Obligatoria. Nunca se loguea.
  QUIVO_PIN_1..QUIVO_PIN_6  Obligatorias, 6 dígitos distintos entre sí. Nunca se loguean.
  QUIVO_DIAS_ROTACION    Opcional. Default 21.
`);
  process.exit(0);
}

// BUG real, confirmado corriendo contra producción (code review post-corrida): el default de
// abajo NO llevaba el sufijo `/v1` — la API monta `app.setGlobalPrefix('v1')` (apps/api/src/
// main.ts) y CADA ruta que este script llama es relativa a `/v1` (`/auth/login`, `/sindicatos`,
// etc.). Sin `/v1`, el login da 404 antes de autenticar nada. `normalizarBaseUrl` agrega el
// sufijo si falta (para el default, y para quien pase `QUIVO_API_URL` sin ponerlo) y NO lo
// duplica si ya viene puesto (para quien pase la variable con `/v1` incluido).
function normalizarBaseUrl(url: string): string {
  const sinBarraFinal = url.replace(/\/+$/, '');
  return sinBarraFinal.endsWith('/v1') ? sinBarraFinal : `${sinBarraFinal}/v1`;
}

const API_URL = normalizarBaseUrl(process.env.QUIVO_API_URL ?? 'https://quivo-api-741758083365.southamerica-west1.run.app');

function requerirEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim().length === 0) {
    console.error(`Falta la variable de entorno ${nombre}. Abortando antes de tocar nada.`);
    process.exit(1);
  }
  return valor;
}

const ADMIN_EMAIL = requerirEnv('QUIVO_ADMIN_EMAIL');
const ADMIN_PASSWORD = requerirEnv('QUIVO_ADMIN_PASSWORD');
const PINES_RAW = [1, 2, 3, 4, 5, 6].map((n) => requerirEnv(`QUIVO_PIN_${n}`));

const PIN_REGEX = /^\d{6,12}$/;
for (const [i, pin] of PINES_RAW.entries()) {
  if (!PIN_REGEX.test(pin)) {
    console.error(`QUIVO_PIN_${i + 1} no tiene el formato esperado (6 a 12 dígitos). Abortando.`);
    process.exit(1);
  }
}
if (new Set(PINES_RAW).size !== PINES_RAW.length) {
  console.error(
    'Dos o más de QUIVO_PIN_1..QUIVO_PIN_6 son iguales. Dos conductores del mismo vehículo con ' +
      'el mismo PIN hacen que el login móvil devuelva 401 a ambos. Abortando antes de tocar nada.',
  );
  process.exit(1);
}
// PINES_RAW ya tiene longitud 6 fija (un requerirEnv por índice 1..6) — el cast documenta esa
// invariante para TS (noUncheckedIndexedAccess no lo puede inferir de un .map).
const PINES = PINES_RAW as [string, string, string, string, string, string];

const DIAS_ROTACION_RAW = process.env.QUIVO_DIAS_ROTACION;
const DIAS_ROTACION = DIAS_ROTACION_RAW ? Number(DIAS_ROTACION_RAW) : 21;
if (!Number.isInteger(DIAS_ROTACION) || DIAS_ROTACION < 1) {
  console.error(`QUIVO_DIAS_ROTACION debe ser un entero positivo, se recibió "${DIAS_ROTACION_RAW}". Abortando.`);
  process.exit(1);
}

// ============================================================================================
// Estado local (reanudabilidad) — ver "Reanudable e idempotente" en la cabecera.
// ============================================================================================

interface EstadoSiembra {
  sindicatoId?: string;
  // ---- LEGADO (socio/vehículo del diseño viejo, 2 vehículos compartidos) — NUNCA se vuelve a
  // escribir en estos campos desde esta versión del script; solo se leen, como puente hacia el
  // estado nuevo de abajo (ver `puentearDesdeLegado`). Conservan los ids reales de lo que ya
  // existe en producción (socio/vehículo del conductor #1 en `z12`, del conductor #4 en
  // `l120`) — no tocar a mano.
  socios?: { z12?: string; l120?: string };
  vehiculos?: { z12?: string; l120?: string };
  vehiculosActivados?: { z12?: boolean; l120?: boolean };
  /** Id de la ÚNICA rotación del piloto — no legado, sigue siendo la que se usa: este diseño
   * la migra in situ (despublicar → editar asignaciones → publicar), NO crea una rotación
   * nueva (ver Pasos 10-13). */
  rotacionId?: string;
  /** Legado del primer `generar()` (creación original de la rotación) — sin uso activo en
   * esta versión, se conserva solo por compatibilidad con archivos de estado viejos. */
  rotacionJunkLimpiado?: boolean;
  /** Clave `${vehiculoId}|${fechaIso}|${horario}` -> id de asignación. Fuente de verdad ÚNICA
   * y ACTIVA de qué asignaciones existen en la rotación (`rotacionId`) — a diferencia de los
   * demás campos legado, ESTE campo SÍ se sigue escribiendo: el Paso 11 borra de acá las
   * claves tarde/noche que borra de verdad en la API, y el Paso 12 agrega acá las claves
   * "manana" nuevas que crea de verdad. Al terminar la migración contiene exactamente las 126
   * claves del diseño nuevo (42 "manana" heredadas sin tocar + 84 "manana" nuevas). */
  asignaciones?: Record<string, string>;
  /** Refleja el estado REAL de `rotacionId` en todo momento — `true` = publicada (estado
   * inicial real de producción), `false` = despublicada (Paso 10 la puso así, Paso 13 la
   * vuelve a `true`). Mientras esté en `false`, NADIE puede loguearse — ver "TRAMO
   * PELIGROSO" en el comentario de los Pasos 10-13. */
  rotacionPublicada?: boolean;
  // ---- Resto de entidades compartidas (sin cambios de forma) ----
  lineas?: { z12?: string; l120?: string };
  rutas?: { z12?: string; l120?: string };
  /** Ids devueltos por cada POST de punto de control, en el mismo orden/índice que la lista
   * fuente correspondiente (`PUNTOS_Z12`/`PUNTOS_120_A_ENVIAR`) — permite reanudar a mitad de
   * un loop de 26 o 12 llamadas. */
  puntosControl?: { z12?: (string | undefined)[]; l120?: (string | undefined)[] };
  /** 6 entradas, índice 0..5 = conductor 1..6. */
  conductores?: (string | undefined)[];
  pinesFijados?: (boolean | undefined)[];
  // ---- DISEÑO 1:1 (1 vehículo por conductor, 6 en total) — índice 0..5 = conductor #1..#6.
  // Los índices 0 y 3 (vehículo/socio de los conductores #1 y #4) se puentean desde el
  // legado de arriba la primera vez que se necesitan (`puentearDesdeLegado`) y de ahí en más
  // quedan acá — el legado nunca se vuelve a tocar.
  sociosPorConductor?: (string | undefined)[];
  vehiculosPorConductor?: (string | undefined)[];
  vehiculosActivadosPorConductor?: (boolean | undefined)[];
  /** Claves (mismo formato `${vehiculoId}|${fechaIso}|${horario}` que `asignaciones`) de filas
   * tarde/noche del diseño viejo que se intentaron borrar y fallaron — casi siempre porque
   * tienen una `SesionOperativa` real encima (`onDelete: Restrict`, 500 de la API, ver el
   * Paso 12). Se marcan acá para que una corrida futura no las reintente cada vez; es un
   * registro de "ya se intentó, no insistir solo", no de "esto está mal". */
  asignacionesImborrables?: Record<string, true>;
}

function cargarEstado(): EstadoSiembra {
  if (!fs.existsSync(ESTADO_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(ESTADO_PATH, 'utf8')) as EstadoSiembra;
  } catch (err) {
    console.error(`No se pudo leer/parsear ${ESTADO_PATH} — corrupto. Abortando (revisar a mano antes de continuar).`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

const estado: EstadoSiembra = cargarEstado();

function guardarEstado(): void {
  // Solo en --apply: en dry-run el estado nunca se toca (ni se lee dos veces distinto, ni se
  // escribe), para que un dry-run nunca tenga efectos secundarios en disco.
  if (!APLICAR) return;
  // Escritura atómica (encontrado en `/code-review`): esto se llama ~190 veces por corrida
  // completa (una vez por cada id que se persiste). Un `writeFileSync` directo sobre
  // `ESTADO_PATH` deja el archivo TRUNCADO si el proceso muere a mitad de la escritura (Ctrl-C,
  // OOM, corte de luz) — y como no hay endpoint DELETE, un estado corrupto significa no poder
  // reanudar SIN duplicar filas que después no se pueden borrar. Escribir a un `.tmp` y
  // `renameSync` encima es atómico en el mismo filesystem (POSIX): o queda el archivo viejo
  // completo, o el nuevo completo, nunca algo a medias.
  const tmpPath = `${ESTADO_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(estado, null, 2) + '\n');
  fs.renameSync(tmpPath, ESTADO_PATH);
}

// ============================================================================================
// Cliente HTTP mínimo — un solo punto de entrada para todas las llamadas, para que el
// contrato "para en el primer error con status+body" y "nunca loguea pin/password" se cumpla
// en un solo lugar en vez de repetirse en cada paso.
// ============================================================================================

let accessToken: string | undefined;
let llamadasPlaneadas = 0;
let llamadasEjecutadas = 0;

function redactar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(redactar);
  if (valor && typeof valor === 'object') {
    const copia: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      copia[k] = k === 'pin' || k === 'password' ? '(oculto)' : redactar(v);
    }
    return copia;
  }
  return valor;
}

/** Resumen compacto de un body para el plan de dry-run — nunca el JSON completo de geometrías
 * (podrían ser miles de vértices), solo sus claves "livianas" + el conteo de vértices si
 * corresponde. */
function resumirBody(body: unknown): string {
  if (body === undefined) return '(sin body)';
  const redactado = redactar(body) as Record<string, unknown>;
  const resumen: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(redactado)) {
    if (k === 'geometria' && v && typeof v === 'object' && 'coordinates' in v) {
      const coords = (v as { coordinates: unknown[] }).coordinates;
      resumen[k] = `LineString(${coords.length} vértices)`;
    } else {
      resumen[k] = v;
    }
  }
  return JSON.stringify(resumen);
}

class ErrorApi extends Error {}

// Rate limit real de la API: 100 req/min/IP (`ThrottlerModule.forRoot([{ ttl: 60_000, limit:
// 100 }])`, apps/api/src/app.module.ts) — nos cortó dos veces corriendo este mismo script.
// `RATE_LIMIT_ESPERA_MS` es la ventana completa del throttler (fallback cuando la respuesta no
// trae `Retry-After`); `RATE_LIMIT_MAX_REINTENTOS` acota cuántas veces se reintenta la MISMA
// llamada antes de rendirse y abortar como cualquier otro error.
const RATE_LIMIT_ESPERA_MS = 60_000;
const RATE_LIMIT_MAX_REINTENTOS = 5;

let reintentosPorRateLimit = 0;

function esperarMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Único punto desde el que este script habla con la API. En dry-run nunca llama a `fetch` —
 * solo cuenta y, si `logPlan` no es false, imprime la línea del plan. En `--apply`, hace la
 * llamada real y para el script entero (throw) en el primer error, con status + cuerpo — CON
 * UNA EXCEPCIÓN: un 429 (`ThrottlerException`, rate limit) no aborta, espera y reintenta la
 * misma llamada (ver constantes de arriba). */
async function llamar(metodo: string, path: string, body?: unknown, opts: { logPlan?: boolean } = {}): Promise<unknown> {
  llamadasPlaneadas++;
  if (!APLICAR) {
    if (opts.logPlan !== false) {
      console.log(`  SE HARÍA: ${metodo} ${path}  body=${resumirBody(body)}`);
    }
    return undefined;
  }

  llamadasEjecutadas++;

  for (let intento = 0; ; intento++) {
    const res = await fetch(`${API_URL}${path}`, {
      method: metodo,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (res.status === 429) {
      // Se descarta el cuerpo de la respuesta 429 (no aporta nada más que el mensaje genérico
      // de ThrottlerException) — no hace falta leerlo antes de decidir si reintentar.
      if (intento >= RATE_LIMIT_MAX_REINTENTOS) {
        throw new ErrorApi(`${metodo} ${path} → HTTP 429 (rate limit) tras ${intento} reintento(s). Abortando.`);
      }
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterSegundos = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const esperaMs = Number.isFinite(retryAfterSegundos) && retryAfterSegundos > 0 ? retryAfterSegundos * 1000 : RATE_LIMIT_ESPERA_MS;
      reintentosPorRateLimit++;
      console.warn(
        `  ⏳ 429 (rate limit) en ${metodo} ${path} — esperando ${Math.round(esperaMs / 1000)}s antes de reintentar ` +
          `(intento ${intento + 1}/${RATE_LIMIT_MAX_REINTENTOS})...`,
      );
      await esperarMs(esperaMs);
      continue;
    }

    const texto = await res.text();
    let cuerpo: unknown = undefined;
    if (texto.length > 0) {
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        cuerpo = texto;
      }
    }

    if (!res.ok) {
      const cuerpoTexto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo, null, 2);
      throw new ErrorApi(`${metodo} ${path} → HTTP ${res.status}\n${cuerpoTexto}`);
    }
    return cuerpo;
  }
}

// ============================================================================================
// Login — POST /v1/auth/login (5 intentos/min, se llama UNA sola vez por corrida).
// ============================================================================================

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; rol: string; sindicatoId: string | null };
}

async function login(): Promise<void> {
  console.log('--- Login (POST /v1/auth/login) ---');
  if (!APLICAR) {
    llamadasPlaneadas++;
    console.log('  SE HARÍA: POST /v1/auth/login  body={"email":"(oculto)","password":"(oculto)"}');
    console.log('  (dry-run: no se autentica de verdad, los pasos siguientes solo listan lo que harían)');
    return;
  }
  const respuesta = (await llamar('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { logPlan: false })) as LoginResponse;
  accessToken = respuesta.accessToken;
  console.log(`  OK — autenticado como ${respuesta.user.email} (rol=${respuesta.user.rol}).`);
  if (respuesta.user.rol !== 'admin_quivo') {
    console.warn(
      `  ⚠ El usuario autenticado tiene rol "${respuesta.user.rol}", no "admin_quivo". Varios pasos de este ` +
        'script (crear sindicato, generar rotación) exigen admin_quivo — es probable que fallen más adelante.',
    );
  }
}

// ============================================================================================
// Geometría — Z12 (subida + conector interpolado vía Salomón + bajada) y 120 (ida + vuelta,
// concatenadas sin deduplicar). Helpers copiados a propósito de cargar-circuito-z12.ts /
// cargar-linea-120.ts (mismo motivo que esos dos: este script es standalone, no importa nada
// de packages/ en runtime).
// ============================================================================================

type Coord = [number, number]; // [lon, lat], GeoJSON estándar (RFC 7946)

const RADIO_TIERRA_METROS = 6_371_000;

function haversineMetros(a: Coord, b: Coord): number {
  const [lonA, latA] = a;
  const [lonB, latB] = b;
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLon = (lonB - lonA) * rad;
  const senoLat = Math.sin(dLat / 2);
  const senoLon = Math.sin(dLon / 2);
  const h = senoLat * senoLat + Math.cos(latA * rad) * Math.cos(latB * rad) * senoLon * senoLon;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function redondear(n: number): number {
  return Math.round(n * 1e7) / 1e7; // ~1.1 cm de precisión
}

/** Copiado de cargar-circuito-z12.ts — interpola una línea recta (lon/lat lineal, no
 * geodésica) entre `inicio` y `fin`, vértices espaciados ~`espaciadoM` metros. Solo los
 * puntos INTERIORES (sin `inicio` ni `fin`), para que el llamador no duplique vértices. */
function interpolarRecta(inicio: Coord, fin: Coord, espaciadoM: number): Coord[] {
  const distanciaTotal = haversineMetros(inicio, fin);
  const segmentos = Math.max(1, Math.round(distanciaTotal / espaciadoM));
  const puntos: Coord[] = [];
  for (let i = 1; i < segmentos; i++) {
    const t = i / segmentos;
    puntos.push([redondear(inicio[0] + (fin[0] - inicio[0]) * t), redondear(inicio[1] + (fin[1] - inicio[1]) * t)]);
  }
  return puntos;
}

function cargarLineStringJson(rutaArchivo: string): Coord[] {
  const contenido = JSON.parse(fs.readFileSync(rutaArchivo, 'utf8')) as { type: string; coordinates: Coord[] };
  if (contenido.type !== 'LineString' || !Array.isArray(contenido.coordinates) || contenido.coordinates.length < 2) {
    throw new Error(`${rutaArchivo} no es un GeoJSON LineString válido (>= 2 vértices).`);
  }
  return contenido.coordinates.map(([lon, lat]) => [redondear(lon), redondear(lat)] as Coord);
}

const CONECTOR_ESPACIADO_M = 50;

/** Coordenada real de la parada "Salomón" — ver "Otras decisiones" en la cabecera del
 * archivo para de dónde sale este número y cómo se verificó. */
const SALOMON_COORD: Coord = [-66.2285535, -17.3174191];

interface GeometriaZ12 {
  coordinates: Coord[];
}

function construirGeometriaZ12(): GeometriaZ12 {
  const subida = cargarLineStringJson(Z12_SUBIDA_PATH);
  const bajada = cargarLineStringJson(Z12_BAJADA_PATH);
  const subidaFin = subida[subida.length - 1]!;
  const bajadaInicio = bajada[0]!;

  const conectorTramo1 = interpolarRecta(subidaFin, SALOMON_COORD, CONECTOR_ESPACIADO_M);
  const conectorTramo2 = interpolarRecta(SALOMON_COORD, bajadaInicio, CONECTOR_ESPACIADO_M);
  const coordinates: Coord[] = [...subida, ...conectorTramo1, SALOMON_COORD, ...conectorTramo2, ...bajada];

  console.log(
    `  Z12: subida ${subida.length} + conector ${conectorTramo1.length + 1 + conectorTramo2.length} ` +
      `(vía Salomón) + bajada ${bajada.length} = ${coordinates.length} vértices.`,
  );
  return { coordinates };
}

// --- Parser mínimo del KML de la 120 — regex sobre texto crudo, mismo motivo que
// cargar-linea-120.ts (no hay librería XML en node_modules del repo). Acá solo se necesitan
// las 2 LineString del tronco, no las 8 de ramal ni las 10 paradas.
function extraerLineStringKml(kmlTexto: string, nombrePlacemark: string): Coord[] {
  const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let match: RegExpExecArray | null;
  while ((match = placemarkRegex.exec(kmlTexto)) !== null) {
    const bloque = match[1]!;
    const nombreMatch = bloque.match(/<name>([\s\S]*?)<\/name>/);
    const nombre = nombreMatch ? nombreMatch[1]!.trim() : '';
    if (nombre !== nombrePlacemark) continue;
    const lsMatch = bloque.match(/<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!lsMatch) throw new Error(`Placemark "${nombrePlacemark}" no tiene <LineString><coordinates>.`);
    const coords = lsMatch[1]!
      .trim()
      .split(/\s+/)
      .filter((tok) => tok.length > 0)
      .map((tok) => {
        const partes = tok.split(',');
        const lon = Number(partes[0]);
        const lat = Number(partes[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`Coordenada KML inválida: "${tok}"`);
        if (Math.abs(lon) <= 90 && Math.abs(lat) > 90) throw new Error(`Coordenada [${lon}, ${lat}] parece [lat, lon] invertido.`);
        return [redondear(lon), redondear(lat)] as Coord;
      });
    if (coords.length < 2) throw new Error(`Placemark "${nombrePlacemark}": menos de 2 vértices.`);
    return coords;
  }
  throw new Error(`No se encontró el Placemark "${nombrePlacemark}" en ${KML_120_PATH}.`);
}

const KML_TRONCO_IDA_120 = 'RUTA 120 DE NORTE A SUD';
const KML_TRONCO_VUELTA_120 = 'RETORNO LINEA 120 SUD A NORTE';

function construirGeometria120(): GeometriaZ12 {
  const kmlTexto = fs.readFileSync(KML_120_PATH, 'utf8');
  const ida = extraerLineStringKml(kmlTexto, KML_TRONCO_IDA_120);
  const vuelta = extraerLineStringKml(kmlTexto, KML_TRONCO_VUELTA_120);
  // Concatenados TAL CUAL, sin deduplicar ningún vértice (brief explícito) — mismo criterio
  // que la corrida real de cargar-linea-120.ts documenta para su ruta "circuito".
  const coordinates: Coord[] = [...ida, ...vuelta];
  console.log(`  120: ida ${ida.length} + vuelta ${vuelta.length} (sin deduplicar) = ${coordinates.length} vértices.`);
  return { coordinates };
}

// ============================================================================================
// Puntos de control — datos fuente
// ============================================================================================

interface PuntoControlFuente {
  id: string;
  lon: number;
  lat: number;
  radioToleranciaM: number;
  obligatorio: boolean;
}

function cargarPuntosZ12(): PuntoControlFuente[] {
  const contenido = JSON.parse(fs.readFileSync(Z12_PUNTOS_PATH, 'utf8')) as {
    puntos: { orden: number; lon: number; lat: number; radioToleranciaM: number; obligatorio: boolean }[];
  };
  return contenido.puntos
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((p) => ({ id: `z12-orden-${p.orden}`, lon: p.lon, lat: p.lat, radioToleranciaM: p.radioToleranciaM, obligatorio: p.obligatorio }));
}

interface PuntoControlAndry {
  id: string;
  lat: number;
  lon: number;
  nota: string;
}

/** Los 12 de los 16 puntos de `puntos-control-andry.json` que SÍ caen a <100 m de la
 * geometría tronco-only de la 120 (ver "Otras decisiones" en la cabecera) — en secuencia real
 * de recorrido: terminal norte → ida norte→sud → terminal sur → retorno sud→norte, con `C1`
 * (mismo lugar físico que `A1`, ~12 m) al final. `A2`/`A3`/`C2`/`C3` (ramales) quedan afuera
 * a propósito — no se mandan, se documenta por qué en la cabecera del archivo. */
const ORDEN_PUNTOS_120 = ['A1', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'N10', 'C1'] as const;
const PUNTOS_120_OMITIDOS = ['A2', 'A3', 'C2', 'C3'] as const;

/** `radioToleranciaM`/`obligatorio` para los puntos de la 120 — mismo criterio que documenta
 * `cargar-linea-120.ts` para el tronco real: 150 m de tolerancia (igual que los puntos activos
 * de la Z12 de este mismo script); `obligatorio = true` en los dos extremos geométricos
 * (`A1` terminal norte, `N10` cierre del retorno) y en `N6` (terminal sur, donde arranca el
 * regreso) — el resto, intermedios, en `false`. `C1` (mismo lugar físico que `A1`) va en
 * `false`: ya está cubierto por `A1` como extremo obligatorio, no hace falta duplicarlo. */
const RADIO_TOLERANCIA_120_M = 150;
const OBLIGATORIOS_120 = new Set(['A1', 'N6', 'N10']);

function cargarPuntos120(): { aEnviar: PuntoControlFuente[]; omitidos: PuntoControlAndry[] } {
  const contenido = JSON.parse(fs.readFileSync(PUNTOS_120_PATH, 'utf8')) as { puntos: PuntoControlAndry[] };
  const porId = new Map(contenido.puntos.map((p) => [p.id, p]));

  const aEnviar: PuntoControlFuente[] = ORDEN_PUNTOS_120.map((id) => {
    const p = porId.get(id);
    if (!p) throw new Error(`${PUNTOS_120_PATH}: no se encontró el punto "${id}" esperado por ORDEN_PUNTOS_120.`);
    return {
      id: p.id,
      lon: p.lon,
      lat: p.lat,
      radioToleranciaM: RADIO_TOLERANCIA_120_M,
      obligatorio: OBLIGATORIOS_120.has(p.id),
    };
  });

  const omitidos = PUNTOS_120_OMITIDOS.map((id) => {
    const p = porId.get(id);
    if (!p) throw new Error(`${PUNTOS_120_PATH}: no se encontró el punto "${id}" esperado por PUNTOS_120_OMITIDOS.`);
    return p;
  });

  return { aEnviar, omitidos };
}

// ============================================================================================
// Fechas — copiado del mismo patrón que crear-credenciales-piloto.ts/cargar-linea-120.ts
// (calendario Bolivia, viajan como texto 'YYYY-MM-DD').
// ============================================================================================

const BOLIVIA_UTC_OFFSET_HOURS = 4;

function fechaActualBolivia(ahora: Date = new Date()): Date {
  const bolivia = new Date(ahora.getTime() - BOLIVIA_UTC_OFFSET_HOURS * 3_600_000);
  return new Date(Date.UTC(bolivia.getUTCFullYear(), bolivia.getUTCMonth(), bolivia.getUTCDate()));
}

function sumarDiasUtc(fecha: Date, dias: number): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + dias));
}

function fechaIsoDeUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

// ============================================================================================
// Datos de las entidades a crear — nombres/documentos ficticios pero válidos (ver regex de
// cada schema en packages/shared/src/entities/*.ts e identidad-bolivia.ts).
// ============================================================================================

const NOMBRE_SINDICATO = 'Sindicato Piloto — Producción';

/** 6 socios, uno por vehículo/conductor — índice 0..5 = conductor #1..#6. Los índices 0 y 3
 * (socios de 9001TST/9004TST) YA EXISTEN en producción (diseño viejo, `estado.socios.z12`/
 * `.l120`) — se listan igual acá para que `crearSociosPorConductor` tenga datos uniformes,
 * pero esa función los detecta vía el puente al legado y NUNCA los vuelve a mandar. */
const SOCIOS_POR_CONDUCTOR = [
  { nombre: 'Ramiro Quispe Mamani', documentoIdentidad: '9000101 CB' }, // #1 — legado (socios.z12)
  { nombre: 'Freddy Ariel Vargas Choque', documentoIdentidad: '9000103 CB' }, // #2 — nuevo
  { nombre: 'Nelly Patricia Rojas Illanes', documentoIdentidad: '9000104 CB' }, // #3 — nuevo
  { nombre: 'Teodora Choque Flores', documentoIdentidad: '9000102 CB' }, // #4 — legado (socios.l120)
  { nombre: 'Wilson Edgar Poma Ticona', documentoIdentidad: '9000105 CB' }, // #5 — nuevo
  { nombre: 'Carmen Rosa Yucra Mamani', documentoIdentidad: '9000106 CB' }, // #6 — nuevo
] as const;

const CONDUCTORES = [
  { nombre: 'Marco Antonio Villca Poma', documentoIdentidad: '9000001 CB', licenciaConducir: 'LIC-9000001' },
  { nombre: 'Elena Rocío Fernández Quispe', documentoIdentidad: '9000002 CB', licenciaConducir: 'LIC-9000002' },
  { nombre: 'Juan Carlos Mamani Rojas', documentoIdentidad: '9000003 CB', licenciaConducir: 'LIC-9000003' },
  { nombre: 'Betty Choquehuanca Yucra', documentoIdentidad: '9000004 CB', licenciaConducir: 'LIC-9000004' },
  { nombre: 'Gonzalo Iván Torrez Salazar', documentoIdentidad: '9000005 CB', licenciaConducir: 'LIC-9000005' },
  { nombre: 'Rosa Ninoska Aguilar Vargas', documentoIdentidad: '9000006 CB', licenciaConducir: 'LIC-9000006' },
] as const;

/** Diseño nuevo (1:1): un solo horario para las 6 asignaciones diarias — cada vehículo tiene
 * un único conductor, no hace falta repartir turnos dentro del mismo vehículo. */
const HORARIO_UNICO = 'manana' as const;

// ============================================================================================
// Paso 1 — Sindicato
// ============================================================================================

async function crearSindicato(): Promise<string> {
  console.log('\n--- Paso 1: sindicato (POST /v1/sindicatos) ---');
  if (estado.sindicatoId) {
    console.log(`  Ya existe (estado local): ${estado.sindicatoId} — se omite.`);
    return estado.sindicatoId;
  }
  const body = { nombre: NOMBRE_SINDICATO, estado: 'activo' };
  const respuesta = (await llamar('POST', '/sindicatos', body)) as { id: string } | undefined;
  if (!APLICAR) return 'PENDIENTE:sindicato';
  estado.sindicatoId = respuesta!.id;
  guardarEstado();
  console.log(`  Creado: ${estado.sindicatoId}`);
  return estado.sindicatoId;
}

// ============================================================================================
// Paso 2 — Socios
// ============================================================================================

/** Puente legado→nuevo: si el índice `idx` del array nuevo todavía no tiene id pero el campo
 * legado sí, se copia UNA vez (sin volver a escribir el legado) y de ahí en más vive en el
 * array nuevo. No hace nada si `idx` ya tiene id (nuevo o re-leído de una corrida anterior) o
 * si el legado tampoco lo tiene (índices que nunca fueron legado, o corrida desde cero). */
function puentearDesdeLegado(destino: (string | undefined)[], idx: number, valorLegado: string | undefined): void {
  if (!destino[idx] && valorLegado) {
    destino[idx] = valorLegado;
    guardarEstado();
  }
}

async function crearSocios(sindicatoId: string): Promise<string[]> {
  console.log('\n--- Paso 2: socios, uno por conductor (POST /v1/socios) ---');
  estado.sociosPorConductor ??= new Array(SOCIOS_POR_CONDUCTOR.length).fill(undefined);
  puentearDesdeLegado(estado.sociosPorConductor, 0, estado.socios?.z12); // #1 — 9001TST
  puentearDesdeLegado(estado.sociosPorConductor, 3, estado.socios?.l120); // #4 — 9004TST

  for (let i = 0; i < SOCIOS_POR_CONDUCTOR.length; i++) {
    if (estado.sociosPorConductor[i]) {
      console.log(`  Socio #${i + 1} ya existe (estado local): ${estado.sociosPorConductor[i]} — se omite.`);
      continue;
    }
    const s = SOCIOS_POR_CONDUCTOR[i]!;
    const body = { sindicatoId, nombre: s.nombre, documentoIdentidad: s.documentoIdentidad };
    const respuesta = (await llamar('POST', '/socios', body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.sociosPorConductor[i] = respuesta!.id;
      guardarEstado();
      console.log(`  Socio #${i + 1} (${s.nombre}) creado: ${estado.sociosPorConductor[i]}`);
    }
  }
  return estado.sociosPorConductor.map((id, i) => id ?? `PENDIENTE:socio-${i + 1}`);
}

// ============================================================================================
// Paso 3 — Líneas (con branding)
// ============================================================================================

interface BrandingLinea {
  color: string;
  colorSecundario: string;
  colorTexto: string;
  colorTerciario: string;
  colorFondo: string;
  nombreCorto: string;
  lema: string;
  descripcion: string;
  distintivoTipo: 'numero';
  distintivoValor: string;
  cartelSuperior: string;
  cartelFormato: 'doble_clasico';
  cartelTitulo: string;
  cartelDetalle: string;
  cartelNumeroPosicion: 'izquierda';
  cartelLogoPosicion: 'ninguno';
  cartelColorTitulo: string;
  cartelColorDetalle: string;
  cartelColorNumero: string;
  cartelColorBorde: string;
}

const BRANDING_Z12: BrandingLinea = {
  color: '#E4572E',
  colorSecundario: '#1B1B1E',
  colorTexto: '#FFFFFF',
  colorTerciario: '#F2A93B',
  colorFondo: '#FFF4E8',
  nombreCorto: 'Z12',
  lema: 'Circuito Villa Armonía — Univalle — Salomón',
  descripcion: 'Circuito real del sindicato piloto, cargado con geometría GPS real.',
  distintivoTipo: 'numero',
  distintivoValor: 'Z12',
  cartelSuperior: 'Z12',
  cartelFormato: 'doble_clasico',
  cartelTitulo: 'Z12',
  cartelDetalle: 'Circuito',
  cartelNumeroPosicion: 'izquierda',
  cartelLogoPosicion: 'ninguno',
  cartelColorTitulo: '#FFFFFF',
  cartelColorDetalle: '#FFF4E8',
  cartelColorNumero: '#FFFFFF',
  cartelColorBorde: '#1B1B1E',
};

const BRANDING_120: BrandingLinea = {
  color: '#2864DC',
  colorSecundario: '#0F766E',
  colorTexto: '#FFFFFF',
  colorTerciario: '#FD9E15',
  colorFondo: '#EFF6FF',
  nombreCorto: '120',
  lema: 'Norte–Sud, ida y vuelta',
  descripcion: 'Tronco norte-sud del sindicato piloto (ida + vuelta), geometría real del KML del sindicato.',
  distintivoTipo: 'numero',
  distintivoValor: '120',
  cartelSuperior: '120',
  cartelFormato: 'doble_clasico',
  cartelTitulo: '120',
  cartelDetalle: 'Norte-Sud',
  cartelNumeroPosicion: 'izquierda',
  cartelLogoPosicion: 'ninguno',
  cartelColorTitulo: '#FFFFFF',
  cartelColorDetalle: '#EFF6FF',
  cartelColorNumero: '#FFFFFF',
  cartelColorBorde: '#0F766E',
};

const CIUDAD_ID = 'cochabamba';

async function crearLineas(sindicatoId: string): Promise<{ z12: string; l120: string }> {
  console.log('\n--- Paso 3: líneas Z12 y 120, con branding (POST /v1/lineas) ---');
  estado.lineas ??= {};

  const crear = async (clave: 'z12' | 'l120', codigo: string, nombre: string, branding: BrandingLinea) => {
    if (estado.lineas![clave]) {
      console.log(`  Línea ${codigo} ya existe (estado local): ${estado.lineas![clave]} — se omite.`);
      return;
    }
    const body = { sindicatoId, cityId: CIUDAD_ID, codigo, nombre, ...branding };
    const respuesta = (await llamar('POST', '/lineas', body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.lineas![clave] = respuesta!.id;
      guardarEstado();
      console.log(`  Línea ${codigo} creada: ${estado.lineas![clave]}`);
    }
  };

  await crear('z12', 'Z12', 'Zona 12', BRANDING_Z12);
  await crear('l120', '120', 'Línea 120', BRANDING_120);

  return {
    z12: estado.lineas.z12 ?? 'PENDIENTE:linea-z12',
    l120: estado.lineas.l120 ?? 'PENDIENTE:linea-120',
  };
}

// ============================================================================================
// Paso 4 — Rutas con geometría real
// ============================================================================================

async function crearRutas(lineaZ12Id: string, linea120Id: string): Promise<{ z12: string; l120: string }> {
  console.log('\n--- Paso 4: rutas con geometría real (POST /v1/lineas/:lineaId/rutas) ---');
  estado.rutas ??= {};

  if (!estado.rutas.z12) {
    const geometria = construirGeometriaZ12();
    const body = { sentido: 'circuito', geometria: { type: 'LineString', coordinates: geometria.coordinates }, estado: 'activo' };
    const respuesta = (await llamar('POST', `/lineas/${lineaZ12Id}/rutas`, body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.rutas.z12 = respuesta!.id;
      guardarEstado();
      console.log(`  Ruta Z12 creada: ${estado.rutas.z12}`);
    }
  } else {
    console.log(`  Ruta Z12 ya existe (estado local): ${estado.rutas.z12} — se omite.`);
  }

  if (!estado.rutas.l120) {
    const geometria = construirGeometria120();
    const body = { sentido: 'circuito', geometria: { type: 'LineString', coordinates: geometria.coordinates }, estado: 'activo' };
    const respuesta = (await llamar('POST', `/lineas/${linea120Id}/rutas`, body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.rutas.l120 = respuesta!.id;
      guardarEstado();
      console.log(`  Ruta 120 creada: ${estado.rutas.l120}`);
    }
  } else {
    console.log(`  Ruta 120 ya existe (estado local): ${estado.rutas.l120} — se omite.`);
  }

  return {
    z12: estado.rutas.z12 ?? 'PENDIENTE:ruta-z12',
    l120: estado.rutas.l120 ?? 'PENDIENTE:ruta-120',
  };
}

// ============================================================================================
// Paso 5 — Puntos de control
// ============================================================================================

async function crearPuntosControlPorRuta(rutaId: string, puntos: PuntoControlFuente[], destino: (string | undefined)[]): Promise<void> {
  for (let i = 0; i < puntos.length; i++) {
    if (destino[i]) {
      console.log(`    [${i}] ${puntos[i]!.id}: ya existe (estado local): ${destino[i]} — se omite.`);
      continue;
    }
    const punto = puntos[i]!;
    const body = {
      orden: i,
      coord: { type: 'Point', coordinates: [punto.lon, punto.lat] },
      radioToleranciaM: punto.radioToleranciaM,
      obligatorio: punto.obligatorio,
      estado: 'activo',
    };
    const respuesta = (await llamar('POST', `/rutas/${rutaId}/puntos-control`, body, { logPlan: false })) as { id: string } | undefined;
    if (APLICAR) {
      destino[i] = respuesta!.id;
      guardarEstado();
    }
  }
}

async function crearPuntosControl(rutaZ12Id: string, ruta120Id: string): Promise<void> {
  console.log('\n--- Paso 5: puntos de control (POST /v1/rutas/:rutaId/puntos-control) ---');

  const puntosZ12 = cargarPuntosZ12();
  const { aEnviar: puntos120, omitidos } = cargarPuntos120();

  console.log(`  Z12: ${puntosZ12.length} puntos (de scripts/data/z12-circuito/puntos-control.json).`);
  console.log(`  120: ${puntos120.length} puntos a enviar (${ORDEN_PUNTOS_120.join(', ')}).`);
  console.log(
    `  120: ${omitidos.length} puntos OMITIDOS a propósito (quedan a >1 km de la geometría tronco-only): ` +
      omitidos.map((p) => p.id).join(', ') +
      ' — ver "Otras decisiones" en la cabecera del archivo.',
  );

  estado.puntosControl ??= {};
  estado.puntosControl.z12 ??= new Array(puntosZ12.length).fill(undefined);
  estado.puntosControl.l120 ??= new Array(puntos120.length).fill(undefined);

  if (!APLICAR) {
    const pendientesZ12 = puntosZ12.filter((_, i) => !estado.puntosControl!.z12![i]).length;
    const pendientes120 = puntos120.filter((_, i) => !estado.puntosControl!.l120![i]).length;
    llamadasPlaneadas += pendientesZ12 + pendientes120;
    console.log(`  SE HARÍAN: ${pendientesZ12} POST /v1/rutas/${rutaZ12Id}/puntos-control (Z12, orden 0..${puntosZ12.length - 1}).`);
    console.log(`  SE HARÍAN: ${pendientes120} POST /v1/rutas/${ruta120Id}/puntos-control (120, orden 0..${puntos120.length - 1}).`);
    return;
  }

  console.log('  Z12:');
  await crearPuntosControlPorRuta(rutaZ12Id, puntosZ12, estado.puntosControl.z12);
  console.log(`  Z12: ${estado.puntosControl.z12.filter(Boolean).length}/${puntosZ12.length} puntos listos.`);

  console.log('  120:');
  await crearPuntosControlPorRuta(ruta120Id, puntos120, estado.puntosControl.l120);
  console.log(`  120: ${estado.puntosControl.l120.filter(Boolean).length}/${puntos120.length} puntos listos.`);
}

// ============================================================================================
// Paso 6 — Vehículos (nacen 'pendiente')
// ============================================================================================

interface DatosVehiculo {
  placa: string;
  tipo: string;
  marca: string;
  modelo: string;
  color: string;
  capacidad: number;
}

/** 6 vehículos, uno por conductor — índice 0..5 = conductor #1..#6, `rutaClave` dice a qué
 * ruta (Z12 o 120) va cada uno (ver tabla del brief). Los índices 0 y 3 (9001TST, 9004TST) YA
 * EXISTEN en producción (diseño viejo, `estado.vehiculos.z12`/`.l120`) — mismo criterio que
 * `SOCIOS_POR_CONDUCTOR`: se listan igual para datos uniformes, `crearVehiculosPorConductor`
 * los puentea desde el legado y nunca los recrea. */
const VEHICULOS_POR_CONDUCTOR: { datos: DatosVehiculo; rutaClave: 'z12' | 'l120' }[] = [
  { datos: { placa: '9001TST', tipo: 'minibus', marca: 'Toyota', modelo: 'Hiace', color: 'blanco', capacidad: 18 }, rutaClave: 'z12' }, // #1 legado
  { datos: { placa: '9002TST', tipo: 'minibus', marca: 'Toyota', modelo: 'Hiace', color: 'blanco', capacidad: 18 }, rutaClave: 'z12' }, // #2 nuevo
  { datos: { placa: '9003TST', tipo: 'minibus', marca: 'Toyota', modelo: 'Hiace', color: 'blanco', capacidad: 18 }, rutaClave: 'z12' }, // #3 nuevo
  { datos: { placa: '9004TST', tipo: 'minibus', marca: 'Nissan', modelo: 'Urvan', color: 'verde', capacidad: 18 }, rutaClave: 'l120' }, // #4 legado
  { datos: { placa: '9005TST', tipo: 'minibus', marca: 'Nissan', modelo: 'Urvan', color: 'verde', capacidad: 18 }, rutaClave: 'l120' }, // #5 nuevo
  { datos: { placa: '9006TST', tipo: 'minibus', marca: 'Nissan', modelo: 'Urvan', color: 'verde', capacidad: 18 }, rutaClave: 'l120' }, // #6 nuevo
];

async function crearVehiculos(sindicatoId: string, sociosPorConductor: string[]): Promise<string[]> {
  console.log('\n--- Paso 6: vehículos, uno por conductor (POST /v1/vehiculos, nacen "pendiente") ---');
  estado.vehiculosPorConductor ??= new Array(VEHICULOS_POR_CONDUCTOR.length).fill(undefined);
  puentearDesdeLegado(estado.vehiculosPorConductor, 0, estado.vehiculos?.z12); // #1 — 9001TST
  puentearDesdeLegado(estado.vehiculosPorConductor, 3, estado.vehiculos?.l120); // #4 — 9004TST

  for (let i = 0; i < VEHICULOS_POR_CONDUCTOR.length; i++) {
    const { datos } = VEHICULOS_POR_CONDUCTOR[i]!;
    if (estado.vehiculosPorConductor[i]) {
      console.log(`  Vehículo ${datos.placa} (#${i + 1}) ya existe (estado local): ${estado.vehiculosPorConductor[i]} — se omite.`);
      continue;
    }
    const body = {
      sindicatoId,
      socioId: sociosPorConductor[i],
      placa: datos.placa,
      tipo: datos.tipo,
      marca: datos.marca,
      modelo: datos.modelo,
      color: datos.color,
      colorSecundario: null,
      capacidad: datos.capacidad,
    };
    const respuesta = (await llamar('POST', '/vehiculos', body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.vehiculosPorConductor[i] = respuesta!.id;
      guardarEstado();
      console.log(`  Vehículo ${datos.placa} (#${i + 1}) creado: ${estado.vehiculosPorConductor[i]}`);
    }
  }
  return estado.vehiculosPorConductor.map((id, i) => id ?? `PENDIENTE:vehiculo-${i + 1}`);
}

// ============================================================================================
// Paso 7 — Activar vehículos
// ============================================================================================

async function activarVehiculos(vehiculosPorConductor: string[]): Promise<void> {
  console.log('\n--- Paso 7: activar vehículos (PATCH /v1/vehiculos/:id/estado) ---');
  estado.vehiculosActivadosPorConductor ??= new Array(VEHICULOS_POR_CONDUCTOR.length).fill(undefined);
  if (!estado.vehiculosActivadosPorConductor[0] && estado.vehiculosActivados?.z12) {
    estado.vehiculosActivadosPorConductor[0] = true;
    guardarEstado();
  }
  if (!estado.vehiculosActivadosPorConductor[3] && estado.vehiculosActivados?.l120) {
    estado.vehiculosActivadosPorConductor[3] = true;
    guardarEstado();
  }

  for (let i = 0; i < VEHICULOS_POR_CONDUCTOR.length; i++) {
    const { datos } = VEHICULOS_POR_CONDUCTOR[i]!;
    if (estado.vehiculosActivadosPorConductor[i]) {
      console.log(`  Vehículo ${datos.placa} (#${i + 1}) ya estaba activado (estado local) — se omite.`);
      continue;
    }
    await llamar('PATCH', `/vehiculos/${vehiculosPorConductor[i]}/estado`, { estado: 'activo' });
    if (APLICAR) {
      estado.vehiculosActivadosPorConductor[i] = true;
      guardarEstado();
      console.log(`  Vehículo ${datos.placa} (#${i + 1}) activado.`);
    }
  }
}

// ============================================================================================
// Paso 8 — Conductores
// ============================================================================================

async function crearConductores(sindicatoId: string): Promise<string[]> {
  console.log('\n--- Paso 8: 6 conductores (POST /v1/conductores) ---');
  estado.conductores ??= new Array(CONDUCTORES.length).fill(undefined);

  for (let i = 0; i < CONDUCTORES.length; i++) {
    if (estado.conductores[i]) {
      console.log(`  Conductor #${i + 1} ya existe (estado local): ${estado.conductores[i]} — se omite.`);
      continue;
    }
    const c = CONDUCTORES[i]!;
    const body = { sindicatoId, nombre: c.nombre, documentoIdentidad: c.documentoIdentidad, licenciaConducir: c.licenciaConducir };
    const respuesta = (await llamar('POST', '/conductores', body)) as { id: string } | undefined;
    if (APLICAR) {
      estado.conductores[i] = respuesta!.id;
      guardarEstado();
      console.log(`  Conductor #${i + 1} (${c.nombre}) creado: ${estado.conductores[i]}`);
    }
  }

  return estado.conductores.map((id, i) => id ?? `PENDIENTE:conductor-${i + 1}`);
}

// ============================================================================================
// Paso 9 — Fijar PIN de los 6 conductores
// ============================================================================================

async function fijarPines(conductorIds: string[]): Promise<void> {
  console.log('\n--- Paso 9: fijar PIN (PUT /v1/mobile/credenciales/conductores/:id) ---');
  estado.pinesFijados ??= new Array(CONDUCTORES.length).fill(undefined);

  for (let i = 0; i < CONDUCTORES.length; i++) {
    if (estado.pinesFijados[i]) {
      console.log(`  PIN del conductor #${i + 1} ya estaba fijado (estado local) — se omite.`);
      continue;
    }
    // body real nunca se loguea (redactar() oculta "pin" en resumirBody) — acá tampoco se
    // arma ningún console.log con PINES[i] directo.
    await llamar('PUT', `/mobile/credenciales/conductores/${conductorIds[i]}`, { pin: PINES[i] });
    if (APLICAR) {
      estado.pinesFijados[i] = true;
      guardarEstado();
      console.log(`  PIN del conductor #${i + 1} fijado.`);
    }
  }
}

// ============================================================================================
// Pasos 10-13 — Migrar la ÚNICA rotación existente in situ (NO se crea una rotación nueva)
//
// ⚠️ TRAMO PELIGROSO (Pasos 10-12): desde que el Paso 10 despublica la rotación hasta que el
// Paso 13 la vuelve a publicar, `estado.rotacionPublicada` queda en `false` y NINGÚN
// conductor (ni viejo ni nuevo) puede loguearse — el login exige `rotacion.estado='publicada'`
// (ver auth-movil.service.ts). Por eso el orden de estos 4 pasos importa: primero lo ESENCIAL
// (crear las 84 asignaciones nuevas — Paso 11), después lo COSMÉTICO (borrar las filas
// tarde/noche del diseño viejo — Paso 12, best-effort, ver más abajo por qué), y el Paso 13
// (publicar) es OBLIGATORIO al final pase lo que pase con el Paso 12: si el borrado no pudo
// completar ni una fila, igual se publica — dejar la rotación despublicada por una limpieza
// cosmética que falló sería peor que el problema que esa limpieza resuelve.
//
// Si el proceso muere en medio de este tramo (429 agotado, Ctrl-C, corte de red, un 500 no
// relacionado con el borrado), la rotación queda despublicada hasta la próxima corrida — por
// eso cada paso persiste su progreso de inmediato (`guardarEstado()` tras cada llamada exitosa)
// y es puramente resumible: una corrida nueva retoma exactamente donde se cortó la anterior y
// llega hasta publicar, sin repetir ni perder nada. Esto YA pasó una vez en producción real: un
// `--apply` anterior murió a mitad del borrado (ver comentario de `verificarYBorrarAsignacionesViejas`
// más abajo) y alguien tuvo que republicar la rotación a mano por fuera del script para
// restaurar el login — el Paso 10 de abajo ahora se autocorrige contra ese tipo de
// intervención manual, para que no vuelva a hacer falta.
// ============================================================================================

// Paso 10 — Despublicar la rotación existente (para poder editarla)
// ============================================================================================

/** Supuesto crítico de todo este diseño, verificado leyendo `rotaciones.service.ts` antes de
 * escribir este código: `publicar()` (líneas 187-203) solo exige `rotacion.estado ===
 * 'borrador'` en el momento de la llamada — no hay ningún campo "ya se publicó antes" ni
 * restricción de que una rotación solo pueda publicarse una vez. `anular()` (líneas 208-217)
 * solo exige `estado === 'publicada'` y la deja en `borrador`. El ciclo `publicada
 * --(anular)--> borrador --(publicar)--> publicada` sobre la MISMA rotación es, por lo tanto,
 * un camino válido del contrato real — no una asunción sin verificar. Si esto no fuera así
 * (`anular` terminal, o `publicar` rechazando una rotación ya publicada antes), esta estrategia
 * completa no serviría — se paró y se avisó ANTES de escribir este código, no después. */
async function despublicarRotacion(rotacionId: string): Promise<void> {
  console.log('\n--- Paso 10: despublicar la rotación existente (POST /v1/rotaciones/:id/anular) — abre el TRAMO PELIGROSO ---');

  // Auto-corrección contra intervención manual: esto pasó de verdad — un `--apply` anterior
  // murió a mitad del Paso de borrado (viejo, abortaba en el primer error) con la rotación
  // despublicada, y se restauró el servicio republicándola A MANO por fuera de este script
  // (`POST /publicar` directo). El estado local nunca se enteró — quedó con
  // `rotacionPublicada: false` mientras la API real ya decía `publicada`. Si este paso
  // confiara ciegamente en el flag local, se saltearía el `anular` (creyendo que ya estaba
  // despublicada) y el Paso 11 fallaría con 400 al intentar escribir sobre una rotación que en
  // realidad sigue publicada. Por eso se relee el estado REAL con GET antes de decidir, y se
  // corrige el local para que coincida.
  const actual = (await llamar('GET', `/rotaciones/${rotacionId}`, undefined, { logPlan: true })) as { estado: string } | undefined;
  if (APLICAR) {
    const publicadaReal = actual!.estado === 'publicada';
    if (estado.rotacionPublicada !== publicadaReal) {
      console.log(
        `  Estado local desincronizado: local decía rotacionPublicada=${estado.rotacionPublicada ?? '(sin dato)'}, la API real dice ` +
          `estado="${actual!.estado}". Corrigiendo el estado local para que coincida con la realidad.`,
      );
      estado.rotacionPublicada = publicadaReal;
      guardarEstado();
    }
  } else {
    // Sin login real no se puede confirmar el estado REAL de la rotación — esta rama sigue
    // usando el flag local tal cual, que puede estar desincronizado (es justo lo que motivó
    // este chequeo, ver comentario de arriba). La autocorrección solo corre en `--apply`.
    console.log('  (dry-run: no se puede leer el estado real sin login — se sigue con el flag del estado local, que puede estar desactualizado).');
  }

  if (estado.rotacionPublicada === false) {
    console.log(`  Ya está despublicada (borrador): ${rotacionId} — se omite el anular.`);
    return;
  }
  await llamar('POST', `/rotaciones/${rotacionId}/anular`);
  // El flag en memoria se actualiza SIEMPRE (incluso en dry-run) para que el Paso 13 de esta
  // MISMA corrida vea la transición simulada y su propio "SE HARÍA" sea consistente — persistir
  // a disco sigue gateado por `APLICAR` dentro de `guardarEstado()` (dry-run nunca toca el
  // archivo, ya verificado por separado).
  estado.rotacionPublicada = false;
  guardarEstado();
  if (APLICAR) {
    console.log(`  Rotación ${rotacionId} despublicada (vuelve a "borrador"). Mientras no se publique de nuevo (Paso 13), NADIE puede loguearse.`);
  }
}

// ============================================================================================
// Paso 11 — Crear las 84 asignaciones nuevas (4 vehículos nuevos, horario único "manana"), en
// la MISMA rotación — ESENCIAL, va primero para minimizar la ventana peligrosa. Sin colisión
// posible: `@@unique([vehiculoId, fecha, horario])` es por vehículo, y estos 4 vehículos
// (9002TST/9003TST/9005TST/9006TST) nunca tuvieron ninguna asignación — las filas tarde/noche
// que sobran son de los vehículos VIEJOS (9001TST/9004TST), un problema distinto (Paso 12).
// ============================================================================================

/** Índices 1, 2, 4 y 5 = conductores/vehículos #2, #3, #5, #6 — los NUEVOS. Los índices 0 y 3
 * (#1, #4 — 9001TST/9004TST) NUNCA se tocan acá: su fila "manana" correcta ya existe desde el
 * diseño viejo (se verifica, sin tocarla, en el Paso 12). */
const INDICES_VEHICULOS_NUEVOS = [1, 2, 4, 5] as const;

async function crearAsignacionesNuevas(rotacionId: string, vehiculosPorConductor: string[], rutaPorConductor: string[], conductorIds: string[]): Promise<void> {
  console.log(`\n--- Paso 11: crear las 84 asignaciones nuevas (4 vehículos nuevos, horario "${HORARIO_UNICO}"), ${DIAS_ROTACION} días desde hoy, en la MISMA rotación ---`);

  const hoy = fechaActualBolivia();
  const fechas = Array.from({ length: DIAS_ROTACION }, (_, i) => fechaIsoDeUtc(sumarDiasUtc(hoy, i)));
  const total = INDICES_VEHICULOS_NUEVOS.length * fechas.length;

  estado.asignaciones ??= {};

  const pendientes: { conductorIdx: number; vehiculoId: string; rutaId: string; fecha: string }[] = [];
  for (const idx of INDICES_VEHICULOS_NUEVOS) {
    const vehiculoId = vehiculosPorConductor[idx]!;
    const rutaId = rutaPorConductor[idx]!;
    for (const fecha of fechas) {
      const clave = `${vehiculoId}|${fecha}|${HORARIO_UNICO}`;
      if (estado.asignaciones[clave]) continue; // ya creada en una corrida anterior — reanudable
      pendientes.push({ conductorIdx: idx, vehiculoId, rutaId, fecha });
    }
  }

  if (!APLICAR) {
    llamadasPlaneadas += pendientes.length;
    console.log(
      `  SE HARÍAN: ${pendientes.length} POST /v1/rotaciones/${rotacionId}/asignaciones ` +
        `(4 vehículos nuevos × 1 horario "${HORARIO_UNICO}" × ${fechas.length} días = ${total} en total, menos las que ya consten en el estado local).`,
    );
    console.log(`  Ejemplo de body: {"vehiculoId":"...","conductorId":"...","rutaId":"...","fecha":"${fechas[0]}","horario":"${HORARIO_UNICO}","orden":1}`);
    return;
  }

  let creadas = 0;
  for (const p of pendientes) {
    const clave = `${p.vehiculoId}|${p.fecha}|${HORARIO_UNICO}`;
    const body = {
      vehiculoId: p.vehiculoId,
      conductorId: conductorIds[p.conductorIdx],
      rutaId: p.rutaId,
      fecha: p.fecha,
      horario: HORARIO_UNICO,
      orden: 1,
    };
    const respuesta = (await llamar('POST', `/rotaciones/${rotacionId}/asignaciones`, body, { logPlan: false })) as { id: string } | undefined;
    estado.asignaciones[clave] = respuesta!.id;
    guardarEstado();
    creadas++;
  }
  console.log(`  ${creadas} asignación(es) nueva(s) creada(s). Total esperado: ${total}.`);
}

// ============================================================================================
// Paso 12 — Verificar el reparto viejo + borrar (best-effort) las filas tarde/noche de los 2
// vehículos preexistentes. Va DESPUÉS del Paso 11 a propósito (ver comentario de los Pasos
// 10-13): es limpieza cosmética, no bloqueante — sin ella, los conductores #2/#3/#5/#6 quedan
// pudiendo loguearse también en su vehículo viejo (9001TST/9004TST), que es feo pero no rompe
// nada (las filas de días pasados se marcan `vencida` solas, RF-57).
// ============================================================================================

interface AsignacionRotacionApi {
  id: string;
  vehiculoId: string;
  conductorId: string | null;
  fecha: string; // ISO datetime (`z.coerce.date()` server-side, serializado a string sobre HTTP)
  horario: string;
}

/** BUG REAL DE LA API, encontrado corriendo esto contra producción — no se arregla acá, solo
 * se documenta y se lo hace tolerable: `eliminarAsignacion` (`rotaciones.service.ts:263-274`)
 * hace `tx.asignacion.delete()`, un DELETE duro. `SesionOperativa.asignacion` tiene
 * `onDelete: Restrict` (`schema.prisma`) — una asignación con una sesión operativa real
 * encima (login de un conductor) es imborrable, y la API devuelve **500** en vez de un 409
 * legible. Esto pasó de verdad: pruebas de login crearon sesiones sobre las asignaciones de
 * HOY, un `DELETE` chocó con eso, y el diseño viejo de este paso (abortaba en el primer error)
 * frenó el script a mitad del borrado con la rotación despublicada — alguien tuvo que
 * restaurar el servicio a mano. Ya no: cada `DELETE` de este loop es tolerante a fallos —
 * se registra cuál falló y por qué, se seguía con el siguiente, NUNCA aborta el script. Las
 * filas que fallan quedan marcadas en `estado.asignacionesImborrables` para no reintentarlas
 * en cada corrida (evita repetir el mismo 500 para siempre). Esta tolerancia es SOLO para este
 * loop — cualquier otra llamada del script sigue abortando en el primer error, como siempre. */
async function verificarYBorrarAsignacionesViejas(
  rotacionId: string,
  vehiculo1Id: string,
  vehiculo4Id: string,
  conductor1Id: string,
  conductor4Id: string,
): Promise<void> {
  console.log('\n--- Paso 12: verificar el reparto viejo + borrar (best-effort) tarde/noche de los 2 vehículos preexistentes ---');
  console.log('  (GET /v1/rotaciones/:id para leer datos reales; DELETE /v1/rotaciones/:id/asignaciones/:id por cada fila tarde/noche — tolerante a fallos)');

  const actual = (await llamar('GET', `/rotaciones/${rotacionId}`, undefined, { logPlan: true })) as
    | { asignaciones: AsignacionRotacionApi[] }
    | undefined;

  if (!APLICAR) {
    // Sin login real no hay datos reales que leer — se estima con el estado local (las claves
    // "tarde"/"noche" que el diseño viejo dejó ahí, menos las ya marcadas imborrables o ya
    // borradas) para que el dry-run igual muestre un número orientativo. La premisa y los ids
    // reales SOLO se conocen con `--apply`, leyendo la respuesta de arriba.
    const clavesTardeNoche = Object.keys(estado.asignaciones ?? {}).filter((k) => {
      const [vehId, , horario] = k.split('|');
      if (horario === 'manana' || (vehId !== vehiculo1Id && vehId !== vehiculo4Id)) return false;
      return !estado.asignacionesImborrables?.[k];
    });
    llamadasPlaneadas += clavesTardeNoche.length;
    console.log(
      `  SE HARÍAN: ~${clavesTardeNoche.length} DELETE /rotaciones/${rotacionId}/asignaciones/:id (tarde/noche de los 2 vehículos ` +
        'preexistentes, best-effort — estimado desde el estado local; el número exacto y los ids reales salen del GET de arriba).',
    );
    console.log(
      '  Antes de borrar, se verifica contra datos reales que el conductor #1 esté en TODAS las "manana" de 9001TST y el #4 en ' +
        'TODAS las "manana" de 9004TST — si no coincide, este paso NO borra nada (pero el script sigue: es best-effort, no bloquea el Paso 13).',
    );
    return;
  }

  const manana1 = actual!.asignaciones.filter((a) => a.vehiculoId === vehiculo1Id && a.horario === 'manana');
  const manana4 = actual!.asignaciones.filter((a) => a.vehiculoId === vehiculo4Id && a.horario === 'manana');

  const premisaRota: string[] = [
    ...manana1
      .filter((a) => a.conductorId !== conductor1Id)
      .map((a) => `vehículo ${vehiculo1Id} (9001TST), ${a.fecha.slice(0, 10)} manana: conductorId=${a.conductorId} (se esperaba ${conductor1Id}, conductor #1)`),
    ...manana4
      .filter((a) => a.conductorId !== conductor4Id)
      .map((a) => `vehículo ${vehiculo4Id} (9004TST), ${a.fecha.slice(0, 10)} manana: conductorId=${a.conductorId} (se esperaba ${conductor4Id}, conductor #4)`),
  ];
  if (manana1.length === 0 || manana4.length === 0) {
    premisaRota.push(
      `No se encontró ninguna asignación "manana" para uno de los dos vehículos preexistentes (${manana1.length} para 9001TST, ${manana4.length} para 9004TST) — se esperaba al menos 1 de cada uno.`,
    );
  }

  if (premisaRota.length > 0) {
    // Este paso es best-effort (limpieza cosmética, ver comentario de arriba) — si la premisa
    // no se cumple, NO se borra nada (no tocar lo que no se entiende), pero tampoco se aborta
    // el script entero: el Paso 13 (publicar) sigue siendo obligatorio después de este paso,
    // pase lo que pase acá (requisito explícito del CTO — dejar la rotación despublicada por
    // una limpieza cosmética que no pudo confirmar su premisa sería peor que el problema que
    // esa limpieza resuelve).
    console.error('\n  ⚠ La premisa "conductor #1 en manana de 9001TST, conductor #4 en manana de 9004TST" NO se cumple contra los datos reales.');
    console.error(`  Detalle (${Math.min(5, premisaRota.length)} de ${premisaRota.length}):`);
    for (const p of premisaRota.slice(0, 5)) console.error(`    ${p}`);
    console.error('  No se borró ni se tocó ninguna asignación en este paso. El script SIGUE (este paso es cosmético) — revisar esto con el CTO antes de la próxima corrida.');
    return;
  }
  console.log(`  Premisa verificada contra datos reales: conductor #1 en las ${manana1.length} "manana" de 9001TST, conductor #4 en las ${manana4.length} "manana" de 9004TST. OK — esas filas NO se tocan.`);

  estado.asignacionesImborrables ??= {};
  const aBorrar = actual!.asignaciones.filter((a) => {
    if (a.vehiculoId !== vehiculo1Id && a.vehiculoId !== vehiculo4Id) return false;
    if (a.horario === 'manana') return false;
    const clave = `${a.vehiculoId}|${a.fecha.slice(0, 10)}|${a.horario}`;
    return !estado.asignacionesImborrables![clave]; // ya se intentó y falló antes — no reintentar cada corrida
  });
  console.log(aBorrar.length === 0 ? '  0 fila(s) tarde/noche pendientes de borrar.' : `  ${aBorrar.length} fila(s) tarde/noche a intentar borrar (de los 2 vehículos preexistentes).`);

  let borradas = 0;
  let noBorradas = 0;
  for (const a of aBorrar) {
    const clave = `${a.vehiculoId}|${a.fecha.slice(0, 10)}|${a.horario}`;
    try {
      await llamar('DELETE', `/rotaciones/${rotacionId}/asignaciones/${a.id}`, undefined, { logPlan: false });
      if (estado.asignaciones) delete estado.asignaciones[clave];
      guardarEstado();
      borradas++;
    } catch (err) {
      // Tolerante a fallos — SOLO en este loop (ver comentario de arriba). Se marca como
      // imborrable para no reintentarla en cada corrida futura; el operador puede editar el
      // estado a mano si alguna vez deja de tener sesión operativa y quiere reintentarla.
      estado.asignacionesImborrables![clave] = true;
      guardarEstado();
      noBorradas++;
      const mensaje = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.warn(`    No se pudo borrar ${clave} (asignación ${a.id}): ${mensaje} — se sigue con la siguiente.`);
    }
  }
  if (aBorrar.length > 0) {
    console.log(
      `  ${borradas} fila(s) borrada(s), ${noBorradas} no se pudieron borrar. Las que no se pudieron borrar casi seguro tienen una ` +
        'SesionOperativa asociada (login real sobre esa asignación) — `onDelete: Restrict` en el schema lo impide con un 500. Es ' +
        'esperado para asignaciones con actividad real, no es un error del operador; quedan como filas extra pero inofensivas ' +
        '(se marcan `vencida` solas cuando pasa la fecha, RF-57).',
    );
  }
}

// ============================================================================================
// Paso 13 — Publicar la rotación (cierra el TRAMO PELIGROSO — va último, una vez publicada no
// acepta más asignaciones). OBLIGATORIO: se intenta siempre, incluso si el Paso 12 no pudo
// borrar ni una sola fila — ver comentario de los Pasos 10-13 más arriba. Si el script muriera
// ANTES de este paso (en el 10, 11 o 12), la rotación queda despublicada y NADIE puede
// loguearse hasta la próxima corrida — por eso una corrida nueva SIEMPRE intenta llegar hasta
// acá, aunque no tenga ningún otro paso pendiente.
// ============================================================================================

async function publicarRotacion(rotacionId: string): Promise<void> {
  console.log('\n--- Paso 13: publicar la rotación (POST /v1/rotaciones/:id/publicar) — cierra el TRAMO PELIGROSO, OBLIGATORIO ---');
  if (estado.rotacionPublicada === true) {
    console.log('  Ya estaba publicada (estado local) — se omite.');
    return;
  }
  await llamar('POST', `/rotaciones/${rotacionId}/publicar`);
  if (APLICAR) {
    estado.rotacionPublicada = true;
    guardarEstado();
    console.log('  Rotación publicada. Fin del tramo peligroso — los 6 conductores ya pueden loguearse.');
  }
}

// ============================================================================================
// main
// ============================================================================================

async function main(): Promise<void> {
  console.log('='.repeat(90));
  console.log(`Siembra piloto en producción — modo: ${APLICAR ? 'APPLY (va a escribir contra la API real)' : 'DRY-RUN (no manda ninguna escritura)'}`);
  console.log(`API: ${API_URL}`);
  console.log(`Estado local: ${ESTADO_PATH} ${fs.existsSync(ESTADO_PATH) ? '(existe, se reanuda desde ahí)' : '(no existe, arranca de cero)'}`);
  console.log(`Días de rotación a sembrar: ${DIAS_ROTACION}`);
  console.log('='.repeat(90));

  await login();

  const sindicatoId = await crearSindicato();
  const sociosPorConductor = await crearSocios(sindicatoId);
  const lineas = await crearLineas(sindicatoId);
  const rutas = await crearRutas(lineas.z12, lineas.l120);
  await crearPuntosControl(rutas.z12, rutas.l120);
  const vehiculosPorConductor = await crearVehiculos(sindicatoId, sociosPorConductor);
  await activarVehiculos(vehiculosPorConductor);
  const conductorIds = await crearConductores(sindicatoId);
  await fijarPines(conductorIds);

  // A partir de acá: se migra IN SITU la única rotación que ya existe — no se crea otra (ver
  // mensaje del CTO que reemplazó el diseño anterior de "rotación nueva").
  if (!estado.rotacionId) {
    throw new ErrorApi(
      'No hay rotación existente en el estado local (estado.rotacionId). Este script asume que ya hay una rotación previa para migrar ' +
        '1:1 sobre ella (el caso real de producción) — no crea una desde cero. Si de verdad no existe ninguna, avisar al CTO antes de improvisar.',
    );
  }
  const rotacionId = estado.rotacionId;
  const rutaPorConductor = VEHICULOS_POR_CONDUCTOR.map((v) => (v.rutaClave === 'z12' ? rutas.z12 : rutas.l120));

  await despublicarRotacion(rotacionId);
  await crearAsignacionesNuevas(rotacionId, vehiculosPorConductor, rutaPorConductor, conductorIds);
  await verificarYBorrarAsignacionesViejas(rotacionId, vehiculosPorConductor[0]!, vehiculosPorConductor[3]!, conductorIds[0]!, conductorIds[3]!);
  await publicarRotacion(rotacionId);

  console.log('\n' + '='.repeat(90));
  if (APLICAR) {
    console.log(`✅ Listo. ${llamadasEjecutadas} llamada(s) HTTP de escritura ejecutada(s) en esta corrida.`);
    if (reintentosPorRateLimit > 0) {
      console.log(`   (de las cuales ${reintentosPorRateLimit} tuvieron que esperar por un 429 de rate limit antes de reintentar con éxito).`);
    }
    console.log(`   Sindicato: ${sindicatoId}`);
    for (let i = 0; i < VEHICULOS_POR_CONDUCTOR.length; i++) {
      console.log(`   Vehículo #${i + 1} (${VEHICULOS_POR_CONDUCTOR[i]!.datos.placa}): ${vehiculosPorConductor[i]} — conductor ${conductorIds[i]}`);
    }
    console.log(`   Rotación (misma de siempre, migrada in situ): ${rotacionId} (publicada)`);
  } else {
    console.log(`DRY-RUN: ${llamadasPlaneadas} llamada(s) HTTP se harían con --apply. No se mandó ninguna escritura.`);
  }
  console.log('='.repeat(90));
}

main().catch((err: unknown) => {
  console.error('\n❌ Abortado.');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
