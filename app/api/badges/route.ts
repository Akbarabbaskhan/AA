import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { awardEarnedBadges, getBadges } from '@/lib/services/recognition';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const { studentId } = z
    .object({ studentId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getBadges(actor, studentId);
});

/** The sweep. Idempotent, so a schedule and a manual run on the same day are harmless. */
export const POST = route({ capability: 'badge.manage' }, async ({ actor }) =>
  awardEarnedBadges(actor.schoolId),
);
