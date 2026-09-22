import { route } from '@/lib/api/handler';
import { removeResource } from '@/lib/services/resources';

export const dynamic = 'force-dynamic';

export const DELETE = route<{ id: string }>(
  { capability: 'resource.upload' },
  async ({ actor, params }) => {
    await removeResource(actor, params.id);
    return { ok: true };
  },
);
