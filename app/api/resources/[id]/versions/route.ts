import { route } from '@/lib/api/handler';
import { getResourceVersions } from '@/lib/services/resources';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(
  { capability: 'resource.read' },
  async ({ actor, params }) => getResourceVersions(actor, params.id),
);
