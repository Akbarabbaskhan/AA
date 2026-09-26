import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { assertCanAccessStudent, can, requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { getSchoolSettings } from '@/lib/services/school-settings';
import { notifyMany } from '@/lib/services/notifications/notify';

/**
 * Recognition.
 *
 * "Leaderboards are the obvious idea and the easy way to cause harm. The rule: rank effort,
 * never grades."
 *
 * That rule is enforced structurally rather than by convention. The only metrics this file
 * can compute are counts of things a student chose to do — papers attempted, quizzes sat,
 * days present, society participation. There is no code path here that reads a mark, and
 * there is deliberately no `score` or `percent` anywhere in the types, so a future change
 * that tried to rank by attainment would have to add the concept rather than reuse it.
 *
 * And `optOutLeaderboards` is honoured as a query predicate in every list, not filtered
 * afterwards — which is what makes "that setting is respected everywhere" true on the
 * second page as well as the first.
 */

export const EFFORT_METRICS = ['PAPERS', 'QUIZZES', 'ATTENDANCE_STREAK', 'SOCIETY'] as const;
export type EffortMetric = (typeof EFFORT_METRICS)[number];

export type LeaderboardRow = {
  rank: number;
  studentId: string;
  /** First name only. A public list is not a directory of full names. */
  displayName: string;
  house: string | null;
  /** The count of the thing they did. Never a mark, never a grade, never a percentage. */
  count: number;
  isMe: boolean;
};

export type Leaderboard = {
  metric: EffortMetric;
  /** Days the window covers, so the label can say "this month" honestly. */
  windowDays: number;
  rows: LeaderboardRow[];
  /** Where this student sits, even when they are not in the visible top slice. */
  myRank: number | null;
  myCount: number;
  /** False when the school has leaderboards switched off entirely. */
  isEnabled: boolean;
  /** True when this student has opted out; they see their own figure and no list. */
  amOptedOut: boolean;
};

export const leaderboardQuerySchema = z.object({
  metric: z.enum(EFFORT_METRICS).default('PAPERS'),
  windowDays: z.coerce.number().int().min(7).max(365).default(30),
  limit: z.coerce.number().int().min(3).max(50).default(10),
});

function firstName(full: string): string {
  return full.split(/\s+/)[0] ?? full;
}

/**
 * The effort leaderboard.
 *
 * Opted-out students are excluded from the rows *and* from the ranking, so a student who
 * opts out does not silently inflate everyone else's position — and is still shown their
 * own count, because opting out of a public list is not opting out of knowing how you are
 * doing.
 */
export async function getLeaderboard(
  actor: Actor,
  query: z.infer<typeof leaderboardQuerySchema>,
): Promise<Leaderboard> {
  const settings = await getSchoolSettings();
  const since = new Date(Date.now() - query.windowDays * 86_400_000);

  const me = actor.studentId
    ? await prisma.student.findFirst({
        where: { id: actor.studentId },
        select: { optOutLeaderboards: true },
      })
    : null;
  const amOptedOut = me?.optOutLeaderboards ?? false;

  if (!settings.engagement.effortLeaderboards) {
    return {
      metric: query.metric,
      windowDays: query.windowDays,
      rows: [],
      myRank: null,
      myCount: 0,
      isEnabled: false,
      amOptedOut,
    };
  }

  const counts = await countEffort(query.metric, since, actor.schoolId);

  // Only students who have not opted out, and only active ones.
  const eligible = await prisma.student.findMany({
    where: { status: 'ACTIVE', deletedAt: null, optOutLeaderboards: false },
    select: { id: true, house: true, user: { select: { name: true } } },
  });

  const ranked = eligible
    .map((student) => ({
      studentId: student.id,
      displayName: firstName(student.user.name),
      house: student.house,
      count: counts.get(student.id) ?? 0,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));

  const myIndex = actor.studentId
    ? ranked.findIndex((row) => row.studentId === actor.studentId)
    : -1;

  return {
    metric: query.metric,
    windowDays: query.windowDays,
    // An opted-out student sees no list at all. Showing them the board they are absent
    // from is the passive-aggressive version of not respecting the setting.
    rows: amOptedOut
      ? []
      : ranked.slice(0, query.limit).map((row, index) => ({
          rank: index + 1,
          ...row,
          isMe: row.studentId === actor.studentId,
        })),
    myRank: amOptedOut || myIndex === -1 ? null : myIndex + 1,
    myCount: actor.studentId ? (counts.get(actor.studentId) ?? 0) : 0,
    isEnabled: true,
    amOptedOut,
  };
}

/**
 * Counts one effort metric per student.
 *
 * Aggregated in Postgres: at two thousand students and hundreds of thousands of attendance
 * rows, counting in JavaScript is the difference between a screen that opens and one
 * nobody waits for.
 */
async function countEffort(
  metric: EffortMetric,
  since: Date,
  schoolId: string,
): Promise<Map<string, number>> {
  if (metric === 'PAPERS') {
    const rows = await prisma.paperAttempt.groupBy({
      by: ['studentId'],
      where: { submittedAt: { gte: since } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.studentId, row._count._all]));
  }

  if (metric === 'QUIZZES') {
    const rows = await prisma.quizAttempt.groupBy({
      by: ['studentId'],
      where: { submittedAt: { gte: since } },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.studentId, row._count._all]));
  }

  if (metric === 'SOCIETY') {
    const rows = await prisma.societyMember.groupBy({
      by: ['studentId'],
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.studentId, row._count._all]));
  }

  /*
   * The attendance streak: consecutive school days present, counted backwards from the most
   * recent day the school marked a register.
   *
   * Two thousand tiny index scans rather than one big aggregate. Per student: the most
   * recent day they were not fully present, then the days since. Both read
   * `(student_id, date)` on the record itself, which is why the date is denormalised there —
   * joining sessions to get it measured 1.5s on a term of registers, and this is 60ms.
   *
   * `school_id` is bound explicitly on every table. Raw SQL bypasses the tenancy extension,
   * so a raw query that forgets it is a cross-tenant read, not a slow one.
   */
  const rows = await prisma.$transaction(
    async (tx) => {
      /*
       * The plan is cheap to run and expensive to compile: Postgres costs the nested loop at
       * well over `jit_above_cost` and then spends 300ms emitting machine code for a query
       * that executes in 60. Local to this transaction, so nothing else is affected.
       */
      await tx.$executeRawUnsafe('SET LOCAL jit = off');

      return tx.$queryRaw<{ student_id: string; streak: bigint }[]>`
        SELECT st.id AS student_id, days.streak
        FROM students st
        CROSS JOIN LATERAL (
          SELECT COUNT(DISTINCT r.date) AS streak
          FROM attendance_records r
          WHERE r.student_id = st.id
            AND r.school_id = ${schoolId}
            AND r.status IN ('PRESENT', 'LATE')
            AND r.date > COALESCE(
              (
                SELECT MAX(missed.date)
                FROM attendance_records missed
                WHERE missed.student_id = st.id
                  AND missed.school_id = ${schoolId}
                  AND missed.date >= ${since}
                  AND missed.status NOT IN ('PRESENT', 'LATE')
              ),
              ${since}::date - 1
            )
        ) AS days
        WHERE st.school_id = ${schoolId}
          AND st.deleted_at IS NULL
          AND st.status = 'ACTIVE'
        `;
    },
    /*
     * Generous for a 60ms query, because the one time it is not 60ms is immediately after a
     * bulk load, before the planner has statistics — which is exactly when the seed runs it.
     */
    { timeout: 30_000 },
  );

  return new Map(rows.map((row) => [row.student_id, Number(row.streak)]));
}

