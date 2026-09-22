import { getServerSession } from 'next-auth';
import { withTenant } from '@/lib/db';
import { resolveActor, ForbiddenError, type Actor } from '@/lib/permissions';
import { authOptions } from './options';

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

  return withTenant({ schoolId: user.schoolId, userId: user.id }, () => resolveActor(user.id));
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
      ...(actor.impersonatedByUserId
        ? { impersonatedByUserId: actor.impersonatedByUserId }
        : {}),
    },
    () => fn(actor),
  );
}

export { ForbiddenError };
