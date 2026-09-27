import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { NotificationChannel, RoleName } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from './audit';
import {
  CONSECUTIVE_ABSENCE_ALERT_DAYS,
  DEFAULT_ATTENDANCE_THRESHOLD_PERCENT,
  DEFAULT_LOCK_WINDOW_HOURS,
} from './attendance/policy';

/**
 * "Everything that differs between schools is a setting, never a code change. This is what
 * makes school #2 a week of work instead of a fork."
 *
 * Settings are stored as JSON on the tenant and parsed through this schema, so a school
 * with an older or partial settings blob still gets working defaults rather than a crash.
 */
export const CHANNEL_NAMES = ['IN_APP', 'PUSH', 'WHATSAPP', 'SMS', 'EMAIL'] as const;

export const schoolSettingsSchema = z.object({
  attendance: z
    .object({
      lockWindowHours: z.number().int().min(1).max(720).default(DEFAULT_LOCK_WINDOW_HOURS),
      minimumPercent: z.number().min(0).max(100).default(DEFAULT_ATTENDANCE_THRESHOLD_PERCENT),
      rollingWindowDays: z.number().int().min(7).max(365).default(30),
      consecutiveAbsenceAlertDays: z
        .number()
        .int()
        .min(2)
        .max(30)
        .default(CONSECUTIVE_ABSENCE_ALERT_DAYS),
      /** Period-wise, not just daily — the default, because selective absence is the problem. */
      periodWise: z.boolean().default(true),
      /** Daily reminder to teachers who have not marked their first period. */
      unmarkedReminderTime: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .default('08:30'),
    })
    .default({}),
  notifications: z
    .object({
      quietHours: z
        .object({
          from: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .default('21:00'),
          to: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .default('07:00'),
        })
        .default({}),
      /** Absence alerts are batched into one message per guardian per day. */
      absenceBatchMinutes: z.number().int().min(5).max(180).default(30),
      /**
       * "Notification defaults per type per role."
       *
       * A school decides which rails a type uses and which of them it does not want at all —
       * WhatsApp costs money per message, and a school that has not signed for it must be
       * able to turn it off without a deploy. Per-role defaults sit on top: a teacher being
       * told about an announcement by SMS is an objection waiting to happen.
       *
       * Resolution order is user preference, then role default, then type default, then the
       * code's default for that type.
       */
      typeDefaults: z
        .record(
          z.object({
            channels: z.array(z.enum(CHANNEL_NAMES)).optional(),
            enabled: z.boolean().default(true),
          }),
        )
        .default({}),
      roleDefaults: z.record(z.record(z.array(z.enum(CHANNEL_NAMES)))).default({}),
    })
    .default({}),
  fees: z
    .object({
      /** "Schools ask for this. Make it a setting, default off." */
      gateResultsOnOverdue: z.boolean().default(false),
      gateOverdueDays: z.number().int().min(1).max(365).default(60),
      /** Printed on the voucher prefix and the challan. */
      voucherPrefix: z.string().min(1).max(10).default('VOLT'),
      /**
       * The bank block on the challan. A voucher without the school's real account
       * details is one the counter hands back, so this is school configuration rather
       * than anything Volt can default usefully.
       */
      bank: z
        .object({
          name: z.string().max(120).default(''),
          accountTitle: z.string().max(160).default(''),
          accountNumber: z.string().max(40).default(''),
          branch: z.string().max(160).default(''),
        })
        .default({}),
      /** Charged after the due date where a school does that; 0 prints no second total. */
      lateFeePaisa: z.number().int().min(0).max(10_000_000).default(0),
    })
    .default({}),
  engagement: z
    .object({
      effortLeaderboards: z.boolean().default(true),
    })
    .default({}),
  branding: z
    .object({
      /**
       * A theme id from `/themes`, not a set of colours.
       *
       * Contrast is enforced by test for every shipped theme; a colour picker would hand a
       * school the ability to ship 2:1 text on its own login page, and "the branding looks
       * wrong" is a cheaper complaint than "a parent cannot read it".
       */
      themeId: z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .max(60)
        .default('volt-default'),
      /** Shown in place of the school's registered name where the school prefers it. */
      displayName: z.string().max(120).default(''),
      loginImageUrl: z.string().max(1_000).default(''),
    })
    .default({}),
  academic: z
    .object({
      /** ISO days: 1 is Monday. A six-day week is the Pakistani norm, Sunday off. */
      workingDays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5, 6]),
    })
    .default({}),
  portal: z
    .object({
      /** "Parent portal toggle" — a school piloting with staff only turns this off. */
      parentPortal: z.boolean().default(true),
      /** Whether guardians may reply to announcements at all. */
      parentReplies: z.boolean().default(true),
    })
    .default({}),
});

/**
 * The modules a school can switch off.
 *
 * "A school that does not want the societies module turns it off." A flag hides the module's
 * navigation *and* closes its endpoints — a hidden screen whose API still answers is not a
 * feature flag, it is a decoration.
 */
