import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getServerSession } from 'next-auth';
import { AppShell } from '@/components/layouts/app-shell';
import { authOptions } from '@/lib/auth/options';
import { loadTenantBranding } from '@/lib/theme/load';
import { prisma, withTenant } from '@/lib/db';
import { getFeatureFlags } from '@/lib/services/school-settings';
import { getImpersonator, getSessionActor } from '@/lib/auth/session';

/**
 * Every signed-in surface renders inside the shell. The session check happens here as well
 * as in middleware: middleware keeps unauthenticated users off the route, this guarantees
 * the layout never renders without a user even if the matcher is edited later.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const branding = await loadTenantBranding(session.user.schoolSlug);
  const locale = await getLocale();

  /*
   * The banner is part of the shell rather than any one screen, so an impersonated session is
   * labelled on every page including the ones that error.
   */
  const actor = await getSessionActor();
  const impersonator = actor ? await getImpersonator(actor) : null;
  const targetName = impersonator
    ? await withTenant({ schoolId: actor!.schoolId }, async () => {
        const user = await prisma.user.findFirst({
          where: { id: actor!.userId },
          select: { name: true },
        });
        return user?.name ?? 'this user';
      })
    : null;

  // Read per request: a module switched off in the console is gone on the next tap.
  const flags = branding
    ? await withTenant({ schoolId: branding.schoolId }, () => getFeatureFlags())
    : undefined;

  return (
    <AppShell
      roles={session.user.roles}
      activeRole={session.user.activeRole}
      schoolName={branding?.displayName ?? 'Volt'}
      locale={locale === 'ur' ? 'ur' : 'en'}
      {...(flags ? { flags } : {})}
      {...(impersonator && targetName
        ? { impersonation: { actorName: impersonator.name, targetName } }
        : {})}
    >
      {children}
    </AppShell>
  );
}
