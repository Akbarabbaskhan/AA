import { route } from '@/lib/api/handler';
import { getAttendees } from '@/lib/services/events';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>({}, async ({ actor, params }) =>
  getAttendees(actor, params.id),
);