export const MODULES = [
  'attendance',
  'exams',
  'learning',
  'fees',
  'parents',
  'societies',
  'events',
  'recognition',
  'careers',
  'identity',
  'documents',
  'meetings',
  'doubts',
  'announcements',
  'reports',
] as const;

export type ModuleName = (typeof MODULES)[number];

export const featureFlagsSchema = z.record(z.boolean());

export type FeatureFlags = Readonly<Record<ModuleName, boolean>>;

/** Everything on unless a school has said otherwise: a new module is not a silent no. */
export function parseFeatureFlags(raw: unknown): FeatureFlags {
  const parsed = featureFlagsSchema.safeParse(raw ?? {});
  const stored = parsed.success ? parsed.data : {};
  return Object.freeze(
    Object.fromEntries(MODULES.map((module) => [module, stored[module] !== false])) as Record<
      ModuleName,
      boolean
    >,
  );
}

export type SchoolSettings = z.infer<typeof schoolSettingsSchema>;

export function parseSchoolSettings(raw: unknown): SchoolSettings {
  const result = schoolSettingsSchema.safeParse(raw ?? {});
  // A malformed settings blob must not take the school offline; fall back to defaults.
  return result.success ? result.data : schoolSettingsSchema.parse({});
}

export async function getSchoolSettings(): Promise<SchoolSettings & { timezone: string }> {
  const school = await prisma.school.findFirstOrThrow({
    select: { settingsJson: true, timezone: true },
  });
  return { ...parseSchoolSettings(school.settingsJson), timezone: school.timezone };
}

export type SchoolConfig = {
  schoolId: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  address: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  settings: SchoolSettings;
  flags: FeatureFlags;
};

/** Everything the settings console shows, in one query. */
export async function getSchoolConfig(): Promise<SchoolConfig> {
  const school = await prisma.school.findFirstOrThrow({
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      locale: true,
      logoUrl: true,
      faviconUrl: true,
      address: true,
      contactPhone: true,
      contactEmail: true,
      settingsJson: true,
      featureFlags: true,
    },
  });

  return {
    schoolId: school.id,
    name: school.name,
    slug: school.slug,
    timezone: school.timezone,
    locale: school.locale,
    logoUrl: school.logoUrl,
    faviconUrl: school.faviconUrl,
    address: school.address,
    contactPhone: school.contactPhone,
    contactEmail: school.contactEmail,
    settings: parseSchoolSettings(school.settingsJson),
    flags: parseFeatureFlags(school.featureFlags),
  };
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  const school = await prisma.school.findFirstOrThrow({ select: { featureFlags: true } });
  return parseFeatureFlags(school.featureFlags);
}

/**
 * Whether a module is on for this school.
 *
 * Read on every request that belongs to a module rather than cached in the process: a flag
 * flipped in the settings console has to take effect on the next tap, not on the next deploy.
 */
export async function isModuleEnabled(module: ModuleName): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[module];
}

export async function assertModuleEnabled(module: ModuleName): Promise<void> {
  if (!(await isModuleEnabled(module))) {
    // 404, not 403: a module this school has switched off does not exist as far as its
    // people are concerned, and "forbidden" invites somebody to go looking for a way in.
    throw ApiError.notFound('Not found');
  }
}

/**
 * A partial settings update.
 *
 * Merged section by section rather than replaced, because the console edits one card at a time
 * and a PATCH that dropped every unsent section would quietly reset a school's fee gate.
 */
export const settingsPatchSchema = schoolSettingsSchema.deepPartial();

