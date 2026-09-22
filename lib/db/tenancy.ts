import { Prisma } from '@prisma/client';
import {
  CrossTenantAccessError,
  TenantContextMissingError,
  getTenantContext,
  isUnscoped,
} from './tenant-context';
import { isTenantScoped } from './tenant-models';

/** Operations whose `where` must be narrowed to the tenant before they run. */
const FILTERED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operations whose `data` must carry the tenant before they run. */
const WRITE_OPERATIONS = new Set(['create', 'createMany', 'upsert']);

type AnyArgs = Record<string, unknown>;

function applySchoolIdToWhere(args: AnyArgs, schoolId: string, model: string): AnyArgs {
  const where = (args['where'] ?? {}) as AnyArgs;
  const existing = where['schoolId'];

  // A caller that named a school explicitly must have named this one. Silently overwriting
  // it would turn a bug into a wrong answer.
  if (typeof existing === 'string' && existing !== schoolId) {
    throw new CrossTenantAccessError(model, schoolId, existing);
  }

  return { ...args, where: { ...where, schoolId } };
}

function applySchoolIdToData(data: unknown, schoolId: string, model: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => applySchoolIdToData(row, schoolId, model));
  }
  if (data && typeof data === 'object') {
    const row = data as AnyArgs;
    const existing = row['schoolId'];
    if (typeof existing === 'string' && existing !== schoolId) {
      throw new CrossTenantAccessError(model, schoolId, existing);
    }
    // A nested `school: { connect: ... }` already binds the tenant; don't add a duplicate
    // scalar alongside it, Prisma rejects both at once.
    if ('school' in row) return row;
    return { ...row, schoolId };
  }
  return data;
}

/**
 * The rule from the spec, in code: "Enforce it in a Prisma middleware or a repository layer
 * that injects school_id from the session into every query — never rely on developers
 * remembering to add the filter."
 *
 * Every tenant-scoped model gets `school_id` injected into the `where` of every read and
 * into the `data` of every write. A query issued with no tenant context throws rather than
 * returning every school's rows.
 */
export const tenancyExtension = Prisma.defineExtension({
  name: 'volt-tenancy',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!isTenantScoped(model)) return query(args);

        // Explicitly cross-tenant work: seeding, provisioning, Super Admin tooling.
        if (isUnscoped()) return query(args);

        const context = getTenantContext();
        if (!context) {
          throw new TenantContextMissingError(
            `${model}.${operation} ran with no tenant context. Wrap it in withTenant(), or ` +
              `withoutTenantScope() if it is deliberately cross-tenant.`,
          );
        }

        const { schoolId } = context;
        const typedArgs = (args ?? {}) as AnyArgs;

        if (FILTERED_OPERATIONS.has(operation)) {
          return query(applySchoolIdToWhere(typedArgs, schoolId, model));
        }

        if (WRITE_OPERATIONS.has(operation)) {
          const next: AnyArgs = { ...typedArgs };
          if ('data' in next) {
            next['data'] = applySchoolIdToData(next['data'], schoolId, model);
          }
          if ('create' in next) {
            next['create'] = applySchoolIdToData(next['create'], schoolId, model);
          }
          // upsert also filters on the way in.
          if ('where' in next) {
            return query(applySchoolIdToWhere(next, schoolId, model));
          }
          return query(next);
        }

        return query(typedArgs);
      },
    },
  },
});
