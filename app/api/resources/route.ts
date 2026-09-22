import { route } from '@/lib/api/handler';
import { createResource, listResources, resourceInputSchema, resourceQuerySchema } from '@/lib/services/resources';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'resource.read' }, async ({ actor, request }) => {
  const query = resourceQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listResources(actor, query);
});

export const POST = route({ capability: 'resource.upload' }, async ({ actor, request }) => {
  const input = resourceInputSchema.parse(await request.json());
  return createResource(actor, input);
});
