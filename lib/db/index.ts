import { PrismaClient } from '@prisma/client';
import { tenancyExtension } from './tenancy';

const globalForPrisma = globalThis as unknown as {
  voltPrisma?: ReturnType<typeof createClient>;
};

function createClient() {
  const base = new PrismaClient({
    log:
      process.env['NODE_ENV'] === 'development'
        ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
        : [{ emit: 'stdout', level: 'error' }],
  });
  return base.$extends(tenancyExtension);
}

/**
 * The only Prisma client the application uses. It refuses to touch a tenant-scoped table
 * without a tenant context — see lib/db/tenancy.ts.
 */
export const prisma = globalForPrisma.voltPrisma ?? createClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.voltPrisma = prisma;
}

export type VoltPrismaClient = typeof prisma;

export {
  withTenant,
  withoutTenantScope,
  getTenantContext,
  requireTenantContext,
  TenantContextMissingError,
  CrossTenantAccessError,
} from './tenant-context';
export type { TenantContext } from './tenant-context';
export { TENANT_SCOPED_MODELS, TENANCY_BY_PARENT, GLOBAL_MODELS, unaccountedModels } from './tenant-models';
