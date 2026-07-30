// Prisma schema, migraciones y seed: ver prisma/schema.prisma y prisma/seed.ts.
// Políticas RLS de Postgres quedan para cuando existan tablas de dominio reales
// (QUI-220 en adelante) — ver docs/documento-tecnico-cto.md §5.
export { prisma } from './client.js';
export { auth } from './auth.js';
export type { PrismaClient } from '@prisma/client';

