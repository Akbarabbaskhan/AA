import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Rng } from './random';

/**
 * Student life.
 *
 * "This layer costs comparatively little to build and is the entire reason a student opens
 * the app voluntarily." Which means the demo has to feel inhabited: societies with real
 * membership and officers, events that are nearly full, a house competition with a close
 * table, badges people have actually earned, and a career corner with the deadlines an A
 * Level student is genuinely anxious about.
 *
 * An empty societies feed makes the module look like a stub, which is worse than not
 * demoing it.
 */

export type StudentLifeSeedOptions = {
  schoolId: string;
  /** `YYYY-MM-DD` — today, as the seed sees it. */
  today: string;
  /** Students eligible to join, with their house. */
  students: { id: string; userId: string; house: string | null }[];
  /** Teaching staff, for society advisors. */
  staffIds: readonly string[];
  houses: readonly string[];
};

export type StudentLifeSeedResult = {
  societies: number;
  memberships: number;
  officers: number;
  events: number;
  rsvps: number;
  waitlisted: number;
  housePoints: number;
  badges: number;
  badgeAwards: number;
  careerItems: number;
  documentRequests: number;
  lockerItems: number;
};

/** The societies that actually run an LGS campus, per the spec. */
const SOCIETIES = [
  { name: 'Model United Nations', isOpen: false, description: 'Delegations, position papers and the annual conference. Selective — there is an interview.' },
  { name: 'Debating Society', isOpen: false, description: 'British Parliamentary and World Schools formats. Trials in September.' },
  { name: 'Science Society', isOpen: true, description: 'Olympiad preparation, lab demonstrations and the science fair.' },
  { name: 'Sports Committee', isOpen: true, description: 'Inter-house cricket, football and athletics. Everyone welcome.' },
  { name: 'Dramatics Society', isOpen: true, description: 'The winter production, plus improv on Thursdays.' },
  { name: 'Literary Circle', isOpen: true, description: 'Reading, writing and the campus magazine.' },
  { name: 'Entrepreneurship Club', isOpen: true, description: 'Pitch nights, case competitions and a term project.' },
  { name: 'Community Service', isOpen: true, description: 'Weekend teaching at the partner school, and the winter drive.' },
] as const;

const EVENT_TEMPLATES = [
  { title: 'MUN selection interviews', venue: 'Conference Room', capacity: 24, days: 5, hours: 2 },
  { title: 'Inter-house debating final', venue: 'Auditorium', capacity: 200, days: 12, hours: 3 },
  { title: 'Science fair set-up', venue: 'Physics Lab', capacity: 40, days: 9, hours: 4 },
  { title: 'Inter-house cricket: AS vs A2', venue: 'Main Ground', capacity: null, days: 3, hours: 5 },
  { title: 'Winter production auditions', venue: 'Drama Studio', capacity: 30, days: 7, hours: 3 },
  { title: 'Campus magazine deadline', venue: 'Library', capacity: null, days: 16, hours: 1 },
  { title: 'Pitch night', venue: 'Seminar Room', capacity: 60, days: 20, hours: 2 },
  { title: 'Weekend teaching trip', venue: 'Partner School', capacity: 18, days: 6, hours: 6 },
] as const;

/**
 * The deadline tracker the spec names, with real dates.
 *
 * Pakistani intakes run roughly November to June, and UCAS and Common App sit in
 * January. A tracker with invented dates is one a student checks once and never again.
 */
