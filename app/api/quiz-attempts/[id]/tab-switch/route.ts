import { route } from '@/lib/api/handler';
import { recordTabSwitch } from '@/lib/services/quizzes/quiz';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(
  { capability: 'quiz.take' },
  async ({ actor, params }) => recordTabSwitch(actor, params.id),
);
