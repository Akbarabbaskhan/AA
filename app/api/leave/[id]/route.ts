import { route } from '@/lib/api/handler';
import { decideLeave, leaveDecisionSchema } from '@/lib/services/parents';

export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(
  { capability: 'leave.approve' },
  async ({ actor, request, params }) => {
    const input = leaveDecisionSchema.parse(await request.json());
    return decideLeave(actor, params.id, input);
  },
);