const CAREER_ITEMS = [
  { type: 'DEADLINE' as const, institution: 'LUMS', title: 'National Outreach Programme application', month: 11, day: 15 },
  { type: 'DEADLINE' as const, institution: 'LUMS', title: 'Undergraduate admission — early decision', month: 12, day: 20 },
  { type: 'DEADLINE' as const, institution: 'NUST', title: 'NET-1 registration closes', month: 11, day: 30 },
  { type: 'DEADLINE' as const, institution: 'IBA Karachi', title: 'Aptitude test registration', month: 1, day: 10 },
  { type: 'DEADLINE' as const, institution: 'GIKI', title: 'Admission test application', month: 5, day: 31 },
  { type: 'DEADLINE' as const, institution: 'FAST-NU', title: 'Undergraduate application opens', month: 4, day: 15 },
  { type: 'DEADLINE' as const, institution: 'Aga Khan University', title: 'MBBS application deadline', month: 12, day: 15 },
  { type: 'DEADLINE' as const, institution: 'UCAS', title: 'Equal consideration deadline', month: 1, day: 29 },
  { type: 'DEADLINE' as const, institution: 'Common App', title: 'Regular decision — most US universities', month: 1, day: 1 },
  { type: 'SCHOLARSHIP' as const, institution: 'LUMS', title: 'National Outreach Programme — full scholarship', month: 11, day: 15 },
  { type: 'SCHOLARSHIP' as const, institution: 'HEC', title: 'Ehsaas Undergraduate Scholarship', month: 2, day: 28 },
  { type: 'SCHOLARSHIP' as const, institution: 'Chevening', title: 'Chevening Awards (for later study)', month: 11, day: 1 },
  { type: 'RESOURCE' as const, institution: null, title: 'Writing a personal statement that is not a list' },
  { type: 'RESOURCE' as const, institution: null, title: 'SAT: what to revise and in what order' },
  { type: 'RESOURCE' as const, institution: null, title: 'IELTS speaking — practice structure' },
  { type: 'RESOURCE' as const, institution: null, title: 'University interviews: the twelve questions that actually come up' },
  { type: 'RESOURCE' as const, institution: null, title: 'Choosing between a Pakistani and an overseas degree' },
  { type: 'ALUMNI' as const, institution: 'LUMS', title: 'Class of 2025 — 14 students, 6 on scholarship' },
  { type: 'ALUMNI' as const, institution: 'NUST', title: 'Class of 2025 — 9 students, Electrical and Mechanical' },
  { type: 'ALUMNI' as const, institution: 'Aga Khan University', title: 'Class of 2025 — 3 students, MBBS' },
  { type: 'ALUMNI' as const, institution: 'University of Toronto', title: 'Class of 2025 — 2 students, Engineering Science' },
  { type: 'ALUMNI' as const, institution: 'University of Warwick', title: 'Class of 2025 — 2 students, Economics' },
] as const;

const HOUSE_POINT_REASONS = [
  'Won the inter-house debating semi-final',
  'Organised the science fair single-handedly',
  'Top of the house in papers attempted this month',
  'Represented the school at the regional MUN',
  'Ran the winter charity drive',
  'Helped a new student settle in',
  'Outstanding contribution to the campus magazine',
  'Perfect attendance for the whole term',
] as const;

function shiftDays(iso: string, days: number): Date {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

/** The next occurrence of a month/day, so a tracker always looks forward. */
function nextOccurrence(today: string, month: number, day: number): Date {
  const now = new Date(`${today}T00:00:00.000Z`);
  let year = now.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getTime() < now.getTime()) {
    year += 1;
    candidate = new Date(Date.UTC(year, month - 1, day));
  }
  return candidate;
}

