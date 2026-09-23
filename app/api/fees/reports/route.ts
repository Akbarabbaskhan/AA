import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getCollectionReport } from '@/lib/services/fees/reports';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'fee.read.school' }, async ({ actor, request }) => {
  const { academicYearId } = z
    .object({ academicYearId: z.string().uuid().optional() })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getCollectionReport(actor, academicYearId);
});
