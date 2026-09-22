import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@/lib/permissions';
import {
  createAssessmentsForSubject,
  createExamSeries,
  listExamSeries,
} from '@/lib/services/exams/series';
import {
  getMarksGrid,
  moderateMarks,
  parsePastedColumn,
  saveMarks,
} from '@/lib/services/exams/marks';
import { publishExamSeries, unpublishExamSeries } from '@/lib/services/exams/publish';
import {
  getGradeDrops,
  getSectionPerformance,
  getStudentResults,
} from '@/lib/services/exams/results';
import { renderStudentResultCard, renderYearGroupResultCards } from '@/lib/services/exams/result-cards';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';
import type { Actor } from '@/lib/permissions';

let schoolId: string;
let admin: Actor;
let hod: Actor;
let teacher: Actor;
let student: Actor;
let otherStudentId: string;

/** The series the seed leaves unpublished, which is what the demo publishes live. */
let mocksSeriesId: string;
let publishedSeriesId: string;

/** Everything this suite creates is named so a previous run's leftovers can be removed. */
const TEST_SERIES_PREFIX = '[test] ';

async function removeTestSeries(actor: Actor) {
  await asActor(actor, () =>
    testPrisma.examSeries.deleteMany({ where: { name: { startsWith: TEST_SERIES_PREFIX } } }),
  );
}

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  hod = await actorByEmail(schoolId, 'emp-0001@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  const teacherEmail = await asActor(admin, async () => {
    const user = await testPrisma.user.findFirstOrThrow({
      where: {
        roles: { some: { role: 'TEACHER' }, none: { role: 'HOD' } },
        staff: { sections: { some: {} } },
      },
      select: { email: true },
    });
    return user.email!;
  });
  teacher = await actorByEmail(schoolId, teacherEmail);

  // A previous run may have died mid-test and left a series behind, dated later than the
  // seed's — which would then be picked as the one under test.
  await removeTestSeries(admin);

  await asActor(admin, async () => {
    /*
     * These tests publish a series, which changes the seeded state they started from. So
     * the precondition is restored rather than assumed: take the most recent series that
     * actually has papers in it and, if a previous run already published it, withdraw it.
     * The suite is then re-runnable without reseeding.
     */
    const candidate = await testPrisma.examSeries.findFirstOrThrow({
      // Marks, not merely papers: a series with empty papers cannot be published, and an
      // abandoned one from a previous run would otherwise be picked ahead of the seed's.
      where: { assessments: { some: { marks: { some: {} } } } },
      orderBy: { startDate: 'desc' },
      select: { id: true, isPublished: true },
    });
    if (candidate.isPublished) {
      await unpublishExamSeries(admin, candidate.id, 'Restoring the precondition for a test run');
    }
    mocksSeriesId = candidate.id;

    const published = await testPrisma.examSeries.findFirstOrThrow({
      where: { isPublished: true, assessments: { some: {} } },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });
    publishedSeriesId = published.id;

    const other = await testPrisma.student.findFirstOrThrow({
      where: { id: { not: student.studentId! } },
      select: { id: true },
    });
    otherStudentId = other.id;
  });
});

afterAll(async () => {
  await removeTestSeries(admin);
  await testPrisma.$disconnect();
});

