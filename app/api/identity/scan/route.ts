import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { scanId } from '@/lib/services/identity';

export const dynamic = 'force-dynamic';

/** Staff only; the scan returns just enough to recognise the person in front of you. */
export const POST = route({}, async ({ actor, request }) => {
  const { token } = z.object({ token: z.string().min(1).max(500) }).parse(await request.json());
  return scanId(actor, token);
});
