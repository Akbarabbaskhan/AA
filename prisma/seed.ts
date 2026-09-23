/**
 * Volt seed — a deliverable, not a convenience.
 *
 * "Most demos fail because the screens are empty, and empty screens make a principal
 * imagine work rather than relief." Running this must leave no screen in the M0 shell
 * blank, and it must finish in under 60 seconds against a real Postgres.
 *
 * Milestone scope: M0 ships the people, the academic structure and a clash-free timetable.
 * Attendance history, exam series, past papers, quizzes, societies and the fee cycle are
 * added by the milestone that builds each of them — "seed data grows with each milestone".
 *
 * Idempotent: it rebuilds the demo tenant from scratch rather than layering a second copy
 * on top, and the PRNG is seeded, so two runs produce identical data.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Gender, type Prisma, type RoleName } from '@prisma/client';
import { hashPassword } from '../lib/auth/password';
import { prisma as scopedPrisma, withTenant } from '../lib/db';
import { publishExamSeries } from '../lib/services/exams/publish';
import type { Actor } from '../lib/permissions';
import { Rng } from './seed/random';
import { seedAttendance, type SeedSection, type SeedSlot } from './seed/attendance';
import { seedExams, type ExamSeedSection } from './seed/exams';
import { seedFees, type FeeSeedOptions } from './seed/fees';
import {
  seedLearning,
  SUBJECT_TOPICS,
  type LearningSeedSection,
  type LearningSeedSubject,
} from './seed/learning';
import {
  DESIGNATIONS,
  FEMALE_FIRST_NAMES,
  GUARDIAN_RELATIONS,
  HOUSES,
  MALE_FIRST_NAMES,
  OCCUPATIONS,
  QUALIFICATIONS,
  SURNAMES,
} from './seed/names';
import {
  BLOCKS,
  COMBINATIONS,
  DEPARTMENTS,
  GRADING_SCALES,
  PERIODS,
  PERIODS_PER_SECTION_PER_WEEK,
  SECTION_CAPACITY,
  SUBJECTS,
  TEACHING_DAYS,
} from './seed/curriculum';

const prisma = new PrismaClient();
const rng = new Rng(0x0101_2026);

const TENANT_SLUG = process.env['DEFAULT_TENANT_SLUG'] ?? 'volt-demo';
const STUDENT_COUNT = Number(process.env['SEED_STUDENT_COUNT'] ?? 2000);
const STAFF_TARGET = Number(process.env['SEED_STAFF_COUNT'] ?? 150);

/**
 * Every seeded account shares one password, hashed once.
 *
 * argon2 is deliberately slow — ~50ms a hash — so hashing 6,000 accounts individually
 * would take five minutes and blow the 60-second budget. Reusing one hash is safe here
 * precisely because this is a demo tenant with a published password, and it is the only
 * place in the system where a hash is reused.
 */
const DEMO_PASSWORD = 'Volt2026!';

/** Overridable so a test can pin the seed to a fixed day. */
const TODAY = process.env['SEED_TODAY']
  ? new Date(`${process.env['SEED_TODAY']}T00:00:00.000Z`)
  : new Date();

const ATTENDANCE_DAY_CAP = Number(process.env['SEED_ATTENDANCE_DAYS'] ?? 180);

const YEAR_GROUPS = [
  { name: 'AS1', order: 1 },
  { name: 'A2', order: 2 },
];

type StudentPlan = {
  userId: string;
  studentId: string;
  name: string;
  gender: Gender;
  yearGroup: string;
  subjects: string[];
  rollNumber: string;
  admissionNumber: string;
  house: string;
  phone: string;
};

