import { route } from '@/lib/api/handler';
import { getPracticeGoal, setPracticeGoal, goalSchema } from '@/lib/services/papers/practice';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor }) => getPracticeGoal(actor));

export const PUT = route({ capability: 'attempt.create' }, async ({ actor, request }) => {
  const input = goalSchema.parse(await request.json());
  return setPracticeGoal(actor, input);
});
