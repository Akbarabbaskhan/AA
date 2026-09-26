import { z } from 'zod';
import type { SocietyMemberRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { notify } from '@/lib/services/notifications/notify';

/**
 * Societies.
 *
 * "MUN, debating, sports and the science society run most of the social energy at an LGS
 * campus. Giving them a real home in the app is the cheapest way to make Volt feel like a
 * campus rather than a gradebook."
 *
 * The governance model is the interesting part: a society head is a *student* with real
 * admin rights over their own society, moderated by the staff advisor. That is how these
 * clubs actually run, and a system where only teachers can post kills the thing it is
 * trying to host.
 */

export const SOCIETY_ROLES = ['MEMBER', 'HEAD', 'SECRETARY', 'TREASURER'] as const;

/** The roles that may post and run events for their own society. */
const OFFICER_ROLES: readonly SocietyMemberRole[] = ['HEAD', 'SECRETARY'];

export type SocietyRow = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  /** Open societies you join; selective ones you apply to. */
  isOpen: boolean;
  staffAdvisorName: string | null;
  memberCount: number;
  /** Null for staff — membership is a student's relationship to a society. */
  myRole: SocietyMemberRole | null;
  isMember: boolean;
  /** True where this actor may post and run the society's events. */
  canManage: boolean;
  upcomingEvents: number;
};

export async function listSocieties(actor: Actor): Promise<SocietyRow[]> {
  requireCapability(actor, 'society.read');
  const now = new Date();

  const societies = await prisma.society.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      logoUrl: true,
      isOpen: true,
      staffAdvisor: { select: { user: { select: { name: true } } } },
      _count: { select: { members: true } },
      members: actor.studentId
        ? { where: { studentId: actor.studentId }, select: { role: true } }
        : { where: { studentId: '' }, select: { role: true } },
      events: { where: { startsAt: { gte: now } }, select: { id: true } },
    },
  });

  const isSchoolWide = can(actor, 'society.manage');

  return societies.map((society) => {
    const mine = society.members[0];
    return {
      id: society.id,
      name: society.name,
      description: society.description,
      logoUrl: society.logoUrl,
      isOpen: society.isOpen,
      staffAdvisorName: society.staffAdvisor?.user.name ?? null,
      memberCount: society._count.members,
      myRole: mine?.role ?? null,
      isMember: Boolean(mine),
      // A student officer manages their own society; a coordinator manages any of them.
      canManage: isSchoolWide || (mine ? OFFICER_ROLES.includes(mine.role) : false),
      upcomingEvents: society.events.length,
    };
  });
}

/**
 * Is this actor entitled to post or run events for this society?
 *
 * The check a student officer passes and an ordinary member does not. Written once here
 * rather than inline at each call site, because getting it wrong in one place means a
 * member can speak for the whole society.
 */
export async function canManageSociety(actor: Actor, societyId: string): Promise<boolean> {
  if (can(actor, 'society.manage')) return true;

  // The staff advisor moderates their own society.
  if (actor.staffId) {
    const advised = await prisma.society.findFirst({
      where: { id: societyId, staffAdvisorId: actor.staffId },
      select: { id: true },
    });
    if (advised) return true;
  }

  if (!actor.studentId) return false;
  const membership = await prisma.societyMember.findFirst({
    where: { societyId, studentId: actor.studentId },
    select: { role: true },
  });
  return membership ? OFFICER_ROLES.includes(membership.role) : false;
}

export async function assertCanManageSociety(actor: Actor, societyId: string): Promise<void> {
  if (!(await canManageSociety(actor, societyId))) {
    throw ApiError.notFound('Society not found');
  }
}

export const societyInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).nullable().default(null),
  logoUrl: z.string().max(1000).nullable().default(null),
  staffAdvisorId: z.string().uuid().nullable().default(null),
  isOpen: z.boolean().default(true),
});

export async function createSociety(
  actor: Actor,
  raw: z.infer<typeof societyInputSchema>,
): Promise<{ id: string }> {
  requireCapability(actor, 'society.manage');
  const input = societyInputSchema.parse(raw);

  const society = await prisma.society.create({
    data: { schoolId: actor.schoolId, ...input },
    select: { id: true },
  });
  await writeAudit(actor, {
    action: 'society.create',
    entityType: 'Society',
    entityId: society.id,
    after: { name: input.name, isOpen: input.isOpen },
  });
  return society;
}

