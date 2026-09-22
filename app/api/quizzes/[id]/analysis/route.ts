import { route } from '@/lib/api/handler';
import { getQuizAnalysis } from '@/lib/services/quizzes/analysis';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(
  { capability: 'quiz.manage' },
  async ({ actor, params }) => getQuizAnalysis(actor, params.id),
);
