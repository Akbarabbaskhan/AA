import { route } from '@/lib/api/handler';
import { createRemark, listRemarks, remarkQuerySchema } from '@/lib/services/remarks';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const query = remarkQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listRemarks(actor, query);
});

export const POST = route({ capability: 'remark.write' }, async ({ actor, request }) =>
  createRemark(actor, await request.json()),
);
