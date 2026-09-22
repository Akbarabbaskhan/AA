import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { assertCanAccessSection, can, requireCapability, type Actor } from '@/lib/permissions';
import { getStorage } from '@/lib/storage';

/**
 * Assignments and submissions.
 *
 * The rule that shapes this one: a late submission is flagged, never refused, unless the
 * teacher has explicitly turned late submissions off. A student who submits at 12:04 has
 * done the work; a system that throws it away has an opinion about punctuality that the
 * school, not the software, should be expressing.
 */

/** A submission this long after the deadline is late but still accepted where late is allowed. */
const LATE_WINDOW_DAYS = 14;

export const assignmentInputSchema = z.object({
  sectionId: z.string().uuid(),
  title: z.string().min(1).max(200),
  brief: z.string().min(1).max(20_000),
  attachments: z
    .array(z.object({ key: z.string().min(1), name: z.string().min(1), size: z.number().int().min(0) }))
    .max(10)
    .default([]),
  dueAt: z.coerce.date(),
  totalMarks: z.number().int().min(1).max(500),
  allowLate: z.boolean().default(true),
  isPublished: z.boolean().default(false),
});

export type AssignmentInput = z.infer<typeof assignmentInputSchema>;

export type AssignmentAttachment = { key: string; name: string; size: number };

function parseAttachments(value: Prisma.JsonValue): AssignmentAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: AssignmentAttachment[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record['key'] === 'string' && typeof record['name'] === 'string') {
      out.push({
        key: record['key'],
        name: record['name'],
        size: typeof record['size'] === 'number' ? record['size'] : 0,
      });
    }
  }
  return out;
}

export async function createAssignment(actor: Actor, raw: AssignmentInput): Promise<{ id: string }> {
  requireCapability(actor, 'assignment.manage');
  const input = assignmentInputSchema.parse(raw);
  assertCanAccessSection(actor, input.sectionId);
  if (!actor.staffId) throw ApiError.notFound('Only staff set assignments');

  const assignment = await prisma.assignment.create({
    data: {
      schoolId: actor.schoolId,
      sectionId: input.sectionId,
      createdById: actor.staffId,
      title: input.title,
      brief: input.brief,
      attachmentsJson: input.attachments,
      dueAt: input.dueAt,
      totalMarks: input.totalMarks,
      allowLate: input.allowLate,
      isPublished: input.isPublished,
    },
    select: { id: true },
  });
  return assignment;
}

export async function updateAssignment(
  actor: Actor,
  assignmentId: string,
  input: Partial<AssignmentInput>,
): Promise<{ id: string }> {
  requireCapability(actor, 'assignment.manage');
  const existing = await prisma.assignment.findFirst({
    where: { id: assignmentId, deletedAt: null },
    select: { id: true, sectionId: true, totalMarks: true },
  });
  if (!existing) throw ApiError.notFound('Assignment not found');
  assertCanAccessSection(actor, existing.sectionId);

  // Lowering the total below a mark already awarded would show a student 14/10.
  if (input.totalMarks !== undefined && input.totalMarks < existing.totalMarks) {
    const highest = await prisma.submission.aggregate({
      where: { assignmentId, marks: { not: null } },
      _max: { marks: true },
    });
    const max = highest._max.marks ?? 0;
    if (input.totalMarks < max) {
      throw ApiError.conflict(
        'belowAwardedMarks',
        `A submission is already marked ${max}. Regrade it before lowering the total.`,
      );
    }
  }

  await prisma.assignment.update({
    where: { id: assignmentId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.brief !== undefined ? { brief: input.brief } : {}),
      ...(input.attachments !== undefined ? { attachmentsJson: input.attachments } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.totalMarks !== undefined ? { totalMarks: input.totalMarks } : {}),
      ...(input.allowLate !== undefined ? { allowLate: input.allowLate } : {}),
      ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
    },
  });
  return { id: assignmentId };
}

export type AssignmentSummary = {
  id: string;
  title: string;
  sectionId: string;
  sectionName: string;
  subjectName: string;
  dueAt: string;
  totalMarks: number;
  allowLate: boolean;
  isPublished: boolean;
  /** Student view. */
  mySubmission: {
    submittedAt: string | null;
    isLate: boolean;
    marks: number | null;
    feedback: string | null;
  } | null;
  /** Staff view. */
  submittedCount: number | null;
  expectedCount: number | null;
  ungradedCount: number | null;
};

export const assignmentQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  /** Students default to what is still open; staff to everything. */
  scope: z.enum(['ALL', 'DUE', 'OVERDUE', 'GRADED']).default('ALL'),
});

