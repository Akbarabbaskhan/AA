import { route } from '@/lib/api/handler';
import { moveSlot, placementSchema, removeSlot } from '@/lib/services/timetable';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

export const PATCH = route<{ id: string }>(
  { capability: 'timetable.manage' },
  async ({ actor, request, params }) => {
    const body = placementSchema.parse(await request.json());
    return moveSlot(actor, params.id, body);
  },
);

export const DELETE = route<{ id: string }>(
  { capability: 'timetable.manage' },
  async ({ actor, params }) => removeSlot(actor, params.id),
);
