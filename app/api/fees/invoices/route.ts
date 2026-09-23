import { route } from '@/lib/api/handler';
import { bulkInvoiceSchema, generateInvoices, invoiceQuerySchema, listInvoices } from '@/lib/services/fees/invoices';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const query = invoiceQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listInvoices(actor, query);
});

export const POST = route({ capability: 'fee.manage' }, async ({ actor, request }) => {
  const input = bulkInvoiceSchema.parse(await request.json());
  return generateInvoices(actor, input);
});
