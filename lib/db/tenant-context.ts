import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The tenant and actor the current request is running as.
 *
 * Services never take a `schoolId` argument. It is resolved once, at the edge of the
 * request, and every query underneath inherits it through this store.
 */
export type TenantContext = {
  schoolId: string;
  userId?: string;
  /** Set when a Super Admin is acting as another user. Drives the audit trail and banner. */
  impersonatedByUserId?: string;
  ip?: string;
  userAgent?: string;
};

const storage = new AsyncLocalStorage<TenantContext | typeof UNSCOPED>();

/**
 * Marks a block as deliberately cross-tenant. Reserved for the seed script, migrations,
 * Super Admin tenant provisioning and the login lookup that resolves a school from a slug.
 * Everything else must run inside `withTenant`.
 */
const UNSCOPED = Symbol('volt.unscoped');

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * Runs `fn` with the store set, and — this is the part that matters — starts any promise it
 * returns from *inside* the scope.
 *
 * A Prisma query is lazy: `prisma.student.findMany()` does no work until something calls
 * `.then` on it. If the caller writes `withTenant(ctx, () => prisma.student.findMany())`,
 * the store is already torn down by the time the query starts, and the tenancy extension
 * sees no context. Chaining here pulls that `.then` back inside the scope, so both
 * `() => prisma...` and `async () => await prisma...` behave the same way.
 */
function runInScope<T>(value: TenantContext | typeof UNSCOPED, fn: () => T): T {
  return storage.run(value, () => {
    const result = fn();
    if (isPromiseLike(result)) {
      return result.then((resolved) => resolved) as T;
    }
    return result;
  });
}

export function withTenant<T>(context: TenantContext, fn: () => T): T {
  return runInScope(context, fn);
}

/**
 * Escape hatch. Deliberately awkward to type and easy to grep for, because every use is a
 * place where the tenancy guarantee is suspended and a reviewer should look.
 */
export function withoutTenantScope<T>(fn: () => T): T {
  return runInScope(UNSCOPED, fn);
}

export function getTenantContext(): TenantContext | null {
  const current = storage.getStore();
  if (current === undefined || current === UNSCOPED) return null;
  return current;
}

export function isUnscoped(): boolean {
  return storage.getStore() === UNSCOPED;
}

/** Throws rather than returning null — callers that need the tenant cannot proceed without it. */
export function requireTenantContext(): TenantContext {
  const current = getTenantContext();
  if (!current) {
    throw new TenantContextMissingError(
      'No tenant context. Wrap the call in withTenant(), or withoutTenantScope() if it is ' +
        'deliberately cross-tenant.',
    );
  }
  return current;
}

export class TenantContextMissingError extends Error {
  override readonly name = 'TenantContextMissingError';
}

export class CrossTenantAccessError extends Error {
  override readonly name = 'CrossTenantAccessError';
  constructor(model: string, expected: string, received: string) {
    super(
      `Cross-tenant access blocked on ${model}: context is school ${expected} but the query ` +
        `targeted school ${received}.`,
    );
  }
}