export type JoinResult = {
  status: 'JOINED' | 'APPLIED';
  role: SocietyMemberRole;
};

/**
 * Joining.
 *
 * An open society you simply join. A selective one takes an application, which is a
 * membership request the officers act on — modelled as a row the advisor confirms rather
 * than a separate table, because "applied" and "member" are the same relationship at
 * different stages and two tables would drift.
 */
export async function joinSociety(actor: Actor, societyId: string): Promise<JoinResult> {
  requireCapability(actor, 'society.join');
  if (!actor.studentId) throw ApiError.notFound('Only students join societies');
  const studentId = actor.studentId;

  const society = await prisma.society.findFirst({
    where: { id: societyId },
    select: { id: true, name: true, isOpen: true, staffAdvisor: { select: { userId: true } } },
  });
  if (!society) throw ApiError.notFound('Society not found');

  const existing = await prisma.societyMember.findFirst({
    where: { societyId, studentId },
    select: { id: true, role: true },
  });
  if (existing) {
    throw ApiError.conflict('alreadyMember', 'You are already in this society.');
  }

  if (society.isOpen) {
    await prisma.societyMember.create({
      data: { schoolId: actor.schoolId, societyId, studentId, role: 'MEMBER' },
    });
    return { status: 'JOINED', role: 'MEMBER' };
  }

  /*
   * A selective society: the application is recorded and the advisor is told. There is no
   * "pending" role in the enum on purpose — a student who has applied is not a member and
   * must not appear in the member count, so the application lives as an event the advisor
   * acts on rather than as a half-membership nobody can interpret.
   */
  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        schoolId: actor.schoolId,
        actorUserId: actor.userId,
        action: 'society.apply',
        entityType: 'Society',
        entityId: societyId,
        afterJson: { studentId, societyName: society.name },
      },
    });
  });

  if (society.staffAdvisor) {
    await notify(actor.schoolId, society.staffAdvisor.userId, 'announcement.published', {
      title: `New application to ${society.name}`,
      body: 'A student has applied to join. Review it in the society members list.',
      link: `/societies/${societyId}`,
    });
  }

  return { status: 'APPLIED', role: 'MEMBER' };
}

export async function leaveSociety(actor: Actor, societyId: string): Promise<{ left: true }> {
  requireCapability(actor, 'society.join');
  if (!actor.studentId) throw ApiError.notFound('Only students leave societies');

  const membership = await prisma.societyMember.findFirst({
    where: { societyId, studentId: actor.studentId },
    select: { id: true, role: true },
  });
  if (!membership) throw ApiError.notFound('You are not in this society');

  // An officer cannot simply walk out: the society would be left with nobody able to post.
  if (OFFICER_ROLES.includes(membership.role)) {
    throw ApiError.conflict(
      'officerCannotLeave',
      'Hand your role to someone else before leaving.',
    );
  }

  await prisma.societyMember.delete({ where: { id: membership.id } });
  return { left: true };
}

export const memberInputSchema = z.object({
  studentId: z.string().uuid(),
  role: z.enum(SOCIETY_ROLES).default('MEMBER'),
});

/** Admits a student to a selective society, or changes an existing member's role. */
export async function setMember(
  actor: Actor,
  societyId: string,
  raw: z.infer<typeof memberInputSchema>,
): Promise<{ id: string; role: SocietyMemberRole }> {
  await assertCanManageSociety(actor, societyId);
  const input = memberInputSchema.parse(raw);

  // Only the advisor or a coordinator appoints officers. A head appointing the next head
  // is how a society becomes somebody's private club.
  const appointsOfficer = OFFICER_ROLES.includes(input.role) || input.role === 'TREASURER';
  if (appointsOfficer && !can(actor, 'society.manage') && !actor.staffId) {
    throw ApiError.badRequest(
      'advisorAppointsOfficers',
      'Ask your staff advisor to appoint officers.',
    );
  }

  const student = await prisma.student.findFirst({
    where: { id: input.studentId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, userId: true },
  });
  if (!student) throw ApiError.notFound('Student not found');

  const member = await prisma.societyMember.upsert({
    where: { societyId_studentId: { societyId, studentId: input.studentId } },
    create: {
      schoolId: actor.schoolId,
      societyId,
      studentId: input.studentId,
      role: input.role,
    },
    update: { role: input.role },
    select: { id: true, role: true },
  });

  await writeAudit(actor, {
    action: 'society.member.set',
    entityType: 'Society',
    entityId: societyId,
    after: { studentId: input.studentId, role: input.role },
  });

  return member;
}

