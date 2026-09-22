import { getTranslations } from 'next-intl/server';

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col justify-center gap-3 px-2 py-6">
      <h1 className="text-h1 text-[var(--text-primary)]">{t('forgotPassword')}</h1>
      <p className="text-body text-[var(--text-secondary)]">
        {/*
          Reset by email or SMS OTP is M1 work — the tokens, single-use and 15-minute
          expiry, are already modelled (OtpToken, PasswordResetToken). This page is the
          route those flows will land on; it is not wired yet and says so rather than
          presenting a form that does nothing.
        */}
        Password reset by SMS or email is not enabled yet. Ask your school office to reset it
        for you.
      </p>
      <a href="/login" className="min-h-tap py-1 text-body text-[var(--accent)] underline">
        {t('signIn')}
      </a>
    </main>
  );
}