export async function listAssignments(
  actor: Actor,
  query: z.infer<typeof assignmentQuerySchema>,
): Promise<AssignmentSummary[]> {
  requireCapability(actor, 'assignment.read');
  const isStudent = Boolean(actor.studentId) && !can(actor, 'assignment.manage');

  let sectionIds: string[];
  if (query.sectionId) {
    assertCanAccessSection(actor, query.sectionId);
    sectionIds = [query.sectionId];
  } else {
    sectionIds = isStudent ? [...actor.enrolledSectionIds] : [...actor.sectionIds];
    if (sectionIds.length === 0 && !can(actor, 'structure.manage')) return [];
  }

  const now = new Date();
  const rows = await prisma.assignment.findMany({
    where: {
      deletedAt: null,
      ...(sectionIds.length > 0 ? { sectionId: { in: sectionIds } } : {}),
      // An unpublished assignment is a draft. Students must never see one.
      ...(isStudent ? { isPublished: true } : {}),
      ...(query.scope === 'DUE' ? { dueAt: { gte: now } } : {}),
      ...(query.scope === 'OVERDUE' ? { dueAt: { lt: now } } : {}),
    },
    orderBy: { dueAt: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      sectionId: true,
      dueAt: true,
      totalMarks: true,
      allowLate: true,
      isPublished: true,
      section: {
        select: {
          name: true,
          subject: { select: { name: true } },
          _count: { select: { enrolments: { where: { droppedAt: null } } } },
        },
      },
      submissions: {
        where: isStudent && actor.studentId ? { studentId: actor.studentId } : {},
        select: { submittedAt: true, isLate: true, marks: true, feedback: true },
      },
    },
  });

  const summaries = rows.map((row): AssignmentSummary => {
    const mine = isStudent ? row.submissions[0] : undefined;
    const submitted = row.submissions.filter((submission) => submission.submittedAt !== null);
    return {
      id: row.id,
      title: row.title,
      sectionId: row.sectionId,
      sectionName: row.section.name,
      subjectName: row.section.subject.name,
      dueAt: row.dueAt.toISOString(),
      totalMarks: row.totalMarks,
      allowLate: row.allowLate,
      isPublished: row.isPublished,
      mySubmission: isStudent
        ? mine
          ? {
              submittedAt: mine.submittedAt?.toISOString() ?? null,
              isLate: mine.isLate,
              marks: mine.marks,
              feedback: mine.feedback,
            }
          : null
        : null,
      submittedCount: isStudent ? null : submitted.length,
      expectedCount: isStudent ? null : row.section._count.enrolments,
      ungradedCount: isStudent
        ? null
        : submitted.filter((submission) => submission.marks === null).length,
    };
  });

  if (query.scope === 'GRADED') {
    return summaries.filter((summary) =>
      isStudent ? summary.mySubmission?.marks !== null && summary.mySubmission !== null : true,
    );
  }
  return summaries;
}

export type AssignmentDetail = AssignmentSummary & {
  brief: string;
  attachments: (AssignmentAttachment & { url: string })[];
};

/**
 * One assignment, built from its own row rather than by filtering a page of the list.
 *
 * A list page is a view, not an access rule: an assignment set last term is still one this
 * student may open, and a detail view that only finds what is on the first page of the
 * list breaks quietly as soon as a section has a term's worth of work behind it.
 */
export async function getAssignment(actor: Actor, assignmentId: string): Promise<AssignmentDetail> {
  requireCapability(actor, 'assignment.read');

  const isStudent = Boolean(actor.studentId) && !can(actor, 'assignment.manage');
  const row = await prisma.assignment.findFirst({
    where: { id: assignmentId, deletedAt: null },
    select: {
      id: true,
      title: true,
      sectionId: true,
      brief: true,
      attachmentsJson: true,
      dueAt: true,
      totalMarks: true,
      allowLate: true,
      isPublished: true,
      section: {
        select: {
          name: true,
          subject: { select: { name: true } },
          _count: { select: { enrolments: { where: { droppedAt: null } } } },
        },
      },
      submissions: {
        where: isStudent && actor.studentId ? { studentId: actor.studentId } : {},
        select: { submittedAt: true, isLate: true, marks: true, feedback: true },
      },
    },
  });
  if (!row) throw ApiError.notFound('Assignment not found');
  assertCanAccessSection(actor, row.sectionId);
  if (isStudent && !row.isPublished) throw ApiError.notFound('Assignment not found');

  const mine = isStudent ? row.submissions[0] : undefined;
  const submitted = row.submissions.filter((submission) => submission.submittedAt !== null);

  const summary: AssignmentSummary = {
    id: row.id,
    title: row.title,
    sectionId: row.sectionId,
    sectionName: row.section.name,
    subjectName: row.section.subject.name,
    dueAt: row.dueAt.toISOString(),
    totalMarks: row.totalMarks,
    allowLate: row.allowLate,
    isPublished: row.isPublished,
    mySubmission:
      isStudent && mine
        ? {
            submittedAt: mine.submittedAt?.toISOString() ?? null,
            isLate: mine.isLate,
            marks: mine.marks,
            feedback: mine.feedback,
          }
        : null,
    submittedCount: isStudent ? null : submitted.length,
    expectedCount: isStudent ? null : row.section._count.enrolments,
    ungradedCount: isStudent ? null : submitted.filter((submission) => submission.marks === null).length,
  };

  const storage = getStorage();
  return {
    ...summary,
    brief: row.brief,
    attachments: await Promise.all(
      parseAttachments(row.attachmentsJson).map(async (attachment) => ({
        ...attachment,
        url: await storage.createDownloadUrl(attachment.key),
      })),
    ),
  };
}

