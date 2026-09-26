import { route } from '@/lib/api/handler';
import { optOutSchema, setLeaderboardOptOut } from '@/lib/services/recognition';

export const dynamic = 'force-dynamic';

export const PATCH = route({}, async ({ actor, request }) => {
  const input = optOutSchema.parse(await request.json());
  return setLeaderboardOptOut(actor, input);
});
