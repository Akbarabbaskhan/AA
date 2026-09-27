import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsCard } from '@/components/features/settings/settings-form';
import { ModuleToggles } from '@/components/features/settings/module-toggles';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getSchoolConfig, listThemes } from '@/lib/services/school-settings';

export const dynamic = 'force-dynamic';

/**
 * The settings console.
 *
 * "Everything that differs between schools is a setting, never a code change. This is what
 * makes school #2 a week of work instead of a fork." So this page is the inventory of those
 * differences, and every value on it is read by the code that depends on it rather than kept
 * in step by hand.
 *
 * Desktop-first, and read-only below 768px, which is the spec's rule for this surface: an
 * admin checking the lock window from their phone at home should see it; nobody should set a
 * school's fee gate with their thumbs on a bus.
 */
export default async function SettingsPage() {
  const actor = await requireSessionActor();
  const [t, tRollover] = await Promise.all([
    getTranslations('settings'),
    getTranslations('rollover'),
  ]);

  const { config, themes } = await withActor(actor, async () => ({
    config: await getSchoolConfig(),
    themes: await listThemes(actor),
  }));

  const { settings } = config;

  const readOnlyRows: [string, string][] = [
    [t('field.name'), config.name],
    [t('field.themeId'), settings.branding.themeId],
    [t('field.lockWindowHours'), String(settings.attendance.lockWindowHours)],
    [t('field.minimumPercent'), `${settings.attendance.minimumPercent}%`],
    [t('field.quietFrom'), settings.notifications.quietHours.from],
    [t('field.quietTo'), settings.notifications.quietHours.to],
    [t('field.gateResultsOnOverdue'), settings.fees.gateResultsOnOverdue ? t('on') : t('off')],
    [t('field.effortLeaderboards'), settings.engagement.effortLeaderboards ? t('on') : t('off')],
    [t('field.parentPortal'), settings.portal.parentPortal ? t('on') : t('off')],
    [
      t('modules'),
      Object.entries(config.flags)
        .filter(([, enabled]) => !enabled)
        .map(([module]) => module)
        .join(', ') || t('allModulesOn'),
    ],
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1">{t('title')}</h1>
          <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/settings/rollover" data-testid="settings-rollover-link">
            {tRollover('title')}
          </Link>
        </Button>
      </header>

      {/* Phones get the values and a note, per the surface table. */}
      <div className="flex flex-col gap-2 tablet:hidden" data-testid="settings-readonly">
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <p className="text-small text-[var(--warning)]">{t('phoneReadOnly')}</p>
            <dl className="flex flex-col gap-2">
              {readOnlyRows.map(([label, value]) => (
                <div key={label} className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="text-small text-[var(--text-tertiary)]">{label}</dt>
                  <dd className="text-body text-[var(--text-primary)]">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="hidden flex-col gap-4 tablet:flex" data-testid="settings-forms">
        <SettingsCard
          testId="settings-branding"
          title={t('section.branding')}
          description={t('section.brandingHint')}
          fields={[
            {
              kind: 'text',
              name: 'branding.displayName',
              label: t('field.displayName'),
              value: settings.branding.displayName,
            },
            {
              kind: 'select',
              name: 'branding.themeId',
              label: t('field.themeId'),
              hint: t('field.themeIdHint'),
              value: settings.branding.themeId,
              options: themes.map((theme) => ({ value: theme.id, label: theme.displayName })),
            },
            {
              kind: 'text',
              name: 'branding.loginImageUrl',
              label: t('field.loginImageUrl'),
              value: settings.branding.loginImageUrl,
            },
          ]}
        />

        <SettingsCard
          testId="settings-attendance"
          title={t('section.attendance')}
          description={t('section.attendanceHint')}
          fields={[
            {
              kind: 'number',
              name: 'attendance.lockWindowHours',
              label: t('field.lockWindowHours'),
              hint: t('field.lockWindowHint'),
              value: settings.attendance.lockWindowHours,
              min: 1,
              max: 720,
            },
            {
              kind: 'number',
              name: 'attendance.minimumPercent',
              label: t('field.minimumPercent'),
              hint: t('field.minimumPercentHint'),
              value: settings.attendance.minimumPercent,
              min: 0,
              max: 100,
            },
            {
              kind: 'number',
              name: 'attendance.rollingWindowDays',
              label: t('field.rollingWindowDays'),
              value: settings.attendance.rollingWindowDays,
              min: 7,
              max: 365,
            },
            {
              kind: 'boolean',
              name: 'attendance.periodWise',
              label: t('field.periodWise'),
              hint: t('field.periodWiseHint'),
              value: settings.attendance.periodWise,
            },
            {
              kind: 'time',
              name: 'attendance.unmarkedReminderTime',
              label: t('field.unmarkedReminderTime'),
              value: settings.attendance.unmarkedReminderTime,
            },
          ]}
        />

        <SettingsCard
          testId="settings-notifications"
          title={t('section.notifications')}
          description={t('section.notificationsHint')}
          fields={[
            {
              kind: 'time',
              name: 'notifications.quietHours.from',
              label: t('field.quietFrom'),
              value: settings.notifications.quietHours.from,
            },
            {
              kind: 'time',
              name: 'notifications.quietHours.to',
              label: t('field.quietTo'),
              value: settings.notifications.quietHours.to,
            },
            {
              kind: 'number',
              name: 'notifications.absenceBatchMinutes',
              label: t('field.absenceBatchMinutes'),
              hint: t('field.absenceBatchHint'),
              value: settings.notifications.absenceBatchMinutes,
              min: 5,
              max: 180,
            },
          ]}
        />

        <SettingsCard
          testId="settings-fees"
          title={t('section.fees')}
          description={t('section.feesHint')}
          fields={[
            {
              kind: 'boolean',
              name: 'fees.gateResultsOnOverdue',
              label: t('field.gateResultsOnOverdue'),
              hint: t('field.gateHint'),
              value: settings.fees.gateResultsOnOverdue,
            },
            {
              kind: 'number',
              name: 'fees.gateOverdueDays',
              label: t('field.gateOverdueDays'),
              value: settings.fees.gateOverdueDays,
              min: 1,
              max: 365,
            },
            {
              kind: 'text',
              name: 'fees.voucherPrefix',
              label: t('field.voucherPrefix'),
              value: settings.fees.voucherPrefix,
            },
            {
              kind: 'text',
              name: 'fees.bank.name',
              label: t('field.bankName'),
              value: settings.fees.bank.name,
            },
            {
              kind: 'text',
              name: 'fees.bank.accountTitle',
              label: t('field.accountTitle'),
              value: settings.fees.bank.accountTitle,
            },
            {
              kind: 'text',
              name: 'fees.bank.accountNumber',
              label: t('field.accountNumber'),
              value: settings.fees.bank.accountNumber,
            },
            {
              kind: 'text',
              name: 'fees.bank.branch',
              label: t('field.branch'),
              value: settings.fees.bank.branch,
            },
          ]}
        />

        <SettingsCard
          testId="settings-engagement"
          title={t('section.engagement')}
          description={t('section.engagementHint')}
          fields={[
            {
              kind: 'boolean',
              name: 'engagement.effortLeaderboards',
              label: t('field.effortLeaderboards'),
              hint: t('field.effortHint'),
              value: settings.engagement.effortLeaderboards,
            },
            {
              kind: 'boolean',
              name: 'portal.parentPortal',
              label: t('field.parentPortal'),
              hint: t('field.parentPortalHint'),
              value: settings.portal.parentPortal,
            },
            {
              kind: 'boolean',
              name: 'portal.parentReplies',
              label: t('field.parentReplies'),
              value: settings.portal.parentReplies,
            },
          ]}
        />

        <section className="flex flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
          <header className="flex flex-col gap-1">
            <h2 className="text-h3">{t('modules')}</h2>
            <p className="text-small text-[var(--text-tertiary)]">{t('modulesHint')}</p>
          </header>
          <ModuleToggles flags={config.flags} />
        </section>
      </div>
    </div>
  );
}
