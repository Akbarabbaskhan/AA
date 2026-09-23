import { route } from '@/lib/api/handler';
import { reversalSchema, reversePayment } from '@/lib/services/fees/payments';

export const dynamic = 'force-dynamic';

export const POST = route({ capability: 'fee.manage' }, async ({ actor, request }) => {
  const input = reversalSchema.parse(await request.json());
  return reversePayment(actor, input);
});
