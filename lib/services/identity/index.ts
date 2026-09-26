import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import {
  assertCanAccessStudent,
  can,
  requireAnyCapability,
  requireCapability,
  type Actor,
} from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { getStorage } from '@/lib/storage';

/**
 * Digital identity: the ID card, the document locker, and the profile.
 *
 * The card's QR code is the part worth thinking about. A QR containing a roll number is
 * trivially forged — anyone can generate one — so it carries a **signed** token instead:
 * the roll number, an expiry and an HMAC. A gate or a librarian scans it and verifies
 * server-side, which is the difference between an ID card and a picture of one.
 *
 * The token deliberately contains no name, no photo and no class. It is an identifier to be
 * looked up, not a record to be read: a QR code photographed off a lanyard in a corridor
 * should hand a stranger nothing.
 */

const ID_SECRET = () => process.env['NEXTAUTH_SECRET'] ?? 'volt-dev-only-identity-secret';

/** A card is re-signed each day, so a screenshot shared with a friend stops working. */
export const ID_TOKEN_TTL_HOURS = 24;

export function signIdToken(rollNumber: string, expiresAt: number): string {
  const payload = `${rollNumber}.${expiresAt}`;
  const signature = createHmac('sha256', ID_SECRET()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export type VerifiedId = { rollNumber: string; expiresAt: number };

export function verifyIdToken(token: string): VerifiedId | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rollNumber, rawExpiry, signature] = parts as [string, string, string];

  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt)) return null;

  const expected = createHmac('sha256', ID_SECRET())
    .update(`${rollNumber}.${rawExpiry}`)
    .digest('base64url');

  // Constant-time, so a wrong signature cannot be found a character at a time.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (expiresAt < Date.now()) return null;

  return { rollNumber, expiresAt };
}

export type DigitalId = {
  studentId: string;
  name: string;
  rollNumber: string;
  admissionNumber: string;
  yearGroupName: string | null;
  house: string | null;
  photoUrl: string | null;
  schoolName: string;
  /** The signed payload the QR encodes. Not the image — the client renders that. */
  qrToken: string;
  expiresAt: string;
};

