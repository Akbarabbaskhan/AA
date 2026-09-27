import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getDigitalId } from '@/lib/services/identity';

export const dynamic = 'force-dynamic';

export const GET = route({ module: 'identity' }, async ({ actor, request }) => {
  const { studentId } = z
    .object({ studentId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getDigitalId(actor, studentId);
});
