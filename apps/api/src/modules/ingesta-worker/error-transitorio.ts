/** Códigos de Prisma que indican un fallo de infraestructura que se resuelve reintentando. */
const PRISMA_TRANSITORIOS = new Set([
  'P1001', // base inalcanzable
  'P1002', // timeout al alcanzar la base
  'P1008', // timeout de la operación
  'P1017', // el servidor cerró la conexión
  'P2024', // timeout esperando una conexión del pool
  'P2034', // conflicto de escritura / deadlock
  'P2037', // demasiadas conexiones
]);

/** SQLSTATE de Postgres (o `08xxx`: errores de conexión). 57P01/57P03: failover o reinicio de Cloud SQL. */
const PG_TRANSITORIOS = new Set(['57014', '40001', '40P01', '53300', '57P01', '57P02', '57P03']);

const SOCKET_TRANSITORIOS = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']);

function esCodigoTransitorio(codigo: unknown): boolean {
  if (typeof codigo !== 'string') return false;
  return (
    PRISMA_TRANSITORIOS.has(codigo) ||
    PG_TRANSITORIOS.has(codigo) ||
    SOCKET_TRANSITORIOS.has(codigo) ||
    codigo.startsWith('08')
  );
}

/**
 * ¿El error es un fallo transitorio de la base (conexión, timeout, deadlock, pool)? Si lo es, el
 * worker debe relanzarlo para que BullMQ reintente el lote entero (es idempotente) en vez de
 * mandar el evento a `sync_errors`. Con el adapter `PrismaPg` los fallos de Postgres llegan como
 * `PrismaClientKnownRequestError` (`P2010` en SQL crudo) con el SQLSTATE real en
 * `meta.driverAdapterError.cause.originalCode`; los de conexión traen su propio `P10xx`. También
 * se recorre `cause` por si el error viene envuelto.
 */
export function esErrorTransitorioDb(error: unknown): boolean {
  let actual: unknown = error;
  for (let i = 0; i < 5 && typeof actual === 'object' && actual !== null; i++) {
    const e = actual as {
      code?: unknown;
      cause?: unknown;
      meta?: { driverAdapterError?: { cause?: { originalCode?: unknown; code?: unknown } } };
    };
    const driver = e.meta?.driverAdapterError?.cause;
    if (esCodigoTransitorio(e.code) || esCodigoTransitorio(driver?.originalCode) || esCodigoTransitorio(driver?.code)) {
      return true;
    }
    actual = e.cause;
  }
  return false;
}
