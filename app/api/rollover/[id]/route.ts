import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { commitRollover, getRolloverRun, revertRollover } from '@/lib/services/rollover';

export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  action: z.enum(['commit', 'revert']),
  /** Mandatory on a revert: undoing a year end is a decision somebody has to own. */
  reason: z.string().min(5).max(300).optional(),
});

export const GET = route<{ id: string }>({ capability: 'structure.read' }, async ({ actor, params }) =>
  getRolloverRun(actor, params.id),
);

export const POST = route<{ id: string }>(
  { capability: 'structure.manage' },
  async ({ actor, params, request }) => {
    const input = actionSchema.parse(await request.json());
    if (input.action === 'commit') return commitRollover(actor, params.id);
    return revertRollover(actor, params.id, input.reason ?? 'Reverted by a coordinator');
  },
);