export const optOutSchema = z.object({ optOut: z.boolean() });

/**
 * The opt-out.
 *
 * "Every student can opt out of appearing on any public list, and that setting is respected
 * everywhere." The student's own switch, not something staff set for them.
 */
export async function setLeaderboardOptOut(
  actor: Actor,
  raw: z.infer<typeof optOutSchema>,
): Promise<{ optOut: boolean }> {
  const input = optOutSchema.parse(raw);
  if (!actor.studentId) throw ApiError.notFound('Only students set this');

  await prisma.student.update({
    where: { id: actor.studentId },
    data: { optOutLeaderboards: input.optOut },
  });
  return { optOut: input.optOut };
}

export type HouseStanding = {
  house: string;
  points: number;
  /** Students who earned points in the window, for context under the total. */
  contributors: number;
};

/**
 * Inter-house standings.
 *
 * Houses are a whole-group total, which is why schools run them: no individual is on
 * display, so there is nothing for a student to opt out of. An opted-out student's points
 * still count towards their house — the setting is about appearing on a list by name.
 */
export async function getHouseStandings(actor: Actor, windowDays = 365): Promise<HouseStanding[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const rows = await prisma.housePoint.groupBy({
    by: ['house'],
    where: { createdAt: { gte: since } },
    _sum: { points: true },
    _count: { _all: true },
  });

  return rows
    .map((row) => ({
      house: row.house,
      points: row._sum.points ?? 0,
      contributors: row._count._all,
    }))
    .sort((a, b) => b.points - a.points || a.house.localeCompare(b.house));
}