export const submissionInputSchema = z
  .object({
    files: z
      .array(z.object({ key: z.string().min(1), name: z.string().min(1), size: z.number().int().min(0) }))
      .max(10)
      .default([]),
    textBody: z.string().max(50_000).nullable().default(null),
  })
  .refine((value) => value.files.length > 0 || (value.textBody ?? '').trim() !== '', {
    path: ['files'],
    message: 'Attach a file or write your answer.',
  });

export type SubmissionResult = {
  id: string;
  submittedAt: string;
  isLate: boolean;
  /** Minutes past the deadline, so the UI can say "3 hours late" rather than just "late". */
  minutesLate: number;
};

/**
 * Submits or replaces a student's work.
 *
 * Replacement is allowed up to the deadline and, where late submission is on, within the
 * late window. The lateness flag is recomputed each time, so a student who submits on time
 * and then replaces the file at midnight is correctly marked late for what was actually
 * handed in.
 */
export async function submitAssignment(
  actor: Actor,
  assignmentId: string,
  input: z.infer<typeof submissionInputSchema>,
): Promise<SubmissionResult> {
  requireCapability(actor, 'assignment.read');
  if (!actor.studentId) throw ApiError.notFound('Only students submit assignments');
  const studentId = actor.studentId;

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, deletedAt: null, isPublished: true },
    select: { id: true, sectionId: true, dueAt: true, allowLate: true },
  });
  if (!assignment) throw ApiError.notFound('Assignment not found');
  if (!actor.enrolledSectionIds.includes(assignment.sectionId)) {
    throw ApiError.notFound('Assignment not found');
  }

  const now = new Date();
  const minutesLate = Math.max(0, Math.floor((now.getTime() - assignment.dueAt.getTime()) / 60_000));
  const isLate = minutesLate > 0;

  if (isLate && !assignment.allowLate) {
    throw ApiError.locked('closed', 'This assignment closed at the deadline.');
  }
  if (isLate && minutesLate > LATE_WINDOW_DAYS * 24 * 60) {
    throw ApiError.locked('closed', 'This assignment is no longer accepting submissions.');
  }

  // Once a teacher has marked it, replacing the file would invalidate the mark silently.
  const existing = await prisma.submission.findFirst({
    where: { assignmentId, studentId },
    select: { id: true, gradedAt: true },
  });
  if (existing?.gradedAt) {
    throw ApiError.conflict('alreadyGraded', 'This work has been marked. Ask your teacher to reopen it.');
  }

  const submission = await prisma.submission.upsert({
    where: { assignmentId_studentId: { assignmentId, studentId } },
    create: {
      schoolId: actor.schoolId,
      assignmentId,
      studentId,
      submittedAt: now,
      filesJson: input.files,
      textBody: input.textBody,
      isLate,
    },
    update: {
      submittedAt: now,
      filesJson: input.files,
      textBody: input.textBody,
      isLate,
    },
    select: { id: true },
  });

  return { id: submission.id, submittedAt: now.toISOString(), isLate, minutesLate };
}

export type SubmissionRow = {
  submissionId: string | null;
  studentId: string;
  studentName: string;
  rollNumber: string;
  submittedAt: string | null;
  isLate: boolean;
  files: (AssignmentAttachment & { url: string })[];
  textBody: string | null;
  marks: number | null;
  feedback: string | null;
};

/**
 * The grading list.
 *
 * Every enrolled student appears, submitted or not. A list of submissions alone hides the
 * students who did not hand in, which is exactly the list a teacher needs.
 */
