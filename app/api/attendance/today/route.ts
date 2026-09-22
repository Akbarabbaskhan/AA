import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getTodaysClasses } from '@/lib/services/attendance/register';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  staffId: z.string().uuid().optional(),
});

/** The teacher's first screen: today's classes, already loaded. */
export const GET = route({ capability: 'attendance.mark' }, async ({ actor, request }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return { classes: await getTodaysClasses(actor, query) };
});
