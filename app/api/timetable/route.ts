import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getTimetable } from '@/lib/services/timetable';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  studentId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  yearGroupId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const GET = route({ capability: 'timetable.read' }, async ({ actor, request }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return getTimetable(actor, query);
});
