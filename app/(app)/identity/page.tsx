import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { QrCode } from '@/components/features/identity/qr-code';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { requireModule } from '@/lib/auth/module-guard';
import { ApiError } from '@/lib/api/errors';
import { getDigitalId } from '@/lib/services/identity';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * The digital ID card.
 *
 * Laid out as a card because that is what it replaces, and sized so the QR is the biggest
 * thing on the screen — a card held up to a scanner at a gate is used at arm's length.
 *
 * The photo is a signed short-lived URL, and the QR carries a signed token rather than a
 * bare roll number, so a screenshot shared with a friend stops working within the day.
 */
export default async function IdentityPage() {
  const actor = await requireSessionActor();
  await requireModule(actor, 'identity');
  const t = await getTranslations('identity');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  try {
    const card = await withActor(actor, () => getDigitalId(actor));

    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-h1">{t('title')}</h1>

        <Card>
          <CardContent className="flex flex-col items-center gap-4 pt-4" data-testid="id-card">
            <p className="text-h3 text-[var(--text-primary)]">{card.schoolName}</p>

            <div className="flex w-full flex-wrap items-center justify-center gap-4">
              {card.photoUrl ? (
                /* A signed, short-lived storage URL cannot be pre-declared to next/image's
                   remote patterns, so this is a plain img by necessity. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.photoUrl}
                  alt=""
                  width={96}
                  height={120}
                  className="h-[120px] w-24 rounded-card object-cover"
                />
              ) : null}

              <div className="flex flex-col gap-1">
                <span className="text-h2 text-[var(--text-primary)]">{card.name}</span>
                <span className="font-mono text-body text-[var(--text-secondary)]">
                  {t('roll')}: {card.rollNumber}
                </span>
                <span className="font-mono text-small text-[var(--text-tertiary)]">
                  {t('admission')}: {card.admissionNumber}
                </span>
                {card.yearGroupName ? (
                  <span className="text-small text-[var(--text-tertiary)]">{card.yearGroupName}</span>
                ) : null}
                {card.house ? (
                  <span className="text-small text-[var(--text-tertiary)]">
                    {t('house')}: {card.house}
                  </span>
                ) : null}
              </div>
            </div>

            <QrCode value={card.qrToken} size={192} />

            <p className="text-small text-[var(--text-tertiary)]">
              {t('validUntil', { date: formatDate(new Date(card.expiresAt), locale) })}
            </p>
            <p className="max-w-[24rem] text-center text-small text-[var(--text-tertiary)]">
              {t('scanHint')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
