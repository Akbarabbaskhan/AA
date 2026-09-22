import type { RoleName } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    /**
     * Absent once the token is past its per-role deadline — see lib/auth/session-policy.ts.
     * Every reader must handle that, which is why it is optional rather than asserted.
     */
    user?: {
      id: string;
      schoolId: string;
      schoolSlug: string;
      locale: string;
      roles: RoleName[];
      activeRole?: RoleName;
      mustChangePassword: boolean;
    } & DefaultSession['user'];
  }
}