export const housePointSchema = z.object({
  /** Either a student (whose house is used) or a house directly. */
  studentId: z.string().uuid().nullable().default(null),
  house: z.string().min(1).max(60).nullable().default(null),
  points: z.number().int().min(-50).max(50),
  reason: z.string().min(3).max(300),
});

export async function awardHousePoints(
  actor: Actor,
  raw: z.infer<typeof housePointSchema>,
): Promise<{ id: string; house: string; points: number }> {
  requireCapability(actor, 'housepoint.award');
  const input = housePointSchema.parse(raw);

  let house = input.house;
  if (input.studentId) {
    const student = await prisma.student.findFirst({
      where: { id: input.studentId, deletedAt: null },
      select: { id: true, house: true },
    });
    if (!student) throw ApiError.notFound('Student not found');
    if (!student.house) {
      throw ApiError.badRequest('noHouse', 'That student is not in a house.');
    }
    house = student.house;
  }

  if (!house) {
    throw ApiError.badRequest('noHouse', 'Name a house, or a student in one.', {
      house: ['Required when no student is named.'],
    });
  }

  if (input.points === 0) {
    throw ApiError.badRequest('zeroPoints', 'Award or deduct something.', {
      points: ['Cannot be zero.'],
    });
  }

  const award = await prisma.housePoint.create({
    data: {
      schoolId: actor.schoolId,
      house,
      studentId: input.studentId,
      points: input.points,
      reason: input.reason,
      awardedBy: actor.userId,
    },
    select: { id: true, house: true, points: true },
  });

  // Deductions are audited as loudly as awards: a point taken away is the one a family asks
  // about, and "who decided that and why" has to be answerable.
  await writeAudit(actor, {
    action: input.points > 0 ? 'housepoint.award' : 'housepoint.deduct',
    entityType: 'HousePoint',
    entityId: award.id,
    after: { house, points: input.points, studentId: input.studentId },
    reason: input.reason,
  });

  return award;
}

export type BadgeRow = {
  code: string;
  title: string;
  description: string;
  iconUrl: string | null;
  /** Set when this student holds it. */
  awardedAt: string | null;
};

/** The badge case: everything the school offers, with what this student has earned. */
export async function getBadges(actor: Actor, studentId?: string): Promise<BadgeRow[]> {
  const target = studentId ?? actor.studentId ?? actor.childStudentIds[0];
  if (!target) throw ApiError.notFound('No student');

  if (target !== actor.studentId) {
    const student = await prisma.student.findFirst({
      where: { id: target },
      select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
    });
    if (!student) throw ApiError.notFound('Student not found');
    assertCanAccessStudent(
      actor,
      target,
      student.enrolments.map((entry) => entry.sectionId),
    );
  }

  const badges = await prisma.badge.findMany({
    orderBy: { code: 'asc' },
    select: {
      code: true,
      title: true,
      description: true,
      iconUrl: true,
      awards: { where: { studentId: target }, select: { awardedAt: true } },
    },
  });

  return badges.map((badge) => ({
    code: badge.code,
    title: badge.title,
    description: badge.description,
    iconUrl: badge.iconUrl,
    awardedAt: badge.awards[0]?.awardedAt.toISOString() ?? null,
  }));
}

