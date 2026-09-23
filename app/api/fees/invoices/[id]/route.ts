import { route } from '@/lib/api/handler';
import { getInvoice } from '@/lib/services/fees/invoices';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>({}, async ({ actor, params }) => getInvoice(actor, params.id));
