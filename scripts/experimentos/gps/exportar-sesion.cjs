/*
 * exportar-sesion.cjs
 *
 * Experimento de puntos GPS (docs/plan-experimento-puntos-gps.md, paso A). Corre DENTRO del
 * Job de Cloud Run quivo-migraciones como "node -e <contenido de este archivo>" (ver
 * exportar-sesion.README.md para el comando exacto). SOLO lectura: cero statements
 * mutantes. Conecta con process.env.DATABASE_URL, fija el contexto RLS con set_config
 * parametrizado (nunca un literal SQL con comilla simple) y exporta por stdout, en bloques
 * delimitados, el resumen de sesiones, la traza cruda de gps_points de la sesión objetivo,
 * los puntos_control de su ruta y sus cumplimientos_pc.
 *
 * Restricciones duras de este archivo (se verifican con verificar-export.mjs):
 *   - Cero comillas simples.
 *   - Cero sustitución de comando de shell (signo dolar seguido de parentesis abierto).
 *   - Cero comentarios de una sola linea (los de este bloque son de bloque, no de linea).
 *   - Cero doble signo de porcentaje (delimitador reservado del --args de gcloud, ver el
 *     README).
 *   - Cero palabras clave mutantes de SQL fuera de un identificador (regex con límites de
 *     palabra en el verificador, así que camelCase como "rutaId" nunca las contiene).
 *   - Sin backticks: todo el texto SQL se arma con concatenación de strings de comillas
 *     dobles, nunca template literals.
 *
 * SESION_ID (variable de entorno, opcional): fuerza la sesion objetivo. Sin ella, se usa la
 * fila con mas puntos del resumen de la letra a.
 */

var Client = require("pg").Client;

function csvField(valor) {
  if (valor === null || valor === undefined) {
    return "";
  }
  var texto;
  if (valor instanceof Date) {
    texto = valor.toISOString();
  } else {
    texto = String(valor);
  }
  if (texto.indexOf(",") !== -1 || texto.indexOf("\"") !== -1 || texto.indexOf("\n") !== -1 || texto.indexOf("\r") !== -1) {
    texto = "\"" + texto.replace(/"/g, "\"\"") + "\"";
  }
  return texto;
}

function imprimirBloque(nombre, encabezados, filas, claves) {
  console.log("===BEGIN " + nombre + "===");
  console.log(encabezados.join(","));
  for (var i = 0; i < filas.length; i++) {
    var fila = filas[i];
    var salida = [];
    for (var j = 0; j < claves.length; j++) {
      salida.push(csvField(fila[claves[j]]));
    }
    console.log(salida.join(","));
  }
  console.log("===END " + nombre + "===");
  return filas.length;
}

