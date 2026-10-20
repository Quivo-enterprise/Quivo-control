/**
 * Config del pool de `pg` (vía `@prisma/adapter-pg`) leída del entorno. Sin esto `pg` usa
 * 10 conexiones, espera infinito por una libre y no tiene statement_timeout: con hasta 3
 * instancias de la API + el worker se pasa de `max_connections=50` de Cloud SQL y una query
 * colgada retiene la conexión para siempre.
 *
 * `DB_STATEMENT_TIMEOUT_MS` por defecto es 0 = sin límite (semántica de Postgres): los seeds y
 * scripts que importan @quivo/db conservan su comportamiento; solo los deploys lo setean. `pg`
 * trata 0 como falsy y no envía `statement_timeout` en el arranque de la conexión.
 *
 * Función pura (recibe `env`) y en un archivo aparte de `client.ts` porque ese módulo falla
 * al importarse sin `RUNTIME_DATABASE_URL`, lo que impediría testearla.
 */
export interface PoolEnvConfig {
  max: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
}

function entero(env: NodeJS.ProcessEnv, nombre: string, porDefecto: number, minimo: 0 | 1): number {
  const raw = env[nombre];
  if (raw === undefined || raw === '') return porDefecto;
  if (!/^\d+$/.test(raw) || Number(raw) < minimo) {
    throw new Error(
      `${nombre} debe ser un entero ${minimo === 0 ? 'no negativo' : 'positivo'} (recibido: "${raw}").`,
    );
  }
  return Number(raw);
}

export function resolvePoolConfig(env: NodeJS.ProcessEnv): PoolEnvConfig {
  return {
    max: entero(env, 'DB_POOL_MAX', 8, 1),
    connectionTimeoutMillis: entero(env, 'DB_CONNECTION_TIMEOUT_MS', 5000, 1),
    statement_timeout: entero(env, 'DB_STATEMENT_TIMEOUT_MS', 0, 0),
  };
}
