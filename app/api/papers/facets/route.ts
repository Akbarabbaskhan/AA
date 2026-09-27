import { route } from '@/lib/api/handler';
import { getVaultFacets } from '@/lib/services/papers/vault';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'pastpaper.read', module: 'learning' }, async ({ actor }) =>
  getVaultFacets(actor),
);
