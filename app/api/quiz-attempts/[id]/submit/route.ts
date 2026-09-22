import { route } from '@/lib/api/handler';
import { submitQuizAttempt } from '@/lib/services/quizzes/quiz';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(
  { capability: 'quiz.take' },
  async ({ actor, params }) => submitQuizAttempt(actor, params.id),
);
