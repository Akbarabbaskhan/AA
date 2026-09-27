import { z } from 'zod';
import { route } from '@/lib/api/handler';
import {
  feeStructureSchema,
  listFeeStructures,
  saveFeeStructure,
} from '@/lib/services/fees/structures';

export const dynamic = 'force-dynamic';

export const GET = route(
  { capability: 'fee.read.school', module: 'fees' },
  async ({ actor, request }) => {
    const { academicYearId } = z
      .object({ academicYearId: z.string().uuid().optional() })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    return listFeeStructures(actor, academicYearId);
  },
);

export const PUT = route(
  { capability: 'fee.manage', module: 'fees' },
  async ({ actor, request }) => {
    const input = feeStructureSchema.parse(await request.json());
    return saveFeeStructure(actor, input);
  },
);
