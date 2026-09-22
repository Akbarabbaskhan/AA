import { withAuth } from 'next-auth/middleware';
import { isSessionExpired } from '@/lib/auth/session-policy';

/**
 * Keeps unauthenticated requests off the signed-in surfaces.
 *
 * This is a convenience, not the security boundary: "Every API handler resolves permissions
 * server-side. Hiding a button in the UI is not a permission" — and neither is a matcher.
 * Every route handler and service call checks capability and row scope for itself.
 */
export default withAuth({
  pages: { signIn: '/login' },
  callbacks: {
    // Per-role session length is enforced on the token's own deadline, not on NextAuth's
    // global maxAge — see lib/auth/session-policy.ts.
    authorized: ({ token }) => Boolean(token?.sub) && !isSessionExpired(token),
  },
});

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/timetable/:path*',
    '/attendance/:path*',
    '/results/:path*',
    '/papers/:path*',
    '/assignments/:path*',
    '/societies/:path*',
    '/careers/:path*',
    '/marks/:path*',
    '/quizzes/:path*',
    '/resources/:path*',
    '/remarks/:path*',
    '/students/:path*',
    '/staff/:path*',
    '/exams/:path*',
    '/fees/:path*',
    '/announcements/:path*',
    '/reports/:path*',
    '/settings/:path*',
    '/children/:path*',
  ],
};
