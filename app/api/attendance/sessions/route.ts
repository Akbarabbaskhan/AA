import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getRegister, saveRegister, saveRegisterSchema } from '@/lib/services/attendance/register';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  sectionId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodIndex: z.coerce.number().int().min(1).max(20),
});

export const GET = route({ capability: 'attendance.read.section' }, async ({ actor, request }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return getRegister(actor, query);
});

export const POST = route({ capability: 'attendance.mark' }, async ({ actor, request }) => {
  const body = saveRegisterSchema.parse(await request.json());
  return saveRegister(actor, body);
});
