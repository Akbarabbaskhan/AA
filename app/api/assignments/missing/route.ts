import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getMissingSubmissions } from '@/lib/services/assignments';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'assignment.manage' }, async ({ actor, request }) => {
  const { sectionId } = z
    .object({ sectionId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getMissingSubmissions(actor, sectionId);
});
