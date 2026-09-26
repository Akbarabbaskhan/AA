import { route } from '@/lib/api/handler';
import { calendarQuerySchema, getCalendar } from '@/lib/services/calendar';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const query = calendarQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return getCalendar(actor, query);
});
