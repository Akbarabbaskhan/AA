import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { assertCanAccessStudent, can, type Actor } from '@/lib/permissions';
import { renderResultCards, type ResultCardData } from '@/lib/pdf/result-card';
import { loadTenantBranding } from '@/lib/theme/load';
import type { ResultCardAggregate } from './publish';

/**
 * Turning a published snapshot into a printable card.
 *
 * Nothing is recomputed here: the aggregate was frozen at publication, so a card reprinted
 * three years from now is byte-for-byte the one the family received.
 */

async function loadCards(
  examSeriesId: string,
  where: { studentId?: string; yearGroupId?: string; limit?: number },
): Promise<ResultCardData[]> {
  const [branding, school, cards] = await Promise.all([
    prisma.school.findFirstOrThrow({ select: { slug: true } }).then((row) => loadTenantBranding(row.slug)),
    prisma.school.findFirstOrThrow({ select: { name: true, address: true, logoUrl: true } }),
    prisma.resultCard.findMany({
      where: {
        examSeriesId,
        ...(where.studentId ? { studentId: where.studentId } : {}),
        ...(where.yearGroupId
          ? {
              student: {
                enrolments: {
                  some: { droppedAt: null, section: { yearGroupId: where.yearGroupId } },
                },
              },
            }
          : {}),
      },
      select: {
        aggregateJson: true,
        student: {
          select: {
            rollNumber: true,
            admissionNumber: true,
            house: true,
            photoUrl: true,
            user: { select: { name: true } },
            enrolments: {
              where: { droppedAt: null },
              take: 1,
              select: { section: { select: { yearGroup: { select: { name: true } } } } },
            },
          },
        },
      },
      // Roll-number order, which is the order the print shop wants them stacked in.
      orderBy: { student: { rollNumber: 'asc' } },
      ...(where.limit ? { take: where.limit } : {}),
    }),
  ]);

  const brandColour = branding?.theme.light.brandPrimary ?? '#1E3A8A';

  return cards.map((card) => ({
    school: {
      name: school.name,
      address: school.address,
      brandColour,
      logoUrl: school.logoUrl,
    },
    student: {
      name: card.student.user.name,
      rollNumber: card.student.rollNumber,
      admissionNumber: card.student.admissionNumber,
      yearGroup: card.student.enrolments[0]?.section.yearGroup.name ?? null,
      house: card.student.house,
      photoUrl: card.student.photoUrl,
    },
    aggregate: card.aggregateJson as unknown as ResultCardAggregate,
  }));
}

/** One student's card. A student or parent may fetch their own; staff may fetch any. */
export async function renderStudentResultCard(
  actor: Actor,
  studentId: string,
  examSeriesId: string,
): Promise<Buffer> {
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
  });
  if (!student) throw ApiError.notFound('Student not found');

  assertCanAccessStudent(
    actor,
    studentId,
    student.enrolments.map((entry) => entry.sectionId),
  );

  const series = await prisma.examSeries.findFirst({
    where: { id: examSeriesId },
    select: { isPublished: true },
  });
  // An unpublished series has no card a family may see, whoever asks.
  if (!series?.isPublished && !can(actor, 'exam.publish')) {
    throw ApiError.notFound('Result card not available');
  }

  const cards = await loadCards(examSeriesId, { studentId });
  if (cards.length === 0) throw ApiError.notFound('Result card not available');

  return renderResultCards(cards);
}

/**
 * "Bulk generation for a whole year group runs as a background job and produces a single
 * merged PDF for the print shop plus individual PDFs for the portal."
 *
 * This is the merged one. The per-student files come from the same snapshots through
 * `renderStudentResultCard`, so the two can never disagree.
 */
export async function renderYearGroupResultCards(
  actor: Actor,
  examSeriesId: string,
  yearGroupId: string,
  options: { limit?: number } = {},
): Promise<{ pdf: Buffer; count: number }> {
  if (!can(actor, 'resultcard.generate')) {
    throw ApiError.notFound('Result cards not available');
  }

  // Rendering is roughly 140ms a card, so a thousand-student year group is minutes of work.
  // The background job chunks it; `limit` is how.
  const cards = await loadCards(examSeriesId, {
    yearGroupId,
    ...(options.limit ? { limit: options.limit } : {}),
  });
  if (cards.length === 0) throw ApiError.notFound('No result cards for that year group');

  return { pdf: await renderResultCards(cards), count: cards.length };
}