export async function getSubmissions(actor: Actor, assignmentId: string): Promise<SubmissionRow[]> {
  requireCapability(actor, 'assignment.manage');
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, deletedAt: null },
    select: { id: true, sectionId: true },
  });
  if (!assignment) throw ApiError.notFound('Assignment not found');
  assertCanAccessSection(actor, assignment.sectionId);

  const enrolments = await prisma.enrolment.findMany({
    where: { sectionId: assignment.sectionId, droppedAt: null },
    select: {
      studentId: true,
      student: { select: { rollNumber: true, user: { select: { name: true } } } },
    },
  });

  const submissions = await prisma.submission.findMany({
    where: { assignmentId },
    select: {
      id: true,
      studentId: true,
      submittedAt: true,
      isLate: true,
      filesJson: true,
      textBody: true,
      marks: true,
      feedback: true,
    },
  });
  const byStudent = new Map(submissions.map((submission) => [submission.studentId, submission]));

  const storage = getStorage();
  const rows = await Promise.all(
    enrolments.map(async (enrolment): Promise<SubmissionRow> => {
      const submission = byStudent.get(enrolment.studentId);
      return {
        submissionId: submission?.id ?? null,
        studentId: enrolment.studentId,
        studentName: enrolment.student.user.name,
        rollNumber: enrolment.student.rollNumber,
        submittedAt: submission?.submittedAt?.toISOString() ?? null,
        isLate: submission?.isLate ?? false,
        files: submission
          ? await Promise.all(
              parseAttachments(submission.filesJson).map(async (file) => ({
                ...file,
                url: await storage.createDownloadUrl(file.key),
              })),
            )
          : [],
        textBody: submission?.textBody ?? null,
        marks: submission?.marks ?? null,
        feedback: submission?.feedback ?? null,
      };
    }),
  );

  return rows.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));
}

export const gradeSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  marks: z.number().int().min(0),
  feedback: z.string().max(10_000).nullable().default(null),
});

export async function gradeSubmission(
  actor: Actor,
  input: z.infer<typeof gradeSubmissionSchema>,
): Promise<{ id: string }> {
  requireCapability(actor, 'assignment.manage');
  if (!actor.staffId) throw ApiError.notFound('Only staff grade submissions');

  const submission = await prisma.submission.findFirst({
    where: { id: input.submissionId },
    select: {
      id: true,
      submittedAt: true,
      assignment: { select: { sectionId: true, totalMarks: true, deletedAt: true } },
    },
  });
  if (!submission || submission.assignment.deletedAt) throw ApiError.notFound('Submission not found');
  assertCanAccessSection(actor, submission.assignment.sectionId);
  if (!submission.submittedAt) throw ApiError.conflict('notSubmitted', 'Nothing has been handed in yet.');
  if (input.marks > submission.assignment.totalMarks) {
    throw ApiError.badRequest(
      'aboveMaximum',
      `This assignment is out of ${submission.assignment.totalMarks}.`,
      { marks: [`Maximum ${submission.assignment.totalMarks}.`] },
    );
  }

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      marks: input.marks,
      feedback: input.feedback,
      gradedById: actor.staffId,
      gradedAt: new Date(),
    },
  });
  return { id: submission.id };
}

export type MissingSubmission = {
  assignmentId: string;
  title: string;
  sectionName: string;
  dueAt: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  daysOverdue: number;
};

/**
 * Who has not handed in, across a teacher's sections.
 *
 * The list the reminder is built from. Sorted by how overdue, because a piece three weeks
 * late is a different conversation from one three hours late.
 */
export async function getMissingSubmissions(actor: Actor, sectionId?: string): Promise<MissingSubmission[]> {
  requireCapability(actor, 'assignment.manage');
  const sectionIds = sectionId ? [sectionId] : [...actor.sectionIds];
  if (sectionId) assertCanAccessSection(actor, sectionId);
  if (sectionIds.length === 0) return [];

  const now = new Date();
  const assignments = await prisma.assignment.findMany({
    where: {
      sectionId: { in: sectionIds },
      deletedAt: null,
      isPublished: true,
      dueAt: { lt: now },
    },
    orderBy: { dueAt: 'asc' },
    select: {
      id: true,
      title: true,
      dueAt: true,
      sectionId: true,
      section: {
        select: {
          name: true,
          enrolments: {
            where: { droppedAt: null },
            select: {
              studentId: true,
              student: { select: { rollNumber: true, user: { select: { name: true } } } },
            },
          },
        },
      },
      submissions: { where: { submittedAt: { not: null } }, select: { studentId: true } },
    },
  });

  const missing: MissingSubmission[] = [];
  for (const assignment of assignments) {
    const handedIn = new Set(assignment.submissions.map((submission) => submission.studentId));
    for (const enrolment of assignment.section.enrolments) {
      if (handedIn.has(enrolment.studentId)) continue;
      missing.push({
        assignmentId: assignment.id,
        title: assignment.title,
        sectionName: assignment.section.name,
        dueAt: assignment.dueAt.toISOString(),
        studentId: enrolment.studentId,
        studentName: enrolment.student.user.name,
        rollNumber: enrolment.student.rollNumber,
        daysOverdue: Math.floor((now.getTime() - assignment.dueAt.getTime()) / 86_400_000),
      });
    }
  }

  return missing.sort((a, b) => b.daysOverdue - a.daysOverdue);
}
