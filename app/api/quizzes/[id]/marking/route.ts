import { route } from '@/lib/api/handler';
import { getManualMarkingQueue, markManually, manualMarkSchema } from '@/lib/services/quizzes/analysis';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(
  { capability: 'quiz.manage' },
  async ({ actor, params }) => getManualMarkingQueue(actor, params.id),
);

export const POST = route<{ id: string }>(
  { capability: 'quiz.manage' },
  async ({ actor, request, params }) => {
    const input = manualMarkSchema.parse(await request.json());
    return markManually(actor, params.id, input);
  },
);
