import { route } from '@/lib/api/handler';
import { replySchema, replyToDoubt } from '@/lib/services/doubts';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>({}, async ({ actor, request, params }) => {
  const input = replySchema.parse(await request.json());
  return replyToDoubt(actor, params.id, input);
});
