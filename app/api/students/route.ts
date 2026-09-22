import { route } from '@/lib/api/handler';
import { listStudents, studentQuerySchema } from '@/lib/services/students';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const query = studentQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  return listStudents(actor, query);
});
