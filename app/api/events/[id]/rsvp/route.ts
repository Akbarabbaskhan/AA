import { route } from '@/lib/api/handler';
import { cancelRsvp, rsvp } from '@/lib/services/events';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>({ capability: 'event.rsvp' }, async ({ actor, params }) =>
  rsvp(actor, params.id),
);

export const DELETE = route<{ id: string }>({ capability: 'event.rsvp' }, async ({ actor, params }) =>
  cancelRsvp(actor, params.id),
);
