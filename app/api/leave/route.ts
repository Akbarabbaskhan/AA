import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { leaveRequestSchema, listLeaveRequests, requestLeave } from '@/lib/services/parents';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const query = z
    .object({
      studentId: z.string().uuid().optional(),
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
    })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return listLeaveRequests(actor, query);
});

export const POST = route({ capability: 'leave.request' }, async ({ actor, request }) => {
  const input = leaveRequestSchema.parse(await request.json());
  return requestLeave(actor, input);
});
