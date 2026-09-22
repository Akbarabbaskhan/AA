import { route } from '@/lib/api/handler';
import { syncBatch, syncBatchSchema } from '@/lib/services/attendance/sync';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

/**
 * Where the offline queue lands. Idempotent on `batchId`, and it answers with a per-register
 * result so the device knows exactly what to clear.
 */
export const POST = route({ capability: 'attendance.mark' }, async ({ actor, request }) => {
  const body = syncBatchSchema.parse(await request.json());
  return syncBatch(actor, body);
});
