import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getDailyReport } from '@/lib/services/attendance/reports';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const GET = route({ capability: 'attendance.read.school' }, async ({ actor, request }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return getDailyReport(actor, query.date);
});
