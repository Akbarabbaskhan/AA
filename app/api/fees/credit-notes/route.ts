import { route } from '@/lib/api/handler';
import { creditNoteSchema, issueCreditNote } from '@/lib/services/fees/invoices';

export const dynamic = 'force-dynamic';

export const POST = route({ capability: 'fee.manage' }, async ({ actor, request }) => {
  const input = creditNoteSchema.parse(await request.json());
  return issueCreditNote(actor, input);
});