export async function removeMember(
  actor: Actor,
  societyId: string,
  studentId: string,
): Promise<{ removed: true }> {
  await assertCanManageSociety(actor, societyId);

  const membership = await prisma.societyMember.findFirst({
    where: { societyId, studentId },
    select: { id: true },
  });
  if (!membership) throw ApiError.notFound('Not a member');

  await prisma.societyMember.delete({ where: { id: membership.id } });
  await writeAudit(actor, {
    action: 'society.member.remove',
    entityType: 'Society',
    entityId: societyId,
    before: { studentId },
  });
  return { removed: true };
}

export type SocietyDetail = SocietyRow & {
  members: {
    studentId: string;
    name: string;
    rollNumber: string;
    role: SocietyMemberRole;
    joinedAt: string;
  }[];
  /** Applications the officers have not acted on, newest first. Officers only. */
  applications: { studentId: string; name: string; rollNumber: string; appliedAt: string }[];
  events: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    venue: string | null;
    going: number;
    capacity: number | null;
  }[];
};

export async function getSociety(actor: Actor, societyId: string): Promise<SocietyDetail> {
  requireCapability(actor, 'society.read');

  const societies = await listSocieties(actor);
  const summary = societies.find((entry) => entry.id === societyId);
  if (!summary) throw ApiError.notFound('Society not found');

  const [members, events] = await Promise.all([
    prisma.societyMember.findMany({
      where: { societyId },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      select: {
        studentId: true,
        role: true,
        joinedAt: true,
        student: { select: { rollNumber: true, user: { select: { name: true } } } },
      },
    }),
    prisma.event.findMany({
      where: { societyId },
      orderBy: { startsAt: 'asc' },
      take: 50,
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        venue: true,
        capacity: true,
        rsvps: { where: { status: 'GOING' }, select: { id: true } },
      },
    }),
  ]);

  // Applications are only the officers' business.
  const applications = summary.canManage
    ? await pendingApplications(societyId, new Set(members.map((member) => member.studentId)))
    : [];

  return {
    ...summary,
    members: members.map((member) => ({
      studentId: member.studentId,
      name: member.student.user.name,
      rollNumber: member.student.rollNumber,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
    })),
    applications,
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      venue: event.venue,
      going: event.rsvps.length,
      capacity: event.capacity,
    })),
  };
}

/**
 * Who has applied and not yet been admitted.
 *
 * Read from the audit log, which is where the application was recorded. That keeps
 * "applied" from becoming a membership state the member count has to remember to exclude —
 * the single most likely way this feature would start over-reporting society sizes.
 */
async function pendingApplications(
  societyId: string,
  alreadyMembers: ReadonlySet<string>,
): Promise<SocietyDetail['applications']> {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'society.apply', entityId: societyId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { afterJson: true, createdAt: true },
  });

  const seen = new Set<string>();
  const studentIds: { studentId: string; appliedAt: Date }[] = [];
  for (const row of rows) {
    const after = (row.afterJson ?? {}) as Record<string, unknown>;
    const studentId = typeof after['studentId'] === 'string' ? after['studentId'] : null;
    if (!studentId || alreadyMembers.has(studentId) || seen.has(studentId)) continue;
    seen.add(studentId);
    studentIds.push({ studentId, appliedAt: row.createdAt });
  }
  if (studentIds.length === 0) return [];

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds.map((entry) => entry.studentId) } },
    select: { id: true, rollNumber: true, user: { select: { name: true } } },
  });
  const byId = new Map(students.map((student) => [student.id, student]));

  return studentIds.flatMap((entry) => {
    const student = byId.get(entry.studentId);
    if (!student) return [];
    return [
      {
        studentId: entry.studentId,
        name: student.user.name,
        rollNumber: student.rollNumber,
        appliedAt: entry.appliedAt.toISOString(),
      },
    ];
  });
}
