import { route } from '@/lib/api/handler';
import {
  brandingPatchSchema,
  flagPatchSchema,
  getSchoolConfig,
  setFeatureFlag,
  settingsPatchSchema,
  updateBranding,
  updateSchoolSettings,
} from '@/lib/services/school-settings';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'school.settings.read' }, async () => getSchoolConfig());

/** One section at a time: the console edits a card, not the whole blob. */
export const PATCH = route({ capability: 'school.settings.manage' }, async ({ actor, request }) => {
  const body = (await request.json()) as Record<string, unknown>;

  if ('module' in body) {
    return { flags: await setFeatureFlag(actor, flagPatchSchema.parse(body)) };
  }
  if ('branding' in body) {
    return { config: await updateBranding(actor, brandingPatchSchema.parse(body['branding'])) };
  }
  return { settings: await updateSchoolSettings(actor, settingsPatchSchema.parse(body)) };
});
