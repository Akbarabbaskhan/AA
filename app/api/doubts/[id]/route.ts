import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getDoubt, resolveDoubt } from '@/lib/services/doubts';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>({}, async ({ actor, params }) => getDoubt(actor, params.id));

export const PATCH = route<{ id: string }>({}, async ({ actor, request, params }) => {
  const { isResolved } = z.object({ isResolved: z.boolean() }).parse(await request.json());
  return resolveDoubt(actor, params.id, isResolved);
});
