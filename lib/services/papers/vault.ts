import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { cursorArgs, paginationSchema, toPage, type Page } from '@/lib/api/pagination';
import { writeAudit } from '@/lib/services/audit';
import { requireCapability, type Actor } from '@/lib/permissions';
import { getStorage, isAcceptableVideoLink } from '@/lib/storage';

/**
 * The past paper vault.
 *
 * "The single most addictive feature for an A Level student. Today they hunt through
 * WhatsApp groups and cluttered download sites. Volt makes it organised and fast."
 *
 * Note the content position, which is a legal one rather than a technical one: Volt ships
 * the uploader and the taxonomy, and each school uploads its own copies into its own tenant
 * storage. There is no preloaded library here and there should not be one — CAIE and
 * Pearson own their papers.
 */

export const PAPER_SESSIONS = ['MAY_JUNE', 'OCT_NOV', 'FEB_MARCH'] as const;

export const vaultQuerySchema = paginationSchema.extend({
  subjectId: z.string().uuid().optional(),
  componentId: z.string().uuid().optional(),
  yearFrom: z.coerce.number().int().min(1990).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1990).max(2100).optional(),
  session: z.enum(PAPER_SESSIONS).optional(),
  variant: z.coerce.number().int().min(1).max(9).optional(),
  topicTag: z.string().max(60).optional(),
  /** "Never attempted" — so a student can find fresh papers instantly. */
  onlyUnattempted: z.coerce.boolean().optional(),
  collectionId: z.string().uuid().optional(),
});

export type VaultPaper = {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  componentCode: string | null;
  board: string;
  session: string;
  year: number;
  variant: number;
  durationMinutes: number | null;
  totalMarks: number | null;
  difficulty: number | null;
  topicTags: string[];
  hasMarkScheme: boolean;
  hasExaminerReport: boolean;
  /** Null for staff — "attempted" is a student's own relationship to a paper. */
  attemptCount: number | null;
  bestPercent: number | null;
};

/**
 * Lists papers.
 *
 * A student's own attempt counts are folded in from one extra query rather than a subquery
 * per row: at four hundred papers the N+1 version is the difference between a screen that
 * opens and one a student gives up on.
 */
export async function listPapers(
  actor: Actor,
  query: z.infer<typeof vaultQuerySchema>,
): Promise<Page<VaultPaper>> {
  requireCapability(actor, 'pastpaper.read');

  const filters: Prisma.PastPaperWhereInput[] = [];
  if (query.subjectId) filters.push({ subjectId: query.subjectId });
  if (query.componentId) filters.push({ componentId: query.componentId });
  if (query.session) filters.push({ session: query.session });
  if (query.variant) filters.push({ variant: query.variant });
  if (query.yearFrom) filters.push({ year: { gte: query.yearFrom } });
  if (query.yearTo) filters.push({ year: { lte: query.yearTo } });
  if (query.topicTag) filters.push({ topicTags: { has: query.topicTag } });
  if (query.collectionId) {
    filters.push({ collectionEntries: { some: { collectionId: query.collectionId } } });
  }

  // "Never attempted" is only meaningful for a student, and it has to be applied in the
  // query rather than after paging, or page two silently contains attempted papers.
  if (query.onlyUnattempted && actor.studentId) {
    filters.push({ attempts: { none: { studentId: actor.studentId } } });
  }

  const rows = await prisma.pastPaper.findMany({
    where: filters.length > 0 ? { AND: filters } : {},
    ...cursorArgs(query),
    orderBy: [{ year: 'desc' }, { session: 'asc' }, { variant: 'asc' }],
    select: {
      id: true,
      subjectId: true,
      board: true,
      session: true,
      year: true,
      variant: true,
      durationMinutes: true,
      totalMarks: true,
      difficulty: true,
      topicTags: true,
      markSchemeUrl: true,
      examinerReportUrl: true,
      subject: { select: { name: true, code: true } },
      component: { select: { code: true } },
    },
  });

  const attemptsByPaper = new Map<string, { count: number; bestPercent: number | null }>();
  if (actor.studentId && rows.length > 0) {
    const attempts = await prisma.paperAttempt.findMany({
      where: {
        studentId: actor.studentId,
        pastPaperId: { in: rows.map((row) => row.id) },
        submittedAt: { not: null },
      },
      select: { pastPaperId: true, selfMarkedScore: true, total: true },
    });

    for (const attempt of attempts) {
      const existing = attemptsByPaper.get(attempt.pastPaperId) ?? { count: 0, bestPercent: null };
      const percent =
        attempt.selfMarkedScore !== null && attempt.total !== null && attempt.total > 0
          ? (attempt.selfMarkedScore / attempt.total) * 100
          : null;
      attemptsByPaper.set(attempt.pastPaperId, {
        count: existing.count + 1,
        bestPercent:
          percent === null
            ? existing.bestPercent
            : Math.max(existing.bestPercent ?? 0, percent),
      });
    }
  }

  return toPage(
    rows.map((row) => {
      const attempts = attemptsByPaper.get(row.id);
      return {
        id: row.id,
        subjectId: row.subjectId,
        subjectName: row.subject.name,
        subjectCode: row.subject.code,
        componentCode: row.component?.code ?? null,
        board: row.board,
        session: row.session,
        year: row.year,
        variant: row.variant,
        durationMinutes: row.durationMinutes,
        totalMarks: row.totalMarks,
        difficulty: row.difficulty,
        topicTags: row.topicTags,
        hasMarkScheme: row.markSchemeUrl !== null,
        hasExaminerReport: row.examinerReportUrl !== null,
        attemptCount: actor.studentId ? (attempts?.count ?? 0) : null,
        bestPercent: attempts?.bestPercent ?? null,
      };
    }),
    query.limit,
  );
}

