import { route } from '@/lib/api/handler';
import { moderateMarks, moderationSchema } from '@/lib/services/exams/marks';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(
  { capability: 'marks.moderate' },
  async ({ actor, request, params }) => {
    const body = moderationSchema.parse(await request.json());
    return moderateMarks(actor, params.id, body);
  },
);
