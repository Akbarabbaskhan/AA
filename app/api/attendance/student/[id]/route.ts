import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getStudentAttendance } from '@/lib/services/attendance/reports';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * No capability gate here on purpose: a student, a parent and a teacher all reach this with
 * different capabilities, and the row-level check inside the service is the one that
 * decides whose record may be read.
 */
export const GET = route<{ id: string }>({}, async ({ actor, request, params }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return getStudentAttendance(actor, params.id, query);
});
