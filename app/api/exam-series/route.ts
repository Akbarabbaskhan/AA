import { route } from '@/lib/api/handler';
import { createExamSeries, examSeriesSchema, listExamSeries } from '@/lib/services/exams/series';

export const dynamic = 'force-dynamic';

export const GET = route({ module: 'exams' }, async ({ actor }) => ({
  series: await listExamSeries(actor),
}));

export const POST = route(
  { capability: 'exam.manage', module: 'exams' },
  async ({ actor, request }) => {
    const body = examSeriesSchema.parse(await request.json());
    return createExamSeries(actor, body);
  },
);