function mergeSection(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = merged[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      merged[key] = mergeSection(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

export async function updateSchoolSettings(
  actor: Actor,
  // The *input* type, not the output: a patch sends one field and the rest stay as they are.
  raw: z.input<typeof settingsPatchSchema>,
): Promise<SchoolSettings> {
  requireCapability(actor, 'school.settings.manage');
  const patch = settingsPatchSchema.parse(raw);

  const school = await prisma.school.findFirstOrThrow({ select: { id: true, settingsJson: true } });
  const before = parseSchoolSettings(school.settingsJson);

  const merged = mergeSection(
    before as unknown as Record<string, unknown>,
    patch as Record<string, unknown>,
  );
  // Re-parsed, so a patch can never store something the rest of the app would choke on.
  const after = schoolSettingsSchema.parse(merged);

  await prisma.school.update({
    where: { id: school.id },
    data: { settingsJson: after as unknown as object },
  });

  await writeAudit(actor, {
    action: 'school.settings.update',
    entityType: 'School',
    entityId: school.id,
    before,
    after,
  });

  return after;
}

export const flagPatchSchema = z.object({
  module: z.enum(MODULES),
  enabled: z.boolean(),
});

export async function setFeatureFlag(
  actor: Actor,
  raw: z.infer<typeof flagPatchSchema>,
): Promise<FeatureFlags> {
  requireCapability(actor, 'school.settings.manage');
  const input = flagPatchSchema.parse(raw);

  const school = await prisma.school.findFirstOrThrow({ select: { id: true, featureFlags: true } });
  const before = parseFeatureFlags(school.featureFlags);
  const after = { ...before, [input.module]: input.enabled };

  await prisma.school.update({
    where: { id: school.id },
    data: { featureFlags: after as unknown as object },
  });

  await writeAudit(actor, {
    action: input.enabled ? 'school.module.enable' : 'school.module.disable',
    entityType: 'School',
    entityId: school.id,
    before: { [input.module]: before[input.module] },
    after: { [input.module]: input.enabled },
  });

  return parseFeatureFlags(after);
}

export const brandingPatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  themeId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(60)
    .optional(),
  displayName: z.string().max(120).optional(),
  logoUrl: z.string().max(1_000).nullable().optional(),
  faviconUrl: z.string().max(1_000).nullable().optional(),
  loginImageUrl: z.string().max(1_000).optional(),
  address: z.string().max(400).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  contactEmail: z.string().max(200).nullable().optional(),
});

export type ThemeOption = { id: string; displayName: string; publicUseApproved: boolean };

/**
 * The themes a school may choose from.
 *
 * Read from `/themes` rather than hardcoded, and a theme whose file says it is not approved
 * for public use is offered only to Volt staff — LGS's own branding is in that category until
 * the school puts its permission in writing.
 */
export async function listThemes(actor: Actor): Promise<ThemeOption[]> {
  const isVoltStaff = actor.roles.includes('SUPERADMIN');
  const dir = join(process.cwd(), 'themes');

  const files = await readdir(dir).catch(() => [] as string[]);
  const options: ThemeOption[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as Record<string, unknown>;
      const id = typeof raw['id'] === 'string' ? raw['id'] : file.replace(/\.json$/, '');
      const approved = raw['publicUseApproved'] === true;
      if (!approved && !isVoltStaff) continue;
      options.push({
        id,
        displayName: typeof raw['displayName'] === 'string' ? raw['displayName'] : id,
        publicUseApproved: approved,
      });
    } catch {
      // A malformed theme file is not offered rather than taking the settings page down.
    }
  }

  return options.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function updateBranding(
  actor: Actor,
  raw: z.infer<typeof brandingPatchSchema>,
): Promise<SchoolConfig> {
  requireCapability(actor, 'school.settings.manage');
  const input = brandingPatchSchema.parse(raw);

  const school = await prisma.school.findFirstOrThrow({
    select: { id: true, name: true, settingsJson: true, themeJson: true },
  });

  if (input.themeId) {
    const allowed = await listThemes(actor);
    if (!allowed.some((theme) => theme.id === input.themeId)) {
      /*
       * A theme id that is not on this school's list is refused rather than stored.
       * `themeJson.themeId` is used to read a file from disk, and LGS's own theme carries
       * `publicUseApproved: false` until the school gives written permission.
       */
      throw ApiError.badRequest('unknownTheme', 'That theme is not available to this school.', {
        themeId: ['Choose one of the listed themes.'],
      });
    }
  }

  const settings = parseSchoolSettings(school.settingsJson);
  const branding = {
    ...settings.branding,
    ...(input.themeId ? { themeId: input.themeId } : {}),
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    ...(input.loginImageUrl !== undefined ? { loginImageUrl: input.loginImageUrl } : {}),
  };

  await prisma.school.update({
    where: { id: school.id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      ...(input.faviconUrl !== undefined ? { faviconUrl: input.faviconUrl } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
      settingsJson: { ...settings, branding } as unknown as object,
      // The theme loader reads `themeJson.themeId`; keep the two in step.
      ...(input.themeId
        ? {
            themeJson: {
              ...((school.themeJson ?? {}) as Record<string, unknown>),
              themeId: input.themeId,
            } as unknown as object,
          }
        : {}),
    },
  });

  await writeAudit(actor, {
    action: 'school.branding.update',
    entityType: 'School',
    entityId: school.id,
    before: { name: school.name, branding: settings.branding },
    after: { name: input.name ?? school.name, branding },
  });

  return getSchoolConfig();
}

/**
 * The channels a notification type uses for one recipient.
 *
 * User preference wins, then the school's per-role default, then its per-type default, then
 * the code's default for the type. A school that has not signed a WhatsApp contract turns the
 * rail off here and nothing else changes.
 */
export function resolveChannels(
  settings: SchoolSettings,
  type: string,
  roles: readonly RoleName[],
  codeDefaults: readonly NotificationChannel[],
): { channels: NotificationChannel[]; disabledBySchool: boolean } {
  const typeDefault = settings.notifications.typeDefaults[type];
  if (typeDefault?.enabled === false) return { channels: [], disabledBySchool: true };

  for (const role of roles) {
    const perRole = settings.notifications.roleDefaults[role]?.[type];
    if (perRole && perRole.length > 0) {
      return { channels: perRole as NotificationChannel[], disabledBySchool: false };
    }
  }

  if (typeDefault?.channels && typeDefault.channels.length > 0) {
    return { channels: typeDefault.channels as NotificationChannel[], disabledBySchool: false };
  }

  return { channels: [...codeDefaults], disabledBySchool: false };
}
