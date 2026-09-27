import { route } from '@/lib/api/handler';
import { getLeaderboard, leaderboardQuerySchema } from '@/lib/services/recognition';

export const dynamic = 'force-dynamic';

export const GET = route({ module: 'recognition' }, async ({ actor, request }) => {
  const query = leaderboardQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return getLeaderboard(actor, query);
});