/**
 * The badges Volt knows how to award automatically.
 *
 * Each one is a genuine milestone rather than a participation trophy — the spec's examples,
 * plus the two the seed data can actually demonstrate. A badge that everyone has by week
 * two is a badge nobody mentions.
 */
export const AUTO_BADGES = [
  {
    code: 'PAPERS_10',
    title: 'Ten papers in',
    description: 'Ten past papers attempted under timed conditions.',
    threshold: 10,
    metric: 'PAPERS' as const,
  },
  {
    code: 'PAPERS_50',
    title: 'Fifty papers',
    description: 'Fifty past papers attempted under timed conditions. That is real work.',
    threshold: 50,
    metric: 'PAPERS' as const,
  },
  {
    code: 'QUIZZES_20',
    title: 'Twenty quizzes',
    description: 'Twenty quizzes sat.',
    threshold: 20,
    metric: 'QUIZZES' as const,
  },
  {
    code: 'ATTENDANCE_30',
    title: 'A full month, every day',
    description: 'Thirty consecutive school days present.',
    threshold: 30,
    metric: 'ATTENDANCE_STREAK' as const,
  },
  {
    code: 'SOCIETY_2',
    title: 'Around campus',
    description: 'A member of two or more societies.',
    threshold: 2,
    metric: 'SOCIETY' as const,
  },
] as const;

export type BadgeSweepResult = { awarded: number; byCode: Record<string, number> };

/**
 * Awards whatever has been earned since the last run.
 *
 * Idempotent through the unique (badge, student) constraint, so running it twice awards
 * nothing twice — which matters because it is the sort of job that gets triggered by a
 * schedule and by hand on the same afternoon.
 *
 * Deliberately a sweep rather than a check inside each feature: a badge condition that
 * lives in five places is a badge condition that is wrong in two of them.
 */
export async function awardEarnedBadges(
  schoolId: string,
  options: { windowDays?: number } = {},
): Promise<BadgeSweepResult> {
  const since = new Date(Date.now() - (options.windowDays ?? 365) * 86_400_000);
  const byCode: Record<string, number> = {};
  let awarded = 0;

  const definitions = await prisma.badge.findMany({
    where: { code: { in: AUTO_BADGES.map((badge) => badge.code) } },
    select: { id: true, code: true },
  });
  const badgeIds = new Map(definitions.map((badge) => [badge.code, badge.id]));

  // Counts are per metric, so each is computed once however many badges hang off it.
  const cache = new Map<EffortMetric, Map<string, number>>();
  for (const metric of new Set(AUTO_BADGES.map((badge) => badge.metric))) {
    cache.set(metric, await countEffort(metric, since, schoolId));
  }

  for (const badge of AUTO_BADGES) {
    const badgeId = badgeIds.get(badge.code);
    if (!badgeId) continue;

    const counts = cache.get(badge.metric);
    if (!counts) continue;

    const earners = [...counts.entries()]
      .filter(([, count]) => count >= badge.threshold)
      .map(([studentId]) => studentId);
    if (earners.length === 0) continue;

    const already = await prisma.studentBadge.findMany({
      where: { badgeId, studentId: { in: earners } },
      select: { studentId: true },
    });
    const held = new Set(already.map((row) => row.studentId));
    const fresh = earners.filter((studentId) => !held.has(studentId));
    if (fresh.length === 0) continue;

    await prisma.studentBadge.createMany({
      data: fresh.map((studentId) => ({ badgeId, studentId })),
      skipDuplicates: true,
    });

    byCode[badge.code] = fresh.length;
    awarded += fresh.length;

    /*
     * Telling somebody is most of the point of a badge — through the bulk path, because a
     * sweep can award a hundred at once and a per-recipient notify() is roughly eight
     * queries each. Same reason publication uses it.
     */
    const students = await prisma.student.findMany({
      where: { id: { in: fresh } },
      select: { userId: true },
    });
    await notifyMany(
      schoolId,
      'announcement.published',
      students.map((student) => ({
        userId: student.userId,
        payload: {
          title: `Badge earned: ${badge.title}`,
          body: badge.description,
          link: '/profile',
        },
      })),
    );
  }

  return { awarded, byCode };
}
