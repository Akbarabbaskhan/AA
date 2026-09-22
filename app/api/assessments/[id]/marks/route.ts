import { route } from '@/lib/api/handler';
import { getMarksGrid, saveMarks, saveMarksSchema } from '@/lib/services/exams/marks';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>({}, async ({ actor, params }) =>
  getMarksGrid(actor, params.id),
);

/** Called on every cell blur — autosave, so it has to be cheap and idempotent. */
export const POST = route<{ id: string }>(
  { capability: 'marks.enter' },
  async ({ actor, request, params }) => {
    const body = saveMarksSchema.parse(await request.json());
    return saveMarks(actor, params.id, body);
  },
);
