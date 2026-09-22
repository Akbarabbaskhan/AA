import { z } from 'zod';
import { route } from '@/lib/api/handler';
import {
  assessmentSchema,
  bulkAssessmentSchema,
  createAssessment,
  createAssessmentsForSubject,
} from '@/lib/services/exams/series';

export const dynamic = 'force-dynamic';

const bodySchema = z.union([
  z.object({ mode: z.literal('single') }).and(assessmentSchema),
  z.object({ mode: z.literal('bulk') }).and(bulkAssessmentSchema),
]);

export const POST = route({ capability: 'exam.manage' }, async ({ actor, request }) => {
  const body = bodySchema.parse(await request.json());
  return body.mode === 'bulk'
    ? createAssessmentsForSubject(actor, body)
    : createAssessment(actor, body);
});
