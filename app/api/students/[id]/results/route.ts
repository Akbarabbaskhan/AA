import { route } from '@/lib/api/handler';
import { getStudentResults } from '@/lib/services/exams/results';

export const dynamic = 'force-dynamic';

/**
 * No capability gate: a student, a parent and a teacher all reach this with different
 * capabilities, and the row-level check inside decides whose results may be read.
 */
export const GET = route<{ id: string }>({}, async ({ actor, params }) =>
  getStudentResults(actor, params.id),
);
