import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth/options';


/**
 * Always dynamic: the route wrapper resolves the session and reads request headers, so
 * there is nothing here Next could prerender.
 */
export const dynamic = 'force-dynamic';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
