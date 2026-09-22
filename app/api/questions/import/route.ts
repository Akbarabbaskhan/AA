import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { importQuestions } from '@/lib/services/quizzes/bank';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  subjectId: z.string().uuid(),
  csv: z.string().min(1).max(2_000_000),
});

export const POST = route({ capability: 'quiz.manage' }, async ({ actor, request }) => {
  const input = bodySchema.parse(await request.json());
  return importQuestions(actor, input.subjectId, input.csv);
});
