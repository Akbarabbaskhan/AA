import { route } from '@/lib/api/handler';
import { careerItemSchema, careerQuerySchema, createCareerItem, listCareerItems } from '@/lib/services/careers';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'career.read' }, async ({ actor, request }) => {
  const query = careerQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listCareerItems(actor, query);
});

export const POST = route({ capability: 'career.manage' }, async ({ actor, request }) => {
  const input = careerItemSchema.parse(await request.json());
  return createCareerItem(actor, input);
});
