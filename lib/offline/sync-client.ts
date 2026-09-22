import { dequeueRegister, pendingRegisters, recordFailure, type QueuedRegister } from './attendance-queue';

/**
 * Drains the offline queue.
 *
 * Batches are capped so a teacher who has been offline all day does not send one enormous
 * request that times out on 3G and then retries from scratch.
 */
const MAX_PER_BATCH = 25;

export type SyncOutcome = {
  attempted: number;
  applied: number;
  failed: number;
  remaining: number;
  /**
   * Registers the server accepted but did not apply, because someone had already marked
   * that period earlier. Reported rather than swallowed: a teacher told "saved" whose
   * marks were dropped is exactly how this product loses a staff room's trust.
   */
  superseded: number;
};

type SyncResponse = {
  batchId: string;
  replayed: boolean;
  registers: {
    sectionId: string;
    date: string;
    periodIndex: number;
    status: 'applied' | 'failed';
    skipped?: { studentId: string; reason: string }[];
    error?: { code: string; message: string };
  }[];
};

export async function drainQueue(): Promise<SyncOutcome> {
  const queued = await pendingRegisters();
  if (queued.length === 0) {
    return { attempted: 0, applied: 0, failed: 0, remaining: 0, superseded: 0 };
  }

  const batch = queued.slice(0, MAX_PER_BATCH);

  // The batch id is derived from the entries, so a retry after a dropped response replays
  // the same batch rather than creating a second one the server treats as new work.
  const batchId = batch[0]!.id;

  const response = await fetch('/api/attendance/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      batchId,
      registers: batch.map((entry) => ({
        sectionId: entry.sectionId,
        date: entry.date,
        periodIndex: entry.periodIndex,
        markedAt: entry.markedAt,
        deviceId: entry.deviceId,
        marks: entry.marks,
      })),
    }),
  });

  if (!response.ok) {
    // A server error leaves everything queued — nothing is lost, it simply tries again.
    for (const entry of batch) {
      await recordFailure(entry, `Server responded ${response.status}`);
    }
    return {
      attempted: batch.length,
      applied: 0,
      failed: batch.length,
      remaining: queued.length,
      superseded: 0,
    };
  }

  const result = (await response.json()) as SyncResponse;

  let applied = 0;
  let failed = 0;
  let superseded = 0;

  for (const entry of batch) {
    const outcome = result.registers.find(
      (row) =>
        row.sectionId === entry.sectionId &&
        row.date === entry.date &&
        row.periodIndex === entry.periodIndex,
    );

    if (outcome?.status === 'applied') {
      // Accepted, but every mark lost to an earlier one: the register is off the queue and
      // the teacher needs to know it did not take.
      const wholeRegisterSuperseded =
        (outcome.skipped?.length ?? 0) > 0 &&
        outcome.skipped!.every((entry) => entry.reason === 'supersededByEarlierMark');
      if (wholeRegisterSuperseded) superseded += 1;

      await dequeueRegister(entry.id);
      applied += 1;
    } else {
      await recordFailure(entry, outcome?.error?.message ?? 'The server did not accept this register');
      failed += 1;
    }
  }

  return {
    attempted: batch.length,
    applied,
    failed,
    remaining: queued.length - applied,
    superseded,
  };
}
