import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, QuestionType } from '@prisma/client';
import type { Rng } from './random';

/**
 * The learning milestone's demo data: a stocked past-paper vault, practice attempts with a
 * trend in them, quizzes that have actually been sat, resources, assignments and doubts.
 *
 * The point of seeding this rather than shipping empty tables is that every M3 screen has a
 * shape on first open. An empty vault and a flat trend line tell a principal nothing about
 * whether the feature works.
 *
 * No real board PDFs are seeded. Paper and mark-scheme URLs are storage keys under the
 * school's own prefix — each school uploads its own copies, which is the licensing position
 * the spec takes.
 */

export type LearningSeedSubject = {
  id: string;
  code: string;
  name: string;
  /** Component id and code, for papers and topic tagging. */
  components: { id: string; code: string }[];
  topics: readonly string[];
};

export type LearningSeedSection = {
  id: string;
  subjectId: string;
  subjectCode: string;
  teacherStaffId: string;
  studentIds: string[];
};

export type LearningSeedOptions = {
  schoolId: string;
  sections: readonly LearningSeedSection[];
  subjects: readonly LearningSeedSubject[];
  /** `YYYY-MM-DD` — today, as the seed sees it. */
  today: string;
  papers: number;
  attempts: number;
  attemptStudents: number;
  quizzes: number;
};

export type LearningSeedResult = {
  papers: number;
  attempts: number;
  quizzes: number;
  questions: number;
  quizAttempts: number;
  resources: number;
  assignments: number;
  submissions: number;
  doubts: number;
  masteryRows: number;
};

/** Topic lists per subject code. Real syllabus areas, so the weakness map reads like one. */
export const SUBJECT_TOPICS: Record<string, readonly string[]> = {
  '9701': ['Atomic Structure', 'Chemical Bonding', 'Energetics', 'Electrochemistry', 'Organic Chemistry', 'Equilibria'],
  '9702': ['Kinematics', 'Forces', 'Waves', 'Electric Fields', 'Quantum Physics', 'Thermodynamics'],
  '9700': ['Cell Structure', 'Biological Molecules', 'Transport in Plants', 'Genetics', 'Photosynthesis', 'Infectious Disease'],
  '9709': ['Quadratics', 'Trigonometry', 'Differentiation', 'Integration', 'Vectors', 'Probability'],
  '9708': ['Scarcity and Choice', 'Price Elasticity', 'Market Failure', 'Macroeconomic Policy', 'Trade', 'Inflation'],
  '9093': ['Language Analysis', 'Directed Writing', 'Text Comparison', 'Discursive Essay'],
  '9618': ['Data Representation', 'Networks', 'Algorithms', 'Databases', 'Security'],
  '9706': ['Double Entry', 'Depreciation', 'Partnerships', 'Ratio Analysis', 'Budgeting'],
};

const SESSIONS = ['MAY_JUNE', 'OCT_NOV', 'FEB_MARCH'] as const;
const BOARDS = ['CAIE'] as const;

function topicsFor(code: string): readonly string[] {
  return SUBJECT_TOPICS[code] ?? ['Paper 1', 'Paper 2', 'Paper 3'];
}

