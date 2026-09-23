import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getServerSession } from 'next-auth';
import { AppShell } from '@/components/layouts/app-shell';
import { authOptions } from '@/lib/auth/options';
import { loadTenantBranding } from '@/lib/theme/load';

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

  return (
    <AppShell
      roles={session.user.roles}
      activeRole={session.user.activeRole}
      schoolName={branding?.displayName ?? 'Volt'}
      locale={locale === 'ur' ? 'ur' : 'en'}
    >
      {children}
    </AppShell>
  );
}
