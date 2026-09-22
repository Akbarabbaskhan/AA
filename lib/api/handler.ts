import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { withTenant } from '@/lib/db';
import { requireSessionActor } from '@/lib/auth/session';
import { requireCapability, type Actor, type Capability } from '@/lib/permissions';
import { toErrorResponse } from './errors';

export type RouteContext<P = Record<string, string>> = {
  actor: Actor;
  request: NextRequest;
  params: P;
};

/**
 * The route-handler contract from the spec: "validate input with Zod, check permission,
 * call a service function, return."
 *
 * This wrapper does the three things every handler would otherwise repeat — resolve the
 * session, open the tenant scope, map thrown errors to the shared error shape — so a
 * handler is left with only its own logic. Permissions are resolved server-side here, on
 * every request, for every route.
 */
export function route<P = Record<string, string>>(
  options: { capability?: Capability },
  handler: (context: RouteContext<P>) => Promise<NextResponse | unknown>,
) {
  return async (request: NextRequest, segment: { params: P }): Promise<NextResponse> => {
    try {
      const actor = await requireSessionActor();
      if (options.capability) requireCapability(actor, options.capability);

      const headerList = headers();
      const result = await withTenant(
        {
          schoolId: actor.schoolId,
          userId: actor.userId,
          ...(actor.impersonatedByUserId
            ? { impersonatedByUserId: actor.impersonatedByUserId }
            : {}),
          // Recorded on every audit row. x-forwarded-for is the VPS reverse proxy's header.
          ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
          userAgent: headerList.get('user-agent') ?? undefined,
        },
        () => handler({ actor, request, params: segment.params }),
      );

      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      const { status, body } = toErrorResponse(error);
      if (status >= 500) {
        // Sentry replaces this in M6; until then a failure must at least be visible.
        console.error('[api]', error);
      }
      return NextResponse.json(body, { status });
    }
  };
}