export async function seedStudentLife(
  prisma: PrismaClient,
  rng: Rng,
  options: StudentLifeSeedOptions,
): Promise<StudentLifeSeedResult> {
  const t0 = Date.now();
  const mark = (label: string) => {
    if (process.env['SEED_TIMING']) console.log(`    [life] ${label} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  };

  const result: StudentLifeSeedResult = {
    societies: 0,
    memberships: 0,
    officers: 0,
    events: 0,
    rsvps: 0,
    waitlisted: 0,
    housePoints: 0,
    badges: 0,
    badgeAwards: 0,
    careerItems: 0,
    documentRequests: 0,
    lockerItems: 0,
  };

  // -------------------------------------------------------------------------
  // Societies, with officers
  // -------------------------------------------------------------------------
  const societyRows: Prisma.SocietyCreateManyInput[] = SOCIETIES.map((society, index) => ({
    id: randomUUID(),
    schoolId: options.schoolId,
    name: society.name,
    description: society.description,
    isOpen: society.isOpen,
    staffAdvisorId: options.staffIds[index % Math.max(1, options.staffIds.length)] ?? null,
  }));
  await prisma.society.createMany({ data: societyRows });
  result.societies = societyRows.length;
  mark('societies');

  const memberships: Prisma.SocietyMemberCreateManyInput[] = [];
  const joined = new Set<string>();

  for (const society of societyRows) {
    /*
     * Membership sizes that look like a real campus: MUN and debating are selective and
     * small, sports and community service are large. A uniform forty everywhere is the
     * tell that the data was generated.
     */
    const isSelective = SOCIETIES.find((entry) => entry.name === society.name)?.isOpen === false;
    const size = isSelective ? rng.int(18, 30) : rng.int(45, 110);
    const picked = rng.sample(options.students, Math.min(size, options.students.length));

    picked.forEach((student, index) => {
      const key = `${society.id}:${student.id}`;
      if (joined.has(key)) return;
      joined.add(key);

      // Every society has a head, a secretary and a treasurer — students, as the spec says.
      const role = index === 0 ? 'HEAD' : index === 1 ? 'SECRETARY' : index === 2 ? 'TREASURER' : 'MEMBER';
      if (role !== 'MEMBER') result.officers += 1;

      memberships.push({
        schoolId: options.schoolId,
        societyId: society.id as string,
        studentId: student.id,
        role,
        joinedAt: shiftDays(options.today, -rng.int(20, 200)),
      });
    });
  }

  for (let index = 0; index < memberships.length; index += 2000) {
    await prisma.societyMember.createMany({ data: memberships.slice(index, index + 2000) });
  }
  result.memberships = memberships.length;
  mark('memberships');

  // -------------------------------------------------------------------------
  // Events, some of them deliberately over capacity so the waitlist has people on it
  // -------------------------------------------------------------------------
  const eventRows: Prisma.EventCreateManyInput[] = EVENT_TEMPLATES.map((template, index) => {
    const startsAt = shiftDays(options.today, template.days);
    startsAt.setUTCHours(10, 0, 0, 0);
    return {
      id: randomUUID(),
      schoolId: options.schoolId,
      societyId: societyRows[index % societyRows.length]!.id as string,
      title: template.title,
      description: null,
      startsAt,
      endsAt: new Date(startsAt.getTime() + template.hours * 3_600_000),
      venue: template.venue,
      capacity: template.capacity,
      rsvpRequired: template.capacity !== null,
    };
  });
  await prisma.event.createMany({ data: eventRows });
  result.events = eventRows.length;
  mark('events');

  const rsvpRows: Prisma.EventRSVPCreateManyInput[] = [];
  const membersBySociety = new Map<string, string[]>();
  for (const membership of memberships) {
    const list = membersBySociety.get(membership.societyId) ?? [];
    list.push(membership.studentId);
    membersBySociety.set(membership.societyId, list);
  }
  const userIdByStudent = new Map(options.students.map((student) => [student.id, student.userId]));

  for (const event of eventRows) {
    const members = membersBySociety.get(event.societyId as string) ?? [];
    if (members.length === 0) continue;

    // Oversubscribe the capped events on purpose: a waitlist with nobody on it proves nothing.
    const capacity = event.capacity ?? null;
    const wanted =
      capacity === null
        ? Math.round(members.length * 0.5)
        : Math.min(members.length, Math.round(capacity * 1.3));
    const attendees = rng.sample(members, wanted);

    attendees.forEach((studentId, index) => {
      const userId = userIdByStudent.get(studentId);
      if (!userId) return;
      const overCapacity = capacity !== null && index >= capacity;
      if (overCapacity) result.waitlisted += 1;
      else result.rsvps += 1;

      rsvpRows.push({
        schoolId: options.schoolId,
        eventId: event.id as string,
        userId,
        status: overCapacity ? 'WAITLIST' : 'GOING',
        // Ordered, because waitlist position is by when you said yes.
        createdAt: new Date(Date.now() - (wanted - index) * 60_000),
      });
    });
  }

  for (let index = 0; index < rsvpRows.length; index += 2000) {
    await prisma.eventRSVP.createMany({ data: rsvpRows.slice(index, index + 2000), skipDuplicates: true });
  }

  // -------------------------------------------------------------------------
  // House points — a close table, because a runaway leader is nobody's competition
  // -------------------------------------------------------------------------
  const housePointRows: Prisma.HousePointCreateManyInput[] = [];
  const awarder = await prisma.user.findFirst({
    where: { schoolId: options.schoolId, email: 'admin@volt-demo.test' },
    select: { id: true },
  });

  if (awarder && options.houses.length > 0) {
    const byHouse = new Map<string, string[]>();
    for (const student of options.students) {
      if (!student.house) continue;
      byHouse.set(student.house, [...(byHouse.get(student.house) ?? []), student.id]);
    }

    for (const house of options.houses) {
      const candidates = byHouse.get(house) ?? [];
      // 40–60 awards per house over the year, 1–10 points each.
      for (let index = 0; index < rng.int(40, 60); index += 1) {
        housePointRows.push({
          schoolId: options.schoolId,
          house,
          studentId: candidates.length > 0 ? rng.pick(candidates) : null,
          points: rng.int(1, 10),
          reason: rng.pick(HOUSE_POINT_REASONS),
          awardedBy: awarder.id,
          createdAt: shiftDays(options.today, -rng.int(1, 240)),
        });
      }
    }

    for (let index = 0; index < housePointRows.length; index += 2000) {
      await prisma.housePoint.createMany({ data: housePointRows.slice(index, index + 2000) });
    }
    result.housePoints = housePointRows.length;
  mark('housePoints');
  }

  // -------------------------------------------------------------------------
  // Badges. The definitions; awarding is the real service's job, run by the seed after.
  // -------------------------------------------------------------------------
  const badgeRows: Prisma.BadgeCreateManyInput[] = [
    { schoolId: options.schoolId, code: 'PAPERS_10', title: 'Ten papers in', description: 'Ten past papers attempted under timed conditions.' },
    { schoolId: options.schoolId, code: 'PAPERS_50', title: 'Fifty papers', description: 'Fifty past papers attempted under timed conditions. That is real work.' },
    { schoolId: options.schoolId, code: 'QUIZZES_20', title: 'Twenty quizzes', description: 'Twenty quizzes sat.' },
    { schoolId: options.schoolId, code: 'ATTENDANCE_30', title: 'A full month, every day', description: 'Thirty consecutive school days present.' },
    { schoolId: options.schoolId, code: 'SOCIETY_2', title: 'Around campus', description: 'A member of two or more societies.' },
  ];
  await prisma.badge.createMany({ data: badgeRows });
  result.badges = badgeRows.length;
  mark('badges');

  // -------------------------------------------------------------------------
  // The career corner
  // -------------------------------------------------------------------------
  const careerRows: Prisma.CareerItemCreateManyInput[] = CAREER_ITEMS.map((item) => ({
    schoolId: options.schoolId,
    type: item.type,
    title: item.title,
    institution: item.institution,
    body: null,
    deadline:
      'month' in item && 'day' in item
        ? nextOccurrence(options.today, item.month, item.day)
        : null,
    link: null,
  }));
  await prisma.careerItem.createMany({ data: careerRows });
  result.careerItems = careerRows.length;
  mark('careers');

  // -------------------------------------------------------------------------
  // A few document requests in flight, so the tracker has every state in it
  // -------------------------------------------------------------------------
  const requesters = rng.sample(options.students, Math.min(12, options.students.length));
  const requestRows: Prisma.DocumentRequestCreateManyInput[] = [];
  const lockerRows: Prisma.DocumentLockerItemCreateManyInput[] = [];

  requesters.forEach((student, index) => {
    const type = index % 3 === 0 ? 'TRANSCRIPT' : index % 3 === 1 ? 'RECOMMENDATION' : 'CHARACTER_CERTIFICATE';
    const status = index % 4 === 0 ? 'REQUESTED' : index % 4 === 1 ? 'IN_PROGRESS' : index % 4 === 2 ? 'READY' : 'DECLINED';
    const destination = rng.pick(['LUMS', 'NUST', 'UCAS', 'Common App', 'IBA Karachi', 'University of Toronto']);

    let lockerItemId: string | null = null;
    if (status === 'READY') {
      lockerItemId = randomUUID();
      const userId = userIdByStudent.get(student.id);
      if (userId) {
        lockerRows.push({
          id: lockerItemId,
          schoolId: options.schoolId,
          userId,
          title: `${type === 'TRANSCRIPT' ? 'Transcript' : type === 'RECOMMENDATION' ? 'Reference letter' : 'Character certificate'} — ${destination}`,
          type,
          fileUrl: `${options.schoolId}/documents/${student.id}-${type.toLowerCase()}.pdf`,
          createdAt: shiftDays(options.today, -rng.int(1, 20)),
        });
      } else {
        lockerItemId = null;
      }
    }

    requestRows.push({
      schoolId: options.schoolId,
      studentId: student.id,
      type,
      assignedToId:
        type === 'RECOMMENDATION'
          ? options.staffIds[index % Math.max(1, options.staffIds.length)] ?? null
          : null,
      destination,
      note: type === 'RECOMMENDATION' ? 'Applying for Economics. Happy to send my personal statement.' : null,
      deadline: shiftDays(options.today, rng.int(14, 90)),
      status,
      lockerItemId,
      declineReason:
        status === 'DECLINED' ? 'I have not taught you this year — please ask your current teacher.' : null,
      decidedAt: status === 'REQUESTED' || status === 'IN_PROGRESS' ? null : shiftDays(options.today, -rng.int(1, 10)),
      createdAt: shiftDays(options.today, -rng.int(10, 40)),
    });
  });

  // The locker items first: a request's lockerItemId points at one.
  if (lockerRows.length > 0) {
    await prisma.documentLockerItem.createMany({ data: lockerRows });
    result.lockerItems = lockerRows.length;
  }
  if (requestRows.length > 0) {
    await prisma.documentRequest.createMany({ data: requestRows });
    result.documentRequests = requestRows.length;
  }

  mark('requests');
  return result;
}
