import { useTranslations } from 'next-intl';

/**
 * "Impersonation by Super Admin must write an audit record and show a persistent banner in
 * the UI reading who is impersonating whom."
 *
 * Persistent means exactly that: it is part of the shell, above the content, on every
 * screen, and it does not dismiss.
 */
export function ImpersonationBanner({ actorName, targetName }: { actorName: string; targetName: string }) {
  const t = useTranslations('impersonation');

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 bg-[var(--warning)] px-2 py-1 text-small text-[var(--brand-on-primary)]"
    >
      <span>{t('banner', { actor: actorName, target: targetName })}</span>
      <a href="/api/impersonation/end" className="shrink-0 underline">
        {t('end')}
      </a>
    </div>
  );
}
