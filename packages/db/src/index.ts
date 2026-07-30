// Prisma schema, migraciones y seed: ver prisma/schema.prisma y prisma/seed.ts.
// Políticas RLS multi-tenant: ver migración `20260730152500_rls_multi_tenant` (QUI-218)
// y `tenant-context.ts` para cómo fijar el contexto por request.
export { prisma } from './client.js';
export { auth } from './auth.js';
export { withTenantContext } from './tenant-context.js';
export type { TenantContext } from './tenant-context.js';
export type { Prisma, PrismaClient } from '@prisma/client';

