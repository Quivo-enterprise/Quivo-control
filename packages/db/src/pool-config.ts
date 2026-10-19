/**
 * Config del pool de `pg` (vía `@prisma/adapter-pg`) leída del entorno. Sin esto `pg` usa
 * 10 conexiones, espera infinito por una libre y no tiene statement_timeout: con hasta 3
 * instancias de la API + el worker se pasa de `max_connections=50` de Cloud SQL y una query
 * colgada retiene la conexión para siempre.
 *
 * Función pura (recibe `env`) y en un archivo aparte de `client.ts` porque ese módulo falla
 * al importarse sin `RUNTIME_DATABASE_URL`, lo que impediría testearla.
 */
export interface PoolEnvConfig {
  max: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
}

function enteroPositivo(env: NodeJS.ProcessEnv, nombre: string, porDefecto: number): number {
  const raw = env[nombre];
  if (raw === undefined || raw === '') return porDefecto;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`${nombre} debe ser un entero positivo (recibido: "${raw}").`);
  }
  return Number(raw);
}

export function resolvePoolConfig(env: NodeJS.ProcessEnv): PoolEnvConfig {
  return {
    max: enteroPositivo(env, 'DB_POOL_MAX', 8),
    connectionTimeoutMillis: enteroPositivo(env, 'DB_CONNECTION_TIMEOUT_MS', 5000),
    statement_timeout: enteroPositivo(env, 'DB_STATEMENT_TIMEOUT_MS', 10000),
  };
}
