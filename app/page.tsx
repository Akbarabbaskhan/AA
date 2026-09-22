import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';

export default async function IndexPage() {
  const session = await getServerSession(authOptions);
  redirect(session?.user ? '/dashboard' : '/login');
}