describe('exam setup', () => {
  it('creates a series and bulk-adds one assessment per component per section', async () => {
    // Setting up a mock series by hand is ~500 rows. Nobody does that twice.
    const series = await asActor(admin, () =>
      createExamSeries(admin, {
        name: `${TEST_SERIES_PREFIX}Setup ${Date.now()}`,
        type: 'TEST',
        startDate: '2026-11-02',
        endDate: '2026-11-06',
      }),
    );

    const { subjectId, componentTotals, yearGroupId } = await asActor(admin, async () => {
      const subject = await testPrisma.subject.findFirstOrThrow({
        where: { code: '9701' },
        select: { id: true, components: { select: { id: true, code: true } } },
      });
      const section = await testPrisma.section.findFirstOrThrow({
        where: { subjectId: subject.id },
        select: { yearGroupId: true },
      });
      return {
        subjectId: subject.id,
        yearGroupId: section.yearGroupId,
        componentTotals: Object.fromEntries(
          subject.components.map((component) => [component.id, component.code === 'P1' ? 40 : 100]),
        ),
      };
    });

    const result = await asActor(admin, () =>
      createAssessmentsForSubject(admin, {
        examSeriesId: series.id,
        subjectId,
        yearGroupId,
        date: '2026-11-03',
        componentTotals,
      }),
    );

    expect(result.components).toBe(4);
    expect(result.sections).toBeGreaterThan(1);
    expect(result.created).toBe(result.sections * result.components);

    await asActor(admin, () => testPrisma.examSeries.delete({ where: { id: series.id } }));
  });

  it('refuses a teacher', async () => {
    await expect(
      asActor(teacher, () =>
        createExamSeries(teacher, {
          name: `${TEST_SERIES_PREFIX}Nope`,
          type: 'TEST',
          startDate: '2026-11-02',
          endDate: '2026-11-06',
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a series that ends before it starts', async () => {
    await expect(
      asActor(admin, () =>
        createExamSeries(admin, {
          name: `${TEST_SERIES_PREFIX}Backwards`,
          type: 'TEST',
          startDate: '2026-11-06',
          endDate: '2026-11-02',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalidDates' });
  });

  it('shows how much of each series has marks in', async () => {
    const series = await asActor(admin, () => listExamSeries(admin));
    expect(series.length).toBeGreaterThanOrEqual(3);
    for (const entry of series) {
      expect(entry.marksEntered).toBeLessThanOrEqual(entry.marksExpected);
      expect(entry.assessmentCount).toBeGreaterThan(0);
    }
  });
});

describe('the marks grid', () => {
  async function anAssessment(actor: Actor, sectionIds: readonly string[]) {
    return asActor(actor, () =>
      testPrisma.assessment.findFirstOrThrow({
        where: { examSeriesId: mocksSeriesId, sectionId: { in: [...sectionIds] } },
        select: { id: true, totalMarks: true, sectionId: true },
      }),
    );
  }

  it('lists students in roll-number order, which is how an Excel column pastes', async () => {
    const assessment = await anAssessment(admin, hod.sectionIds);
    const grid = await asActor(hod, () => getMarksGrid(hod, assessment.id));

    const rolls = grid.rows.map((row) => row.rollNumber);
    expect([...rolls].sort((a, b) => a.localeCompare(b))).toEqual(rolls);
    expect(grid.rows.length).toBeGreaterThan(5);
    expect(grid.canEnter).toBe(true);
  });

  it('shows the class statistics and grades alongside the marks', async () => {
    const assessment = await anAssessment(admin, hod.sectionIds);
    const grid = await asActor(hod, () => getMarksGrid(hod, assessment.id));

    expect(grid.statistics.mean).not.toBeNull();
    expect(grid.statistics.sat).toBeGreaterThan(0);
    expect(grid.gradingScale.bands.length).toBeGreaterThan(3);

    const graded = grid.rows.find((row) => row.grade !== null);
    expect(graded).toBeDefined();
  });

  it('refuses a student enrolled in the very section', async () => {
    // Being in the class is not permission to read the class's marks.
    const assessment = await asActor(admin, () =>
      testPrisma.assessment.findFirstOrThrow({
        where: {
          examSeriesId: mocksSeriesId,
          section: { enrolments: { some: { studentId: student.studentId! } } },
        },
        select: { id: true },
      }),
    );

    await expect(asActor(student, () => getMarksGrid(student, assessment.id))).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it('refuses a section the teacher does not teach', async () => {
    const foreign = await asActor(admin, () =>
      testPrisma.assessment.findFirstOrThrow({
        where: { examSeriesId: mocksSeriesId, sectionId: { notIn: [...teacher.sectionIds] } },
        select: { id: true },
      }),
    );
    await expect(asActor(teacher, () => getMarksGrid(teacher, foreign.id))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('rejects a mark above the paper total and a negative, without failing the rest', async () => {
    const assessment = await anAssessment(hod, hod.sectionIds);
    const grid = await asActor(hod, () => getMarksGrid(hod, assessment.id));
    const [first, second, third] = grid.rows;

    const result = await asActor(hod, () =>
      saveMarks(hod, assessment.id, {
        entries: [
          { studentId: first!.studentId, marksObtained: assessment.totalMarks, isAbsent: false },
          { studentId: second!.studentId, marksObtained: assessment.totalMarks + 1, isAbsent: false },
          { studentId: third!.studentId, marksObtained: 5, isAbsent: false },
        ],
      }),
    );

    const byStudent = Object.fromEntries(result.results.map((row) => [row.studentId, row]));
    expect(byStudent[first!.studentId]?.applied).toBe(true);
    expect(byStudent[second!.studentId]?.reason).toBe('aboveTotal');
    expect(byStudent[third!.studentId]?.applied).toBe(true);
    expect(result.saved).toBe(2);
  });

  it('stores an absence as an absence, never as a zero', async () => {
    const assessment = await anAssessment(hod, hod.sectionIds);
    const grid = await asActor(hod, () => getMarksGrid(hod, assessment.id));
    const target = grid.rows[0]!;

    await asActor(hod, () =>
      saveMarks(hod, assessment.id, {
        entries: [{ studentId: target.studentId, marksObtained: null, isAbsent: true }],
      }),
    );

    const stored = await asActor(admin, () =>
      testPrisma.mark.findFirstOrThrow({
        where: { assessmentId: assessment.id, studentId: target.studentId },
        select: { marksObtained: true, isAbsent: true },
      }),
    );

    // A zero here would drag the class average printed on every other student's card.
    expect(stored.isAbsent).toBe(true);
    expect(stored.marksObtained).toBeNull();
  });

  it('flags an outlier without refusing it', async () => {
    const assessment = await anAssessment(hod, hod.sectionIds);
    const grid = await asActor(hod, () => getMarksGrid(hod, assessment.id));

    // A tight class, then one mistyped mark.
    const entries = grid.rows.map((row, index) => ({
      studentId: row.studentId,
      marksObtained: index === 0 ? assessment.totalMarks : Math.round(assessment.totalMarks * 0.5),
      isAbsent: false,
    }));

    const result = await asActor(hod, () => saveMarks(hod, assessment.id, { entries }));
    expect(result.results.every((row) => row.applied)).toBe(true);
    expect(result.outliers.length).toBeGreaterThan(0);
    expect(result.outliers[0]?.studentId).toBe(grid.rows[0]?.studentId);
  });

  it('audits a changed mark and stays quiet on an unchanged one', async () => {
    const assessment = await anAssessment(hod, hod.sectionIds);
    const grid = await asActor(hod, () => getMarksGrid(hod, assessment.id));
    const target = grid.rows[1]!;
    const entityId = `${assessment.id}:${target.studentId}`;

    const countAudits = () =>
      asActor(admin, () => testPrisma.auditLog.count({ where: { entityType: 'Mark', entityId } }));

    await asActor(hod, () =>
      saveMarks(hod, assessment.id, {
        entries: [{ studentId: target.studentId, marksObtained: 31, isAbsent: false }],
      }),
    );
    const afterFirst = await countAudits();

    // Autosave fires constantly; re-saving the same value must not bury the real edits.
    await asActor(hod, () =>
      saveMarks(hod, assessment.id, {
        entries: [{ studentId: target.studentId, marksObtained: 31, isAbsent: false }],
      }),
    );
    expect(await countAudits()).toBe(afterFirst);

    await asActor(hod, () =>
      saveMarks(hod, assessment.id, {
        entries: [{ studentId: target.studentId, marksObtained: 32, isAbsent: false }],
      }),
    );
    expect(await countAudits()).toBe(afterFirst + 1);
  });
});

describe('pasting a column from Excel', () => {
  it('reads a plain column', () => {
    expect(parsePastedColumn('34\n28\n41').map((entry) => entry.marksObtained)).toEqual([34, 28, 41]);
  });

  it('reads the spellings a teacher types for an absence', () => {
    const parsed = parsePastedColumn('34\nA\nabs\nAbsent\n-');
    expect(parsed.map((entry) => entry.isAbsent)).toEqual([false, true, true, true, true]);
    expect(parsed.slice(1).every((entry) => entry.marksObtained === null)).toBe(true);
  });

  it('takes only the first column when a whole row is pasted', () => {
    // Copying from Excel brings tab-separated neighbours along with it.
    expect(parsePastedColumn('34\tAyesha\n28\tBilal').map((entry) => entry.marksObtained)).toEqual([
      34, 28,
    ]);
  });

  it('keeps blanks as blanks rather than zeros', () => {
    const parsed = parsePastedColumn('34\n\n41');
    expect(parsed[1]).toEqual({ marksObtained: null, isAbsent: false, raw: '' });
  });

  it('survives stray characters and decimals', () => {
    expect(parsePastedColumn(' 34 \n28.6\n"41"').map((entry) => entry.marksObtained)).toEqual([
      34, 29, 41,
    ]);
  });
});

describe('moderation', () => {
  it('retains the original mark and records the reason', async () => {
    const assessment = await asActor(admin, () =>
      testPrisma.assessment.findFirstOrThrow({
        where: { examSeriesId: mocksSeriesId, sectionId: { in: [...hod.sectionIds] } },
        select: { id: true, totalMarks: true },
      }),
    );

    const grid = await asActor(hod, () => getMarksGrid(hod, assessment.id));
    // Needs headroom below the paper total, or the "adjustment" would be the same mark.
    const target = grid.rows.find(
      (row) => !row.isAbsent && row.marksObtained !== null && row.marksObtained < assessment.totalMarks - 3,
    )!;
    expect(target).toBeDefined();
    const original = target.marksObtained!;
    const adjusted = original + 3;

    const result = await asActor(hod, () =>
      moderateMarks(hod, assessment.id, {
        adjustments: [{ studentId: target.studentId, marksObtained: adjusted }],
        reason: 'Standardised against the other section',
      }),
    );
    expect(result.moderated).toBe(1);
    expect(result.results).toEqual([{ studentId: target.studentId, applied: true }]);

    const stored = await asActor(admin, () =>
      testPrisma.mark.findFirstOrThrow({
        where: { assessmentId: assessment.id, studentId: target.studentId },
        select: { marksObtained: true, originalMarks: true, moderatedById: true },
      }),
    );
    expect(stored.marksObtained).toBe(adjusted);
    expect(stored.originalMarks).toBe(original);
    expect(stored.moderatedById).toBe(hod.staffId);

    // A second pass must not overwrite the teacher's mark with the first moderator's.
    await asActor(hod, () =>
      moderateMarks(hod, assessment.id, {
        adjustments: [{ studentId: target.studentId, marksObtained: adjusted - 1 }],
        reason: 'Second look',
      }),
    );

    // An unchanged adjustment is reported rather than silently dropped.
    const noop = await asActor(hod, () =>
      moderateMarks(hod, assessment.id, {
        adjustments: [{ studentId: target.studentId, marksObtained: adjusted - 1 }],
        reason: 'Same again',
      }),
    );
    expect(noop.results[0]).toEqual({
      studentId: target.studentId,
      applied: false,
      reason: 'unchanged',
    });
    const again = await asActor(admin, () =>
      testPrisma.mark.findFirstOrThrow({
        where: { assessmentId: assessment.id, studentId: target.studentId },
        select: { originalMarks: true },
      }),
    );
    expect(again.originalMarks).toBe(original);

    const audit = await asActor(admin, () =>
      testPrisma.auditLog.findFirstOrThrow({
        where: { action: 'marks.moderate', entityId: `${assessment.id}:${target.studentId}` },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(audit.reason).toBeTruthy();
  });

  it('refuses a teacher, who enters marks but does not moderate them', async () => {
    const assessment = await asActor(admin, () =>
      testPrisma.assessment.findFirstOrThrow({
        where: { examSeriesId: mocksSeriesId, sectionId: { in: [...teacher.sectionIds] } },
        select: { id: true },
      }),
    );

    await expect(
      asActor(teacher, () =>
        moderateMarks(teacher, assessment.id, {
          adjustments: [{ studentId: otherStudentId, marksObtained: 10 }],
          reason: 'Trying it on',
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('publication', () => {
  it('keeps marks invisible to a student until the whole series publishes', async () => {
    const before = await asActor(student, () => getStudentResults(student, student.studentId!));
    const names = before.series.map((entry) => entry.name);

    const unpublishedName = await asActor(admin, () =>
      testPrisma.examSeries
        .findFirstOrThrow({ where: { id: mocksSeriesId }, select: { name: true } })
        .then((row) => row.name),
    );

    // Staggered visibility causes complaints, so nothing from this series is readable yet.
    expect(names).not.toContain(unpublishedName);
    expect(before.series.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses to publish a series twice', async () => {
    await expect(
      asActor(admin, () => publishExamSeries(admin, publishedSeriesId)),
    ).rejects.toMatchObject({ code: 'alreadyPublished' });
  });

  it('refuses a teacher and an HOD', async () => {
    for (const actor of [teacher, hod]) {
      await expect(
        asActor(actor, () => publishExamSeries(actor, mocksSeriesId)),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('publishes the whole series at once and freezes a card per student', async () => {
    const result = await asActor(admin, () => publishExamSeries(admin, mocksSeriesId));

    expect(result.resultCards).toBeGreaterThan(1500);
    expect(result.subjectsGraded).toBeGreaterThan(result.resultCards);

    const card = await asActor(admin, () =>
      testPrisma.resultCard.findFirstOrThrow({
        where: { examSeriesId: mocksSeriesId, studentId: student.studentId! },
        select: { aggregateJson: true, publishedAt: true },
      }),
    );

    const aggregate = card.aggregateJson as {
      subjects: {
        subjectCode: string;
        grade: string | null;
        percent: number | null;
        components: { code: string; weightPercent: number }[];
        classAveragePercent: number | null;
        percentileBand: string | null;
      }[];
      attendancePercent: number | null;
    };

    expect(card.publishedAt).not.toBeNull();
    expect(aggregate.subjects.length).toBeGreaterThanOrEqual(3);

    const subject = aggregate.subjects[0]!;
    // The component breakdown is the thing every competitor gets wrong.
    expect(subject.components.length).toBeGreaterThanOrEqual(3);
    expect(subject.grade).toBeTruthy();
    expect(subject.classAveragePercent).not.toBeNull();
    // Private to the student: a band, never a rank.
    expect(subject.percentileBand).toMatch(/top|bottom/);
    expect(aggregate.attendancePercent).not.toBeNull();
  }, 120_000);

  it('makes the series visible to the student immediately afterwards', async () => {
    const after = await asActor(student, () => getStudentResults(student, student.studentId!));
    expect(after.series.length).toBeGreaterThanOrEqual(3);

    // Three series means the grade trend finally has a shape.
    const withHistory = after.trend.find((entry) => entry.points.length >= 3);
    expect(withHistory).toBeDefined();
    expect(withHistory!.points.every((point) => point.grade !== null || point.percent === null)).toBe(
      true,
    );
  });

  it('refuses to change marks once the series is published', async () => {
    const assessment = await asActor(admin, () =>
      testPrisma.assessment.findFirstOrThrow({
        where: { examSeriesId: mocksSeriesId, sectionId: { in: [...hod.sectionIds] } },
        select: { id: true },
      }),
    );

    await expect(
      asActor(hod, () =>
        saveMarks(hod, assessment.id, {
          entries: [{ studentId: student.studentId!, marksObtained: 1, isAbsent: false }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'seriesPublished' });
  });
});

describe('student analytics', () => {
  it('builds a grade trend and a component breakdown', async () => {
    const results = await asActor(student, () => getStudentResults(student, student.studentId!));

    expect(results.trend.length).toBeGreaterThanOrEqual(3);
    for (const subject of results.trend) {
      expect(subject.points.length).toBeGreaterThanOrEqual(1);
    }

    // "Which paper is dragging the grade down."
    const breakdown = results.componentBreakdown.find((entry) => entry.weakest.length > 0);
    expect(breakdown).toBeDefined();
    const [worst, second] = breakdown!.weakest;
    if (second) expect(worst!.lostPoints).toBeGreaterThanOrEqual(second.lostPoints);
  });

  it('offers a system-suggested prediction next to the teacher\'s', async () => {
    const results = await asActor(student, () => getStudentResults(student, student.studentId!));
    const predicted = results.predicted.find((entry) => entry.systemGrade !== null);

    expect(predicted).toBeDefined();
    // Clearly labelled as which is which: they are separate fields, never merged.
    expect(predicted).toHaveProperty('teacherGrade');
    expect(predicted).toHaveProperty('systemGrade');
  });

  it('never lets a student read another student\'s results', async () => {
    await expect(
      asActor(student, () => getStudentResults(student, otherStudentId)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('teacher and HOD analytics', () => {
  it('compares a section against its year group', async () => {
    const sectionId = hod.sectionIds[0]!;
    const performance = await asActor(hod, () =>
      getSectionPerformance(hod, sectionId, publishedSeriesId),
    );

    expect(performance.distribution.length).toBeGreaterThan(3);
    expect(performance.yearGroupDistribution.length).toBe(performance.distribution.length);

    const sectionEntered = performance.rates.entered;
    const yearGroupCount = performance.yearGroupDistribution.reduce((sum, b) => sum + b.count, 0);
    // The year group is the larger population, which is what makes the comparison useful.
    expect(yearGroupCount).toBeGreaterThanOrEqual(sectionEntered);
    expect(performance.rates.passRate).not.toBeNull();
  });

  it('flags students who dropped two grade bands or more', async () => {
    const drops = await asActor(admin, () => getGradeDrops(admin));

    for (const drop of drops) {
      expect(drop.bandsDropped).toBeGreaterThanOrEqual(2);
      expect(drop.previousGrade).not.toBe(drop.currentGrade);
    }
    // Sorted worst-first: the list exists to be acted on from the top.
    const dropped = drops.map((entry) => entry.bandsDropped);
    expect([...dropped].sort((a, b) => b - a)).toEqual(dropped);
  });

  it('refuses a teacher the grade-drop report', async () => {
    await expect(asActor(teacher, () => getGradeDrops(teacher))).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('result card PDFs', () => {
  it('renders a student\'s card as a real PDF', async () => {
    const pdf = await asActor(student, () =>
      renderStudentResultCard(student, student.studentId!, publishedSeriesId),
    );

    expect(pdf.byteLength).toBeGreaterThan(2000);
    // A PDF starts with %PDF- and ends with %%EOF; anything else is not a file a print
    // shop can open.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('EOF');
  }, 60_000);

  it('refuses a student another student\'s card', async () => {
    await expect(
      asActor(student, () => renderStudentResultCard(student, otherStudentId, publishedSeriesId)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('merges a chunk of a year group into one file, inside the budget', async () => {
    // "< 60s for 200" is the spec's budget for bulk generation as a background job.
    const yearGroupId = await asActor(admin, () =>
      testPrisma.yearGroup
        .findFirstOrThrow({ where: { name: 'AS1' }, select: { id: true } })
        .then((row) => row.id),
    );

    const startedAt = Date.now();
    const { pdf, count } = await asActor(admin, () =>
      renderYearGroupResultCards(admin, publishedSeriesId, yearGroupId, { limit: 200 }),
    );
    const elapsedSeconds = (Date.now() - startedAt) / 1000;

    expect(count).toBe(200);
    expect(elapsedSeconds).toBeLessThan(60);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // One page per student, so two hundred cards is a substantial file.
    expect(pdf.byteLength).toBeGreaterThan(100_000);
  }, 120_000);

  it('refuses a teacher the bulk generation', async () => {
    const yearGroupId = await asActor(admin, () =>
      testPrisma.yearGroup.findFirstOrThrow({ select: { id: true } }).then((row) => row.id),
    );
    await expect(
      asActor(teacher, () => renderYearGroupResultCards(teacher, publishedSeriesId, yearGroupId)),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('unpublishing', () => {
  it('withdraws the cards and is recorded loudly', async () => {
    const series = await asActor(admin, () =>
      createExamSeries(admin, {
        name: `${TEST_SERIES_PREFIX}Withdrawable ${Date.now()}`,
        type: 'TEST',
        startDate: '2026-11-10',
        endDate: '2026-11-11',
      }),
    );

    const { subjectId, componentTotals } = await asActor(admin, async () => {
      const subject = await testPrisma.subject.findFirstOrThrow({
        where: { code: '9093' },
        select: { id: true, components: { select: { id: true } } },
      });
      return {
        subjectId: subject.id,
        componentTotals: Object.fromEntries(
          subject.components.map((component) => [component.id, 100]),
        ),
      };
    });

    await asActor(admin, () =>
      createAssessmentsForSubject(admin, {
        examSeriesId: series.id,
        subjectId,
        date: '2026-11-10',
        componentTotals,
      }),
    );

    const assessment = await asActor(admin, () =>
      testPrisma.assessment.findFirstOrThrow({
        where: { examSeriesId: series.id },
        select: { id: true, section: { select: { enrolments: { take: 2, select: { studentId: true } } } } },
      }),
    );

    await asActor(admin, () =>
      saveMarks(admin, assessment.id, {
        entries: assessment.section.enrolments.map((entry) => ({
          studentId: entry.studentId,
          marksObtained: 70,
          isAbsent: false,
        })),
      }),
    );

    await asActor(admin, () => publishExamSeries(admin, series.id));
    expect(
      await asActor(admin, () => testPrisma.resultCard.count({ where: { examSeriesId: series.id } })),
    ).toBeGreaterThan(0);

    await asActor(admin, () => unpublishExamSeries(admin, series.id, 'Paper total was wrong'));

    expect(
      await asActor(admin, () => testPrisma.resultCard.count({ where: { examSeriesId: series.id } })),
    ).toBe(0);

    const audit = await asActor(admin, () =>
      testPrisma.auditLog.findFirstOrThrow({
        where: { action: 'exam.series.unpublish', entityId: series.id },
      }),
    );
    expect(audit.reason).toBe('Paper total was wrong');

    await asActor(admin, () => testPrisma.examSeries.delete({ where: { id: series.id } }));
  }, 120_000);
});
