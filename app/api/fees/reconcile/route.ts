import { route } from '@/lib/api/handler';
import {
  confirmMatches,
  confirmMatchesSchema,
  proposeMatches,
  reconcileQuerySchema,
} from '@/lib/services/fees/reconciliation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Proposes only. Nothing is posted until the bursar confirms through PUT. */
export const POST = route({ capability: 'payment.reconcile' }, async ({ actor, request }) => {
  const input = reconcileQuerySchema.parse(await request.json());
  return proposeMatches(actor, input);
});

export const PUT = route({ capability: 'payment.reconcile' }, async ({ actor, request }) => {
  const input = confirmMatchesSchema.parse(await request.json());
  return confirmMatches(actor, input);
});
