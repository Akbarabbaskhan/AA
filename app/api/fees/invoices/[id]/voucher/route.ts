import { NextResponse } from 'next/server';
import { route } from '@/lib/api/handler';
import { renderInvoiceVoucher } from '@/lib/services/fees/vouchers';
import { getInvoice } from '@/lib/services/fees/invoices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = route<{ id: string }>({}, async ({ actor, params }) => {
  const invoice = await getInvoice(actor, params.id);
  const pdf = await renderInvoiceVoucher(actor, params.id);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${invoice.voucherNumber}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
});
