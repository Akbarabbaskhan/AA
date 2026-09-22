import { route } from '@/lib/api/handler';
import { assignmentInputSchema, getAssignment, updateAssignment } from '@/lib/services/assignments';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(
  { capability: 'assignment.read' },
  async ({ actor, params }) => getAssignment(actor, params.id),
);

export const PATCH = route<{ id: string }>(
  { capability: 'assignment.manage' },
  async ({ actor, request, params }) => {
    const input = assignmentInputSchema.partial().parse(await request.json());
    return updateAssignment(actor, params.id, input);
  },
);
