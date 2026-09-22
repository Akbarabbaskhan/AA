import { route } from '@/lib/api/handler';
import { checkPlacement, placementSchema } from '@/lib/services/timetable';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

/** The preview behind the builder's drag-and-drop: all three axes, before anything moves. */
export const POST = route({ capability: 'timetable.read' }, async ({ actor, request }) => {
  const body = placementSchema.parse(await request.json());
  return checkPlacement(actor, body);
});
