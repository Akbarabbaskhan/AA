import { route } from '@/lib/api/handler';
import {
  assignmentInputSchema,
  assignmentQuerySchema,
  createAssignment,
  listAssignments,
} from '@/lib/services/assignments';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'assignment.read' }, async ({ actor, request }) => {
  const query = assignmentQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listAssignments(actor, query);
});

export const POST = route({ capability: 'assignment.manage' }, async ({ actor, request }) => {
  const input = assignmentInputSchema.parse(await request.json());
  return createAssignment(actor, input);
});