export async function getDigitalId(actor: Actor, studentId?: string): Promise<DigitalId> {
  const target = studentId ?? actor.studentId ?? actor.childStudentIds[0];
  if (!target) throw ApiError.notFound('No student');

  if (target !== actor.studentId) {
    const check = await prisma.student.findFirst({
      where: { id: target },
      select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
    });
    if (!check) throw ApiError.notFound('Student not found');
    assertCanAccessStudent(
      actor,
      target,
      check.enrolments.map((entry) => entry.sectionId),
    );
  }

  const student = await prisma.student.findFirst({
    where: { id: target, deletedAt: null },
    select: {
      id: true,
      rollNumber: true,
      admissionNumber: true,
      house: true,
      photoUrl: true,
      status: true,
      user: { select: { name: true } },
      enrolments: {
        where: { droppedAt: null },
        take: 1,
        select: { section: { select: { yearGroup: { select: { name: true } } } } },
      },
    },
  });
  if (!student) throw ApiError.notFound('Student not found');

  // A withdrawn student has no valid card. An ID that keeps working after somebody leaves
  // is the one that gets used to walk back in.
  if (student.status !== 'ACTIVE') {
    throw ApiError.conflict('notActive', 'This student is no longer enrolled.');
  }

  const school = await prisma.school.findFirstOrThrow({ select: { name: true } });
  const expiresAt = Date.now() + ID_TOKEN_TTL_HOURS * 3_600_000;

  const photoUrl = student.photoUrl
    ? await getStorage()
        .createDownloadUrl(student.photoUrl, { expiresInSeconds: 3600 })
        .catch(() => null)
    : null;

  return {
    studentId: student.id,
    name: student.user.name,
    rollNumber: student.rollNumber,
    admissionNumber: student.admissionNumber,
    yearGroupName: student.enrolments[0]?.section.yearGroup.name ?? null,
    house: student.house,
    photoUrl,
    schoolName: school.name,
    qrToken: signIdToken(student.rollNumber, expiresAt),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export type ScanResult = {
  valid: boolean;
  reason?: 'invalid' | 'expired' | 'unknown' | 'notActive';
  student?: {
    name: string;
    rollNumber: string;
    yearGroupName: string | null;
    photoUrl: string | null;
  };
};

/**
 * Verifies a scanned card.
 *
 * Staff only. The scan returns just enough to recognise the person in front of you — name,
 * roll number, class, photo — and nothing about their marks, fees or contact details.
 */
export async function scanId(actor: Actor, token: string): Promise<ScanResult> {
  if (!actor.staffId && !can(actor, 'user.read')) {
    throw ApiError.notFound('Not found');
  }

  const verified = verifyIdToken(token);
  if (!verified) {
    // Deliberately not distinguishing a bad signature from an expired one to a caller:
    // both mean "do not let this person through", and the difference only helps a forger.
    return { valid: false, reason: 'invalid' };
  }

  const student = await prisma.student.findFirst({
    where: { rollNumber: verified.rollNumber, deletedAt: null },
    select: {
      status: true,
      rollNumber: true,
      photoUrl: true,
      user: { select: { name: true } },
      enrolments: {
        where: { droppedAt: null },
        take: 1,
        select: { section: { select: { yearGroup: { select: { name: true } } } } },
      },
    },
  });
  if (!student) return { valid: false, reason: 'unknown' };
  if (student.status !== 'ACTIVE') return { valid: false, reason: 'notActive' };

  return {
    valid: true,
    student: {
      name: student.user.name,
      rollNumber: student.rollNumber,
      yearGroupName: student.enrolments[0]?.section.yearGroup.name ?? null,
      photoUrl: student.photoUrl,
    },
  };
}

export type LockerItem = {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  /** A short-lived signed URL, minted per read rather than stored. */
  url: string;
};

/**
 * The document locker.
 *
 * "Result cards, certificates, transcripts, character certificates, all downloadable." A
 * student's own documents are their property, and the point of the locker is that they can
 * fetch a character certificate at 11pm the night before a deadline without asking anybody.
 *
 * Result cards are folded in from where they already live rather than copied: a copy would
 * drift from the published snapshot, and the snapshot is the authority.
 */
export async function getLocker(actor: Actor, studentId?: string): Promise<LockerItem[]> {
  // Either capability opens a locker; the row scope below decides whose. A parent holds
  // only the second, and has no locker of their own.
  requireAnyCapability(actor, ['document.read.own', 'document.read.children']);

  // A parent reads their child's locker; a student reads their own; nobody reads anyone
  // else's without an explicit scope check.
  const targetStudentId = studentId ?? actor.studentId ?? actor.childStudentIds[0] ?? null;
  let userId = actor.userId;

  if (targetStudentId && targetStudentId !== actor.studentId) {
    const student = await prisma.student.findFirst({
      where: { id: targetStudentId },
      select: {
        userId: true,
        enrolments: { where: { droppedAt: null }, select: { sectionId: true } },
      },
    });
    if (!student) throw ApiError.notFound('Student not found');
    assertCanAccessStudent(
      actor,
      targetStudentId,
      student.enrolments.map((entry) => entry.sectionId),
    );
    userId = student.userId;
  }

  const storage = getStorage();
  const sign = async (key: string): Promise<string | null> => {
    try {
      return await storage.createDownloadUrl(key, { expiresInSeconds: 900, download: true });
    } catch {
      return null;
    }
  };

  const [items, resultCards] = await Promise.all([
    prisma.documentLockerItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, title: true, type: true, fileUrl: true, createdAt: true },
    }),
    targetStudentId
      ? prisma.resultCard.findMany({
          where: { studentId: targetStudentId, publishedAt: { not: null } },
          orderBy: { publishedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            pdfUrl: true,
            publishedAt: true,
            examSeriesId: true,
            examSeries: { select: { name: true } },
          },
        })
      : [],
  ]);

  const locker = await Promise.all(
    items.map(async (item) => {
      const url = await sign(item.fileUrl);
      return url
        ? {
            id: item.id,
            title: item.title,
            type: item.type,
            createdAt: item.createdAt.toISOString(),
            url,
          }
        : null;
    }),
  );

  /*
   * A result card is rendered on demand, not archived: the PDF is a view of the published
   * snapshot, so generating it per download can never drift from the marks. `pdfUrl` is
   * honoured when something has archived one (a signed storage link is cheaper to serve),
   * and otherwise the locker links at the renderer, which re-checks the caller's scope.
   */
  const cards = await Promise.all(
    resultCards.map(async (card) => {
      const url = card.pdfUrl
        ? await sign(card.pdfUrl)
        : `/api/result-cards?examSeriesId=${card.examSeriesId}&studentId=${targetStudentId ?? ''}`;
      return url
        ? {
            id: `resultcard:${card.id}`,
            title: `Result card — ${card.examSeries.name}`,
            type: 'RESULT_CARD',
            createdAt: (card.publishedAt ?? new Date()).toISOString(),
            url,
          }
        : null;
    }),
  );

  return [...locker, ...cards]
    .flatMap((entry) => (entry ? [entry] : []))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const lockerItemSchema = z.object({
  studentId: z.string().uuid(),
  title: z.string().min(1).max(200),
  type: z.string().min(1).max(60),
  fileUrl: z.string().min(1).max(1000),
});

