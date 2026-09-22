import { route } from '@/lib/api/handler';
import { selfMarkAttempt, selfMarkSchema } from '@/lib/services/papers/practice';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(
  { capability: 'attempt.create' },
  async ({ actor, request, params }) => {
    const input = selfMarkSchema.parse(await request.json());
    return selfMarkAttempt(actor, params.id, input);
  },
);
