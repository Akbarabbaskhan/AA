import { route } from '@/lib/api/handler';
import { amendRecord, amendSchema } from '@/lib/services/attendance/register';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

/** Admin amendment of a locked register. The reason is required and it is audit-logged. */
export const PATCH = route<{ id: string }>(
  { capability: 'attendance.amend' },
  async ({ actor, request, params }) => {
    const body = amendSchema.parse(await request.json());
    return amendRecord(actor, params.id, body);
  },
);
