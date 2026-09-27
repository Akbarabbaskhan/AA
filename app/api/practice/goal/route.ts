import { route } from '@/lib/api/handler';
import { getPracticeGoal, setPracticeGoal, goalSchema } from '@/lib/services/papers/practice';

export const dynamic = 'force-dynamic';

export const GET = route({ module: 'learning' }, async ({ actor }) => getPracticeGoal(actor));

export const PUT = route(
  { capability: 'attempt.create', module: 'learning' },
  async ({ actor, request }) => {
    const input = goalSchema.parse(await request.json());
    return setPracticeGoal(actor, input);
  },
);
