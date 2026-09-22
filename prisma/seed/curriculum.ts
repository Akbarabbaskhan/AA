/**
 * The A Level curriculum the demo tenant runs, and the option blocks that make its
 * timetable solvable.
 *
 * Option blocks are how real A Level colleges avoid student-cohort clashes: every subject
 * sits in exactly one block, a student takes at most one subject per block, and all
 * sections of a block run at the same time. Generating the seed this way means the
 * clash-free timetable is a property of the structure rather than something the seed has
 * to search for.
 */
export type ComponentSpec = { code: string; name: string; weightPercent: number };

export type SubjectSpec = {
  code: string;
  name: string;
  department: string;
  /** A, B, C or D. */
  block: string;
  components: ComponentSpec[];
};

export const DEPARTMENTS = [
  'Sciences',
  'Mathematics',
  'Business and Economics',
  'Humanities',
  'English',
  'Computing',
] as const;

export const SUBJECTS: readonly SubjectSpec[] = [
  {
    code: '9701',
    name: 'Chemistry',
    department: 'Sciences',
    block: 'A',
    // The spec's worked example: P1 15, P2 23, P4 38, P5 23. These sum to 99, not 100 —
    // real CAIE weights are 15.5/23.1/38.5/23.1 — so the grading service normalises by the
    // sum of the component weights rather than assuming a total of 100.
    components: [
      { code: 'P1', name: 'Multiple Choice', weightPercent: 15 },
      { code: 'P2', name: 'AS Structured Questions', weightPercent: 23 },
      { code: 'P4', name: 'A Level Structured Questions', weightPercent: 38 },
      { code: 'P5', name: 'Planning, Analysis and Evaluation', weightPercent: 23 },
    ],
  },
  {
    code: '9702',
    name: 'Physics',
    department: 'Sciences',
    block: 'B',
    components: [
      { code: 'P1', name: 'Multiple Choice', weightPercent: 15 },
      { code: 'P2', name: 'AS Structured Questions', weightPercent: 23 },
      { code: 'P4', name: 'A Level Structured Questions', weightPercent: 38 },
      { code: 'P5', name: 'Planning, Analysis and Evaluation', weightPercent: 23 },
    ],
  },
  {
    code: '9700',
    name: 'Biology',
    department: 'Sciences',
    block: 'C',
    components: [
      { code: 'P1', name: 'Multiple Choice', weightPercent: 15 },
      { code: 'P2', name: 'AS Structured Questions', weightPercent: 23 },
      { code: 'P4', name: 'A Level Structured Questions', weightPercent: 38 },
      { code: 'P5', name: 'Planning, Analysis and Evaluation', weightPercent: 23 },
    ],
  },
  {
    code: '9709',
    name: 'Mathematics',
    department: 'Mathematics',
    block: 'D',
    components: [
      { code: 'P1', name: 'Pure Mathematics 1', weightPercent: 30 },
      { code: 'P3', name: 'Pure Mathematics 3', weightPercent: 30 },
      { code: 'P4', name: 'Mechanics', weightPercent: 20 },
      { code: 'P5', name: 'Probability and Statistics 1', weightPercent: 20 },
    ],
  },
  {
    code: '9231',
    name: 'Further Mathematics',
    department: 'Mathematics',
    block: 'C',
    components: [
      { code: 'P1', name: 'Further Pure Mathematics 1', weightPercent: 30 },
      { code: 'P2', name: 'Further Pure Mathematics 2', weightPercent: 30 },
      { code: 'P3', name: 'Further Mechanics', weightPercent: 20 },
      { code: 'P4', name: 'Further Probability and Statistics', weightPercent: 20 },
    ],
  },
  {
    code: '9708',
    name: 'Economics',
    department: 'Business and Economics',
    block: 'A',
    components: [
      { code: 'P1', name: 'Multiple Choice', weightPercent: 15 },
      { code: 'P2', name: 'Data Response and Essays (AS)', weightPercent: 35 },
      { code: 'P3', name: 'Multiple Choice (A Level)', weightPercent: 15 },
      { code: 'P4', name: 'Data Response and Essays (A Level)', weightPercent: 35 },
    ],
  },
  {
    code: '9609',
    name: 'Business',
    department: 'Business and Economics',
    block: 'B',
    components: [
      { code: 'P1', name: 'Short Answer and Essay', weightPercent: 25 },
      { code: 'P2', name: 'Data Response', weightPercent: 25 },
      { code: 'P3', name: 'Case Study', weightPercent: 50 },
    ],
  },
  {
    code: '9706',
    name: 'Accounting',
    department: 'Business and Economics',
    block: 'C',
    components: [
      { code: 'P1', name: 'Multiple Choice and Structured', weightPercent: 30 },
      { code: 'P2', name: 'Structured Questions (AS)', weightPercent: 35 },
      { code: 'P3', name: 'Structured Questions (A Level)', weightPercent: 35 },
    ],
  },
  {
    code: '9990',
    name: 'Psychology',
    department: 'Humanities',
    block: 'A',
    components: [
      { code: 'P1', name: 'Approaches, Issues and Debates', weightPercent: 30 },
      { code: 'P2', name: 'Research Methods', weightPercent: 30 },
      { code: 'P3', name: 'Specialist Options 1', weightPercent: 20 },
      { code: 'P4', name: 'Specialist Options 2', weightPercent: 20 },
    ],
  },
  {
    code: '9699',
    name: 'Sociology',
    department: 'Humanities',
    block: 'B',
    components: [
      { code: 'P1', name: 'Socialisation and Identity', weightPercent: 33 },
      { code: 'P2', name: 'Methods of Research', weightPercent: 33 },
      { code: 'P3', name: 'Social Inequality', weightPercent: 34 },
    ],
  },
  {
    code: '9093',
    name: 'English Language',
    department: 'English',
    block: 'C',
    components: [
      { code: 'P1', name: 'Reading', weightPercent: 25 },
      { code: 'P2', name: 'Writing', weightPercent: 25 },
      { code: 'P3', name: 'Language Analysis', weightPercent: 25 },
      { code: 'P4', name: 'Language Topics', weightPercent: 25 },
    ],
  },
  {
    code: '9618',
    name: 'Computer Science',
    department: 'Computing',
    block: 'A',
    components: [
      { code: 'P1', name: 'Theory Fundamentals', weightPercent: 25 },
      { code: 'P2', name: 'Fundamental Problem-solving', weightPercent: 25 },
      { code: 'P3', name: 'Advanced Theory', weightPercent: 25 },
      { code: 'P4', name: 'Practical', weightPercent: 25 },
    ],
  },
];

