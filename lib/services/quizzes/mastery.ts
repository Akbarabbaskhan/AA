import { prisma } from '@/lib/db';
import type { MarkedAnswer, QuestionSpec } from './marking';

/**
 * Topic mastery — the number behind the weakness map.
 *
 * Deliberately a rolling average rather than a lifetime one. A student who bombed
 * electrolysis in September and has since fixed it should not still be told electrolysis is
 * their weakness in March; a mastery score that never moves is a score nobody trusts.
 *
 * Scores are basis points (0–10000) so they stay integers all the way to the chart.
 */

export const MASTERY_SCALE = 10_000;

/**
 * Weight of the newest evidence against everything before it.
 *
 * 0.3 means roughly the last ten attempts dominate — fast enough to reward a student who
 * has just worked at a topic, slow enough that one careless question does not flip a
 * strength into a weakness.
 */
export const RECENCY_WEIGHT = 0.3;

/** Below this many marked questions the score is shown as provisional, not as a verdict. */
export const CONFIDENT_SAMPLE = 8;

export function blendMastery(previous: number | null, batchScoreBp: number): number {
  if (previous === null) return Math.round(batchScoreBp);
  return Math.round(previous * (1 - RECENCY_WEIGHT) + batchScoreBp * RECENCY_WEIGHT);
}

type TopicTally = { earned: number; possible: number; counted: number };

/**
 * Folds a marked attempt into the student's mastery rows.
 *
 * Only auto-marked questions count. A short answer sitting in the teacher's queue has no
 * verdict yet, and treating "not marked" as "wrong" would tell a student they are weak at a
 * topic nobody has looked at. Questions with no topic tag are skipped entirely — an
 * untagged question teaches the weakness map nothing.
 *
 * Negative marking is excluded from mastery on purpose: mastery answers "how much of this
 * topic do you know", and a guessing penalty is a scoring rule, not knowledge.
 */
export async function recordQuizMastery(
  schoolId: string,
  studentId: string,
  subjectId: string,
  specs: readonly QuestionSpec[],
  marked: ReadonlyMap<string, MarkedAnswer>,
  context: { topicOf: ReadonlyMap<string, string | null> },
): Promise<void> {
  const byTopic = new Map<string, TopicTally>();
  for (const spec of specs) {
    const topic = context.topicOf.get(spec.id);
    if (!topic) continue;
    const result = marked.get(spec.id);
    if (!result || result.needsManualMarking) continue;
    const tally = byTopic.get(topic) ?? { earned: 0, possible: 0, counted: 0 };
    tally.earned += result.isCorrect ? spec.marks : 0;
    tally.possible += spec.marks;
    tally.counted += 1;
    byTopic.set(topic, tally);
  }
  if (byTopic.size === 0) return;

  const topics = [...byTopic.keys()];
  const existing = await prisma.topicMastery.findMany({
    where: { studentId, subjectId, topicTag: { in: topics } },
    select: { topicTag: true, score: true, sampleSize: true },
  });
  const previous = new Map(existing.map((row) => [row.topicTag, row]));

  for (const [topicTag, tally] of byTopic) {
    if (tally.possible === 0) continue;
    const batch = (tally.earned / tally.possible) * MASTERY_SCALE;
    const before = previous.get(topicTag);
    const score = blendMastery(before?.score ?? null, batch);
    const sampleSize = (before?.sampleSize ?? 0) + tally.counted;

    await prisma.topicMastery.upsert({
      where: { studentId_subjectId_topicTag: { studentId, subjectId, topicTag } },
      create: { schoolId, studentId, subjectId, topicTag, score, sampleSize },
      update: { score, sampleSize },
    });
  }
}

export type MasteryTopic = {
  topicTag: string;
  subjectId: string;
  subjectName: string;
  /** 0–100, rounded, for display. */
  percent: number;
  sampleSize: number;
  /** False while the sample is too small to call a weakness. */
  isConfident: boolean;
};

export type WeaknessMap = {
  subjects: {
    subjectId: string;
    subjectName: string;
    topics: MasteryTopic[];
  }[];
  /** The confident low scorers, across subjects, weakest first. */
  weakest: MasteryTopic[];
};

/**
 * The student's weakness map.
 *
 * Ordered weakest first within each subject, because the whole point is "what should I
 * revise tonight" — and a list sorted by topic code answers a different question.
 */
export async function getWeaknessMap(studentId: string, limit = 5): Promise<WeaknessMap> {
  const rows = await prisma.topicMastery.findMany({
    where: { studentId },
    orderBy: [{ subjectId: 'asc' }, { score: 'asc' }],
    select: {
      topicTag: true,
      score: true,
      sampleSize: true,
      subjectId: true,
      subject: { select: { name: true } },
    },
  });

  const bySubject = new Map<string, { subjectId: string; subjectName: string; topics: MasteryTopic[] }>();
  for (const row of rows) {
    const topic: MasteryTopic = {
      topicTag: row.topicTag,
      subjectId: row.subjectId,
      subjectName: row.subject.name,
      percent: Math.round((row.score / MASTERY_SCALE) * 100),
      sampleSize: row.sampleSize,
      isConfident: row.sampleSize >= CONFIDENT_SAMPLE,
    };
    const bucket = bySubject.get(row.subjectId) ?? {
      subjectId: row.subjectId,
      subjectName: row.subject.name,
      topics: [],
    };
    bucket.topics.push(topic);
    bySubject.set(row.subjectId, bucket);
  }

  const weakest = [...bySubject.values()]
    .flatMap((subject) => subject.topics)
    .filter((topic) => topic.isConfident)
    .sort((a, b) => a.percent - b.percent)
    .slice(0, limit);

  return { subjects: [...bySubject.values()], weakest };
}

/**
 * Class-level topic mastery for a teacher: which topic to reteach on Monday.
 *
 * Averaged across the students who have evidence for that topic, not across the whole
 * class — dividing by students who never sat the question would make every topic look weak
 * in proportion to how recently it was set.
 */
export type SectionTopicMastery = {
  topicTag: string;
  averagePercent: number;
  studentsWithEvidence: number;
  studentsBelowHalf: number;
};

export async function getSectionTopicMastery(
  sectionId: string,
  subjectId: string,
): Promise<SectionTopicMastery[]> {
  const enrolments = await prisma.enrolment.findMany({
    where: { sectionId, droppedAt: null },
    select: { studentId: true },
  });
  const studentIds = enrolments.map((enrolment) => enrolment.studentId);
  if (studentIds.length === 0) return [];

  const rows = await prisma.topicMastery.findMany({
    where: { subjectId, studentId: { in: studentIds } },
    select: { topicTag: true, score: true },
  });

  const byTopic = new Map<string, { total: number; count: number; belowHalf: number }>();
  for (const row of rows) {
    const bucket = byTopic.get(row.topicTag) ?? { total: 0, count: 0, belowHalf: 0 };
    bucket.total += row.score;
    bucket.count += 1;
    if (row.score < MASTERY_SCALE / 2) bucket.belowHalf += 1;
    byTopic.set(row.topicTag, bucket);
  }

  return [...byTopic.entries()]
    .map(([topicTag, bucket]) => ({
      topicTag,
      averagePercent: Math.round((bucket.total / bucket.count / MASTERY_SCALE) * 100),
      studentsWithEvidence: bucket.count,
      studentsBelowHalf: bucket.belowHalf,
    }))
    .sort((a, b) => a.averagePercent - b.averagePercent);
}
