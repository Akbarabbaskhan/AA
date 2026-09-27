import { route } from '@/lib/api/handler';
import { getSociety } from '@/lib/services/societies';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(
  { capability: 'society.read' },
  async ({ actor, params }) => getSociety(actor, params.id),
);
