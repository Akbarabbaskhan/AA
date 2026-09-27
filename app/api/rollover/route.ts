import { route } from '@/lib/api/handler';
import { listRolloverRuns, previewRollover } from '@/lib/services/rollover';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'structure.read' }, async ({ actor }) => ({
  runs: await listRolloverRuns(actor),
}));

/** A preview writes nothing but the plan: the commit is a separate, deliberate call. */
export const POST = route({ capability: 'structure.manage' }, async ({ actor, request }) =>
  previewRollover(actor, await request.json()),
);
