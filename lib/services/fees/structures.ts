import { z } from 'zod';
import type { FeeFrequency } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import type { LineItem } from './money';

/**
 * Fee heads and structures.
 *
 * A structure is "what a student in this year group pays, this year, at this frequency" —
 * one row per (year group, frequency), holding the heads and the amounts. Invoicing reads
 * it; it does not compute anything itself, so last year's structure keeps producing last
 * year's amounts on a reprint.
 */

export const FEE_FREQUENCIES = ['MONTHLY', 'TERMLY', 'ANNUAL', 'ONE_OFF'] as const;

export const feeHeadSchema = z.object({
  name: z.string().min(1).max(120),
  isRecurring: z.boolean().default(true),
  /** Paisa. */
  defaultAmount: z.number().int().min(0).max(100_000_000),
});

export async function listFeeHeads(actor: Actor) {
  requireCapability(actor, 'fee.read.school');
  return prisma.feeHead.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, isRecurring: true, defaultAmount: true },
  });
}

export async function createFeeHead(actor: Actor, raw: z.infer<typeof feeHeadSchema>) {
  requireCapability(actor, 'fee.manage');
  const input = feeHeadSchema.parse(raw);

  const head = await prisma.feeHead.create({
    data: { schoolId: actor.schoolId, ...input },
    select: { id: true, name: true, defaultAmount: true },
  });
  await writeAudit(actor, {
    action: 'fee.head.create',
    entityType: 'FeeHead',
    entityId: head.id,
    after: head,
  });
  return head;
}

export const feeStructureSchema = z.object({
  academicYearId: z.string().uuid(),
  yearGroupId: z.string().uuid(),
  frequency: z.enum(FEE_FREQUENCIES),
  heads: z
    .array(
      z.object({
        feeHeadId: z.string().uuid(),
        amountPaisa: z.number().int().min(0).max(100_000_000),
      }),
    )
    .min(1)
    .max(30),
});

export type FeeStructureInput = z.infer<typeof feeStructureSchema>;

export type FeeStructureRow = {
  id: string;
  academicYearId: string;
  yearGroupId: string;
  yearGroupName: string;
  frequency: FeeFrequency;
  heads: { feeHeadId: string; label: string; amountPaisa: number }[];
  totalPaisa: number;
};

export function parseHeads(value: unknown): { feeHeadId: string; amountPaisa: number }[] {
  if (!Array.isArray(value)) return [];
  const out: { feeHeadId: string; amountPaisa: number }[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record['feeHeadId'] === 'string' && typeof record['amountPaisa'] === 'number') {
      out.push({ feeHeadId: record['feeHeadId'], amountPaisa: record['amountPaisa'] });
    }
  }
  return out;
}

export async function listFeeStructures(actor: Actor, academicYearId?: string): Promise<FeeStructureRow[]> {
  requireCapability(actor, 'fee.read.school');

  const [structures, heads] = await Promise.all([
    prisma.feeStructure.findMany({
      where: academicYearId ? { academicYearId } : {},
      orderBy: [{ yearGroup: { name: 'asc' } }, { frequency: 'asc' }],
      select: {
        id: true,
        academicYearId: true,
        yearGroupId: true,
        frequency: true,
        headsJson: true,
        yearGroup: { select: { name: true } },
      },
    }),
    prisma.feeHead.findMany({ select: { id: true, name: true } }),
  ]);

  const labels = new Map(heads.map((head) => [head.id, head.name]));

  return structures.map((structure) => {
    const parsed = parseHeads(structure.headsJson);
    return {
      id: structure.id,
      academicYearId: structure.academicYearId,
      yearGroupId: structure.yearGroupId,
      yearGroupName: structure.yearGroup.name,
      frequency: structure.frequency,
      heads: parsed.map((head) => ({
        ...head,
        label: labels.get(head.feeHeadId) ?? 'Unknown head',
      })),
      totalPaisa: parsed.reduce((sum, head) => sum + head.amountPaisa, 0),
    };
  });
}

/**
 * Creates or replaces a structure.
 *
 * Upsert rather than create-only: a school correcting next term's tuition before any
 * invoice has been raised should not have to delete a row first. Once invoices exist they
 * carry their own frozen line items, so editing the structure afterwards changes what is
 * billed next, never what was billed already.
 */
export async function saveFeeStructure(actor: Actor, raw: FeeStructureInput): Promise<{ id: string }> {
  requireCapability(actor, 'fee.manage');
  const input = feeStructureSchema.parse(raw);

  const known = await prisma.feeHead.findMany({
    where: { id: { in: input.heads.map((head) => head.feeHeadId) } },
    select: { id: true },
  });
  if (known.length !== new Set(input.heads.map((head) => head.feeHeadId)).size) {
    throw ApiError.badRequest('unknownFeeHead', 'One of those fee heads no longer exists.');
  }

  const existing = await prisma.feeStructure.findFirst({
    where: {
      academicYearId: input.academicYearId,
      yearGroupId: input.yearGroupId,
      frequency: input.frequency,
    },
    select: { id: true, headsJson: true },
  });

  const structure = existing
    ? await prisma.feeStructure.update({
        where: { id: existing.id },
        data: { headsJson: input.heads },
        select: { id: true },
      })
    : await prisma.feeStructure.create({
        data: {
          schoolId: actor.schoolId,
          academicYearId: input.academicYearId,
          yearGroupId: input.yearGroupId,
          frequency: input.frequency,
          headsJson: input.heads,
        },
        select: { id: true },
      });

  await writeAudit(actor, {
    action: existing ? 'fee.structure.update' : 'fee.structure.create',
    entityType: 'FeeStructure',
    entityId: structure.id,
    ...(existing ? { before: { heads: parseHeads(existing.headsJson) } } : {}),
    after: { heads: input.heads },
  });

  return structure;
}

/** The line items a structure produces, resolved against current head names. */
export async function lineItemsFor(structureId: string): Promise<LineItem[]> {
  const structure = await prisma.feeStructure.findFirst({
    where: { id: structureId },
    select: { headsJson: true },
  });
  if (!structure) throw ApiError.notFound('Fee structure not found');

  const parsed = parseHeads(structure.headsJson);
  const heads = await prisma.feeHead.findMany({
    where: { id: { in: parsed.map((head) => head.feeHeadId) } },
    select: { id: true, name: true },
  });
  const labels = new Map(heads.map((head) => [head.id, head.name]));

  return parsed.map((head) => ({
    feeHeadId: head.feeHeadId,
    label: labels.get(head.feeHeadId) ?? 'Fee',
    amountPaisa: head.amountPaisa,
  }));
}