async function main() {
  var databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Falta DATABASE_URL en el entorno");
  }

  var client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    /* Contexto RLS (plan trampas §4): sin esto, FORCE ROW LEVEL SECURITY hace que el export
     * devuelva 0 filas en todas las tablas con policy tenant_isolation. Parametrizado con
     * $1/$2 en vez de un literal con comilla simple. is_local = false (tercer argumento) a
     * proposito: persiste para toda la sesion de este script, no solo la transaccion actual
     * (este script no abre transacciones explicitas). */
    await client.query("SELECT set_config($1, $2, false)", ["app.rol", "admin_quivo"]);
    await client.query("SELECT set_config($1, $2, false)", ["app.sindicato_id", ""]);

    /* a) Sesiones con conteo de gps_points, ordenadas por conteo desc. */
    var sqlResumen =
      "SELECT so.id AS sesion_id, " +
      "so.\"conductorId\" AS conductor_id, " +
      "so.\"deviceId\" AS device_id, " +
      "so.inicio AS inicio, " +
      "so.fin AS fin, " +
      "a.\"rutaId\" AS ruta_id, " +
      "count(gp.event_id) AS puntos, " +
      "min(gp.ts) AS ts_min, " +
      "max(gp.ts) AS ts_max " +
      "FROM sesiones_operativas so " +
      "JOIN asignaciones a ON a.id = so.\"asignacionId\" " +
      "LEFT JOIN gps_points gp ON gp.sesion_id = so.id::uuid " +
      "GROUP BY so.id, so.\"conductorId\", so.\"deviceId\", so.inicio, so.fin, a.\"rutaId\" " +
      "ORDER BY count(gp.event_id) DESC";
    var resumen = await client.query(sqlResumen);
    imprimirBloque(
      "sesiones_resumen",
      ["sesion_id", "conductor_id", "device_id", "inicio", "fin", "ruta_id", "puntos", "ts_min", "ts_max"],
      resumen.rows,
      ["sesion_id", "conductor_id", "device_id", "inicio", "fin", "ruta_id", "puntos", "ts_min", "ts_max"],
    );

    var sesionIdObjetivo = process.env.SESION_ID;
    if (!sesionIdObjetivo) {
      if (resumen.rows.length === 0) {
        throw new Error("Resumen de sesiones vacio y SESION_ID no esta definido");
      }
      sesionIdObjetivo = resumen.rows[0].sesion_id;
    }

    /* Se resuelve rutaId de forma independiente del resumen (robusto si SESION_ID vino por
     * variable de entorno y no aparecia entre las filas de arriba, p.ej. una sesion sin
     * ningun gps_point todavia). */
    var sqlSesion =
      "SELECT so.id AS sesion_id, a.\"rutaId\" AS ruta_id " +
      "FROM sesiones_operativas so " +
      "JOIN asignaciones a ON a.id = so.\"asignacionId\" " +
      "WHERE so.id = $1";
    var sesion = await client.query(sqlSesion, [sesionIdObjetivo]);
    if (sesion.rows.length === 0) {
      throw new Error("Sesion objetivo no encontrada: " + sesionIdObjetivo);
    }
    var rutaIdObjetivo = sesion.rows[0].ruta_id;

    /* b) Todos los gps_points de la sesion objetivo, ordenados por ts. */
    var sqlPuntosSesion =
      "SELECT ts, lat, lng, accuracy, speed " +
      "FROM gps_points " +
      "WHERE sesion_id = $1::uuid " +
      "ORDER BY ts";
    var puntosSesion = await client.query(sqlPuntosSesion, [sesionIdObjetivo]);
    var totalGpsPoints = imprimirBloque(
      "gps_points_sesion",
      ["ts", "lat", "lng", "accuracy", "speed"],
      puntosSesion.rows,
      ["ts", "lat", "lng", "accuracy", "speed"],
    );

    /* c) puntos_control de la ruta de esa sesion. */
    var sqlPuntosControl =
      "SELECT pc.id AS id, " +
      "pc.orden AS orden, " +
      "ST_Y(pc.coord::geometry) AS lat, " +
      "ST_X(pc.coord::geometry) AS lng, " +
      "pc.\"radioToleranciaM\" AS radio_tolerancia_m, " +
      "pc.obligatorio AS obligatorio, " +
      "pc.estado AS estado " +
      "FROM puntos_control pc " +
      "WHERE pc.\"rutaId\" = $1 " +
      "ORDER BY pc.orden";
    var puntosControl = await client.query(sqlPuntosControl, [rutaIdObjetivo]);
    imprimirBloque(
      "puntos_control_ruta",
      ["id", "orden", "lat", "lng", "radio_tolerancia_m", "obligatorio", "estado"],
      puntosControl.rows,
      ["id", "orden", "lat", "lng", "radio_tolerancia_m", "obligatorio", "estado"],
    );

    /* d) cumplimientos_pc de esa sesion. */
    var sqlCumplimientos =
      "SELECT \"puntoControlId\" AS punto_control_id, " +
      "ts AS ts, " +
      "\"distanciaM\" AS distancia_m, " +
      "cumplido AS cumplido, " +
      "\"validadoPor\" AS validado_por, " +
      "pasada AS pasada " +
      "FROM cumplimientos_pc " +
      "WHERE \"sesionId\" = $1 " +
      "ORDER BY ts";
    var cumplimientos = await client.query(sqlCumplimientos, [sesionIdObjetivo]);
    imprimirBloque(
      "cumplimientos_pc_sesion",
      ["punto_control_id", "ts", "distancia_m", "cumplido", "validado_por", "pasada"],
      cumplimientos.rows,
      ["punto_control_id", "ts", "distancia_m", "cumplido", "validado_por", "pasada"],
    );

    console.log("===COUNT gps_points_sesion=" + totalGpsPoints + "===");
  } finally {
    await client.end();
  }
}

/* Sin process.exit(0) a proposito (hallazgo de revision, Codex): stdout hacia un pipe (los
 * logs de Cloud Run) es un stream asincrono con buffer propio — un exit inmediato puede
 * cortar ese buffer antes de que termine de volcarse, dejando el export truncado con exit
 * code 0 igual (el peor caso: parece exitoso y no lo es). Sin la llamada, el proceso termina
 * solo en cuanto ya no queda ningun handle activo (el cliente de pg ya cerro con
 * client.end() dentro de main), que es despues de que todo lo encolado en stdout ya se
 * escribio. En el error tampoco se fuerza la salida: se deja process.exitCode = 1 para que
 * el proceso siga vaciando sus streams antes de terminar con ese codigo. */
main().catch(function (err) {
  console.error("Fallo el export: " + (err && err.message ? err.message : String(err)));
  process.exitCode = 1;
});
