import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { withTenant } from '@/lib/db';
import { resolveActor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { currentImpersonation, IMPERSONATION_COOKIE } from '@/lib/auth/impersonation';

export const dynamic = 'force-dynamic';

/**
 * End an impersonation.
 *
 * A GET, because the banner is a link that has to work on every screen including one that has
 * just errored — and because ending a support session must never be the thing that fails. It
 * clears the cookie whatever else happens, then records it.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const impersonation = currentImpersonation();

  const response = NextResponse.redirect(
    new URL('/dashboard', process.env['NEXTAUTH_URL'] ?? 'http://localhost:3000'),
  );
  response.cookies.set({ name: IMPERSONATION_COOKIE, value: '', path: '/', maxAge: 0 });

  const user = session?.user;
  if (user?.id && user.schoolId && impersonation) {
    const actor = await withTenant({ schoolId: user.schoolId, userId: user.id }, () =>
      resolveActor(user.id),
    );
    if (actor) {
      await withTenant({ schoolId: actor.schoolId, userId: actor.userId }, () =>
        writeAudit(actor, {
          action: 'user.impersonate.end',
          entityType: 'UserRole',
          entityId: impersonation.targetUserId,
        }),
      );
    }
  }

  return response;
}
