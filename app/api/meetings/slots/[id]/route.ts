import { route } from '@/lib/api/handler';
import { bookSlot, bookSlotSchema, cancelBooking } from '@/lib/services/parents/bookings';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>({}, async ({ actor, request, params }) => {
  const input = bookSlotSchema.parse(await request.json().catch(() => ({})));
  return bookSlot(actor, params.id, input);
});

export const DELETE = route<{ id: string }>({}, async ({ actor, params }) =>
  cancelBooking(actor, params.id),
);
