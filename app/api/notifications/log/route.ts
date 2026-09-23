import { route } from '@/lib/api/handler';
import { deliveryLogQuerySchema, getDeliveryLog } from '@/lib/services/notifications/inbox';

export const dynamic = 'force-dynamic';

/**
 * The delivery log. "When a parent says 'I was never informed', the school can show them
 * otherwise" — so this is the admin's evidence, not a debugging endpoint.
 */
export const GET = route({ capability: 'audit.read' }, async ({ actor, request }) => {
  const query = deliveryLogQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return getDeliveryLog(actor, query);
});
