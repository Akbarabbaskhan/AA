import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { listAttempts, startAttempt } from '@/lib/services/papers/practice';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  studentId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = route({}, async ({ actor, request }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listAttempts(actor, query);
});

export const POST = route({ capability: 'attempt.create' }, async ({ actor, request }) => {
  const { pastPaperId } = z.object({ pastPaperId: z.string().uuid() }).parse(await request.json());
  return startAttempt(actor, pastPaperId);
});
