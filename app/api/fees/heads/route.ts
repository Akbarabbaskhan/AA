import { route } from '@/lib/api/handler';
import { createFeeHead, feeHeadSchema, listFeeHeads } from '@/lib/services/fees/structures';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'fee.read.school', module: 'fees' }, async ({ actor }) =>
  listFeeHeads(actor),
);

export const POST = route(
  { capability: 'fee.manage', module: 'fees' },
  async ({ actor, request }) => {
    const input = feeHeadSchema.parse(await request.json());
    return createFeeHead(actor, input);
  },
);
