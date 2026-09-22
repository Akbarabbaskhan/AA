import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { createQuiz, listQuizzes, quizInputSchema } from '@/lib/services/quizzes/quiz';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const { sectionId } = z
    .object({ sectionId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return listQuizzes(actor, sectionId);
});

export const POST = route({ capability: 'quiz.manage' }, async ({ actor, request }) => {
  const input = quizInputSchema.parse(await request.json());
  return createQuiz(actor, input);
});
