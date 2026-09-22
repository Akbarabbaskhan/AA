import { route } from '@/lib/api/handler';
import { askDoubt, doubtInputSchema, doubtQuerySchema, listDoubts } from '@/lib/services/doubts';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const query = doubtQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listDoubts(actor, query);
});

export const POST = route({ capability: 'doubt.ask' }, async ({ actor, request }) => {
  const input = doubtInputSchema.parse(await request.json());
  return askDoubt(actor, input);
});
