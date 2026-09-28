import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma, withoutTenantScope } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { writeAudit } from '@/lib/services/audit';
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_TTL_MINUTES,
  signImpersonation,
} from '@/lib/auth/impersonation';

export const dynamic = 'force-dynamic';

const startSchema = z.object({
  userId: z.string().uuid(),
  /** Mandatory: "support asked me to look at this" is the whole point of the record. */
  reason: z.string().min(5).max(300),
});

/**
 * Begin impersonating a user.
 *
 * Volt staff only, audited before the cookie is set, and never onto another Super Admin — the
 * one account that could turn a support session into a way of covering tracks.
 */
export const POST = route({ capability: 'user.impersonate' }, async ({ actor, request }) => {
  const input = startSchema.parse(await request.json());

  if (input.userId === actor.userId) {
    throw ApiError.badRequest('self', 'You are already signed in as yourself.');
  }

  const target = await withoutTenantScope(() =>
    prisma.user.findFirst({
      where: { id: input.userId, isActive: true },
      select: {
        id: true,
        name: true,
        schoolId: true,
        roles: { select: { role: true } },
        school: { select: { slug: true, name: true } },
      },
    }),
  );
  if (!target) throw ApiError.notFound('User not found');

  if (target.roles.some((entry) => entry.role === 'SUPERADMIN')) {
    throw ApiError.badRequest('notSuperAdmin', 'Volt staff accounts cannot be impersonated.');
  }

  const expiresAt = Date.now() + IMPERSONATION_TTL_MINUTES * 60_000;

  // Audited first: if the cookie is set and the write fails, there is a support session with
  // no record of it, which is the one outcome this feature must never produce.
  await writeAudit(actor, {
    action: 'user.impersonate.start',
    entityType: 'UserRole',
    entityId: target.id,
    after: {
      targetName: target.name,
      targetSchool: target.school.name,
      expiresAt: new Date(expiresAt).toISOString(),
    },
    reason: input.reason,
  });

  const response = NextResponse.json({
    ok: true,
    target: { id: target.id, name: target.name },
    expiresAt: new Date(expiresAt).toISOString(),
  });

  response.cookies.set({
    name: IMPERSONATION_COOKIE,
    value: signImpersonation(target.id, expiresAt),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: IMPERSONATION_TTL_MINUTES * 60,
  });

  return response;
});
