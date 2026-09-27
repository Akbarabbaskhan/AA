import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { addLockerItem, getLocker, lockerItemSchema } from '@/lib/services/identity';

export const dynamic = 'force-dynamic';

export const GET = route(
  { anyCapability: ['document.read.own', 'document.read.children'] },
  async ({ actor, request }) => {
    const { studentId } = z
      .object({ studentId: z.string().uuid().optional() })
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    return getLocker(actor, studentId);
  },
);

export const POST = route(
  { capability: 'document.manage', module: 'documents' },
  async ({ actor, request }) => {
    const input = lockerItemSchema.parse(await request.json());
    return addLockerItem(actor, input);
  },
);
