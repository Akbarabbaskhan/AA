import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { awardHousePoints, getHouseStandings, housePointSchema } from '@/lib/services/recognition';

export const dynamic = 'force-dynamic';

export const GET = route({ module: 'recognition' }, async ({ actor, request }) => {
  const { windowDays } = z
    .object({ windowDays: z.coerce.number().int().min(7).max(730).default(365) })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getHouseStandings(actor, windowDays);
});

export const POST = route(
  { capability: 'housepoint.award', module: 'recognition' },
  async ({ actor, request }) => {
    const input = housePointSchema.parse(await request.json());
    return awardHousePoints(actor, input);
  },
);
