import { notFound } from 'next/navigation';
import { withActor } from './session';
import { isModuleEnabled, type ModuleName } from '@/lib/services/school-settings';
import type { Actor } from '@/lib/permissions';

/**
 * The page-level half of a feature flag.
 *
 * A module a school has switched off answers 404 on its endpoints and does not appear in the
 * navigation — and typing the URL has to land in the same place, or the flag is a decoration.
 * `notFound()` rather than a redirect, because as far as this school is concerned the screen
 * does not exist.
 */
export async function requireModule(actor: Actor, module: ModuleName): Promise<void> {
  const enabled = await withActor(actor, () => isModuleEnabled(module));
  if (!enabled) notFound();
}
