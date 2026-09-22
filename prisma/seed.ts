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
import { Rng } from './seed/random';
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

  // Two academic years, current and previous — so year-scoping is exercised from day one.
  const previousYear = await prisma.academicYear.create({
    data: {
      schoolId,
      label: '2025–26',
      startDate: new Date('2025-08-01'),
      endDate: new Date('2026-06-30'),
      isCurrent: false,
    },
  });
  const currentYear = await prisma.academicYear.create({
    data: {
      schoolId,
      label: '2026–27',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2027-06-30'),
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

  await prisma.holiday.createMany({
    data: [
      { date: new Date('2026-08-14'), label: 'Independence Day' },
      { date: new Date('2026-09-15'), label: 'Eid Milad-un-Nabi' },
      { date: new Date('2026-11-09'), label: 'Iqbal Day' },
      { date: new Date('2026-12-25'), label: 'Quaid-e-Azam Day' },
      { date: new Date('2027-03-23'), label: 'Pakistan Day' },
      { date: new Date('2027-05-01'), label: 'Labour Day' },
    ].map((holiday) => ({ ...holiday, schoolId, academicYearId: currentYear.id })),
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
  // Rooms are allocated per (year group, block) — the unit of concurrency.
  const roomCursor = new Map<string, number>();

  for (const group of YEAR_GROUPS) {
    for (const subject of SUBJECTS) {
      const needed = sectionsNeeded.get(`${group.name}|${subject.code}`) ?? 0;
      const teachers = teachersBySubject.get(subject.code) ?? [];
      const blockKey = `${group.name}|${subject.block}`;

      for (let index = 0; index < needed; index += 1) {
        const teacher = teachers[index % teachers.length];
        if (!teacher) throw new Error(`No teacher available for ${subject.code}`);

        const cursor = roomCursor.get(blockKey) ?? 0;
        const room = rooms[cursor % rooms.length];
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
  // Demo logins, one per role, with documented credentials.
  // ---------------------------------------------------------------------------
  const demoAccounts: { role: RoleName; name: string; phone: string; email: string }[] = [
    { role: 'ADMIN', name: 'Nadia Coordinator', phone: '+923001110001', email: 'admin@volt-demo.test' },
    { role: 'BURSAR', name: 'Imran Accounts', phone: '+923001110002', email: 'bursar@volt-demo.test' },
    { role: 'SUPERADMIN', name: 'Volt Support', phone: '+923001110003', email: 'support@volt.test' },
  ];

  for (const account of demoAccounts) {
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
  }

  // The teacher, student and parent demo logins are real accounts from the data above, so
  // the demo shows a populated timetable rather than an empty one.
  const demoTeacher = staffPlans[0]!;
  const demoStudent = plans[0]!;
  const demoParent = guardianPlans[0]!;

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const counts = {
    students: plans.length,
    guardians: guardianPlans.length,
    staff: staffPlans.length,
    teachingStaff: teachingStaffCount,
    sections: sectionPlans.length,
    enrolments: enrolments.length,
    timetableSlots: timetableSlots.length,
  };

  console.log('\nSeeded:');
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(16)} ${value}`);
  }
  console.log(`  academic years   ${[previousYear.label, currentYear.label].join(', ')}`);

  console.log('\nDemo logins (password for every account: ' + DEMO_PASSWORD + '):');
  console.log(`  Coordinator  admin@volt-demo.test    +923001110001`);
  console.log(`  Accounts     bursar@volt-demo.test   +923001110002`);
  console.log(`  Volt staff   support@volt.test       +923001110003`);
  console.log(`  Teacher      ${demoTeacher.employeeCode.toLowerCase()}@volt-demo.test  ${demoTeacher.phone}`);
  console.log(`  Student      ${demoStudent.rollNumber.toLowerCase()}@volt-demo.test  ${demoStudent.phone}`);
  console.log(`  Parent       (phone only)            ${phoneFor(500_000)}  — ${demoParent.name}`);

  console.log(`\nDone in ${elapsed}s.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
