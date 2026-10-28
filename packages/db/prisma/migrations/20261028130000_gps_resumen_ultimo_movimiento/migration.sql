-- `ultimo_movimiento_ts`: último instante en que el vehículo SE MOVIÓ (≥ max(30 m, accuracy) respecto del
-- ANCLA `mov_lat/mov_lng` = posición del último movimiento, con accuracy ≤ 50 m; o velocidad ≥ 2 m/s), mantenido por `insertarGpsPoints` en el mismo upsert que el
-- resto del resumen. Desde #268 la app en primer plano persiste un fix cada 60 s aun detenida,
-- así que `ultimo_fix_ts` ya no distingue "reportando" de "detenido": `clasificarFrescura`
-- (en-vivo.service.ts) usa esta columna. NULL = sin dato; el lector cae a `ultimo_fix_ts`.
ALTER TABLE gps_sesion_resumen ADD COLUMN ultimo_movimiento_ts TIMESTAMPTZ,
  ADD COLUMN mov_lat DOUBLE PRECISION,
  ADD COLUMN mov_lng DOUBLE PRECISION;

-- Las filas existentes arrancan "recién movidas": a lo sumo se muestran 15 min de más como
-- `reportando` tras el deploy, en vez de quedar NULL para siempre mientras haya latidos.
-- La tabla tiene FORCE RLS: mismo bypass transitorio que `20260922100000_gps_sesion_resumen`.
SELECT set_config('app.rol', 'admin_quivo', false);
UPDATE gps_sesion_resumen SET ultimo_movimiento_ts = ultimo_fix_ts, mov_lat = lat, mov_lng = lng WHERE ultimo_movimiento_ts IS NULL;
SELECT set_config('app.rol', '', false);
