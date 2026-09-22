import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getPracticeTrend } from '@/lib/services/papers/practice';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const { studentId } = z
    .object({ studentId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getPracticeTrend(actor, studentId);
});
