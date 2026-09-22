import { route } from '@/lib/api/handler';
import { bankQuerySchema, createQuestion, listQuestions, questionInputSchema } from '@/lib/services/quizzes/bank';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'quiz.manage' }, async ({ actor, request }) => {
  const query = bankQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listQuestions(actor, query);
});

export const POST = route({ capability: 'quiz.manage' }, async ({ actor, request }) => {
  const input = questionInputSchema.parse(await request.json());
  return createQuestion(actor, input);
});
