import { route } from '@/lib/api/handler';
import { openResource } from '@/lib/services/resources';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(
  { capability: 'resource.read' },
  async ({ actor, params }) => openResource(actor, params.id),
);
