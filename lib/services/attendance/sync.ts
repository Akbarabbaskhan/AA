import { z } from 'zod';
import { prisma, withoutTenantScope } from '@/lib/db';
import type { Actor } from '@/lib/permissions';
import { saveRegister, saveRegisterSchema } from './register';

/**
 * The offline write queue's landing point.
 *
 * "Attendance marked offline on a phone in airplane mode appears in the admin dashboard
 * within 60 seconds of reconnecting, with the original period timestamp preserved, not the
 * sync time."
 *
 * Two properties matter more than throughput here:
 *
 *   Idempotent — a phone that loses signal mid-sync retries the whole batch. Replaying a
 *   batch must not double-write or clobber a later correction, so each batch carries a
 *   client-generated id recorded in `processed_events`.
 *
 *   Per-row results — "bulk endpoints return per-row results, not a single success flag",
 *   so the phone can clear the registers that landed and keep the ones that did not.
 */
export const syncBatchSchema = z.object({
  /** Generated on the device when the batch is formed, stable across retries. */
  batchId: z.string().uuid(),
  registers: z.array(saveRegisterSchema).min(1).max(50),
});

export type SyncBatchInput = z.infer<typeof syncBatchSchema>;

export type SyncRegisterResult = {
  sectionId: string;
  date: string;
  periodIndex: number;
  status: 'applied' | 'failed';
  sessionId?: string;
  /** Marks the server rejected — a dropped student, or an earlier mark that wins. */
  skipped?: { studentId: string; reason: string }[];
  error?: { code: string; message: string };
};

export type SyncBatchResult = {
  batchId: string;
  /** True when this exact batch had already been processed and was not re-applied. */
  replayed: boolean;
  registers: SyncRegisterResult[];
};

export async function syncBatch(actor: Actor, input: SyncBatchInput): Promise<SyncBatchResult> {
  // The idempotency ledger is global by design — it is keyed on an id the device generated,
  // and it holds no tenant data beyond the result summary.
  const alreadyProcessed = await withoutTenantScope(() =>
    prisma.processedEvent.findUnique({
      where: { source_externalId: { source: 'attendance.sync', externalId: input.batchId } },
      select: { resultJson: true },
    }),
  );

  if (alreadyProcessed) {
    return {
      batchId: input.batchId,
      replayed: true,
      registers: (alreadyProcessed.resultJson as SyncRegisterResult[] | null) ?? [],
    };
  }

  const registers: SyncRegisterResult[] = [];

  for (const register of input.registers) {
    try {
      const result = await saveRegister(actor, register);
      const skipped = result.results
        .filter((entry) => !entry.applied)
        .map((entry) => ({ studentId: entry.studentId, reason: entry.reason ?? 'unknown' }));

      registers.push({
        sectionId: register.sectionId,
        date: register.date,
        periodIndex: register.periodIndex,
        status: 'applied',
        sessionId: result.sessionId,
        ...(skipped.length > 0 ? { skipped } : {}),
      });
    } catch (error) {
      // One bad register must not strand the rest of the day's queue on the device.
      const code = error instanceof Error ? error.name : 'unknown';
      registers.push({
        sectionId: register.sectionId,
        date: register.date,
        periodIndex: register.periodIndex,
        status: 'failed',
        error: {
          code: (error as { code?: string }).code ?? code,
          message: error instanceof Error ? error.message : 'Could not sync this register',
        },
      });
    }
  }

  await withoutTenantScope(() =>
    prisma.processedEvent.create({
      data: {
        source: 'attendance.sync',
        externalId: input.batchId,
        resultJson: registers as unknown as object,
      },
    }),
  );

  return { batchId: input.batchId, replayed: false, registers };
}
