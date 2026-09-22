'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const KNOWN_ERRORS = new Set(['invalidCredentials', 'accountLocked', 'unknownSchool']);

export function LoginForm({ tenantSlug }: { tenantSlug: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await signIn('credentials', {
      identifier,
      password,
      tenant: tenantSlug,
      redirect: false,
    });

    if (result?.ok) {
      router.replace(searchParams.get('callbackUrl') ?? '/dashboard');
      router.refresh();
      return;
    }

    // NextAuth returns the thrown code as the error string; anything unrecognised is a bug
    // on our side, not the user's, so it gets the generic message.
    const code = result?.error ?? 'unexpected';
    setError(KNOWN_ERRORS.has(code) ? code : 'unexpected');
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="identifier" className="text-small font-medium text-[var(--text-secondary)]">
          {t('identifier')}
        </label>
        <Input
          id="identifier"
          name="identifier"
          // Phone first: a numeric keypad is what most of these users need.
          inputMode="tel"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          aria-describedby="identifier-hint"
          aria-invalid={error === 'invalidCredentials' ? true : undefined}
        />
        <p id="identifier-hint" className="text-small text-[var(--text-tertiary)]">
          {t('identifierHint')}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-small font-medium text-[var(--text-secondary)]">
          {t('password')}
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error === 'invalidCredentials' ? true : undefined}
        />
      </div>

      {error ? (
        <p role="alert" className="text-small text-[var(--danger)]">
          {t(`errors.${error}` as 'errors.unexpected')}
        </p>
      ) : null}

      <Button type="submit" size="lg" full disabled={pending}>
        {pending ? t('signingIn') : t('signIn')}
      </Button>

      <a
        href="/forgot-password"
        className="min-h-tap py-1 text-center text-small text-[var(--text-secondary)] underline"
      >
        {t('forgotPassword')}
      </a>
    </form>
  );
}
