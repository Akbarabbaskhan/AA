import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getTeacherCompliance } from '@/lib/services/attendance/reports';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const GET = route({ capability: 'report.school' }, async ({ actor, request }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return { teachers: await getTeacherCompliance(actor, query) };
});
