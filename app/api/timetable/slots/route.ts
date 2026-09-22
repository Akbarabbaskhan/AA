import { route } from '@/lib/api/handler';
import { placeSlot, placementSchema } from '@/lib/services/timetable';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

export const POST = route({ capability: 'timetable.manage' }, async ({ actor, request }) => {
  const body = placementSchema.parse(await request.json());
  return placeSlot(actor, body);
});
