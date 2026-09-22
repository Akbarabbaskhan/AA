import { route } from '@/lib/api/handler';
import { getAttemptResult } from '@/lib/services/quizzes/quiz';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>({}, async ({ actor, params }) =>
  getAttemptResult(actor, params.id),
);
