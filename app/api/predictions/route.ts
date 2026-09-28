import { route } from '@/lib/api/handler';
import {
  listPredictions,
  predictionQuerySchema,
  setPredictedGrades,
} from '@/lib/services/exams/predictions';

export const dynamic = 'force-dynamic';

export const GET = route(
  { capability: 'marks.read.section', module: 'exams' },
  async ({ actor, request }) => {
    const query = predictionQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return { rows: await listPredictions(actor, query) };
  },
);

export const POST = route(
  { capability: 'predictedgrade.set', module: 'exams' },
  async ({ actor, request }) => setPredictedGrades(actor, await request.json()),
);
