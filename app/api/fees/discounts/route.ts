import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { discountSchema, grantDiscount, listDiscounts } from '@/lib/services/fees/payments';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'fee.read.school' }, async ({ actor, request }) => {
  const { studentId } = z
    .object({ studentId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return listDiscounts(actor, studentId);
});

export const POST = route({ capability: 'discount.approve' }, async ({ actor, request }) => {
  const input = discountSchema.parse(await request.json());
  return grantDiscount(actor, input);
});
