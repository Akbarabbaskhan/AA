import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { remindDefaulters } from '@/lib/services/notifications/triggers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bodySchema = z.object({
  minDaysOverdue: z.number().int().min(0).max(365).optional(),
  yearGroupId: z.string().uuid().optional(),
});

export const POST = route({ capability: 'fee.manage' }, async ({ actor, request }) => {
  const input = bodySchema.parse(await request.json().catch(() => ({})));
  return remindDefaulters(actor, input);
});
