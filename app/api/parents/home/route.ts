import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getParentHome } from '@/lib/services/parents';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'fee.read.children' }, async ({ actor, request }) => {
  const { studentId } = z
    .object({ studentId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getParentHome(actor, studentId);
});