export const BLOCKS = ['A', 'B', 'C', 'D'] as const;

/**
 * Real A Level combinations, each taking at most one subject per block — which is what
 * keeps the generated timetable free of student-cohort clashes.
 */
export const COMBINATIONS: readonly { label: string; subjects: string[]; weight: number }[] = [
  { label: 'Pre-medical', subjects: ['9701', '9702', '9700'], weight: 20 },
  { label: 'Pre-medical with Maths', subjects: ['9701', '9700', '9709'], weight: 8 },
  { label: 'Pre-engineering', subjects: ['9701', '9702', '9709'], weight: 18 },
  { label: 'Pre-engineering with Further Maths', subjects: ['9701', '9702', '9709', '9231'], weight: 7 },
  { label: 'Computing', subjects: ['9702', '9709', '9618'], weight: 9 },
  { label: 'Business', subjects: ['9708', '9609', '9706'], weight: 14 },
  { label: 'Business with Maths', subjects: ['9708', '9609', '9709'], weight: 8 },
  { label: 'Economics and Accounting', subjects: ['9708', '9609', '9709', '9706'], weight: 4 },
  { label: 'Humanities', subjects: ['9990', '9699', '9093'], weight: 8 },
  { label: 'Social sciences with Business', subjects: ['9990', '9609', '9093'], weight: 4 },
];

/**
 * The invariant that makes the whole scheme work: a student never takes two subjects from
 * the same option block, because all sections of a block run at the same time.
 *
 * Getting this wrong produces a timetable that looks fine on the teacher and room axes and
 * is broken on the student-cohort axis — which is exactly the failure this product exists
 * to prevent, so it is asserted rather than assumed.
 */
