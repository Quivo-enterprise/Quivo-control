/**
 * Preflight de arranque: falla rápido y con mensaje claro si falta una variable de entorno
 * obligatoria, en vez de dejar que Nest/Prisma revienten más adelante con un stack trace
 * menos legible. Se separa de `main.ts` (en vez de vivir inline ahí) para poder testearla
 * sin importar `main.ts`, que en su nivel superior invoca `bootstrap()` como efecto
 * secundario del import — importarlo levantaría la app completa (Nest, Fastify, conexión a
 * DB/Redis) sólo para probar esta función.
 */
export function validateRuntimeConfig(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');

  // RUNTIME_DATABASE_URL, NO DATABASE_URL — este gate exigía DATABASE_URL hasta acá, y
  // DATABASE_URL es el rol "postgres" de Cloud SQL: dueño de las tablas, cloudsqlsuperuser,
  // capaz de un `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` sobre todo el modelo
  // multi-tenant (ver packages/db/prisma/migrations/20260730152500_rls_multi_tenant). El
  // runtime NUNCA usa esa variable — packages/db/src/client.ts:41-66 arma el cliente de
  // Prisma con `RUNTIME_DATABASE_URL` (rol "quivo_app", sin superuser/BYPASSRLS) y sólo cae
  // a `DATABASE_URL` cuando `NODE_ENV === 'development'` (con un `console.warn`); fuera de
  // development, si `RUNTIME_DATABASE_URL` falta, client.ts tira un error fatal en vez de
  // caer en silencio. Este gate replica EXACTAMENTE ese mismo criterio (mismo operador,
  // `process.env.NODE_ENV === 'development'` sin default) para no quedar más laxo ni más
  // estricto que client.ts — si antes exigíamos DATABASE_URL acá, un servicio expuesto a
  // internet (`--allow-unauthenticated`, ver quivo-api en scripts/deploy-gcp.sh) terminaba
  // cargando la credencial dueña de las tablas sólo para satisfacer este chequeo de
  // presencia, sin que ningún código de runtime la usara jamás.
  const runtimeDatabaseUrlPresente =
    Boolean(process.env.RUNTIME_DATABASE_URL) ||
    (process.env.NODE_ENV === 'development' && Boolean(process.env.DATABASE_URL));
  if (!runtimeDatabaseUrlPresente) missing.push('RUNTIME_DATABASE_URL');

  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
  }

  if (nodeEnv === 'production') {
    const jwtSecret = process.env.JWT_SECRET ?? '';
    if (jwtSecret.length < 32 || jwtSecret === 'change-me-in-production') {
      throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
    }
    if ((process.env.CORS_ORIGIN ?? '').split(',').some((origin) => origin.trim() === '*')) {
      throw new Error('CORS_ORIGIN no puede usar * en producción');
    }
  }
  // GCS_MEDIA_BUCKET es opcional (sin ella la media cae a disco local, sólo válido en
  // desarrollo/tests): si viene, tiene que ser un nombre de bucket válido y no algo como una URL.
  const bucketMedia = process.env.GCS_MEDIA_BUCKET?.trim();
  if (bucketMedia && !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketMedia)) {
    throw new Error('GCS_MEDIA_BUCKET debe ser un nombre de bucket de GCS válido (no una URL)');
  }
  if (!bucketMedia && nodeEnv === 'production') {
    console.warn(
      'GCS_MEDIA_BUCKET no está definida en producción: la media se guarda en disco efímero y se pierde al reiniciar.',
    );
  }
  // MEDIA_PUBLIC_BASE_URL es opcional: origen público de la API (p. ej. http://localhost:4000)
  // con el que el driver de disco arma URLs absolutas de media. Sin ella quedan relativas.
  const baseMedia = process.env.MEDIA_PUBLIC_BASE_URL?.trim();
  if (baseMedia) {
    let url: URL | null = null;
    try {
      url = new URL(baseMedia);
    } catch {
      url = null;
    }
    if (
      !url ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'MEDIA_PUBLIC_BASE_URL debe ser un origen http(s) sin ruta (p. ej. http://localhost:4000)',
      );
    }
  }
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535');
  }
}
