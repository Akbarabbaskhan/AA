import { route } from '@/lib/api/handler';
import { gradeSubmission, gradeSubmissionSchema } from '@/lib/services/assignments';

export const dynamic = 'force-dynamic';

export const POST = route({ capability: 'assignment.manage' }, async ({ actor, request }) => {
  const input = gradeSubmissionSchema.parse(await request.json());
  return gradeSubmission(actor, input);
});
