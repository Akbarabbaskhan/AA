import { Prisma } from '@prisma/client';

/**
 * Models that reach tenancy through a required parent relation rather than carrying
 * `school_id` themselves. Each entry names the parent that owns the tenant boundary.
 *
 * Adding a model here is a deliberate decision, not a convenience: a row in one of these
 * tables can only be reached through a parent row that the tenancy guard already filtered.
 */
export const TENANCY_BY_PARENT: Readonly<Record<string, string>> = Object.freeze({
  OAuthAccount: 'User',
  OtpToken: 'User',
  PasswordResetToken: 'User',
  PushSubscription: 'User',
  QuizQuestion: 'Quiz',
  QuizAnswer: 'QuizAttempt',
  DoubtReply: 'DoubtThread',
  AnnouncementRead: 'Announcement',
  StudentBadge: 'Badge',
  PaperCollectionItem: 'PaperCollection',
});

/** Genuinely global tables — no tenant owns them. */
export const GLOBAL_MODELS: readonly string[] = Object.freeze([
  'School', // the tenant itself
  'ProcessedEvent', // idempotency ledger, keyed by external provider event id
]);

/**
 * Derived from the generated client rather than hand-maintained, so the guard cannot drift
 * away from the schema: any model with a `schoolId` scalar is tenant-scoped, full stop.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'schoolId'))
    .map((model) => model.name),
);

export function isTenantScoped(model: string | undefined): boolean {
  return model !== undefined && TENANT_SCOPED_MODELS.has(model);
}

/**
 * Every model must be accounted for: tenant-scoped, parented, or explicitly global.
 * `tests/unit/tenancy.test.ts` asserts this returns an empty array, so a new model added
 * without `school_id` and without a decision recorded here fails CI.
 */
export function unaccountedModels(): string[] {
  return Prisma.dmmf.datamodel.models
    .map((model) => model.name)
    .filter(
      (name) =>
        !TENANT_SCOPED_MODELS.has(name) &&
        !(name in TENANCY_BY_PARENT) &&
        !GLOBAL_MODELS.includes(name),
    );
}
