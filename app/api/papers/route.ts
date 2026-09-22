import { route } from '@/lib/api/handler';
import { createPaperSchema, createPastPaper, listPapers, vaultQuerySchema } from '@/lib/services/papers/vault';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'pastpaper.read' }, async ({ actor, request }) => {
  const query = vaultQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listPapers(actor, query);
});

export const POST = route({ capability: 'pastpaper.manage' }, async ({ actor, request }) => {
  const input = createPaperSchema.parse(await request.json());
  return createPastPaper(actor, input);
});