export function combinationBlockConflicts(): {
  combination: string;
  block: string;
  subjects: string[];
}[] {
  const blockOf = new Map(SUBJECTS.map((subject) => [subject.code, subject.block]));
  const conflicts: { combination: string; block: string; subjects: string[] }[] = [];

  for (const combination of COMBINATIONS) {
    const byBlock = new Map<string, string[]>();
    for (const code of combination.subjects) {
      const block = blockOf.get(code);
      if (!block) throw new Error(`Combination "${combination.label}" names unknown subject ${code}`);
      byBlock.set(block, [...(byBlock.get(block) ?? []), code]);
    }
    for (const [block, codes] of byBlock) {
      if (codes.length > 1) {
        conflicts.push({ combination: combination.label, block, subjects: codes });
      }
    }
  }

  return conflicts;
}

/** The bell schedule: 8 periods, 6-day week. */
export const PERIODS = [
  { index: 1, label: 'Period 1', startTime: '08:00', endTime: '08:45' },
  { index: 2, label: 'Period 2', startTime: '08:45', endTime: '09:30' },
  { index: 3, label: 'Period 3', startTime: '09:30', endTime: '10:15' },
  { index: 4, label: 'Period 4', startTime: '10:35', endTime: '11:20' },
  { index: 5, label: 'Period 5', startTime: '11:20', endTime: '12:05' },
  { index: 6, label: 'Period 6', startTime: '12:05', endTime: '12:50' },
  { index: 7, label: 'Period 7', startTime: '13:20', endTime: '14:05' },
  { index: 8, label: 'Period 8', startTime: '14:05', endTime: '14:50' },
] as const;

/** Monday to Saturday. */
export const TEACHING_DAYS = [1, 2, 3, 4, 5, 6] as const;

export const PERIODS_PER_SECTION_PER_WEEK = 4;
export const SECTION_CAPACITY = 30;

/**
 * Grading scales, "all editable per school and per exam series because boundaries move
 * every session". These are the shipped defaults.
 */
export const GRADING_SCALES = [
  {
    name: 'CAIE A Level',
    board: 'CAIE',
    isDefault: true,
    bands: [
      { grade: 'A*', minPercent: 90 },
      { grade: 'A', minPercent: 80 },
      { grade: 'B', minPercent: 70 },
      { grade: 'C', minPercent: 60 },
      { grade: 'D', minPercent: 50 },
      { grade: 'E', minPercent: 40 },
      { grade: 'U', minPercent: 0 },
    ],
  },
  {
    name: 'CAIE AS Level',
    board: 'CAIE',
    isDefault: false,
    bands: [
      { grade: 'a', minPercent: 80 },
      { grade: 'b', minPercent: 70 },
      { grade: 'c', minPercent: 60 },
      { grade: 'd', minPercent: 50 },
      { grade: 'e', minPercent: 40 },
      { grade: 'u', minPercent: 0 },
    ],
  },
  {
    name: 'CAIE O Level / IGCSE',
    board: 'CAIE',
    isDefault: false,
    bands: [
      { grade: 'A*', minPercent: 90 },
      { grade: 'A', minPercent: 80 },
      { grade: 'B', minPercent: 70 },
      { grade: 'C', minPercent: 60 },
      { grade: 'D', minPercent: 50 },
      { grade: 'E', minPercent: 40 },
      { grade: 'F', minPercent: 30 },
      { grade: 'G', minPercent: 20 },
      { grade: 'U', minPercent: 0 },
    ],
  },
  {
    name: 'Edexcel IAL',
    board: 'Edexcel',
    isDefault: false,
    bands: [
      { grade: 'A*', minPercent: 90 },
      { grade: 'A', minPercent: 80 },
      { grade: 'B', minPercent: 70 },
      { grade: 'C', minPercent: 60 },
      { grade: 'D', minPercent: 50 },
      { grade: 'E', minPercent: 40 },
      { grade: 'U', minPercent: 0 },
    ],
  },
  {
    name: 'School internal',
    board: 'Internal',
    isDefault: false,
    bands: [
      { grade: 'A', minPercent: 80 },
      { grade: 'B', minPercent: 70 },
      { grade: 'C', minPercent: 60 },
      { grade: 'D', minPercent: 50 },
      { grade: 'E', minPercent: 40 },
      { grade: 'F', minPercent: 0 },
    ],
  },
];
