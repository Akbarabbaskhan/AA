import { route } from '@/lib/api/handler';
import { createSociety, listSocieties, societyInputSchema } from '@/lib/services/societies';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'society.read' }, async ({ actor }) => listSocieties(actor));

export const POST = route({ capability: 'society.manage' }, async ({ actor, request }) => {
  const input = societyInputSchema.parse(await request.json());
  return createSociety(actor, input);
});
