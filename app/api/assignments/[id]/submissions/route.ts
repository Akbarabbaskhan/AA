import { route } from '@/lib/api/handler';
import { getSubmissions, submitAssignment, submissionInputSchema } from '@/lib/services/assignments';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(
  { capability: 'assignment.manage' },
  async ({ actor, params }) => getSubmissions(actor, params.id),
);

export const POST = route<{ id: string }>(
  { capability: 'assignment.read' },
  async ({ actor, request, params }) => {
    const input = submissionInputSchema.parse(await request.json());
    return submitAssignment(actor, params.id, input);
  },
);