function pickName(gender: Gender): string {
  const first = rng.pick(gender === 'FEMALE' ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
  return `${first} ${rng.pick(SURNAMES)}`;
}

function weightedCombination(): readonly string[] {
  const total = COMBINATIONS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  for (const entry of COMBINATIONS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.subjects;
  }
  return COMBINATIONS[0]!.subjects;
}

/** +92 3XX XXXXXXX, unique per account. */
function phoneFor(serial: number): string {
  const network = 300 + (serial % 50);
  return `+92${network}${String(1_000_000 + serial).slice(-7)}`;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log(`Seeding tenant "${TENANT_SLUG}" with ${STUDENT_COUNT} students…`);

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ---------------------------------------------------------------------------
  // Tenant. Rebuilt from scratch so a second run is identical rather than doubled.
  // ---------------------------------------------------------------------------
  await prisma.school.deleteMany({ where: { slug: TENANT_SLUG } });

  const school = await prisma.school.create({
    data: {
      slug: TENANT_SLUG,
      name: 'Volt Demo Campus',
      // The neutral Volt theme. Section 18: develop against this, switch the LGS theme on
      // only for the pitch itself.
      themeJson: { themeId: 'volt-default' },
      featureFlags: { societies: true, onlinePayments: false, feeGate: false },
      settingsJson: {
        attendance: { lockWindowHours: 24, minimumPercent: 85, periodWise: true },
        notifications: { quietHours: { from: '21:00', to: '07:00' } },
      },
      timezone: 'Asia/Karachi',
      locale: 'en',
      address: 'Gulberg III, Lahore',
      contactPhone: '+924235700000',
      contactEmail: 'office@volt-demo.test',
    },
  });
  const schoolId = school.id;

  /*
   * Two academic years, current and previous, computed from today rather than hardcoded —
   * so the demo tenant always has a term and a half of real history behind it whenever the
   * seed is run, instead of going empty the moment a fixed date passes.
   *
   * The demo campus runs an April–March calendar. That is what puts ~150 school days of
   * attendance behind a September demo; an August–June year seeded in September would have
   * six weeks of registers and a heatmap with nothing in it.
   */
  const today = TODAY;
  const yearStartMonth = 3; // April, zero-indexed
  const currentYearStartYear =
    today.getUTCMonth() >= yearStartMonth ? today.getUTCFullYear() : today.getUTCFullYear() - 1;

  const yearBounds = (startYear: number) => ({
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    label: `${startYear}–${String(startYear + 1).slice(2)}`,
  });

  const previousBounds = yearBounds(currentYearStartYear - 1);
  const currentBounds = yearBounds(currentYearStartYear);

  const previousYear = await prisma.academicYear.create({
    data: {
      schoolId,
      label: previousBounds.label,
      startDate: new Date(`${previousBounds.start}T00:00:00.000Z`),
      endDate: new Date(`${previousBounds.end}T00:00:00.000Z`),
      isCurrent: false,
    },
  });
  const currentYear = await prisma.academicYear.create({
    data: {
      schoolId,
      label: currentBounds.label,
      startDate: new Date(`${currentBounds.start}T00:00:00.000Z`),
      endDate: new Date(`${currentBounds.end}T00:00:00.000Z`),
      isCurrent: true,
    },
  });

  // ---------------------------------------------------------------------------
  // Structure
  // ---------------------------------------------------------------------------
  await prisma.department.createMany({
    data: DEPARTMENTS.map((name) => ({ schoolId, name })),
  });
  const departments = await prisma.department.findMany({ where: { schoolId } });
  const departmentByName = new Map(departments.map((d) => [d.name, d.id]));

  const programme = await prisma.programme.create({
    data: { schoolId, name: 'A Level (CAIE)', board: 'CAIE' },
  });

  await prisma.yearGroup.createMany({
    data: YEAR_GROUPS.map((group) => ({
      schoolId,
      programmeId: programme.id,
      name: group.name,
      order: group.order,
    })),
  });
  const yearGroups = await prisma.yearGroup.findMany({ where: { schoolId } });
  const yearGroupByName = new Map(yearGroups.map((group) => [group.name, group.id]));

  await prisma.subject.createMany({
    data: SUBJECTS.map((subject) => ({
      schoolId,
      programmeId: programme.id,
      departmentId: departmentByName.get(subject.department) ?? null,
      name: subject.name,
      code: subject.code,
    })),
  });
  const subjects = await prisma.subject.findMany({ where: { schoolId } });
  const subjectByCode = new Map(subjects.map((subject) => [subject.code, subject]));

  await prisma.subjectComponent.createMany({
    data: SUBJECTS.flatMap((subject) =>
      subject.components.map((component) => ({
        schoolId,
        subjectId: subjectByCode.get(subject.code)!.id,
        name: component.name,
        code: component.code,
        weightPercent: component.weightPercent,
      })),
    ),
  });

  await prisma.gradingScale.createMany({
    data: GRADING_SCALES.map((scale) => ({
      schoolId,
      name: scale.name,
      board: scale.board,
      isDefault: scale.isDefault,
      bandsJson: scale.bands as unknown as Prisma.InputJsonValue,
    })),
  });

  await prisma.period.createMany({
    data: PERIODS.map((period) => ({
      schoolId,
      index: period.index,
      label: period.label,
      startTime: period.startTime,
      endTime: period.endTime,
    })),
  });

  // Enough rooms that no two concurrent sections share one — see the clash check below.
  const ROOM_COUNT = 80;
  await prisma.room.createMany({
    data: Array.from({ length: ROOM_COUNT }, (_, index) => {
      const isLab = index % 8 === 0;
      return {
        schoolId,
        name: isLab ? `Lab ${Math.floor(index / 8) + 1}` : `Room ${index + 1}`,
        capacity: SECTION_CAPACITY + 4,
        type: isLab ? 'lab' : 'classroom',
      };
    }),
  });
  const rooms = await prisma.room.findMany({ where: { schoolId }, orderBy: { name: 'asc' } });

  // Placed inside the academic year's own range, so "excluded from attendance
  // calculations" is actually exercised by the history below.
  const holidayCalendar: { monthDay: string; label: string }[] = [
    { monthDay: '05-01', label: 'Labour Day' },
    { monthDay: '08-14', label: 'Independence Day' },
    { monthDay: '09-15', label: 'Eid Milad-un-Nabi' },
    { monthDay: '11-09', label: 'Iqbal Day' },
    { monthDay: '12-25', label: 'Quaid-e-Azam Day' },
    { monthDay: '03-23', label: 'Pakistan Day' },
  ];

  const holidayDates = holidayCalendar.map(({ monthDay, label }) => {
    const [month] = monthDay.split('-');
    // April–March: months from April on belong to the start year, January–March to the next.
    const year = Number(month) >= 4 ? currentYearStartYear : currentYearStartYear + 1;
    return { date: `${year}-${monthDay}`, label };
  });

  await prisma.holiday.createMany({
    data: holidayDates.map((holiday) => ({
      schoolId,
      academicYearId: currentYear.id,
      date: new Date(`${holiday.date}T00:00:00.000Z`),
      label: holiday.label,
    })),
  });

  // ---------------------------------------------------------------------------
  // Students: choose combinations first, so section counts can be computed exactly.
  // ---------------------------------------------------------------------------
  const plans: StudentPlan[] = [];
  for (let index = 0; index < STUDENT_COUNT; index += 1) {
    const gender: Gender = rng.bool(0.5) ? 'MALE' : 'FEMALE';
    const yearGroup = index < STUDENT_COUNT / 2 ? 'AS1' : 'A2';
    const admissionYear = yearGroup === 'AS1' ? 2026 : 2025;
    const serial = index + 1;

    plans.push({
      userId: randomUUID(),
      studentId: randomUUID(),
      name: pickName(gender),
      gender,
      yearGroup,
      subjects: [...weightedCombination()],
      rollNumber: `${yearGroup}-${String(serial).padStart(4, '0')}`,
      admissionNumber: `${admissionYear}-${String(serial).padStart(5, '0')}`,
      house: rng.pick(HOUSES),
      phone: phoneFor(serial),
    });
  }

  // How many sections each (year group, subject) needs.
  const sectionCounts = new Map<string, number>();
  for (const plan of plans) {
    for (const code of plan.subjects) {
      const key = `${plan.yearGroup}|${code}`;
      sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
    }
  }
  const sectionsNeeded = new Map<string, number>();
  for (const [key, students] of sectionCounts) {
    sectionsNeeded.set(key, Math.max(1, Math.ceil(students / SECTION_CAPACITY)));
  }

  /**
   * Teachers per subject = the most sections that subject ever runs at once.
   *
   * All sections of a subject for one year group are concurrent (they share an option
   * block), so that count is exactly how many teachers of that subject the timetable
   * needs. The two year groups sit in different slots, so the same teachers cover both.
   */
  const teachersPerSubject = new Map<string, number>();
  for (const subject of SUBJECTS) {
    const perYear = YEAR_GROUPS.map(
      (group) => sectionsNeeded.get(`${group.name}|${subject.code}`) ?? 0,
    );
    teachersPerSubject.set(subject.code, Math.max(1, ...perYear));
  }

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------
  type StaffPlan = {
    userId: string;
    staffId: string;
    name: string;
    subjectCode: string | null;
    departmentName: string;
    employeeCode: string;
    phone: string;
  };

  const staffPlans: StaffPlan[] = [];
  let staffSerial = 0;

  for (const subject of SUBJECTS) {
    const count = teachersPerSubject.get(subject.code) ?? 1;
    for (let index = 0; index < count; index += 1) {
      staffSerial += 1;
      const gender: Gender = rng.bool(0.55) ? 'FEMALE' : 'MALE';
      staffPlans.push({
        userId: randomUUID(),
        staffId: randomUUID(),
        name: pickName(gender),
        subjectCode: subject.code,
        departmentName: subject.department,
        employeeCode: `EMP-${String(staffSerial).padStart(4, '0')}`,
        phone: phoneFor(900_000 + staffSerial),
      });
    }
  }

  const teachingStaffCount = staffPlans.length;

  // Pad to the target headcount with the non-teaching staff a campus actually has.
  while (staffPlans.length < STAFF_TARGET) {
    staffSerial += 1;
    const gender: Gender = rng.bool(0.5) ? 'FEMALE' : 'MALE';
    staffPlans.push({
      userId: randomUUID(),
      staffId: randomUUID(),
      name: pickName(gender),
      subjectCode: null,
      departmentName: rng.pick([...DEPARTMENTS]),
      employeeCode: `EMP-${String(staffSerial).padStart(4, '0')}`,
      phone: phoneFor(900_000 + staffSerial),
    });
  }

  await prisma.user.createMany({
    data: staffPlans.map((plan) => ({
      id: plan.userId,
      schoolId,
      name: plan.name,
      email: `${plan.employeeCode.toLowerCase()}@volt-demo.test`,
      phone: plan.phone,
      passwordHash,
      locale: 'en',
    })),
  });

  await prisma.staff.createMany({
    data: staffPlans.map((plan) => ({
      id: plan.staffId,
      schoolId,
      userId: plan.userId,
      employeeCode: plan.employeeCode,
      designation: rng.pick(DESIGNATIONS),
      departmentId: departmentByName.get(plan.departmentName) ?? null,
      joiningDate: new Date(`${rng.int(2012, 2025)}-08-01`),
      qualifications: rng.pick(QUALIFICATIONS),
    })),
  });

  await prisma.userRole.createMany({
    data: staffPlans.map((plan) => ({
      schoolId,
      userId: plan.userId,
      role: 'TEACHER' as RoleName,
    })),
  });

  // One HOD per department, who also holds the TEACHER role — a user can be both.
  for (const departmentName of DEPARTMENTS) {
    const candidate = staffPlans.find((plan) => plan.departmentName === departmentName);
    if (!candidate) continue;
    const departmentId = departmentByName.get(departmentName);
    if (!departmentId) continue;

    await prisma.department.update({
      where: { id: departmentId },
      data: { hodStaffId: candidate.staffId },
    });
    await prisma.userRole.create({
      data: { schoolId, userId: candidate.userId, role: 'HOD' },
    });
  }

  // ---------------------------------------------------------------------------
  // Sections — one teacher each, drawn from the subject's own teachers.
  // ---------------------------------------------------------------------------
  const teachersBySubject = new Map<string, StaffPlan[]>();
  for (const plan of staffPlans) {
    if (!plan.subjectCode) continue;
    const list = teachersBySubject.get(plan.subjectCode) ?? [];
    list.push(plan);
    teachersBySubject.set(plan.subjectCode, list);
  }

  type SectionPlan = {
    id: string;
    name: string;
    yearGroup: string;
    subjectCode: string;
    block: string;
    teacherId: string;
    roomId: string;
    students: StudentPlan[];
  };

  const sectionPlans: SectionPlan[] = [];
  /*
   * Rooms are allocated per (year group, block), because that is the unit of concurrency:
   * distinct rooms within a pair is all the room axis needs.
   *
   * Each pair also starts at a different offset in the room list. Without that every block
   * begins at room 0 and a student's timetable shows all four of their subjects in "Lab 1"
   * — harmless for clash detection, and instantly wrong to anyone reading the screen.
   */
  const roomCursor = new Map<string, number>();
  const roomOffsets = new Map<string, number>();

  for (const group of YEAR_GROUPS) {
    for (const subject of SUBJECTS) {
      const needed = sectionsNeeded.get(`${group.name}|${subject.code}`) ?? 0;
      const teachers = teachersBySubject.get(subject.code) ?? [];
      const blockKey = `${group.name}|${subject.block}`;

      for (let index = 0; index < needed; index += 1) {
        const teacher = teachers[index % teachers.length];
        if (!teacher) throw new Error(`No teacher available for ${subject.code}`);

        if (!roomOffsets.has(blockKey)) {
          roomOffsets.set(blockKey, (roomOffsets.size * 11) % rooms.length);
        }
        const cursor = roomCursor.get(blockKey) ?? 0;
        const offset = roomOffsets.get(blockKey) ?? 0;
        const room = rooms[(offset + cursor) % rooms.length];
        if (!room) throw new Error('No rooms available');
        roomCursor.set(blockKey, cursor + 1);

        sectionPlans.push({
          id: randomUUID(),
          name: `${group.name} ${subject.name} ${String.fromCharCode(65 + index)}`,
          yearGroup: group.name,
          subjectCode: subject.code,
          block: subject.block,
          teacherId: teacher.staffId,
          roomId: room.id,
          students: [],
        });
      }
    }
  }

  await prisma.section.createMany({
    data: sectionPlans.map((plan) => ({
      id: plan.id,
      schoolId,
      academicYearId: currentYear.id,
      yearGroupId: yearGroupByName.get(plan.yearGroup)!,
      subjectId: subjectByCode.get(plan.subjectCode)!.id,
      name: plan.name,
      teacherId: plan.teacherId,
      roomId: plan.roomId,
      capacity: SECTION_CAPACITY,
    })),
  });

  // ---------------------------------------------------------------------------
  // Student accounts and guardians
  // ---------------------------------------------------------------------------
  await prisma.user.createMany({
    data: plans.map((plan) => ({
      id: plan.userId,
      schoolId,
      name: plan.name,
      // Email optional for students; phone is the real identifier.
      email: `${plan.rollNumber.toLowerCase()}@volt-demo.test`,
      phone: plan.phone,
      passwordHash,
      locale: 'en',
    })),
  });

  await prisma.student.createMany({
    data: plans.map((plan) => ({
      id: plan.studentId,
      schoolId,
      userId: plan.userId,
      rollNumber: plan.rollNumber,
      admissionNumber: plan.admissionNumber,
      gsmNumber: `GSM${plan.admissionNumber.replace('-', '')}`,
      dateOfBirth: new Date(
        `${plan.yearGroup === 'AS1' ? 2009 : 2008}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
      ),
      gender: plan.gender,
      admissionDate: new Date(plan.yearGroup === 'AS1' ? '2026-08-01' : '2025-08-01'),
      house: plan.house,
      status: 'ACTIVE' as const,
    })),
  });

  await prisma.userRole.createMany({
    data: plans.map((plan) => ({ schoolId, userId: plan.userId, role: 'STUDENT' as RoleName })),
  });

  // Guardians. Roughly one in twelve families has a sibling at the campus, so some guardian
  // accounts link to two students — which is what makes the child switcher worth building.
  type GuardianPlan = { userId: string; guardianId: string; name: string; children: StudentPlan[] };
  const guardianPlans: GuardianPlan[] = [];
  let guardianSerial = 0;
  let pendingSibling: GuardianPlan | null = null;

  for (const plan of plans) {
    if (pendingSibling) {
      pendingSibling.children.push(plan);
      pendingSibling = null;
      continue;
    }

    guardianSerial += 1;
    const surname = plan.name.split(' ').at(-1) ?? 'Khan';
    const guardian: GuardianPlan = {
      userId: randomUUID(),
      guardianId: randomUUID(),
      name: `${rng.pick(MALE_FIRST_NAMES)} ${surname}`,
      children: [plan],
    };
    guardianPlans.push(guardian);

    if (rng.bool(1 / 12)) pendingSibling = guardian;
  }

  await prisma.user.createMany({
    data: guardianPlans.map((plan, index) => ({
      id: plan.userId,
      schoolId,
      name: plan.name,
      phone: phoneFor(500_000 + index),
      passwordHash,
      // Many parents are not comfortable reading English interfaces.
      locale: rng.bool(0.4) ? 'ur' : 'en',
    })),
  });

  await prisma.guardian.createMany({
    data: guardianPlans.map((plan) => ({
      id: plan.guardianId,
      schoolId,
      userId: plan.userId,
      relation: rng.pick(GUARDIAN_RELATIONS),
      occupation: rng.pick(OCCUPATIONS),
      cnic: `35201-${rng.int(1_000_000, 9_999_999)}-${rng.int(1, 9)}`,
    })),
  });

  await prisma.userRole.createMany({
    data: guardianPlans.map((plan) => ({
      schoolId,
      userId: plan.userId,
      role: 'PARENT' as RoleName,
    })),
  });

  await prisma.guardianStudent.createMany({
    data: guardianPlans.flatMap((plan) =>
      plan.children.map((child) => ({
        schoolId,
        guardianId: plan.guardianId,
        studentId: child.studentId,
        isPrimary: true,
        receivesAlerts: true,
      })),
    ),
  });

  // ---------------------------------------------------------------------------
  // Enrolments — fill each section in turn so class sizes are even.
  // ---------------------------------------------------------------------------
  const sectionsByKey = new Map<string, SectionPlan[]>();
  for (const section of sectionPlans) {
    const key = `${section.yearGroup}|${section.subjectCode}`;
    const list = sectionsByKey.get(key) ?? [];
    list.push(section);
    sectionsByKey.set(key, list);
  }

  const enrolments: Prisma.EnrolmentCreateManyInput[] = [];
  const fillCursor = new Map<string, number>();

  for (const plan of plans) {
    for (const code of plan.subjects) {
      const key = `${plan.yearGroup}|${code}`;
      const candidates = sectionsByKey.get(key);
      if (!candidates || candidates.length === 0) continue;

      const cursor = fillCursor.get(key) ?? 0;
      const section = candidates[cursor % candidates.length]!;
      fillCursor.set(key, cursor + 1);

      section.students.push(plan);
      enrolments.push({
        schoolId,
        academicYearId: currentYear.id,
        studentId: plan.studentId,
        sectionId: section.id,
      });
    }
  }

  for (let index = 0; index < enrolments.length; index += 5000) {
    await prisma.enrolment.createMany({ data: enrolments.slice(index, index + 5000) });
  }

  // ---------------------------------------------------------------------------
  // Timetable
  //
  // Each (year group, option block) pair gets four slots of the 48 in the week, and no two
  // pairs share a slot. Everything in one pair runs concurrently, so distinct teachers and
  // rooms within a pair are all that is needed — and because a student takes at most one
  // subject per block, no student can be in two places at once either.
  // ---------------------------------------------------------------------------
  const allSlots = TEACHING_DAYS.flatMap((day) =>
    PERIODS.map((period) => ({ day, periodIndex: period.index, period })),
  );

  const pairs = YEAR_GROUPS.flatMap((group) => BLOCKS.map((block) => ({ group: group.name, block })));

  /**
   * 11 and 48 are coprime and 11 × 3 < 48, so the four slots of one pair never collide with
   * another pair's, and they land on four different days including Friday and Saturday.
   */
  const SLOT_STRIDE = 11;
  const slotsForPair = (pairIndex: number) =>
    Array.from({ length: PERIODS_PER_SECTION_PER_WEEK }, (_, k) => {
      const slot = allSlots[pairIndex + k * SLOT_STRIDE];
      if (!slot) throw new Error(`Slot allocation overflowed at pair ${pairIndex}`);
      return slot;
    });

  const timetableSlots: Prisma.TimetableSlotCreateManyInput[] = [];

  pairs.forEach((pair, pairIndex) => {
    const slots = slotsForPair(pairIndex);
    const sectionsInPair = sectionPlans.filter(
      (section) => section.yearGroup === pair.group && section.block === pair.block,
    );

    for (const section of sectionsInPair) {
      for (const slot of slots) {
        timetableSlots.push({
          schoolId,
          academicYearId: currentYear.id,
          sectionId: section.id,
          dayOfWeek: slot.day,
          periodIndex: slot.periodIndex,
          startTime: slot.period.startTime,
          endTime: slot.period.endTime,
          roomId: section.roomId,
        });
      }
    }
  });

  for (let index = 0; index < timetableSlots.length; index += 5000) {
    await prisma.timetableSlot.createMany({ data: timetableSlots.slice(index, index + 5000) });
  }

  // ---------------------------------------------------------------------------
  // Attendance history
  //
  // Every school day of the current academic year up to today, capped at 180. This is what
  // makes the heatmaps, the defaulters list and the teacher-compliance report show
  // something real in a demo instead of an empty state.
  // ---------------------------------------------------------------------------
  const todayString = TODAY.toISOString().slice(0, 10);
  const historyEnd = todayString < currentBounds.end ? todayString : currentBounds.end;

  // Walk back from today to find where the capped window starts, counting only the days
  // that actually have teaching.
  const holidaySet = new Set(holidayDates.map((holiday) => holiday.date));
  const shiftDays = (date: string, days: number) => {
    const instant = new Date(`${date}T00:00:00.000Z`);
    instant.setUTCDate(instant.getUTCDate() + days);
    return instant.toISOString().slice(0, 10);
  };

  let historyStart = historyEnd;
  let schoolDayBudget = ATTENDANCE_DAY_CAP;
  while (historyStart > currentBounds.start && schoolDayBudget > 0) {
    const previous = shiftDays(historyStart, -1);
    if (previous < currentBounds.start) break;
    historyStart = previous;
    const weekday = new Date(`${previous}T00:00:00.000Z`).getUTCDay() || 7;
    if (weekday !== 7 && !holidaySet.has(previous)) schoolDayBudget -= 1;
  }

  const seedSections: SeedSection[] = sectionPlans
    .filter((section) => section.students.length > 0)
    .map((section) => ({
      id: section.id,
      teacherStaffId: section.teacherId,
      studentIds: section.students.map((student) => student.studentId),
    }));

  const seedSlots: SeedSlot[] = timetableSlots.map((slot) => ({
    sectionId: slot.sectionId as string,
    dayOfWeek: slot.dayOfWeek as number,
    periodIndex: slot.periodIndex as number,
    endTime: slot.endTime as string,
  }));

  const attendance = await seedAttendance(prisma, rng, {
    schoolId,
    academicYearId: currentYear.id,
    from: historyStart,
    to: historyEnd,
    holidays: holidaySet,
    sections: seedSections,
    slots: seedSlots,
    lockWindowHours: 24,
  });

  // ---------------------------------------------------------------------------
  // Exam series
  //
  // Three completed series with marks for every enrolled student, spread across the year so
  // the grade-trend chart has a trend in it and the "dropped two bands" report has someone
  // to report on.
  // ---------------------------------------------------------------------------
  const componentRows = await prisma.subjectComponent.findMany({
    where: { schoolId },
    select: { id: true, code: true, weightPercent: true, subject: { select: { code: true } } },
  });
  const componentIds = new Map(
    componentRows.map((row) => [
      `${row.subject.code}:${row.code}`,
      { id: row.id, weightPercent: row.weightPercent },
    ]),
  );

  const examSections: ExamSeedSection[] = sectionPlans
    .filter((section) => section.students.length > 0)
    .map((section) => ({
      id: section.id,
      subjectCode: section.subjectCode,
      studentIds: section.students.map((student) => student.studentId),
    }));

  // Dated backwards from today so every series sits in the past and can be published.
  const examSeriesDates = [
    { name: `June Tests ${currentYearStartYear}`, type: 'TEST' as const, date: shiftDays(todayString, -120) },
    { name: `August Mid-Terms ${currentYearStartYear}`, type: 'MID_TERM' as const, date: shiftDays(todayString, -60) },
    { name: `September Mocks ${currentYearStartYear}`, type: 'MOCK' as const, date: shiftDays(todayString, -14) },
  ];

  const exams = await seedExams(prisma, rng, {
    schoolId,
    academicYearId: currentYear.id,
    componentIds,
    sections: examSections,
    seriesDates: examSeriesDates,
    defaultScaleBands: GRADING_SCALES[0]!.bands,
  });

  // ---------------------------------------------------------------------------
  // Learning: the vault, practice attempts, quizzes, resources, assignments, doubts.
  //
  // Seeded after the exams so a student's practice trend sits alongside a real mark
  // history rather than floating on its own.
  // ---------------------------------------------------------------------------
  const learningSubjects: LearningSeedSubject[] = SUBJECTS.map((subject) => ({
    id: subjectByCode.get(subject.code)!.id,
    code: subject.code,
    name: subject.name,
    components: subject.components.flatMap((component) => {
      const meta = componentIds.get(`${subject.code}:${component.code}`);
      return meta ? [{ id: meta.id, code: component.code }] : [];
    }),
    topics: SUBJECT_TOPICS[subject.code] ?? [],
  }));

  const learningSections: LearningSeedSection[] = sectionPlans
    .filter((section) => section.students.length > 0)
    .map((section) => ({
      id: section.id,
      subjectId: subjectByCode.get(section.subjectCode)!.id,
      subjectCode: section.subjectCode,
      teacherStaffId: section.teacherId,
      studentIds: section.students.map((student) => student.studentId),
    }));

  const learning = await seedLearning(prisma, rng, {
    schoolId,
    sections: learningSections,
    subjects: learningSubjects,
    today: todayString,
    papers: 400,
    attempts: 300,
    attemptStudents: 60,
    // Half the sections, two quizzes each: one already sat, one just opened.
    quizzes: 40,
  });

  // ---------------------------------------------------------------------------
  // Finance
  //
  // Seeded last among the academic data and before the demo logins, because a coordinator
  // account has to exist to approve the concessions and sign the credit notes. Six months
  // of monthly billing puts somebody in every aging bucket.
  // ---------------------------------------------------------------------------
  const studentsByYearGroup = new Map<string, string[]>();
  for (const section of sectionPlans) {
    const groupId = yearGroupByName.get(section.yearGroup);
    if (!groupId) continue;
    const existing = studentsByYearGroup.get(groupId) ?? [];
    for (const student of section.students) {
      if (!existing.includes(student.studentId)) existing.push(student.studentId);
    }
    studentsByYearGroup.set(groupId, existing);
  }

  const feeSeedOptions: FeeSeedOptions = {
    schoolId,
    academicYearId: currentYear.id,
    today: todayString,
    voucherPrefix: 'LGS',
    months: 6,
    meetingStaffIds: staffPlans
      .filter((plan) => plan.subjectCode !== null)
      .slice(0, 6)
      .map((plan) => plan.staffId),
    yearGroups: YEAR_GROUPS.flatMap((group) => {
      const id = yearGroupByName.get(group.name);
      const studentIds = id ? studentsByYearGroup.get(id) ?? [] : [];
      return id && studentIds.length > 0 ? [{ id, name: group.name, studentIds }] : [];
    }),
  };

  // ---------------------------------------------------------------------------
  // Demo logins, one per role, with documented credentials.
  // ---------------------------------------------------------------------------
  const demoAccounts: { role: RoleName; name: string; phone: string; email: string }[] = [
    { role: 'ADMIN', name: 'Nadia Coordinator', phone: '+923001110001', email: 'admin@volt-demo.test' },
    { role: 'BURSAR', name: 'Imran Accounts', phone: '+923001110002', email: 'bursar@volt-demo.test' },
    { role: 'SUPERADMIN', name: 'Volt Support', phone: '+923001110003', email: 'support@volt.test' },
  ];

  for (const [index, account] of demoAccounts.entries()) {
    const user = await prisma.user.create({
      data: {
        schoolId,
        name: account.name,
        email: account.email,
        phone: account.phone,
        passwordHash,
        locale: 'en',
      },
    });
    await prisma.userRole.create({ data: { schoolId, userId: user.id, role: account.role } });

    /*
     * A coordinator and a bursar are employees of the school, so they get a Staff row like
     * every other member of staff. Without one, a coordinator holding `assignment.manage`
     * and `quiz.manage` cannot actually create either, because both records are attributed
     * to a Staff id — the capability would be real and the action impossible.
     *
     * Volt's own support account is not school staff and deliberately gets no Staff row:
     * it is a person at the vendor, and putting them on the school's establishment would
     * make them appear in staff lists and department counts.
     */
    if (account.role !== 'SUPERADMIN') {
      await prisma.staff.create({
        data: {
          schoolId,
          userId: user.id,
          employeeCode: `ADM-${String(index + 1).padStart(4, '0')}`,
          designation: account.role === 'BURSAR' ? 'Accounts Officer' : 'Coordinator',
        },
      });
    }
  }

  // Finance runs here rather than above because every concession and credit note carries
  // the coordinator's user id as its approver, and an approval with nobody's name on it is
  // exactly what an auditor looks for.
  const fees = await seedFees(prisma, rng, feeSeedOptions);

  // The teacher, student and parent demo logins are real accounts from the data above, so
  // the demo shows a populated timetable rather than an empty one.
  const demoTeacher = staffPlans[0]!;
  const demoStudent = plans[0]!;
  /*
   * The documented parent login is deliberately a guardian with two children.
   *
   * The child switcher is the first thing a parent sees and one of the few things that
   * distinguishes this portal from a letter home — demoing it with an account that has one
   * child shows a control that does nothing.
   */
  const demoParentIndex = Math.max(
    0,
    guardianPlans.findIndex((plan) => plan.children.length > 1),
  );
  const demoParent = guardianPlans[demoParentIndex]!;

  /*
   * The two older series are published, so a student's grade-trend chart and a teacher's
   * distribution charts have something to draw the moment the app opens. The most recent
   * mocks are left with marks entered but unpublished, which is what the demo publishes
   * live — the trend gains its third point in front of the principal.
   *
   * This runs the real publication service rather than a seed-only copy of it, so a bug in
   * grading or aggregation fails the seed instead of hiding until a demo.
   */
  const adminUser = await prisma.user.findFirstOrThrow({
    where: { schoolId, email: 'admin@volt-demo.test' },
    select: { id: true },
  });

  const publishingActor: Actor = {
    userId: adminUser.id,
    schoolId,
    roles: ['ADMIN'],
    sectionIds: [],
    enrolledSectionIds: [],
    headOfDepartmentIds: [],
    childStudentIds: [],
  };

  const toPublish = await prisma.examSeries.findMany({
    where: { schoolId, academicYearId: currentYear.id },
    orderBy: { startDate: 'asc' },
    take: 2,
    select: { id: true, name: true },
  });

  let resultCards = 0;
  for (const series of toPublish) {
    const published = await withTenant({ schoolId, userId: adminUser.id }, () =>
      publishExamSeries(publishingActor, series.id),
    );
    resultCards += published.resultCards;
  }
  await scopedPrisma.$disconnect();

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const counts = {
    students: plans.length,
    guardians: guardianPlans.length,
    staff: staffPlans.length,
    teachingStaff: teachingStaffCount,
    sections: sectionPlans.length,
    enrolments: enrolments.length,
    timetableSlots: timetableSlots.length,
    schoolDays: attendance.schoolDays,
    attendanceSessions: attendance.sessions,
    attendanceRecords: attendance.records,
    examSeries: exams.series,
    assessments: exams.assessments,
    marks: exams.marks,
    resultCards,
    pastPapers: learning.papers,
    paperAttempts: learning.attempts,
    quizzes: learning.quizzes,
    questions: learning.questions,
    quizAttempts: learning.quizAttempts,
    resources: learning.resources,
    assignments: learning.assignments,
    submissions: learning.submissions,
    doubtThreads: learning.doubts,
    topicMastery: learning.masteryRows,
    feeStructures: fees.structures,
    invoices: fees.invoices,
    payments: fees.payments,
    creditNotes: fees.creditNotes,
    concessions: fees.discounts,
    meetingSlots: fees.meetingSlots,
  };

  console.log('\nSeeded:');
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(18)} ${value}`);
  }
  console.log(`  academic years   ${[previousYear.label, currentYear.label].join(', ')}`);
  console.log(
    `  attendance       ${attendance.attendedPercent.toFixed(1)}% average, ` +
      `${attendance.chronicAbsentees} chronic absentees, ${historyStart} to ${historyEnd}`,
  );
  console.log(`  exam marks       ${exams.meanPercent.toFixed(1)}% mean across 3 series`);
  console.log(
    `  practice         ${learning.attempts} attempts by 60 students across ${learning.papers} papers`,
  );
  console.log(
    `  fees             PKR ${Math.round(fees.collectedPaisa / 100).toLocaleString('en-PK')} collected of ` +
      `${Math.round(fees.duePaisa / 100).toLocaleString('en-PK')} due ` +
      `(${((fees.collectedPaisa / Math.max(1, fees.duePaisa)) * 100).toFixed(1)}%), ` +
      `${fees.defaulters} families behind`,
  );
  console.log(
    `  published        ${toPublish.map((series) => series.name).join(', ')} ` +
      `(the latest series is left unpublished for the demo)`,
  );

  console.log('\nDemo logins (password for every account: ' + DEMO_PASSWORD + '):');
  console.log(`  Coordinator  admin@volt-demo.test    +923001110001`);
  console.log(`  Accounts     bursar@volt-demo.test   +923001110002`);
  console.log(`  Volt staff   support@volt.test       +923001110003`);
  console.log(`  Teacher      ${demoTeacher.employeeCode.toLowerCase()}@volt-demo.test  ${demoTeacher.phone}`);
  console.log(`  Student      ${demoStudent.rollNumber.toLowerCase()}@volt-demo.test  ${demoStudent.phone}`);
  console.log(
    `  Parent       (phone only)            ${phoneFor(500_000 + demoParentIndex)}  — ` +
      `${demoParent.name} (${demoParent.children.length} children)`,
  );

  console.log(`\nDone in ${elapsed}s.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
