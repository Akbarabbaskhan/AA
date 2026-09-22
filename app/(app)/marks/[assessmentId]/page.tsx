import { notFound } from 'next/navigation';
import { MarksGridClient } from '@/components/features/exams/marks-grid';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getMarksGrid } from '@/lib/services/exams/marks';
import { ForbiddenError } from '@/lib/permissions';
import { ApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

export default async function MarksPage({ params }: { params: { assessmentId: string } }) {
  const actor = await requireSessionActor();

  try {
    const grid = await withActor(actor, () => getMarksGrid(actor, params.assessmentId));
    return <MarksGridClient initial={grid} />;
  } catch (error) {
    // "Not found", not "forbidden" — the latter confirms the paper exists. The service
    // raises either depending on whether the capability or the row scope refused, and
    // both have to land on the same page rather than a 500.
    if (error instanceof ForbiddenError) notFound();
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
