import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getParentRemarks } from '@/lib/services/parents';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'remark.read.children' }, async ({ actor, request }) => {
  const { studentId } = z
    .object({ studentId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getParentRemarks(actor, studentId);
});
