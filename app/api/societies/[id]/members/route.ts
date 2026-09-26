import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { memberInputSchema, removeMember, setMember } from '@/lib/services/societies';

export const dynamic = 'force-dynamic';

export const PUT = route<{ id: string }>({}, async ({ actor, request, params }) => {
  const input = memberInputSchema.parse(await request.json());
  return setMember(actor, params.id, input);
});

export const DELETE = route<{ id: string }>({}, async ({ actor, request, params }) => {
  const { studentId } = z
    .object({ studentId: z.string().uuid() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return removeMember(actor, params.id, studentId);
});
