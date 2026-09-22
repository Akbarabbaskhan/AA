import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import { getVaultFacets, listPapers } from '@/lib/services/papers/vault';
import {
  getPracticeGoal,
  getPracticeTrend,
  listAttempts,
  selfMarkAttempt,
  setPracticeGoal,
  startAttempt,
  submitAttempt,
} from '@/lib/services/papers/practice';
import { createQuestion, importQuestions, listQuestions } from '@/lib/services/quizzes/bank';
import {
  createQuiz,
  getAttemptResult,
  listQuizzes,
  recordTabSwitch,
  saveQuizAnswer,
  startQuizAttempt,
  submitQuizAttempt,
} from '@/lib/services/quizzes/quiz';
import { getManualMarkingQueue, getQuizAnalysis, markManually } from '@/lib/services/quizzes/analysis';
import { getWeaknessMap } from '@/lib/services/quizzes/mastery';
import {
  createAssignment,
  getAssignment,
  getMissingSubmissions,
  getSubmissions,
  gradeSubmission,
  listAssignments,
  submitAssignment,
} from '@/lib/services/assignments';
import { createResource, listResources, openResource, getResourceVersions } from '@/lib/services/resources';
import { askDoubt, getDoubt, listDoubts, replyToDoubt, resolveDoubt } from '@/lib/services/doubts';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

let schoolId: string;
let admin: Actor;
let student: Actor;
let classmate: Actor;
/** A student in no section this teacher teaches — the one who must see nothing. */
let outsider: Actor;
let teacher: Actor;

/** A section the teacher teaches, with at least two students in it. */
let sectionId: string;
let subjectId: string;

