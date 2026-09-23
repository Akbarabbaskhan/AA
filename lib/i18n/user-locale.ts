import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { prisma } from '@/lib/db';
import { withoutTenantScope } from '@/lib/db/tenant-context';
import { isLocale, type Locale } from './config';

/**
 * The signed-in user's stored language, or null when nobody is signed in.
 *
 * Read outside the tenant scope on purpose: this runs while the request's tenant context
 * is being set up, before a scope exists, and it looks up exactly one user by their own
 * id — which is not a cross-tenant read in any meaningful sense.
 *
 * Any failure here falls back to the default rather than propagating: a language lookup
 * must never be the thing that takes a page down.
 */
export async function currentUserLocale(): Promise<Locale | null> {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;
    if (!userId) return null;

    const user = await withoutTenantScope(() =>
      prisma.user.findFirst({ where: { id: userId }, select: { locale: true } }),
    );
    return isLocale(user?.locale) ? user.locale : null;
  } catch {
    return null;
  }
}
