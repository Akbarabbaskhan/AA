import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { remindUpcomingDeadlines } from '@/lib/services/careers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const POST = route({ capability: 'career.manage' }, async ({ actor, request }) => {
  const input = z
    .object({ withinDays: z.number().int().min(1).max(120).optional() })
    .parse(await request.json().catch(() => ({})));
  return remindUpcomingDeadlines(actor, input);
});
