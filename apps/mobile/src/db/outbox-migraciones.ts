/**
 * Migraciones de esquema que `CREATE TABLE IF NOT EXISTS` (`outbox-ddl.ts`) no cubre — sin
 * NINGÚN import, mismo motivo que `outbox-ddl.ts` (ver su docblock de cabecera): `outbox.ts`
 * arrastra `expo-sqlite`/`@sentry/react-native` → `react-native` (sintaxis Flow, rompe bajo
 * vitest/Node). Separar este módulo permite testear el SQL de migración contra `node:sqlite`
 * real (`outbox-migraciones.test.ts`), igual que `outbox-ddl.test.ts` ya hace con el DDL base.
 *
 * REDISEÑO (decisión del CTO, ronda posterior al veredicto `partial` de Codex `verify-fix` del
 * 2026-09-23, punto 3 del brief — "intención durable ANTES de programar"): `anuncios_punto_control`
 * nació en la Entrega 7 con dos columnas (`clave`, `ts`) — un dedupe simple, marcado DESPUÉS de
 * programar la notificación con éxito. El rediseño necesita reclamar la INTENCIÓN de anunciar
 * (estado `'pendiente'`) ANTES de programar, para que un fallo de `scheduleNotificationAsync` no
 * pierda la identidad reclamada — necesita columnas nuevas que las instalaciones YA EN
 * PRODUCCIÓN no tienen.
 *
 * `CREATE TABLE IF NOT EXISTS` es un no-op sobre una tabla que YA EXISTE: no agrega columnas.
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` NO es SQLite válido (ver el docblock de
 * `outbox-ddl.ts` — otra rama tuvo un bug CRÍTICO por esto). El patrón acá es más simple: correr
 * el `ALTER TABLE ... ADD COLUMN` liso y llano, y dejar que `outbox.ts` atrape el error real que
 * SQLite lanza cuando la columna YA existe ("duplicate column name: <col>") con
 * `esErrorColumnaDuplicada` — así la migración es idempotente (segura de correr en cada apertura
 * del outbox, instalación nueva o vieja).
 *
 * FIX POST-REVISIÓN (hallazgo 9, code review — "una migración rota tumba TODO `abrirOutbox`"):
 * `outbox.ts` YA NO confía a ciegas en el mensaje de error para decidir si una columna existe —
 * consulta `PRAGMA table_info` primero (más robusto que parsear el `message`) y, además, ninguna
 * falla de esta migración (columna duplicada o no) puede tumbar la apertura del outbox: se
 * reporta a Sentry y se sigue. `esErrorColumnaDuplicada` se conserva acá para ese chequeo previo
 * (best-effort) y para el propio test de este módulo, que corre las migraciones a mano contra
 * SQLite real.
 *
 * Columnas nuevas `intentos`/`ultimo_intento_ts` (hallazgo 1): sostienen el estado transitorio
 * `'programando'` (ver `marcarAnuncioProgramando`, `outbox.ts`) — instalaciones ya en producción
 * (con la tabla de 7 columnas de la ronda anterior) tampoco las tienen.
 */
export const MIGRACIONES_ANUNCIOS_PUNTO_CONTROL_SQL: readonly string[] = [
  "ALTER TABLE anuncios_punto_control ADD COLUMN estado TEXT NOT NULL DEFAULT 'programado'",
  'ALTER TABLE anuncios_punto_control ADD COLUMN motivo TEXT',
  'ALTER TABLE anuncios_punto_control ADD COLUMN sesion_id TEXT',
  'ALTER TABLE anuncios_punto_control ADD COLUMN punto_control_id TEXT',
  'ALTER TABLE anuncios_punto_control ADD COLUMN pasada INTEGER',
  'ALTER TABLE anuncios_punto_control ADD COLUMN intentos INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE anuncios_punto_control ADD COLUMN ultimo_intento_ts TEXT',
];

/**
 * `true` si `error` es el `SQLITE_ERROR` real que SQLite lanza ante un `ALTER TABLE ADD COLUMN`
 * sobre una columna que ya existe — el único caso que la migración de arriba debe tragar en
 * silencio (idempotencia). Cualquier otro error (tabla inexistente, SQL roto) se re-lanza tal
 * cual: no hay forma de que esta migración lo cause salvo un problema real.
 */
export function esErrorColumnaDuplicada(error: unknown): boolean {
  const mensaje =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error);
  return /duplicate column name/i.test(mensaje);
}
