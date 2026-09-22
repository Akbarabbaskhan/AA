import { route } from '@/lib/api/handler';
import { saveAnswerSchema, saveQuizAnswer } from '@/lib/services/quizzes/quiz';

export const dynamic = 'force-dynamic';

export const PUT = route<{ id: string }>(
  { capability: 'quiz.take' },
  async ({ actor, request, params }) => {
    const input = saveAnswerSchema.parse(await request.json());
    return saveQuizAnswer(actor, params.id, input);
  },
);
