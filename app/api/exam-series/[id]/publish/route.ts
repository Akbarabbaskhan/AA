import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { publishExamSeries, unpublishExamSeries } from '@/lib/services/exams/publish';

export const dynamic = 'force-dynamic';

/** Publishes the whole series at once — staggered visibility causes complaints. */
export const POST = route<{ id: string }>(
  { capability: 'exam.publish' },
  async ({ actor, params }) => publishExamSeries(actor, params.id),
);

const unpublishSchema = z.object({ reason: z.string().min(3).max(500) });

export const DELETE = route<{ id: string }>(
  { capability: 'exam.publish' },
  async ({ actor, request, params }) => {
    const body = unpublishSchema.parse(await request.json());
    return unpublishExamSeries(actor, params.id, body.reason);
  },
);