function shiftDays(iso: string, days: number): Date {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export async function seedLearning(
  prisma: PrismaClient,
  rng: Rng,
  options: LearningSeedOptions,
): Promise<LearningSeedResult> {
  const t0 = Date.now();
  const mark = (label: string) => {
    if (process.env['SEED_TIMING']) console.log(`    [learning] ${label} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  };
  const result: LearningSeedResult = {
    papers: 0,
    attempts: 0,
    quizzes: 0,
    questions: 0,
    quizAttempts: 0,
    resources: 0,
    assignments: 0,
    submissions: 0,
    doubts: 0,
    masteryRows: 0,
  };

  // -------------------------------------------------------------------------
  // The vault. Spread across years, sessions and variants so the filters have
  // something to filter and the facet counts are not all one.
  // -------------------------------------------------------------------------
  const currentYear = Number(options.today.slice(0, 4));
  const papers: Prisma.PastPaperCreateManyInput[] = [];
  const paperIndex: { id: string; subjectId: string; subjectCode: string; componentCode: string; total: number }[] = [];

  outer: for (let year = currentYear - 1; year >= currentYear - 8; year -= 1) {
    for (const session of SESSIONS) {
      for (const variant of [1, 2, 3]) {
        for (const subject of options.subjects) {
          for (const component of subject.components) {
            if (papers.length >= options.papers) break outer;
            const id = randomUUID();
            const total = component.code === 'P1' ? 40 : component.code === 'P2' ? 60 : 100;
            papers.push({
              id,
              schoolId: options.schoolId,
              subjectId: subject.id,
              componentId: component.id,
              board: BOARDS[0],
              session,
              year,
              variant,
              // Storage keys, not URLs: the file itself is whatever the school uploaded.
              paperUrl: `${options.schoolId}/papers/${subject.code}_${component.code}_${session}_${year}_${variant}_qp.pdf`,
              markSchemeUrl: `${options.schoolId}/papers/${subject.code}_${component.code}_${session}_${year}_${variant}_ms.pdf`,
              examinerReportUrl: rng.bool(0.4)
                ? `${options.schoolId}/papers/${subject.code}_${component.code}_${session}_${year}_er.pdf`
                : null,
              durationMinutes: component.code === 'P1' ? 75 : component.code === 'P5' ? 75 : 120,
              totalMarks: total,
              difficulty: rng.int(2, 4),
              topicTags: rng.sample(topicsFor(subject.code), rng.int(2, 3)),
            });
            paperIndex.push({
              id,
              subjectId: subject.id,
              subjectCode: subject.code,
              componentCode: component.code,
              total,
            });
          }
        }
      }
    }
  }

  for (let index = 0; index < papers.length; index += 500) {
    await prisma.pastPaper.createMany({ data: papers.slice(index, index + 500) });
  }
  result.papers = papers.length;
  mark('papers');

  // -------------------------------------------------------------------------
  // Practice attempts.
  //
  // Concentrated in a subset of students on purpose. A demo where all 2,000 students
  // practise equally is a demo of a product nobody has used; the effort leaderboard and
  // the "who is actually working" report need a spread.
  // -------------------------------------------------------------------------
  const studentSubjects = new Map<string, Set<string>>();
  for (const section of options.sections) {
    for (const studentId of section.studentIds) {
      const set = studentSubjects.get(studentId) ?? new Set<string>();
      set.add(section.subjectCode);
      studentSubjects.set(studentId, set);
    }
  }

  const candidateStudents = [...studentSubjects.keys()];
  const practisers = rng.sample(candidateStudents, Math.min(options.attemptStudents, candidateStudents.length));

  type AttemptRow = {
    id: string;
    studentId: string;
    pastPaperId: string;
    startedAt: Date;
    submittedAt: Date;
    score: number;
    total: number;
    seconds: number;
  };
  const attemptRows: AttemptRow[] = [];
  const perStudent = Math.max(1, Math.round(options.attempts / Math.max(1, practisers.length)));

  for (const studentId of practisers) {
    const subjects = studentSubjects.get(studentId);
    if (!subjects) continue;
    const eligible = paperIndex.filter((paper) => subjects.has(paper.subjectCode));
    if (eligible.length === 0) continue;

    // A latent ability plus an improvement rate, so a student's trend line goes somewhere.
    const ability = rng.normal(58, 13, 25, 92);
    const improvement = rng.normal(0.9, 0.8, -0.6, 2.4);
    // Nudged above the mean because the floor at one attempt truncates the low tail, which
    // otherwise lands the total a little under the target every run.
    const count = Math.max(1, Math.round(rng.normal(perStudent + 0.6, perStudent / 2, 1, perStudent * 2.5)));
    const chosen = rng.sample(eligible, Math.min(count, eligible.length));

    chosen.forEach((paper, index) => {
      // Dated backwards from today, oldest first, roughly one a week.
      const daysAgo = (chosen.length - index) * rng.int(4, 10);
      const startedAt = shiftDays(options.today, -daysAgo);
      const percent = Math.max(
        5,
        Math.min(100, ability + improvement * index + rng.normal(0, 8, -18, 18)),
      );
      const score = Math.round((percent / 100) * paper.total);
      const seconds = rng.int(35, 130) * 60;
      attemptRows.push({
        id: randomUUID(),
        studentId,
        pastPaperId: paper.id,
        startedAt,
        submittedAt: new Date(startedAt.getTime() + seconds * 1000),
        score,
        total: paper.total,
        seconds,
      });
    });
  }

  for (let index = 0; index < attemptRows.length; index += 2000) {
    const batch = attemptRows.slice(index, index + 2000);
    await prisma.$executeRaw`
      INSERT INTO paper_attempts
        (id, school_id, student_id, past_paper_id, started_at, submitted_at,
         self_marked_score, total, time_taken_seconds)
      SELECT t.id, ${options.schoolId}, t.student_id, t.past_paper_id,
             t.started_at, t.submitted_at, t.score, t.total, t.seconds
      FROM unnest(
        ${batch.map((row) => row.id)}::text[],
        ${batch.map((row) => row.studentId)}::text[],
        ${batch.map((row) => row.pastPaperId)}::text[],
        ${batch.map((row) => row.startedAt)}::timestamptz[],
        ${batch.map((row) => row.submittedAt)}::timestamptz[],
        ${batch.map((row) => row.score)}::int[],
        ${batch.map((row) => row.total)}::int[],
        ${batch.map((row) => row.seconds)}::int[]
      ) AS t(id, student_id, past_paper_id, started_at, submitted_at, score, total, seconds)
    `;
  }
  result.attempts = attemptRows.length;
  mark('attempts');

  // -------------------------------------------------------------------------
  // Question bank, quizzes, and attempts at them.
  // -------------------------------------------------------------------------
  const questionsBySubject = new Map<string, { id: string; marks: number; topicTag: string; correct: string }[]>();
  const questionRows: Prisma.QuestionCreateManyInput[] = [];

  for (const subject of options.subjects) {
    const bank: { id: string; marks: number; topicTag: string; correct: string }[] = [];
    for (const topic of topicsFor(subject.code)) {
      for (let n = 1; n <= 6; n += 1) {
        const id = randomUUID();
        const type: QuestionType = n <= 4 ? 'MCQ' : n === 5 ? 'MULTI' : 'NUMERIC';
        const correct = type === 'MCQ' ? rng.pick(['a', 'b', 'c', 'd']) : 'a';
        const options4 = ['a', 'b', 'c', 'd'].map((letter, letterIndex) => ({
          id: letter,
          text: `${topic} response ${letterIndex + 1}`,
        }));

        questionRows.push({
          id,
          schoolId: options.schoolId,
          subjectId: subject.id,
          type,
          body: `${topic}: practice question ${n} (${subject.name}).`,
          optionsJson: type === 'NUMERIC' ? [] : options4,
          correctJson:
            type === 'MCQ'
              ? correct
              : type === 'MULTI'
                ? ['a', 'c']
                : Number((rng.int(100, 990) / 100).toFixed(2)),
          marks: type === 'NUMERIC' ? 2 : 1,
          negativeMarks: type === 'MCQ' ? 0 : 0,
          topicTag: topic,
          difficulty: rng.int(1, 5),
          explanation: `Revise ${topic} in the ${subject.name} notes.`,
          toleranceBp: type === 'NUMERIC' ? 250 : null,
        });
        bank.push({ id, marks: type === 'NUMERIC' ? 2 : 1, topicTag: topic, correct });
      }
    }
    questionsBySubject.set(subject.id, bank);
  }

  for (let index = 0; index < questionRows.length; index += 500) {
    await prisma.question.createMany({ data: questionRows.slice(index, index + 500) });
  }
  result.questions = questionRows.length;
  mark('questions');

  /*
   * Each selected section gets two quizzes: one the class has already sat, which is what
   * the analysis, the reteach list and the weakness map are built from, and one that has
   * just opened and nobody has touched.
   *
   * The second one is not padding. Without it every student in the demo has used their one
   * attempt at everything, so whoever is showing Volt cannot actually sit a quiz — and a
   * class with nothing coming up is not a class anyone recognises.
   */
  const quizSections = rng.sample(
    options.sections.filter((section) => section.studentIds.length > 0),
    Math.min(Math.ceil(options.quizzes / 2), options.sections.length),
  );

  const quizQuestionRows: Prisma.QuizQuestionCreateManyInput[] = [];
  const quizAttemptRows: Prisma.QuizAttemptCreateManyInput[] = [];
  const quizAnswerRows: Prisma.QuizAnswerCreateManyInput[] = [];
  const masteryTally = new Map<string, { schoolId: string; studentId: string; subjectId: string; topicTag: string; earned: number; possible: number; count: number }>();

  for (const [quizIndex, section] of quizSections.entries()) {
    const bank = questionsBySubject.get(section.subjectId);
    if (!bank || bank.length === 0) continue;

    const picked = rng.sample(bank, Math.min(10, bank.length));
    const openedAt = shiftDays(options.today, -(quizIndex * 3 + 2));

    const quiz = await prisma.quiz.create({
      data: {
        schoolId: options.schoolId,
        sectionId: section.id,
        createdById: section.teacherStaffId,
        title: `Topic check ${quizIndex + 1}`,
        timeLimitSeconds: 15 * 60,
        attemptsAllowed: 1,
        negativeMarking: false,
        availableFrom: openedAt,
        availableTo: shiftDays(options.today, 7),
        showAnswersAfter: true,
      },
      select: { id: true },
    });
    result.quizzes += 1;

    picked.forEach((question, order) => {
      quizQuestionRows.push({ quizId: quiz.id, questionId: question.id, order });
    });

    const fresh = await prisma.quiz.create({
      data: {
        schoolId: options.schoolId,
        sectionId: section.id,
        createdById: section.teacherStaffId,
        title: `Topic check ${quizIndex + 1} — this week`,
        timeLimitSeconds: 15 * 60,
        attemptsAllowed: 1,
        negativeMarking: false,
        availableFrom: shiftDays(options.today, -1),
        availableTo: shiftDays(options.today, 6),
        showAnswersAfter: true,
      },
      select: { id: true },
    });
    result.quizzes += 1;
    rng.sample(bank, Math.min(8, bank.length)).forEach((question, order) => {
      quizQuestionRows.push({ quizId: fresh.id, questionId: question.id, order });
    });

    // Roughly three quarters of a class sits a quiz that has been open a few days.
    const sitters = rng.sample(section.studentIds, Math.round(section.studentIds.length * 0.75));
    for (const studentId of sitters) {
      const attemptId = randomUUID();
      const ability = rng.normal(0.62, 0.16, 0.15, 0.98);
      let score = 0;

      for (const question of picked) {
        const correct = rng.bool(ability);
        const marks = correct ? question.marks : 0;
        score += marks;
        quizAnswerRows.push({
          attemptId,
          questionId: question.id,
          answerJson: correct ? question.correct : 'b',
          isCorrect: correct,
          marksAwarded: marks,
          needsManualMarking: false,
        });

        const key = `${studentId}:${section.subjectId}:${question.topicTag}`;
        const tally = masteryTally.get(key) ?? {
          schoolId: options.schoolId,
          studentId,
          subjectId: section.subjectId,
          topicTag: question.topicTag,
          earned: 0,
          possible: 0,
          count: 0,
        };
        tally.earned += marks;
        tally.possible += question.marks;
        tally.count += 1;
        masteryTally.set(key, tally);
      }

      quizAttemptRows.push({
        id: attemptId,
        schoolId: options.schoolId,
        quizId: quiz.id,
        studentId,
        startedAt: openedAt,
        submittedAt: new Date(openedAt.getTime() + rng.int(6, 15) * 60_000),
        score,
        // A handful of high counts, so the teacher's flag list is not empty in the demo.
        tabSwitches: rng.bool(0.05) ? rng.int(5, 12) : rng.int(0, 2),
      });
    }
  }

  for (let index = 0; index < quizQuestionRows.length; index += 1000) {
    await prisma.quizQuestion.createMany({ data: quizQuestionRows.slice(index, index + 1000) });
  }
  for (let index = 0; index < quizAttemptRows.length; index += 1000) {
    await prisma.quizAttempt.createMany({ data: quizAttemptRows.slice(index, index + 1000) });
  }
  for (let index = 0; index < quizAnswerRows.length; index += 2000) {
    await prisma.quizAnswer.createMany({ data: quizAnswerRows.slice(index, index + 2000) });
  }
  result.quizAttempts = quizAttemptRows.length;
  mark('quizzes');

  const masteryRows: Prisma.TopicMasteryCreateManyInput[] = [...masteryTally.values()].map((tally) => ({
    schoolId: tally.schoolId,
    studentId: tally.studentId,
    subjectId: tally.subjectId,
    topicTag: tally.topicTag,
    score: Math.round((tally.earned / Math.max(1, tally.possible)) * 10_000),
    sampleSize: tally.count,
  }));
  for (let index = 0; index < masteryRows.length; index += 2000) {
    await prisma.topicMastery.createMany({ data: masteryRows.slice(index, index + 2000) });
  }
  result.masteryRows = masteryRows.length;
  mark('mastery');

  // -------------------------------------------------------------------------
  // Resources, assignments and doubts — enough per section that the screens
  // have content without the seed becoming a second dataset.
  // -------------------------------------------------------------------------
  const resourceRows: Prisma.ResourceCreateManyInput[] = [];
  const RESOURCE_KINDS = [
    { type: 'NOTES' as const, suffix: 'notes.pdf', mime: 'application/pdf' },
    { type: 'SLIDES' as const, suffix: 'slides.pdf', mime: 'application/pdf' },
    { type: 'WORKSHEET' as const, suffix: 'worksheet.pdf', mime: 'application/pdf' },
  ];

  const seenSubjectTeacher = new Set<string>();
  for (const section of options.sections) {
    const key = `${section.subjectId}:${section.teacherStaffId}`;
    if (seenSubjectTeacher.has(key)) continue;
    seenSubjectTeacher.add(key);

    for (const topic of rng.sample(topicsFor(section.subjectCode), 3)) {
      const kind = rng.pick(RESOURCE_KINDS);
      resourceRows.push({
        schoolId: options.schoolId,
        subjectId: section.subjectId,
        uploadedById: section.teacherStaffId,
        title: `${topic} — ${kind.type.toLowerCase()}`,
        type: kind.type,
        fileUrl: `${options.schoolId}/resources/${section.subjectCode}_${topic.replace(/\s+/g, '_').toLowerCase()}_${kind.suffix}`,
        fileSize: rng.int(180_000, 4_000_000),
        mime: kind.mime,
        topicTags: [topic],
        visibility: 'MY_SECTIONS',
        downloadCount: rng.int(0, 60),
        version: 1,
      });
    }
  }
  for (let index = 0; index < resourceRows.length; index += 500) {
    await prisma.resource.createMany({ data: resourceRows.slice(index, index + 500) });
  }
  result.resources = resourceRows.length;
  mark('resources');

  const assignmentRows: Prisma.AssignmentCreateManyInput[] = [];
  const assignmentIndex: { id: string; studentIds: string[]; dueAt: Date; totalMarks: number }[] = [];

  for (const section of options.sections) {
    if (section.studentIds.length === 0) continue;
    for (let n = 0; n < 2; n += 1) {
      const id = randomUUID();
      // One overdue and one still open, so both the missing-work list and the
      // student's "due this week" list have rows.
      const dueAt = shiftDays(options.today, n === 0 ? -rng.int(3, 12) : rng.int(2, 9));
      const totalMarks = rng.pick([10, 20, 25, 40]);
      assignmentRows.push({
        id,
        schoolId: options.schoolId,
        sectionId: section.id,
        createdById: section.teacherStaffId,
        title: n === 0 ? 'Past paper write-up' : 'Topic questions',
        brief:
          n === 0
            ? 'Attempt the attached paper under timed conditions, then upload your marked script.'
            : 'Answer the questions on the attached worksheet. Show your working.',
        dueAt,
        totalMarks,
        allowLate: true,
        isPublished: true,
      });
      assignmentIndex.push({ id, studentIds: section.studentIds, dueAt, totalMarks });
    }
  }
  for (let index = 0; index < assignmentRows.length; index += 500) {
    await prisma.assignment.createMany({ data: assignmentRows.slice(index, index + 500) });
  }
  result.assignments = assignmentRows.length;
  mark('assignments');

  const submissionRows: Prisma.SubmissionCreateManyInput[] = [];
  for (const assignment of assignmentIndex) {
    const isOverdue = assignment.dueAt.getTime() < shiftDays(options.today, 0).getTime();
    if (!isOverdue) continue;
    // Most hand in, some late, a few not at all — the missing list needs names on it.
    for (const studentId of assignment.studentIds) {
      if (rng.bool(0.12)) continue;
      const late = rng.bool(0.15);
      const submittedAt = new Date(
        assignment.dueAt.getTime() + (late ? rng.int(1, 48) * 3_600_000 : -rng.int(1, 72) * 3_600_000),
      );
      const graded = rng.bool(0.6);
      submissionRows.push({
        schoolId: options.schoolId,
        assignmentId: assignment.id,
        studentId,
        submittedAt,
        filesJson: [],
        textBody: 'Submitted through Volt.',
        isLate: late,
        marks: graded ? Math.round(assignment.totalMarks * rng.normal(0.68, 0.16, 0.2, 1)) : null,
        feedback: graded ? 'Good working. Watch your units in the last part.' : null,
      });
    }
  }
  for (let index = 0; index < submissionRows.length; index += 2000) {
    await prisma.submission.createMany({ data: submissionRows.slice(index, index + 2000) });
  }
  result.submissions = submissionRows.length;
  mark('submissions');

  const doubtRows: Prisma.DoubtThreadCreateManyInput[] = [];
  for (const section of rng.sample(options.sections, Math.min(30, options.sections.length))) {
    if (section.studentIds.length === 0) continue;
    const topic = rng.pick(topicsFor(section.subjectCode));
    doubtRows.push({
      schoolId: options.schoolId,
      subjectId: section.subjectId,
      studentId: rng.pick(section.studentIds),
      title: `Stuck on ${topic}`,
      body: `I do not follow the worked example in ${topic}. Could you explain the second step?`,
      isResolved: rng.bool(0.4),
    });
  }
  await prisma.doubtThread.createMany({ data: doubtRows });
  result.doubts = doubtRows.length;

  return result;
}
