import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getTranslations } from 'next-intl/server';
import { authOptions } from '@/lib/auth/options';
import { loadTenantBranding } from '@/lib/theme/load';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect('/dashboard');

  const slug = process.env['DEFAULT_TENANT_SLUG'] ?? 'volt-demo';
  const [branding, t] = await Promise.all([loadTenantBranding(slug), getTranslations('auth')]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center gap-4 px-2 py-6">
      <header className="flex flex-col gap-1">
        <p className="text-small text-[var(--text-tertiary)]">
          {branding?.displayName ?? 'Volt'}
        </p>
        <h1 className="text-h1 text-[var(--text-primary)]">{t('welcome')}</h1>
      </header>

      <Suspense fallback={<div className="skeleton h-64 w-full rounded-card" />}>
        <LoginForm tenantSlug={slug} />
      </Suspense>
    </main>
  );
}