export type VaultFacets = {
  subjects: { id: string; name: string; code: string; papers: number }[];
  years: number[];
  topicTags: string[];
};

/** The filter options, counted from what is actually in the vault. */
export async function getVaultFacets(actor: Actor): Promise<VaultFacets> {
  requireCapability(actor, 'pastpaper.read');

  const [bySubject, years, tagRows] = await Promise.all([
    prisma.pastPaper.groupBy({ by: ['subjectId'], _count: { _all: true } }),
    prisma.pastPaper.findMany({ distinct: ['year'], select: { year: true }, orderBy: { year: 'desc' } }),
    prisma.pastPaper.findMany({ select: { topicTags: true }, take: 500 }),
  ]);

  const subjects = await prisma.subject.findMany({
    where: { id: { in: bySubject.map((row) => row.subjectId) } },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });

  const counts = new Map(bySubject.map((row) => [row.subjectId, row._count._all]));
  const tags = new Set<string>();
  for (const row of tagRows) for (const tag of row.topicTags) tags.add(tag);

  return {
    subjects: subjects.map((subject) => ({ ...subject, papers: counts.get(subject.id) ?? 0 })),
    years: years.map((row) => row.year),
    topicTags: [...tags].sort(),
  };
}

export const createPaperSchema = z.object({
  subjectId: z.string().uuid(),
  componentId: z.string().uuid().nullable().optional(),
  board: z.string().min(2).max(40),
  session: z.enum(PAPER_SESSIONS),
  year: z.number().int().min(1990).max(2100),
  variant: z.number().int().min(1).max(9),
  /** Storage keys, produced by the upload ticket flow. */
  paperKey: z.string().min(1).max(500),
  markSchemeKey: z.string().max(500).nullable().optional(),
  examinerReportKey: z.string().max(500).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(360).nullable().optional(),
  totalMarks: z.number().int().min(1).max(500).nullable().optional(),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  topicTags: z.array(z.string().min(1).max(60)).max(20).default([]),
});

export async function createPastPaper(actor: Actor, input: z.infer<typeof createPaperSchema>) {
  requireCapability(actor, 'pastpaper.manage');

  const subject = await prisma.subject.findFirst({
    where: { id: input.subjectId },
    select: { id: true },
  });
  if (!subject) throw ApiError.notFound('Subject not found');

  if (input.componentId) {
    const component = await prisma.subjectComponent.findFirst({
      where: { id: input.componentId, subjectId: input.subjectId },
      select: { id: true },
    });
    if (!component) {
      throw ApiError.badRequest('componentMismatch', 'That component belongs to a different subject.');
    }
  }

  // The same paper twice is the commonest upload mistake, and a vault full of duplicates is
  // exactly the cluttered download site this replaces.
  const existing = await prisma.pastPaper.findFirst({
    where: {
      subjectId: input.subjectId,
      componentId: input.componentId ?? null,
      year: input.year,
      session: input.session,
      variant: input.variant,
    },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict('paperExists', 'That paper is already in the vault.');
  }

  const paper = await prisma.pastPaper.create({
    data: {
      schoolId: actor.schoolId,
      subjectId: input.subjectId,
      componentId: input.componentId ?? null,
      board: input.board,
      session: input.session,
      year: input.year,
      variant: input.variant,
      paperUrl: input.paperKey,
      markSchemeUrl: input.markSchemeKey ?? null,
      examinerReportUrl: input.examinerReportKey ?? null,
      durationMinutes: input.durationMinutes ?? null,
      totalMarks: input.totalMarks ?? null,
      difficulty: input.difficulty ?? null,
      topicTags: input.topicTags,
    },
  });

  await writeAudit(actor, {
    action: 'pastpaper.create',
    entityType: 'Student',
    entityId: paper.id,
    after: { year: paper.year, session: paper.session, variant: paper.variant },
  });

  return paper;
}

export type PaperLinks = {
  id: string;
  paperUrl: string;
  /** Withheld while a timed attempt is running — see the practice engine. */
  markSchemeUrl: string | null;
  examinerReportUrl: string | null;
};

/**
 * Turns stored keys into short-lived URLs.
 *
 * "In-browser PDF viewer with page thumbnails — do not force a download on a metered
 * connection." So these are inline URLs by default; the download flag is the student's
 * choice, not ours.
 */
export async function getPaperLinks(
  actor: Actor,
  paperId: string,
  options: { includeMarkScheme: boolean; download?: boolean } = { includeMarkScheme: true },
): Promise<PaperLinks> {
  requireCapability(actor, 'pastpaper.read');

  const paper = await prisma.pastPaper.findFirst({
    where: { id: paperId },
    select: { id: true, paperUrl: true, markSchemeUrl: true, examinerReportUrl: true },
  });
  if (!paper) throw ApiError.notFound('Paper not found');

  const storage = getStorage();
  const sign = (key: string | null) =>
    key === null
      ? Promise.resolve(null)
      : storage.createDownloadUrl(key, { expiresInSeconds: 3600, ...(options.download ? { download: true } : {}) });

  const [paperUrl, markSchemeUrl, examinerReportUrl] = await Promise.all([
    sign(paper.paperUrl),
    options.includeMarkScheme ? sign(paper.markSchemeUrl) : Promise.resolve(null),
    options.includeMarkScheme ? sign(paper.examinerReportUrl) : Promise.resolve(null),
  ]);

  return {
    id: paper.id,
    paperUrl: paperUrl!,
    markSchemeUrl,
    examinerReportUrl,
  };
}

export { isAcceptableVideoLink };
