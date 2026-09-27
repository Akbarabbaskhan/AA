import { route } from '@/lib/api/handler';
import { joinSociety, leaveSociety } from '@/lib/services/societies';

export const dynamic = 'force-dynamic';

export const POST = route<{ id: string }>(
  { capability: 'society.join' },
  async ({ actor, params }) => joinSociety(actor, params.id),
);

export const DELETE = route<{ id: string }>(
  { capability: 'society.join' },
  async ({ actor, params }) => leaveSociety(actor, params.id),
);
