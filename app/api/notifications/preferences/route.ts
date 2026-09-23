import { route } from '@/lib/api/handler';
import { getPreferences, preferenceSchema, setPreference } from '@/lib/services/notifications/inbox';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor }) => getPreferences(actor));

export const PATCH = route({}, async ({ actor, request }) => {
  const input = preferenceSchema.parse(await request.json());
  return setPreference(actor, input);
});
