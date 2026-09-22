import { randomUUID } from 'node:crypto';
import type { ExamSeriesType, Prisma, PrismaClient } from '@prisma/client';
import type { Rng } from './random';
import { SUBJECTS } from './curriculum';

/**
 * Three completed exam series with marks for every enrolled student.
 *
 * "Distributed to produce a realistic grade curve rather than a uniform spread." A uniform
 * spread makes the distribution charts look broken and the predicted grades meaningless,
 * and a demo of the analytics is the point of having this data at all.
 *
 * The series also improve slightly over time for most students, so the grade-trend chart —
 * the screenshot students send each other — actually has a trend in it.
 */

export type ExamSeedSection = {
  id: string;
  subjectCode: string;
  studentIds: string[];
};

export type ExamSeedOptions = {
  schoolId: string;
  academicYearId: string;
  /** Component id lookup: `${subjectCode}:${componentCode}`. */
  componentIds: Map<string, { id: string; weightPercent: number }>;
  sections: readonly ExamSeedSection[];
  /** `YYYY-MM-DD`, oldest first. */
  seriesDates: { name: string; type: ExamSeriesType; date: string }[];
  defaultScaleBands: { grade: string; minPercent: number }[];
};

export type ExamSeedResult = {
  series: number;
  assessments: number;
  marks: number;
  meanPercent: number;
};

/** Total marks a component is out of, by its code. Real CAIE paper sizes. */
const COMPONENT_TOTALS: Record<string, number> = {
  P1: 40,
  P2: 60,
  P3: 75,
  P4: 100,
  P5: 30,
};

function totalFor(code: string): number {
  return COMPONENT_TOTALS[code] ?? 100;
}

export async function seedExams(
  prisma: PrismaClient,
  rng: Rng,
  options: ExamSeedOptions,
): Promise<ExamSeedResult> {
  /*
   * Each student gets a latent ability, and each paper a difficulty. A mark is ability plus
   * paper noise, which produces the long-tailed curve a real cohort has rather than the
   * flat band that uniform randomness gives.
   */
  const ability = new Map<string, number>();
  for (const section of options.sections) {
    for (const studentId of section.studentIds) {
      if (!ability.has(studentId)) {
        ability.set(studentId, rng.normal(62, 14, 20, 98));
      }
    }
  }

  let assessmentCount = 0;
  let markCount = 0;
  let markTotal = 0;

  for (const [seriesIndex, definition] of options.seriesDates.entries()) {
    const series = await prisma.examSeries.create({
      data: {
        schoolId: options.schoolId,
        academicYearId: options.academicYearId,
        name: definition.name,
        type: definition.type,
        startDate: new Date(`${definition.date}T00:00:00.000Z`),
        endDate: new Date(`${definition.date}T00:00:00.000Z`),
        isPublished: false,
      },
    });

    const assessments: Prisma.AssessmentCreateManyInput[] = [];
    // sectionId + componentCode -> assessment id, so marks can be attached below.
    const assessmentIds = new Map<string, string>();

    for (const section of options.sections) {
      const subject = SUBJECTS.find((entry) => entry.code === section.subjectCode);
      if (!subject) continue;

      for (const component of subject.components) {
        const key = `${subject.code}:${component.code}`;
        const componentMeta = options.componentIds.get(key);
        if (!componentMeta) continue;

        const id = randomUUID();
        assessmentIds.set(`${section.id}:${component.code}`, id);

        assessments.push({
          id,
          schoolId: options.schoolId,
          academicYearId: options.academicYearId,
          examSeriesId: series.id,
          sectionId: section.id,
          subjectComponentId: componentMeta.id,
          title: `${component.code} ${component.name}`,
          date: new Date(`${definition.date}T00:00:00.000Z`),
          totalMarks: totalFor(component.code),
          weightPercent: componentMeta.weightPercent,
        });
      }
    }

    for (let index = 0; index < assessments.length; index += 2000) {
      await prisma.assessment.createMany({ data: assessments.slice(index, index + 2000) });
    }
    assessmentCount += assessments.length;

    // Marks. Accumulated across sections and flushed on a row budget: one createMany per
    // section is ~650 round trips of a hundred rows each, which is what pushed the seed
    // past its 60-second budget.
    const pending: MarkRow[] = [];

    for (const section of options.sections) {
      const subject = SUBJECTS.find((entry) => entry.code === section.subjectCode);
      if (!subject) continue;

      const rows: MarkRow[] = [];

      for (const component of subject.components) {
        const assessmentId = assessmentIds.get(`${section.id}:${component.code}`);
        if (!assessmentId) continue;

        const total = totalFor(component.code);
        // Papers differ in difficulty, and the same paper is equally hard for everyone.
        const paperDifficulty = rng.normal(0, 6, -12, 12);

        for (const studentId of section.studentIds) {
          // A small share of students miss a paper. They are marked absent, never zero.
          if (rng.bool(0.02)) {
            rows.push({ assessmentId, studentId, marksObtained: null, isAbsent: true });
            markCount += 1;
            continue;
          }

          const base = ability.get(studentId) ?? 60;
          // Most students improve a little across the year; some drift the other way,
          // which is what the "dropped two bands" report exists to catch.
          const drift = seriesIndex * rng.normal(2.2, 2.6, -6, 8);
          const percent = Math.max(
            2,
            Math.min(100, base + drift - paperDifficulty + rng.normal(0, 7, -20, 20)),
          );

          const marks = Math.round((percent / 100) * total);
          rows.push({ assessmentId, studentId, marksObtained: marks, isAbsent: false });

          markCount += 1;
          markTotal += (marks / total) * 100;
        }
      }

      pending.push(...rows);
      if (pending.length >= FLUSH_EVERY_ROWS) {
        await flushMarks(prisma, options, definition.date, pending);
        pending.length = 0;
      }
    }

    await flushMarks(prisma, options, definition.date, pending);
  }

  return {
    series: options.seriesDates.length,
    assessments: assessmentCount,
    marks: markCount,
    meanPercent: markCount === 0 ? 0 : markTotal / markCount,
  };
}

type MarkRow = {
  assessmentId: string;
  studentId: string;
  marksObtained: number | null;
  isAbsent: boolean;
};

const FLUSH_EVERY_ROWS = 25_000;

/**
 * One statement per batch with array parameters, rather than `createMany` sending every
 * column of every row. `id` and `updated_at` are supplied explicitly because Prisma
 * generates both client-side and neither column has a database default.
 */
async function flushMarks(
  prisma: PrismaClient,
  options: ExamSeedOptions,
  date: string,
  rows: readonly MarkRow[],
): Promise<void> {
  if (rows.length === 0) return;

  for (let index = 0; index < rows.length; index += FLUSH_EVERY_ROWS) {
    const batch = rows.slice(index, index + FLUSH_EVERY_ROWS);
    await prisma.$executeRaw`
      INSERT INTO marks
        (id, school_id, academic_year_id, assessment_id, student_id,
         marks_obtained, is_absent, entered_at, created_at, updated_at)
      SELECT
        gen_random_uuid()::text, ${options.schoolId}, ${options.academicYearId},
        t.assessment_id, t.student_id, t.marks_obtained, t.is_absent,
        ${new Date(`${date}T12:00:00.000Z`)}, now(), now()
      FROM unnest(
        ${batch.map((row) => row.assessmentId)}::text[],
        ${batch.map((row) => row.studentId)}::text[],
        ${batch.map((row) => row.marksObtained)}::int[],
        ${batch.map((row) => row.isAbsent)}::boolean[]
      ) AS t(assessment_id, student_id, marks_obtained, is_absent)
    `;
  }
}