const TEST_PREFIX = '[test] ';

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');

  const picked = await asActor(admin, async () => {
    const section = await testPrisma.section.findFirstOrThrow({
      where: { enrolments: { some: { droppedAt: null } }, teacherId: { not: null } },
      select: {
        id: true,
        subjectId: true,
        teacherId: true,
        enrolments: {
          where: { droppedAt: null },
          take: 2,
          select: { student: { select: { rollNumber: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const staff = await testPrisma.staff.findFirstOrThrow({
      where: { id: section.teacherId ?? '' },
      select: { user: { select: { email: true } } },
    });

    // Someone enrolled in nothing this section covers.
    const other = await testPrisma.student.findFirstOrThrow({
      where: { enrolments: { none: { sectionId: section.id } } },
      select: { rollNumber: true },
    });

    return {
      sectionId: section.id,
      subjectId: section.subjectId,
      teacherEmail: staff.user.email!,
      rolls: section.enrolments.map((entry) => entry.student.rollNumber),
      outsiderRoll: other.rollNumber,
    };
  });

  sectionId = picked.sectionId;
  subjectId = picked.subjectId;
  teacher = await actorByEmail(schoolId, picked.teacherEmail);
  student = await actorForStudentRoll(schoolId, picked.rolls[0]!);
  classmate = await actorForStudentRoll(schoolId, picked.rolls[1]!);
  outsider = await actorForStudentRoll(schoolId, picked.outsiderRoll);
});

afterAll(async () => {
  await asActor(admin, async () => {
    await testPrisma.quiz.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
    await testPrisma.assignment.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
    await testPrisma.question.deleteMany({ where: { body: { startsWith: TEST_PREFIX } } });
    await testPrisma.resource.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
    await testPrisma.doubtThread.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
  });
  await testPrisma.$disconnect();
});

describe('past paper vault', () => {
  it('lists the seeded papers with facets to filter by', async () => {
    const [page, facets] = await asActor(student, async () =>
      Promise.all([listPapers(student, { limit: 20 }), getVaultFacets(student)]),
    );
    expect(page.items.length).toBeGreaterThan(0);
    expect(facets.subjects.length).toBeGreaterThan(0);
    expect(facets.years.length).toBeGreaterThan(0);
  });

  it('filters to a single subject', async () => {
    const facets = await asActor(student, () => getVaultFacets(student));
    const subject = facets.subjects[0]!;
    const page = await asActor(student, () =>
      listPapers(student, { limit: 50, subjectId: subject.id }),
    );
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((paper) => paper.subjectId === subject.id)).toBe(true);
  });

  it('hides papers the student has already attempted when asked to', async () => {
    const attempts = await asActor(student, () => listAttempts(student, { limit: 5 }));
    const unattempted = await asActor(student, () =>
      listPapers(student, { limit: 100, onlyUnattempted: true }),
    );
    const attemptedIds = new Set(attempts.map((attempt) => attempt.pastPaperId));
    expect(unattempted.items.some((paper) => attemptedIds.has(paper.id))).toBe(false);
  });
});

describe('timed practice', () => {
  let paperId: string;

  beforeAll(async () => {
    const page = await asActor(student, () => listPapers(student, { limit: 100, onlyUnattempted: true }));
    paperId = page.items[0]!.id;
  });

  it('never hands the mark scheme to an open attempt', async () => {
    const attempt = await asActor(student, () => startAttempt(student, paperId));
    expect(attempt.markSchemeUrl).toBeNull();
    expect(attempt.secondsRemaining).toBeGreaterThan(0);
  });

  it('resumes the same attempt rather than starting a second one', async () => {
    const first = await asActor(student, () => startAttempt(student, paperId));
    const second = await asActor(student, () => startAttempt(student, paperId));
    expect(second.attemptId).toBe(first.attemptId);
  });

  it('unlocks the mark scheme only on submit, then accepts a self-mark', async () => {
    const attempt = await asActor(student, () => startAttempt(student, paperId));
    const submitted = await asActor(student, () => submitAttempt(student, attempt.attemptId));
    expect(submitted.markSchemeUrl).not.toBeNull();

    const marked = await asActor(student, () =>
      selfMarkAttempt(student, attempt.attemptId, { score: 40, total: 80, notes: 'Units again.' }),
    );
    expect(marked.percent).toBeCloseTo(50, 5);
    expect(marked.grade).not.toBeNull();
  });

  it('refuses to mark an attempt that was never submitted', async () => {
    const other = await asActor(student, () =>
      listPapers(student, { limit: 100, onlyUnattempted: true }),
    );
    const fresh = await asActor(student, () => startAttempt(student, other.items[0]!.id));
    await expect(
      asActor(student, () => selfMarkAttempt(student, fresh.attemptId, { score: 1, total: 10 })),
    ).rejects.toThrow(/submit/i);
  });

  it('refuses to open another student’s attempt', async () => {
    const attempt = await asActor(student, () => startAttempt(student, paperId));
    await expect(
      asActor(classmate, () => submitAttempt(classmate, attempt.attemptId)),
    ).rejects.toThrow(/not found/i);
  });

  it('never lets one student read another student’s practice history', async () => {
    await expect(
      asActor(outsider, () => listAttempts(outsider, { studentId: student.studentId! })),
    ).rejects.toThrow(ForbiddenError);
  });

  it('counts effort, not grades, towards the weekly goal', async () => {
    await asActor(student, () => setPracticeGoal(student, { goalPerWeek: 4 }));
    const goal = await asActor(student, () => getPracticeGoal(student));
    expect(goal.goalPerWeek).toBe(4);
    expect(goal.thisWeek).toBeGreaterThanOrEqual(0);
  });

  it('groups the trend by subject and component, not by subject alone', async () => {
    const trend = await asActor(student, () => getPracticeTrend(student));
    const keys = trend.subjects.map((entry) => `${entry.subjectCode}:${entry.componentCode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('question bank', () => {
  it('rejects an MCQ whose answer is not one of its options', async () => {
    await expect(
      asActor(admin, () =>
        createQuestion(admin, {
          subjectId,
          type: 'MCQ',
          body: `${TEST_PREFIX}bad key`,
          options: [
            { id: 'a', text: 'One' },
            { id: 'b', text: 'Two' },
          ],
          correct: 'z',
          marks: 1,
          negativeMarks: 0,
          topicTag: 'Test',
          difficulty: null,
          explanation: null,
          toleranceBp: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('imports the good CSV rows and reports the bad ones', async () => {
    const csv = [
      'type,body,option_a,option_b,option_c,option_d,answer,marks,topic,tolerance_pct',
      `MCQ,"${TEST_PREFIX}which one",One,Two,Three,Four,C,1,Imported,`,
      `NUMERIC,"${TEST_PREFIX}value of g",,,,,9.81,2,Imported,2.5`,
      `NUMERIC,"${TEST_PREFIX}broken",,,,,not a number,1,Imported,`,
    ].join('\n');

    const result = await asActor(admin, () => importQuestions(admin, subjectId, csv));
    expect(result.created).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.rowNumber).toBe(4);

    const bank = await asActor(admin, () => listQuestions(admin, { subjectId, limit: 100 }));
    expect(bank.filter((question) => question.body.startsWith(TEST_PREFIX))).toHaveLength(2);
  });

  it('never exposes the bank to a student', async () => {
    await expect(
      asActor(student, () => listQuestions(student, { limit: 10 })),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('quiz engine', () => {
  let quizId: string;

  beforeAll(async () => {
    const bank = await asActor(admin, () => listQuestions(admin, { subjectId, limit: 100 }));
    const mcqs = bank.filter((question) => question.type === 'MCQ').slice(0, 4);
    expect(mcqs.length).toBeGreaterThan(0);

    const created = await asActor(admin, () =>
      createQuiz(admin, {
        sectionId,
        title: `${TEST_PREFIX}engine check`,
        timeLimitSeconds: 900,
        attemptsAllowed: 1,
        shuffleQuestions: true,
        shuffleOptions: true,
        negativeMarking: false,
        availableFrom: null,
        availableTo: null,
        showAnswersAfter: true,
        questionIds: mcqs.map((question) => question.id),
      }),
    );
    quizId = created.id;
  });

  it('shows a student the quiz without any answer key in the payload', async () => {
    const sitting = await asActor(student, () => startQuizAttempt(student, quizId));
    const serialised = JSON.stringify(sitting);
    const bank = await asActor(admin, () => listQuestions(admin, { subjectId, limit: 100 }));

    for (const question of bank) {
      if (!sitting.questions.some((entry) => entry.id === question.id)) continue;
      if (typeof question.correct !== 'string') continue;
      // The option id may legitimately appear as an option; what must not appear is a
      // `correct`/`explanation` field anywhere in the payload.
      expect(serialised).not.toContain('"correct"');
      expect(serialised).not.toContain('"explanation"');
    }
  });

  it('marks the attempt and returns the key only after submission', async () => {
    const sitting = await asActor(student, () => startQuizAttempt(student, quizId));
    const bank = await asActor(admin, () => listQuestions(admin, { subjectId, limit: 200 }));
    const keyOf = new Map(bank.map((question) => [question.id, question.correct]));

    for (const question of sitting.questions) {
      const key = keyOf.get(question.id);
      if (typeof key !== 'string') continue;
      await asActor(student, () =>
        saveQuizAnswer(student, sitting.attemptId, { questionId: question.id, answer: key }),
      );
    }

    const result = await asActor(student, () => submitQuizAttempt(student, sitting.attemptId));
    expect(result.score).toBe(result.total);
    expect(result.questions).not.toBeNull();
  });

  it('refuses a second submission of the same attempt', async () => {
    const attempt = await asActor(admin, () =>
      testPrisma.quizAttempt.findFirstOrThrow({
        where: { quizId, studentId: student.studentId! },
        select: { id: true },
      }),
    );
    await expect(
      asActor(student, () => submitQuizAttempt(student, attempt.id)),
    ).rejects.toThrow(/already submitted/i);
  });

  it('refuses a second attempt when only one is allowed', async () => {
    await expect(asActor(student, () => startQuizAttempt(student, quizId))).rejects.toThrow(
      /attempts/i,
    );
  });

  it('never lets a student read a classmate’s attempt', async () => {
    const attempt = await asActor(admin, () =>
      testPrisma.quizAttempt.findFirstOrThrow({
        where: { quizId, studentId: student.studentId! },
        select: { id: true },
      }),
    );
    await expect(asActor(classmate, () => getAttemptResult(classmate, attempt.id))).rejects.toThrow(
      /not found/i,
    );
  });

  it('never lets a student outside the section open the quiz at all', async () => {
    await expect(asActor(outsider, () => startQuizAttempt(outsider, quizId))).rejects.toThrow(
      /not found/i,
    );
  });

  it('records tab switches without blocking anything', async () => {
    const bank = await asActor(admin, () => listQuestions(admin, { subjectId, limit: 100 }));
    const created = await asActor(admin, () =>
      createQuiz(admin, {
        sectionId,
        title: `${TEST_PREFIX}tab switches`,
        timeLimitSeconds: null,
        attemptsAllowed: 1,
        shuffleQuestions: false,
        shuffleOptions: false,
        negativeMarking: false,
        availableFrom: null,
        availableTo: null,
        showAnswersAfter: true,
        questionIds: bank.slice(0, 2).map((question) => question.id),
      }),
    );
    const sitting = await asActor(classmate, () => startQuizAttempt(classmate, created.id));
    const first = await asActor(classmate, () => recordTabSwitch(classmate, sitting.attemptId));
    const second = await asActor(classmate, () => recordTabSwitch(classmate, sitting.attemptId));
    expect(second.tabSwitches).toBe(first.tabSwitches + 1);

    // The attempt is still open: nothing was seized.
    const result = await asActor(classmate, () => submitQuizAttempt(classmate, sitting.attemptId));
    expect(result.submittedAt).toBeTruthy();
  });

  it('sends short answers to the teacher and totals the attempt once marked', async () => {
    const question = await asActor(admin, () =>
      createQuestion(admin, {
        subjectId,
        type: 'SHORT',
        body: `${TEST_PREFIX}name the process`,
        options: [],
        correct: ['photosynthesis'],
        marks: 4,
        negativeMarks: 0,
        topicTag: 'Manual',
        difficulty: null,
        explanation: null,
        toleranceBp: null,
      }),
    );

    const created = await asActor(admin, () =>
      createQuiz(admin, {
        sectionId,
        title: `${TEST_PREFIX}manual marking`,
        timeLimitSeconds: null,
        attemptsAllowed: 1,
        shuffleQuestions: false,
        shuffleOptions: false,
        negativeMarking: false,
        availableFrom: null,
        availableTo: null,
        showAnswersAfter: true,
        questionIds: [question.id],
      }),
    );

    const sitting = await asActor(classmate, () => startQuizAttempt(classmate, created.id));
    await asActor(classmate, () =>
      saveQuizAnswer(classmate, sitting.attemptId, {
        questionId: question.id,
        answer: 'the light dependent reaction',
      }),
    );
    const result = await asActor(classmate, () => submitQuizAttempt(classmate, sitting.attemptId));
    expect(result.pendingManualMarking).toBe(1);
    expect(result.score).toBe(0);

    const queue = await asActor(teacher, () => getManualMarkingQueue(teacher, created.id));
    expect(queue).toHaveLength(1);
    expect(queue[0]?.givenAnswer).toContain('light dependent');

    await asActor(teacher, () =>
      markManually(teacher, created.id, { answerId: queue[0]!.answerId, marksAwarded: 3 }),
    );
    const after = await asActor(classmate, () => getAttemptResult(classmate, sitting.attemptId));
    expect(after.score).toBe(3);
    expect(after.pendingManualMarking).toBe(0);
  });

  it('refuses a mark above the question total', async () => {
    const created = await asActor(admin, () =>
      testPrisma.quiz.findFirstOrThrow({
        where: { title: `${TEST_PREFIX}manual marking` },
        select: { id: true },
      }),
    );
    const answer = await asActor(admin, () =>
      testPrisma.quizAnswer.findFirstOrThrow({
        where: { attempt: { quizId: created.id } },
        select: { id: true },
      }),
    );
    await expect(
      asActor(teacher, () => markManually(teacher, created.id, { answerId: answer.id, marksAwarded: 99 })),
    ).rejects.toThrow(/out of/i);
  });

  it('gives the teacher a distractor breakdown and a reteach list', async () => {
    const analysis = await asActor(teacher, () => getQuizAnalysis(teacher, quizId));
    expect(analysis.submitted).toBeGreaterThan(0);
    expect(analysis.questions.length).toBeGreaterThan(0);
    expect(analysis.questions.some((question) => question.optionCounts.length > 0)).toBe(true);
  });

  it('never shows the analysis to a student', async () => {
    await expect(asActor(student, () => getQuizAnalysis(student, quizId))).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('lists quizzes for a student without a marking count', async () => {
    const quizzes = await asActor(student, () => listQuizzes(student));
    expect(quizzes.length).toBeGreaterThan(0);
    expect(quizzes.every((quiz) => quiz.pendingManualMarking === null)).toBe(true);
    expect(quizzes.every((quiz) => quiz.submissionCount === null)).toBe(true);
  });
});

describe('topic mastery', () => {
  it('builds a weakness map from the seeded quiz answers', async () => {
    const map = await asActor(student, () => getWeaknessMap(student.studentId!));
    expect(map.subjects.length).toBeGreaterThan(0);
    for (const subject of map.subjects) {
      const percents = subject.topics.map((topic) => topic.percent);
      expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    }
  });

  it('marks a thin sample as provisional rather than as a verdict', async () => {
    const map = await asActor(student, () => getWeaknessMap(student.studentId!));
    const all = map.subjects.flatMap((subject) => subject.topics);
    for (const topic of all) {
      if (topic.sampleSize < 8) expect(topic.isConfident).toBe(false);
    }
    expect(map.weakest.every((topic) => topic.isConfident)).toBe(true);
  });
});

describe('assignments', () => {
  let assignmentId: string;

  beforeAll(async () => {
    const created = await asActor(admin, () =>
      createAssignment(admin, {
        sectionId,
        title: `${TEST_PREFIX}essay`,
        brief: 'Write eight hundred words.',
        attachments: [],
        dueAt: new Date(Date.now() + 2 * 86_400_000),
        totalMarks: 20,
        allowLate: true,
        isPublished: true,
      }),
    );
    assignmentId = created.id;
  });

  it('accepts a submission before the deadline and does not flag it', async () => {
    const result = await asActor(student, () =>
      submitAssignment(student, assignmentId, { files: [], textBody: 'My essay.' }),
    );
    expect(result.isLate).toBe(false);
    expect(result.minutesLate).toBe(0);
  });

  it('flags a submission after the deadline rather than refusing it', async () => {
    const late = await asActor(admin, () =>
      createAssignment(admin, {
        sectionId,
        title: `${TEST_PREFIX}late window`,
        brief: 'Overdue on purpose.',
        attachments: [],
        dueAt: new Date(Date.now() - 3 * 3_600_000),
        totalMarks: 10,
        allowLate: true,
        isPublished: true,
      }),
    );
    const result = await asActor(student, () =>
      submitAssignment(student, late.id, { files: [], textBody: 'Sorry it is late.' }),
    );
    expect(result.isLate).toBe(true);
    expect(result.minutesLate).toBeGreaterThan(150);
  });

  it('refuses a late submission where the teacher turned late work off', async () => {
    const closed = await asActor(admin, () =>
      createAssignment(admin, {
        sectionId,
        title: `${TEST_PREFIX}closed`,
        brief: 'No late work.',
        attachments: [],
        dueAt: new Date(Date.now() - 3_600_000),
        totalMarks: 10,
        allowLate: false,
        isPublished: true,
      }),
    );
    await expect(
      asActor(student, () => submitAssignment(student, closed.id, { files: [], textBody: 'Late.' })),
    ).rejects.toThrow(/closed/i);
  });

  it('never shows an unpublished assignment to a student', async () => {
    const draft = await asActor(admin, () =>
      createAssignment(admin, {
        sectionId,
        title: `${TEST_PREFIX}draft`,
        brief: 'Not ready.',
        attachments: [],
        dueAt: new Date(Date.now() + 86_400_000),
        totalMarks: 10,
        allowLate: true,
        isPublished: false,
      }),
    );
    const visible = await asActor(student, () => listAssignments(student, { scope: 'ALL' }));
    expect(visible.some((assignment) => assignment.id === draft.id)).toBe(false);
  });

  it('shows the teacher every enrolled student, including those who handed in nothing', async () => {
    const rows = await asActor(teacher, () => getSubmissions(teacher, assignmentId));
    const enrolled = await asActor(admin, () =>
      testPrisma.enrolment.count({ where: { sectionId, droppedAt: null } }),
    );
    expect(rows).toHaveLength(enrolled);
    expect(rows.some((row) => row.submittedAt === null)).toBe(true);
  });

  it('marks a submission and refuses a mark above the total', async () => {
    const rows = await asActor(teacher, () => getSubmissions(teacher, assignmentId));
    const submitted = rows.find((row) => row.submissionId !== null)!;

    await asActor(teacher, () =>
      gradeSubmission(teacher, { submissionId: submitted.submissionId!, marks: 17, feedback: 'Good.' }),
    );

    await expect(
      asActor(teacher, () =>
        gradeSubmission(teacher, { submissionId: submitted.submissionId!, marks: 500, feedback: null }),
      ),
    ).rejects.toThrow(/out of/i);
  });

  it('refuses to replace work a teacher has already marked', async () => {
    await expect(
      asActor(student, () =>
        submitAssignment(student, assignmentId, { files: [], textBody: 'Second thoughts.' }),
      ),
    ).rejects.toThrow(/marked/i);
  });

  it('lists who has not handed in', async () => {
    const missing = await asActor(teacher, () => getMissingSubmissions(teacher, sectionId));
    expect(Array.isArray(missing)).toBe(true);
    expect(missing.every((row) => row.daysOverdue >= 0)).toBe(true);
  });

  it('opens an assignment from its own row, not from a page of the list', async () => {
    const detail = await asActor(student, () => getAssignment(student, assignmentId));
    expect(detail.id).toBe(assignmentId);
    expect(detail.brief).toContain('eight hundred');
    // A student's own submission travels with it; a classmate's counts never do.
    expect(detail.submittedCount).toBeNull();
    expect(detail.mySubmission).not.toBeNull();
  });

  it('never lets a student read the submission list', async () => {
    await expect(asActor(student, () => getSubmissions(student, assignmentId))).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe('resources', () => {
  let resourceId: string;

  it('uploads a resource and lists it for the class', async () => {
    const created = await asActor(admin, () =>
      createResource(admin, {
        subjectId,
        title: `${TEST_PREFIX}handout`,
        type: 'NOTES',
        fileUrl: `${schoolId}/resources/test-handout.pdf`,
        fileSize: 1024,
        mime: 'application/pdf',
        topicTags: ['Testing'],
        visibility: 'MY_SECTIONS',
        supersedesId: null,
      }),
    );
    resourceId = created.id;
    expect(created.version).toBe(1);

    const visible = await asActor(student, () => listResources(student, { includeSuperseded: false, limit: 200 }));
    expect(visible.some((resource) => resource.id === resourceId)).toBe(true);
  });

  it('rejects a video link that is not a recognised host', async () => {
    await expect(
      asActor(admin, () =>
        createResource(admin, {
          subjectId,
          title: `${TEST_PREFIX}bad link`,
          type: 'VIDEO_LINK',
          fileUrl: 'https://definitely-not-a-video-host.example/watch',
          fileSize: 0,
          mime: 'text/html',
          topicTags: [],
          visibility: 'MY_SECTIONS',
          supersedesId: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('counts a download', async () => {
    const before = await asActor(student, () =>
      listResources(student, { includeSuperseded: false, limit: 200 }),
    );
    const start = before.find((resource) => resource.id === resourceId)!.downloadCount;

    await asActor(student, () => openResource(student, resourceId));

    const after = await asActor(student, () =>
      listResources(student, { includeSuperseded: false, limit: 200 }),
    );
    expect(after.find((resource) => resource.id === resourceId)!.downloadCount).toBe(start + 1);
  });

  it('keeps a version chain and lists only the current version by default', async () => {
    const second = await asActor(admin, () =>
      createResource(admin, {
        subjectId,
        title: `${TEST_PREFIX}handout`,
        type: 'NOTES',
        fileUrl: `${schoolId}/resources/test-handout-v2.pdf`,
        fileSize: 2048,
        mime: 'application/pdf',
        topicTags: ['Testing'],
        visibility: 'MY_SECTIONS',
        supersedesId: resourceId,
      }),
    );
    expect(second.version).toBe(2);

    const current = await asActor(student, () =>
      listResources(student, { includeSuperseded: false, limit: 200 }),
    );
    expect(current.some((resource) => resource.id === resourceId)).toBe(false);
    expect(current.some((resource) => resource.id === second.id)).toBe(true);

    const chain = await asActor(student, () => getResourceVersions(student, second.id));
    expect(chain.map((entry) => entry.version)).toEqual([1, 2]);
  });

  it('opens a resource the reader is entitled to however large the library gets', async () => {
    // Authorisation is against this resource's own subject and visibility, not against a
    // page of the library, so an old handout does not become unreachable as the shelf fills.
    const opened = await asActor(student, () => openResource(student, resourceId));
    expect(opened.title).toContain('handout');
    expect(opened.isExternal).toBe(false);
  });

  it('never lets a class teacher publish to the whole school', async () => {
    await expect(
      asActor(teacher, () =>
        createResource(teacher, {
          subjectId,
          title: `${TEST_PREFIX}broadcast`,
          type: 'NOTES',
          fileUrl: `${schoolId}/resources/broadcast.pdf`,
          fileSize: 10,
          mime: 'application/pdf',
          topicTags: [],
          visibility: 'WHOLE_SCHOOL',
          supersedesId: null,
        }),
      ),
    ).rejects.toThrow(/whole school/i);
  });
});

describe('doubt threads', () => {
  let threadId: string;

  it('lets a student ask a question in a subject they take', async () => {
    const thread = await asActor(student, () =>
      askDoubt(student, {
        subjectId,
        resourceId: null,
        title: `${TEST_PREFIX}stuck`,
        body: 'I do not follow step two.',
      }),
    );
    threadId = thread.id;
    const list = await asActor(student, () => listDoubts(student, { scope: 'ALL', limit: 50 }));
    expect(list.some((entry) => entry.id === threadId)).toBe(true);
  });

  it('refuses a question in a subject the student does not take', async () => {
    const otherSubject = await asActor(admin, () =>
      testPrisma.subject.findFirstOrThrow({
        where: { sections: { none: { enrolments: { some: { studentId: student.studentId! } } } } },
        select: { id: true },
      }),
    );
    await expect(
      asActor(student, () =>
        askDoubt(student, {
          subjectId: otherSubject.id,
          resourceId: null,
          title: `${TEST_PREFIX}not mine`,
          body: 'Should not work.',
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('shows a classmate the same thread — the answer is for the cohort', async () => {
    const list = await asActor(classmate, () => listDoubts(classmate, { scope: 'ALL', limit: 50 }));
    expect(list.some((entry) => entry.id === threadId)).toBe(true);
  });

  it('stamps the thread as answered when a teacher replies', async () => {
    await asActor(teacher, () => replyToDoubt(teacher, threadId, { body: 'Differentiate first.' }));
    const thread = await asActor(student, () => getDoubt(student, threadId));
    expect(thread.answeredBy).not.toBeNull();
    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0]?.isStaff).toBe(true);
  });

  it('lets the asker close their own thread', async () => {
    const result = await asActor(student, () => resolveDoubt(student, threadId, true));
    expect(result.isResolved).toBe(true);
  });

  it('opens a thread that has fallen well off the recent list', async () => {
    /*
     * The archive is the point of these threads, so authorisation must be about the thread
     * rather than about whether it is on the first page. Backdate it past any list window
     * and it must still open for someone entitled to read it.
     */
    await asActor(admin, () =>
      testPrisma.doubtThread.update({
        where: { id: threadId },
        data: { updatedAt: new Date('2020-01-01T00:00:00.000Z') },
      }),
    );

    const list = await asActor(classmate, () => listDoubts(classmate, { scope: 'ALL', limit: 5 }));
    expect(list.some((entry) => entry.id === threadId)).toBe(false);

    const thread = await asActor(classmate, () => getDoubt(classmate, threadId));
    expect(thread.id).toBe(threadId);
  });

  it('never shows the thread to a student outside the subject', async () => {
    const list = await asActor(outsider, () => listDoubts(outsider, { scope: 'ALL', limit: 50 }));
    expect(list.some((entry) => entry.id === threadId)).toBe(false);
    await expect(asActor(outsider, () => getDoubt(outsider, threadId))).rejects.toThrow(/not found/i);
  });
});
