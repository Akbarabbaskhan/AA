import { route } from '@/lib/api/handler';
import { submitAttempt } from '@/lib/services/papers/practice';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(
  { capability: 'attempt.create' },
  async ({ actor, params }) => submitAttempt(actor, params.id),
);
