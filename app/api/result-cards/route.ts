import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import {
  renderStudentResultCard,
  renderYearGroupResultCards,
} from '@/lib/services/exams/result-cards';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  examSeriesId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
  yearGroupId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** Streams the PDF itself rather than a link, so a card is one click from the portal. */
export const GET = route({}, async ({ actor, request }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));

  if (query.studentId) {
    const pdf = await renderStudentResultCard(actor, query.studentId, query.examSeriesId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="result-card.pdf"`,
      },
    });
  }

  if (query.yearGroupId) {
    const { pdf, count } = await renderYearGroupResultCards(
      actor,
      query.examSeriesId,
      query.yearGroupId,
      query.limit ? { limit: query.limit } : {},
    );
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="result-cards-${count}.pdf"`,
      },
    });
  }

  return NextResponse.json(
    { error: { code: 'missingTarget', message: 'Name a student or a year group.' } },
    { status: 400 },
  );
});
