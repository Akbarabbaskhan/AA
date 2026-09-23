import type { RoleName } from '@prisma/client';

export type NavItem = {
  /** Key into the `nav` namespace in messages/*.json — no hardcoded strings. */
  key: string;
  href: string;
  icon: string;
};

/**
 * Navigation per role. The first five entries are what the mobile bottom tab bar shows —
 * "5 items max" — and the rest appear in the desktop sidebar and the mobile More sheet.
 *
 * Order is deliberate: it is what the role wants at 7am, not the order the modules
 * were built in.
 */
export const NAV_BY_ROLE: Readonly<Record<RoleName, readonly NavItem[]>> = Object.freeze({
  STUDENT: [
    { key: 'dashboard', href: '/dashboard', icon: 'home' },
    { key: 'timetable', href: '/timetable', icon: 'calendar' },
    { key: 'papers', href: '/papers', icon: 'file-text' },
    { key: 'results', href: '/results', icon: 'chart' },
    { key: 'societies', href: '/societies', icon: 'users' },
    { key: 'attendance', href: '/attendance', icon: 'check' },
    { key: 'assignments', href: '/assignments', icon: 'clipboard' },
    { key: 'quizzes', href: '/quizzes', icon: 'help-circle' },
    { key: 'resources', href: '/resources', icon: 'folder' },
    { key: 'doubts', href: '/doubts', icon: 'message' },
    { key: 'mastery', href: '/mastery', icon: 'target' },
    { key: 'fees', href: '/fees', icon: 'receipt' },
    { key: 'announcements', href: '/announcements', icon: 'megaphone' },
    { key: 'notifications', href: '/notifications', icon: 'bell' },
    { key: 'careers', href: '/careers', icon: 'compass' },
  ],
  PARENT: [
    // The four things the spec says a parent home screen shows, then the three things
    // they are allowed to do. Nothing else — a parent portal that grows a sidebar is one
    // nobody finds anything in.
    { key: 'dashboard', href: '/dashboard', icon: 'home' },
    { key: 'attendance', href: '/attendance', icon: 'check' },
    { key: 'results', href: '/results', icon: 'chart' },
    { key: 'fees', href: '/fees', icon: 'receipt' },
    { key: 'announcements', href: '/announcements', icon: 'megaphone' },
    { key: 'leave', href: '/leave', icon: 'calendar' },
    { key: 'meetings', href: '/meetings', icon: 'users' },
    { key: 'notifications', href: '/notifications', icon: 'bell' },
  ],
  TEACHER: [
    { key: 'dashboard', href: '/dashboard', icon: 'home' },
    { key: 'attendance', href: '/attendance', icon: 'check' },
    { key: 'marks', href: '/marks', icon: 'edit' },
    { key: 'timetable', href: '/timetable', icon: 'calendar' },
    { key: 'assignments', href: '/assignments', icon: 'clipboard' },
    { key: 'quizzes', href: '/quizzes', icon: 'help-circle' },
    { key: 'resources', href: '/resources', icon: 'folder' },
    { key: 'doubts', href: '/doubts', icon: 'message' },
    { key: 'announcements', href: '/announcements', icon: 'megaphone' },
    { key: 'leave', href: '/leave', icon: 'calendar' },
    { key: 'meetings', href: '/meetings', icon: 'users' },
    { key: 'notifications', href: '/notifications', icon: 'bell' },
    { key: 'remarks', href: '/remarks', icon: 'message' },
  ],
  HOD: [
    { key: 'dashboard', href: '/dashboard', icon: 'home' },
    { key: 'attendance', href: '/attendance', icon: 'check' },
    { key: 'marks', href: '/marks', icon: 'edit' },
    { key: 'reports', href: '/reports', icon: 'chart' },
    { key: 'resources', href: '/resources', icon: 'folder' },
    { key: 'timetable', href: '/timetable', icon: 'calendar' },
    { key: 'quizzes', href: '/quizzes', icon: 'help-circle' },
    { key: 'doubts', href: '/doubts', icon: 'message' },
  ],
  ADMIN: [
    { key: 'dashboard', href: '/dashboard', icon: 'home' },
    { key: 'attendance', href: '/attendance', icon: 'check' },
    { key: 'students', href: '/students', icon: 'users' },
    { key: 'timetable', href: '/timetable', icon: 'calendar' },
    { key: 'reports', href: '/reports', icon: 'chart' },
    { key: 'staff', href: '/staff', icon: 'briefcase' },
    { key: 'exams', href: '/exams', icon: 'award' },
    { key: 'announcements', href: '/announcements', icon: 'megaphone' },
    { key: 'fees', href: '/fees', icon: 'receipt' },
    { key: 'leave', href: '/leave', icon: 'calendar' },
    { key: 'notifications', href: '/notifications', icon: 'bell' },
    { key: 'settings', href: '/settings', icon: 'settings' },
  ],
  BURSAR: [
    // The accounts office's actual day: what is owed, who is behind, and the statement
    // that landed this morning.
    { key: 'fees', href: '/fees', icon: 'receipt' },
    { key: 'defaulters', href: '/fees/defaulters', icon: 'alert' },
    { key: 'reconcile', href: '/fees/reconcile', icon: 'link' },
    { key: 'reports', href: '/fees/reports', icon: 'chart' },
    { key: 'dashboard', href: '/dashboard', icon: 'home' },
    { key: 'students', href: '/students', icon: 'users' },
    { key: 'notifications', href: '/notifications', icon: 'bell' },
  ],
  SUPERADMIN: [
    { key: 'dashboard', href: '/dashboard', icon: 'home' },
    { key: 'settings', href: '/settings', icon: 'settings' },
    { key: 'reports', href: '/reports', icon: 'chart' },
  ],
});

export const MAX_BOTTOM_TABS = 5;

/** The primary role decides the navigation when an account holds several. */
export const ROLE_PRECEDENCE: readonly RoleName[] = [
  'SUPERADMIN',
  'ADMIN',
  'BURSAR',
  'HOD',
  'TEACHER',
  'PARENT',
  'STUDENT',
];

export function primaryRole(roles: readonly RoleName[]): RoleName {
  return ROLE_PRECEDENCE.find((role) => roles.includes(role)) ?? 'STUDENT';
}

export function navFor(roles: readonly RoleName[], activeRole?: RoleName): readonly NavItem[] {
  const role = activeRole && roles.includes(activeRole) ? activeRole : primaryRole(roles);
  return NAV_BY_ROLE[role];
}

export function bottomTabs(roles: readonly RoleName[], activeRole?: RoleName): readonly NavItem[] {
  return navFor(roles, activeRole).slice(0, MAX_BOTTOM_TABS);
}
