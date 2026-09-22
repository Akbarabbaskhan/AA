import type { ReactNode } from 'react';
import type { RoleName } from '@prisma/client';
import { BottomTabBar } from './bottom-tab-bar';
import { ImpersonationBanner } from './impersonation-banner';
import { Sidebar } from './sidebar';
import { bottomTabs, navFor } from './nav-config';

export type AppShellProps = {
  children: ReactNode;
  roles: readonly RoleName[];
  activeRole?: RoleName;
  schoolName: string;
  impersonation?: { actorName: string; targetName: string };
};

/**
 * The application shell: sidebar on desktop, bottom tab bar on mobile, content in between.
 *
 * The bottom padding on mobile is the tab bar's height — content must never sit underneath
 * it, which is the usual way a "done" screen turns out to have an unreachable last row.
 */
export function AppShell({
  children,
  roles,
  activeRole,
  schoolName,
  impersonation,
}: AppShellProps) {
  const items = navFor(roles, activeRole);

  return (
    <div className="flex min-h-dvh flex-col">
      {impersonation ? <ImpersonationBanner {...impersonation} /> : null}
      <div className="flex flex-1">
        <Sidebar items={items} schoolName={schoolName} />
        <main className="mx-auto w-full max-w-container flex-1 px-2 pb-24 pt-3 desktop:px-4 desktop:pb-section">
          {children}
        </main>
      </div>
      <BottomTabBar items={bottomTabs(roles, activeRole)} />
    </div>
  );
}