/** Files a certificate into a student's locker. The office's job, never the student's. */
export async function addLockerItem(
  actor: Actor,
  raw: z.infer<typeof lockerItemSchema>,
): Promise<{ id: string }> {
  requireCapability(actor, 'document.manage');
  const input = lockerItemSchema.parse(raw);

  const student = await prisma.student.findFirst({
    where: { id: input.studentId, deletedAt: null },
    select: { userId: true },
  });
  if (!student) throw ApiError.notFound('Student not found');

  const item = await prisma.documentLockerItem.create({
    data: {
      schoolId: actor.schoolId,
      userId: student.userId,
      title: input.title,
      type: input.type,
      fileUrl: input.fileUrl,
    },
    select: { id: true },
  });

  await writeAudit(actor, {
    action: 'document.file',
    entityType: 'DocumentLockerItem',
    entityId: item.id,
    after: { studentId: input.studentId, title: input.title, type: input.type },
  });

  return item;
}

export type StudentProfile = {
  studentId: string;
  name: string;
  rollNumber: string;
  yearGroupName: string | null;
  house: string | null;
  photoUrl: string | null;
  /** "Subject combination" — the thing an A Level student identifies themselves by. */
  subjects: { code: string; name: string }[];
  societies: { id: string; name: string; role: string }[];
  badges: { code: string; title: string; awardedAt: string }[];
  housePoints: number;
  /** The student's own switch. Shown on their profile because it is theirs to change. */
  optOutLeaderboards: boolean;
};

/**
 * The profile.
 *
 * "Subject combination, house, societies and achievements." Deliberately no marks: this is
 * the page a student would screenshot, and a profile that leads with a grade is one that
 * makes the app feel like a gradebook again.
 */
export async function getProfile(actor: Actor, studentId?: string): Promise<StudentProfile> {
  const target = studentId ?? actor.studentId ?? actor.childStudentIds[0];
  if (!target) throw ApiError.notFound('No student');

  if (target !== actor.studentId) {
    const check = await prisma.student.findFirst({
      where: { id: target },
      select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
    });
    if (!check) throw ApiError.notFound('Student not found');
    assertCanAccessStudent(
      actor,
      target,
      check.enrolments.map((entry) => entry.sectionId),
    );
  }

  const student = await prisma.student.findFirst({
    where: { id: target, deletedAt: null },
    select: {
      id: true,
      rollNumber: true,
      house: true,
      photoUrl: true,
      optOutLeaderboards: true,
      user: { select: { name: true } },
      enrolments: {
        where: { droppedAt: null },
        select: {
          section: {
            select: {
              subject: { select: { code: true, name: true } },
              yearGroup: { select: { name: true } },
            },
          },
        },
      },
      societyMemberships: {
        select: { role: true, society: { select: { id: true, name: true } } },
      },
      badges: {
        orderBy: { awardedAt: 'desc' },
        select: { awardedAt: true, badge: { select: { code: true, title: true } } },
      },
    },
  });
  if (!student) throw ApiError.notFound('Student not found');

  const points = await prisma.housePoint.aggregate({
    where: { studentId: target },
    _sum: { points: true },
  });

  const subjects = new Map<string, { code: string; name: string }>();
  for (const enrolment of student.enrolments) {
    subjects.set(enrolment.section.subject.code, enrolment.section.subject);
  }

  const photoUrl = student.photoUrl
    ? await getStorage()
        .createDownloadUrl(student.photoUrl, { expiresInSeconds: 3600 })
        .catch(() => null)
    : null;

  return {
    studentId: student.id,
    name: student.user.name,
    rollNumber: student.rollNumber,
    yearGroupName: student.enrolments[0]?.section.yearGroup.name ?? null,
    house: student.house,
    photoUrl,
    subjects: [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name)),
    societies: student.societyMemberships
      .map((membership) => ({
        id: membership.society.id,
        name: membership.society.name,
        role: membership.role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    badges: student.badges.map((award) => ({
      code: award.badge.code,
      title: award.badge.title,
      awardedAt: award.awardedAt.toISOString(),
    })),
    housePoints: points._sum.points ?? 0,
    optOutLeaderboards: student.optOutLeaderboards,
  };
}
