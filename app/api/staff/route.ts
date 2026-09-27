import { route } from '@/lib/api/handler';
import { listStaff, staffQuerySchema } from '@/lib/services/staff';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'user.read' }, async ({ actor, request }) => {
  const query = staffQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listStaff(actor, query);
});
