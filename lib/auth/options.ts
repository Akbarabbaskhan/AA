import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { z } from 'zod';
import { prisma, withTenant, withoutTenantScope } from '@/lib/db';
import { looksLikeEmail, normalisePhone } from '@/lib/utils/phone';
import { verifyPassword } from './password';
import { lockState, recordFailedAttempt, recordSuccessfulLogin } from './lockout';
import {
  SESSION_EXPIRY_CLAIM,
  isSessionExpired,
  sessionDeadline,
  sessionMaxAge,
} from './session-policy';
import type { RoleName } from '@prisma/client';

const credentialsSchema = z.object({
  /** Phone or email — phone first, most students and nearly all parents use one. */
  identifier: z.string().min(3).max(320),
  password: z.string().min(1).max(200),
  /** Which tenant to authenticate against. Defaults to DEFAULT_TENANT_SLUG. */
  tenant: z.string().min(1).max(64).optional(),
});

export class AuthError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function resolveSchoolId(slug: string): Promise<string | null> {
  // School is the tenant table itself, so this lookup is legitimately unscoped.
  const school = await withoutTenantScope(() =>
    prisma.school.findFirst({ where: { slug, isActive: true }, select: { id: true } }),
  );
  return school?.id ?? null;
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    // The longest window any role may have. The actual per-role deadline is the
    // SESSION_EXPIRY_CLAIM on the token, checked on every request in the jwt callback —
    // see sessionDeadline().
    maxAge: sessionMaxAge([]),
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Phone or email',
      credentials: {
        identifier: { label: 'Phone or email', type: 'text' },
        password: { label: 'Password', type: 'password' },
        tenant: { label: 'School', type: 'text' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new AuthError('invalidCredentials');

        const { identifier, password } = parsed.data;
        const slug = parsed.data.tenant ?? process.env['DEFAULT_TENANT_SLUG'] ?? 'volt-demo';

        const schoolId = await resolveSchoolId(slug);
        if (!schoolId) throw new AuthError('unknownSchool');

        return withTenant({ schoolId }, async () => {
          const trimmed = identifier.trim();
          const phone = normalisePhone(trimmed);
          const where = looksLikeEmail(trimmed)
            ? { email: trimmed.toLowerCase() }
            : phone
              ? { phone }
              : { email: trimmed.toLowerCase() };

          const user = await prisma.user.findFirst({
            where: { ...where, isActive: true },
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              locale: true,
              avatarUrl: true,
              passwordHash: true,
              lockedUntil: true,
              mustChangePassword: true,
              roles: { select: { role: true } },
            },
          });

          // Same error for "no such user" and "wrong password" — a different message here
          // tells an attacker which phone numbers are enrolled at the school.
          if (!user || !user.passwordHash) throw new AuthError('invalidCredentials');

          const lock = lockState(user);
          if (lock.locked) throw new AuthError('accountLocked');

          const ok = await verifyPassword(user.passwordHash, password);
          if (!ok) {
            const result = await recordFailedAttempt(user.id);
            throw new AuthError(result.locked ? 'accountLocked' : 'invalidCredentials');
          }

          await recordSuccessfulLogin(user.id);

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.avatarUrl,
            schoolId,
            schoolSlug: slug,
            locale: user.locale,
            roles: user.roles.map((entry) => entry.role),
            mustChangePassword: user.mustChangePassword,
          };
        });
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        const typed = user as typeof user & {
          schoolId: string;
          schoolSlug: string;
          locale: string;
          roles: RoleName[];
          mustChangePassword: boolean;
        };
        token['schoolId'] = typed.schoolId;
        token['schoolSlug'] = typed.schoolSlug;
        token['locale'] = typed.locale;
        token['roles'] = typed.roles;
        token['mustChangePassword'] = typed.mustChangePassword;
        // An admin or bursar gets 12 hours, everyone else 30 days.
        token[SESSION_EXPIRY_CLAIM] = sessionDeadline(typed.roles);
      }

      // Past its deadline the token is stripped, so the session callback below produces a
      // signed-out session and the middleware refuses the request.
      if (isSessionExpired(token)) {
        return { [SESSION_EXPIRY_CLAIM]: 0 };
      }

      // The header role switcher updates the active role without a re-login.
      if (trigger === 'update' && session && typeof session === 'object') {
        const next = (session as { activeRole?: RoleName }).activeRole;
        const roles = (token['roles'] as RoleName[] | undefined) ?? [];
        if (next && roles.includes(next)) token['activeRole'] = next;
      }

      return token;
    },
    async session({ session, token }) {
      if (!token.sub || isSessionExpired(token)) {
        // No user on the session is what "signed out" looks like to getSessionActor()
        // and to every server component.
        return { ...session, user: undefined, expires: new Date(0).toISOString() };
      }

      session.expires = new Date(token[SESSION_EXPIRY_CLAIM] as number).toISOString();
      session.user = {
        ...session.user,
        id: token.sub as string,
        schoolId: token['schoolId'] as string,
        schoolSlug: token['schoolSlug'] as string,
        locale: (token['locale'] as string) ?? 'en',
        roles: (token['roles'] as RoleName[]) ?? [],
        activeRole: token['activeRole'] as RoleName | undefined,
        mustChangePassword: Boolean(token['mustChangePassword']),
      };
      return session;
    },
  },
};
