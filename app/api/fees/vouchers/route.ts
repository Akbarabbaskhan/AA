import { z } from 'zod';
import { NextResponse } from 'next/server';
import { route } from '@/lib/api/handler';
import { renderVoucherBatch } from '@/lib/services/fees/vouchers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const querySchema = z.object({
  academicYearId: z.string().uuid(),
  yearGroupId: z.string().uuid().optional(),
  periodLabel: z.string().min(1).max(60),
});

export const GET = route({ capability: 'fee.manage' }, async ({ actor, request }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const { pdf, count } = await renderVoucherBatch(actor, query);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="vouchers-${query.periodLabel.replace(/\W+/g, '-')}.pdf"`,
      'x-voucher-count': String(count),
      'cache-control': 'private, no-store',
    },
  });
});
