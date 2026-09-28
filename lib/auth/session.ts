import { getServerSession } from 'next-auth';
import { prisma, withTenant, withoutTenantScope } from '@/lib/db';
import { can, resolveActor, ForbiddenError, type Actor } from '@/lib/permissions';
import { authOptions } from './options';
import { currentImpersonation } from './impersonation';

export class UnauthenticatedError extends Error {
  override readonly name = 'UnauthenticatedError';
  readonly status = 401;
}

/**
 * The entry point every route handler and server component uses.
 *
 * Returns the tenant context and the actor together, because neither is useful alone:
 * the context scopes the queries, the actor decides whether they are allowed.
 */
export async function getSessionActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id || !user.schoolId) return null;

  /*
   * Impersonation is resolved here, once, so every screen and every endpoint sees the same
   * thing: the target's own actor, carrying who is really driving it. The capability is checked
   * when the impersonation starts, and re-checked here — a Super Admin who loses the
   * capability mid-session stops impersonating on their next request rather than when their
   * cookie expires.
   */
  const impersonation = currentImpersonation();
  if (impersonation && impersonation.targetUserId !== user.id) {
    const real = await withTenant({ schoolId: user.schoolId, userId: user.id }, () =>
      resolveActor(user.id),
    );

    if (real && can(real, 'user.impersonate')) {
      const target = await withoutTenantScope(() =>
        prisma.user.findFirst({
          where: { id: impersonation.targetUserId, isActive: true },
          select: { id: true, schoolId: true },
        }),
      );

      if (target) {
        const acting = await withTenant({ schoolId: target.schoolId, userId: target.id }, () =>
          resolveActor(target.id),
        );
        if (acting) return { ...acting, impersonatedByUserId: real.userId };
      }
    }
  }

  return withTenant({ schoolId: user.schoolId, userId: user.id }, () => resolveActor(user.id));
}

/** Who is really driving, when somebody is being impersonated. */
export async function getImpersonator(actor: Actor): Promise<{ name: string } | null> {
  if (!actor.impersonatedByUserId) return null;
  const user = await withoutTenantScope(() =>
    prisma.user.findFirst({
      where: { id: actor.impersonatedByUserId },
      select: { name: true },
    }),
  );
  return user ? { name: user.name } : { name: 'Volt staff' };
}

export async function requireSessionActor(): Promise<Actor> {
  const actor = await getSessionActor();
  if (!actor) throw new UnauthenticatedError('Not signed in');
  return actor;
}

/**
 * Runs `fn` inside the actor's tenant context.
 *
 * Every service call goes through here, which is what makes "never rely on developers
 * remembering to add the filter" true in practice.
 */
export async function withActor<T>(actor: Actor, fn: (actor: Actor) => Promise<T>): Promise<T> {
  return withTenant(
    {
      schoolId: actor.schoolId,
      userId: actor.userId,
      ...(actor.impersonatedByUserId ? { impersonatedByUserId: actor.impersonatedByUserId } : {}),
    },
    () => fn(actor),
  );
}

export { ForbiddenError };
