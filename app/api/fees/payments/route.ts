import { route } from '@/lib/api/handler';
import { paymentSchema, recordPayment } from '@/lib/services/fees/payments';

export const dynamic = 'force-dynamic';

export const POST = route({ capability: 'payment.record' }, async ({ actor, request }) => {
  const input = paymentSchema.parse(await request.json());
  return recordPayment(actor, input);
});
