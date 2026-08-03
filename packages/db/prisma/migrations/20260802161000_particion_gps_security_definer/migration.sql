-- QUI-241: `quivo_app` (rol de runtime, NOSUPERUSER NOBYPASSRLS, QUI-218) no tiene
-- privilegio CREATE en el schema `public` — sin esto, el worker (que corre con
-- RUNTIME_DATABASE_URL, o sea `quivo_app`) no puede ejecutar
-- `crear_particion_gps_points` porque esa función hace `CREATE TABLE ... PARTITION OF`
-- internamente. Verificado en vivo: `psql -U quivo_app` contra la función sin este fix
-- devuelve `ERROR: permission denied for schema public`.
--
-- `SECURITY DEFINER` corre la función con los privilegios de quien la creó (el rol de
-- migraciones, dueño del schema) en vez de los del que la invoca — le da a `quivo_app` la
-- capacidad puntual de crear SOLO las particiones de `gps_points`, no `CREATE` en general.
ALTER FUNCTION crear_particion_gps_points(date) SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION crear_particion_gps_points(date) TO quivo_app;
