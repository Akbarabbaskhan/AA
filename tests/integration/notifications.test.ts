import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import { notify, notifyMany, flushPending } from '@/lib/services/notifications/notify';
import {
  getDeliveryLog,
  getInbox,
  getPreferences,
  markAllRead,
  setPreference,
} from '@/lib/services/notifications/inbox';
import {
  registerProvider,
  resetProviders,
  type ChannelProvider,
  type OutboundMessage,
  type SendOutcome,
} from '@/lib/services/notifications/providers';
import { notifyAbsence } from '@/lib/services/notifications/triggers';
import {
  createAnnouncement,
  listAnnouncements,
  markAnnouncementRead,
} from '@/lib/services/announcements';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

let schoolId: string;
let admin: Actor;
let teacher: Actor;
let student: Actor;
let parent: Actor;
let parentStudentId: string;

/** Captures what each rail was asked to send, without reaching a network. */
class RecordingProvider implements ChannelProvider {
  readonly sent: OutboundMessage[] = [];
  constructor(
    readonly channel: OutboundMessage['channel'],
    readonly name = 'recording',
  ) {}
  async send(message: OutboundMessage): Promise<SendOutcome> {
    this.sent.push(message);
    return { status: 'SENT', providerMessageId: `rec:${this.sent.length}` };
  }
}

let whatsapp: RecordingProvider;
let sms: RecordingProvider;

const TEST_TITLE = '[test] ';

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  const picked = await asActor(admin, async () => {
    const link = await testPrisma.guardianStudent.findFirstOrThrow({
      where: { isPrimary: true, receivesAlerts: true },
      select: {
        studentId: true,
        guardian: { select: { user: { select: { email: true, phone: true, id: true } } } },
      },
    });
    const staff = await testPrisma.user.findFirstOrThrow({
      where: { roles: { some: { role: 'TEACHER' } }, staff: { sections: { some: {} } } },
      select: { email: true },
    });
    return {
      studentId: link.studentId,
      guardianUserId: link.guardian.user.id,
      guardianPhone: link.guardian.user.phone,
      teacherEmail: staff.email!,
    };
  });

  parentStudentId = picked.studentId;
  teacher = await actorByEmail(schoolId, picked.teacherEmail);

  // Guardians sign in by phone, so the actor is resolved from the user id directly.
  const { resolveActor } = await import('@/lib/permissions/resolve');
  const resolved = await asActor(admin, () => resolveActor(picked.guardianUserId));
  parent = resolved!;
});

afterEach(() => {
  resetProviders();
});

afterAll(async () => {
  await asActor(admin, async () => {
    await testPrisma.notification.deleteMany({
      where: { userId: { in: [parent.userId, student.userId] }, type: 'attendance.absent' },
    });
    await testPrisma.announcement.deleteMany({ where: { title: { startsWith: TEST_TITLE } } });
    await testPrisma.notificationPreference.deleteMany({
      where: { userId: { in: [parent.userId, student.userId] } },
    });
  });
  await testPrisma.$disconnect();
});

function install(): void {
  whatsapp = new RecordingProvider('WHATSAPP');
  sms = new RecordingProvider('SMS');
  registerProvider(whatsapp);
  registerProvider(sms);
}

describe('notify()', () => {
  it('fans out to the channels the type declares', async () => {
    install();
    const result = await asActor(admin, () =>
      notify(schoolId, parent.userId, 'fee.receipt', {
        title: `${TEST_TITLE}Payment received`,
        body: 'PKR 12,500 received.',
        // Midday, so quiet hours are not in play.
        templateVariables: ['12,500', 'TST-1'],
      }, { now: new Date('2026-09-23T09:00:00.000Z') }),
    );

    expect(result.attempted).toContain('IN_APP');
    expect(result.attempted).toContain('WHATSAPP');
    expect(whatsapp.sent).toHaveLength(1);
  });

  it('honours an opt-out and records why nothing was sent', async () => {
    install();
    await asActor(parent, () =>
      setPreference(parent, { type: 'fee.receipt', channel: 'WHATSAPP', enabled: false }),
    );

    const result = await asActor(admin, () =>
      notify(schoolId, parent.userId, 'fee.receipt', {
        title: `${TEST_TITLE}Opted out`,
        body: 'Should not reach WhatsApp.',
      }, { now: new Date('2026-09-23T09:00:00.000Z') }),
    );

    expect(result.attempted).not.toContain('WHATSAPP');
    expect(result.suppressed.some((entry) => entry.channel === 'WHATSAPP' && entry.reason === 'optedOut')).toBe(true);
    expect(whatsapp.sent).toHaveLength(0);

    const log = await asActor(admin, () =>
      getDeliveryLog(admin, { userId: parent.userId, channel: 'WHATSAPP', status: 'SUPPRESSED', limit: 5 }),
    );
    expect(log[0]?.failureReason).toBe('optedOut');

    await asActor(parent, () =>
      setPreference(parent, { type: 'fee.receipt', channel: 'WHATSAPP', enabled: true }),
    );
  });

  it('refuses to let anyone turn off the in-app record', async () => {
    await expect(
      asActor(parent, () =>
        setPreference(parent, { type: 'fee.receipt', channel: 'IN_APP', enabled: false }),
      ),
    ).rejects.toThrow(/record/i);
  });

  it('holds a non-urgent message through quiet hours but still lands it in-app', async () => {
    install();
    // 23:30 in Karachi is 18:30 UTC.
    const result = await asActor(admin, () =>
      notify(schoolId, parent.userId, 'result.published', {
        title: `${TEST_TITLE}Late night result`,
        body: 'Result published.',
      }, { now: new Date('2026-09-23T18:30:00.000Z') }),
    );

    // In-app lands regardless — it makes no noise and it is the record. The rails that
    // would wake somebody are held.
    expect(result.attempted).toEqual(['IN_APP']);
    expect(result.suppressed.some((entry) => entry.reason === 'quietHours')).toBe(true);
    expect(whatsapp.sent).toHaveLength(0);
  });

  it('sends an urgent message straight through quiet hours', async () => {
    install();
    const result = await asActor(admin, () =>
      notify(schoolId, parent.userId, 'fee.receipt', {
        title: `${TEST_TITLE}Urgent at night`,
        body: 'Payment received.',
      }, { now: new Date('2026-09-23T18:30:00.000Z') }),
    );
    expect(result.attempted).toContain('WHATSAPP');
    expect(whatsapp.sent).toHaveLength(1);
  });

  it('releases what quiet hours held, and never delivers the same row twice', async () => {
    install();
    /*
     * Real wall-clock time, not a fixed instant. Rows carry a real `createdAt`, so a flush
     * dated in the past releases nothing however the quiet-hours maths works out.
     */
    const morning = new Date();

    // A row this test owns, queued overnight so the flush is what releases it.
    const queued = await asActor(admin, () =>
      notify(schoolId, parent.userId, 'result.published', {
        title: `${TEST_TITLE}Held overnight`,
        body: 'Result published.',
      }, { now: new Date('2026-09-22T19:00:00.000Z') }),
    );
    const held = queued.notificationIds;
    expect(held.length).toBeGreaterThan(0);

    /*
     * Drained rather than flushed once: the school has a backlog of queued rows from the
     * seed, so a single bounded flush would simply pick up different rows the second time
     * and prove nothing about double-sending.
     */
    for (let pass = 0; pass < 60; pass += 1) {
      const result = await asActor(admin, () => flushPending(schoolId, { now: morning, limit: 500 }));
      if (result.sent === 0) break;
    }

    const drained = await asActor(admin, () => flushPending(schoolId, { now: morning, limit: 500 }));
    expect(drained.sent).toBe(0);

    // The row this test queued was delivered exactly once.
    const mine = whatsapp.sent.filter((message) => held.includes(message.notificationId));
    expect(mine).toHaveLength(1);
  });
});

describe('batching', () => {
  /** The rows the batching test owns, so the flush assertion cannot pick up other traffic. */
  let batchIds: string[] = [];

  it('collapses four absences in a day into one message, counting them', async () => {
    install();
    const day = new Date('2026-09-23T05:00:00.000Z');

    /*
     * A daily batch key is shared with anything else that ran today, including a previous
     * run of this suite. The precondition is established rather than assumed — otherwise
     * the first call joins an existing batch and the test asserts nothing.
     */
    await asActor(admin, () =>
      testPrisma.notification.deleteMany({
        where: { userId: parent.userId, type: 'attendance.absent' },
      }),
    );

    const first = await asActor(admin, () =>
      notify(schoolId, parent.userId, 'attendance.absent', {
        title: `${TEST_TITLE}Absent`,
        body: 'Absent for period 1.',
      }, { now: day }),
    );
    expect(first.batched).toBe(false);
    batchIds = first.notificationIds;

    for (let period = 2; period <= 4; period += 1) {
      const next = await asActor(admin, () =>
        notify(schoolId, parent.userId, 'attendance.absent', {
          title: `${TEST_TITLE}Absent`,
          body: `Absent for period ${period}.`,
        }, { now: day }),
      );
      expect(next.batched).toBe(true);
    }

    const rows = await asActor(admin, () =>
      testPrisma.notification.findMany({
        where: {
          userId: parent.userId,
          type: 'attendance.absent',
          batchKey: { contains: '2026-09-23' },
        },
        select: { payloadJson: true, channel: true, deliveryStatus: true },
      }),
    );

    // One row per channel, not four, and nothing has gone out yet.
    expect(rows.filter((row) => row.channel === 'WHATSAPP')).toHaveLength(1);
    expect(rows.every((row) => row.deliveryStatus === 'QUEUED')).toBe(true);
    const payload = rows[0]?.payloadJson as { count?: number };
    expect(payload.count).toBe(4);

    // Nothing reached a rail while the window was open.
    expect(whatsapp.sent).toHaveLength(0);
  });

  it('sends the batch once the window has closed, saying how many it covers', async () => {
    install();
    /*
     * The batch window is 30 minutes by default, measured from when the row was written —
     * which is real wall-clock time, not the instant the test passed to notify(). So the
     * flush is dated two hours past now rather than at a fixed timestamp.
     */
    const later = new Date(Date.now() + 2 * 60 * 60_000);
    expect(batchIds.length).toBeGreaterThan(0);

    /*
     * The queue is FIFO and the suite has run against this tenant before, so the batch
     * this test wrote sits behind whatever is already queued. Drain until the rows this
     * test owns have gone out, rather than until the queue is empty — the backlog is not
     * what is under test, and its size varies with what else ran.
     */
    for (let pass = 0; pass < 200; pass += 1) {
      if (whatsapp.sent.some((message) => batchIds.includes(message.notificationId))) break;
      const result = await asActor(admin, () => flushPending(schoolId, { now: later, limit: 1_000 }));
      if (result.sent === 0) break;
    }

    const mine = whatsapp.sent.filter((message) => batchIds.includes(message.notificationId));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.body).toMatch(/4 in total today/);
  });

  it('marking a student absent reaches their guardian', async () => {
    install();
    const result = await asActor(admin, () =>
      notifyAbsence(schoolId, parentStudentId, { date: '2026-09-22', periodLabel: 'Period 2' }),
    );
    expect(result.notified).toBeGreaterThan(0);
  });
});

describe('the delivery log', () => {
  it('is the evidence when a parent says they were never told', async () => {
    install();
    await asActor(admin, () =>
      notify(schoolId, parent.userId, 'fee.receipt', {
        title: `${TEST_TITLE}Evidence`,
        body: 'Receipt.',
      }, { now: new Date('2026-09-23T09:00:00.000Z') }),
    );

    const log = await asActor(admin, () => getDeliveryLog(admin, { userId: parent.userId, limit: 20 }));
    expect(log.length).toBeGreaterThan(0);
    expect(log.some((row) => row.status === 'SENT')).toBe(true);
    expect(log[0]?.userPhone).toBeTruthy();
  });

  it('is searchable by the phone number the parent is ringing from', async () => {
    const phone = await asActor(admin, () =>
      testPrisma.user.findFirstOrThrow({ where: { id: parent.userId }, select: { phone: true } }),
    );
    const log = await asActor(admin, () =>
      getDeliveryLog(admin, { search: phone.phone!.slice(-6), limit: 20 }),
    );
    expect(log.length).toBeGreaterThan(0);
  });

  it('is never readable by a teacher or a parent', async () => {
    await expect(asActor(teacher, () => getDeliveryLog(teacher, { limit: 5 }))).rejects.toThrow();
    await expect(asActor(parent, () => getDeliveryLog(parent, { limit: 5 }))).rejects.toThrow();
  });
});

describe('the inbox', () => {
  it('shows only the in-app copies, not one row per rail', async () => {
    install();
    // Unique per run: the suite writes to the shared demo tenant, so a fixed title also
    // matches every previous run's row and the count means nothing.
    const title = `${TEST_TITLE}Inbox ${Date.now()}`;
    await asActor(admin, () =>
      notify(schoolId, parent.userId, 'fee.receipt', {
        title,
        body: 'Receipt.',
      }, { now: new Date('2026-09-23T09:00:00.000Z') }),
    );

    const inbox = await asActor(parent, () => getInbox(parent, { limit: 50 }));
    expect(inbox.items.filter((item) => item.title === title)).toHaveLength(1);
  });

  it('marks everything read without touching anyone else’s', async () => {
    const before = await asActor(student, () => getInbox(student, { limit: 5 }));
    await asActor(parent, () => markAllRead(parent));
    const parentInbox = await asActor(parent, () => getInbox(parent, { limit: 5 }));
    expect(parentInbox.unread).toBe(0);

    const studentInbox = await asActor(student, () => getInbox(student, { limit: 5 }));
    expect(studentInbox.unread).toBe(before.unread);
  });

  it('lists every type and channel in the preference matrix', async () => {
    const preferences = await asActor(parent, () => getPreferences(parent));
    expect(preferences.length).toBeGreaterThan(5);
    expect(preferences[0]?.channels).toHaveLength(5);
  });
});

describe('announcements', () => {
  it('fans out to the audience and counts the reach', async () => {
    install();
    const created = await asActor(admin, () =>
      createAnnouncement(admin, {
        title: `${TEST_TITLE}Sports day`,
        body: 'Sports day is on Saturday.',
        audience: { roles: ['PARENT'] },
        pinned: false,
        allowReplies: false,
        expiresAt: null,
      }),
    );
    expect(created.recipients).toBeGreaterThan(0);
    expect(created.scheduled).toBe(false);

    const staffView = await asActor(admin, () => listAnnouncements(admin, { limit: 20 }));
    const row = staffView.find((entry) => entry.id === created.id)!;
    expect(row.reach?.audience).toBe(created.recipients);
    expect(row.reach?.seen).toBe(0);

    await asActor(parent, () => markAnnouncementRead(parent, created.id));
    const afterRead = await asActor(admin, () => listAnnouncements(admin, { limit: 20 }));
    expect(afterRead.find((entry) => entry.id === created.id)?.reach?.seen).toBe(1);
  });

  it('counts a re-read once — the reach figure has to be trustworthy', async () => {
    const existing = await asActor(admin, () =>
      testPrisma.announcement.findFirstOrThrow({
        where: { title: `${TEST_TITLE}Sports day` },
        select: { id: true },
      }),
    );
    await asActor(parent, () => markAnnouncementRead(parent, existing.id));
    await asActor(parent, () => markAnnouncementRead(parent, existing.id));

    const rows = await asActor(admin, () => listAnnouncements(admin, { limit: 20 }));
    expect(rows.find((entry) => entry.id === existing.id)?.reach?.seen).toBe(1);
  });

  it('never shows a student an announcement addressed to parents', async () => {
    const studentView = await asActor(student, () => listAnnouncements(student, { limit: 50 }));
    expect(studentView.some((entry) => entry.title === `${TEST_TITLE}Sports day`)).toBe(false);
  });

  it('holds a scheduled announcement until its time', async () => {
    install();
    const created = await asActor(admin, () =>
      createAnnouncement(admin, {
        title: `${TEST_TITLE}Next week`,
        body: 'Published later.',
        audience: { roles: ['PARENT'] },
        pinned: false,
        allowReplies: false,
        publishAt: new Date(Date.now() + 7 * 86_400_000),
        expiresAt: null,
      }),
    );
    expect(created.scheduled).toBe(true);
    expect(created.recipients).toBe(0);

    const parentView = await asActor(parent, () => listAnnouncements(parent, { limit: 50 }));
    expect(parentView.some((entry) => entry.id === created.id)).toBe(false);
  });

  it('never lets a teacher announce beyond their own sections', async () => {
    await expect(
      asActor(teacher, () =>
        createAnnouncement(teacher, {
          title: `${TEST_TITLE}Whole school`,
          body: 'Should be refused.',
          audience: { roles: ['STUDENT'] },
          pinned: false,
          allowReplies: false,
          expiresAt: null,
        }),
      ),
    ).rejects.toThrow(/classes/i);
  });

  it('lets a teacher announce to a section they teach', async () => {
    install();
    const sectionId = teacher.sectionIds[0]!;
    const created = await asActor(teacher, () =>
      createAnnouncement(teacher, {
        title: `${TEST_TITLE}Class notice`,
        body: 'Bring your calculator.',
        audience: { sectionIds: [sectionId] },
        pinned: false,
        allowReplies: false,
        expiresAt: null,
      }),
    );
    expect(created.recipients).toBeGreaterThan(0);
  });

  it('never lets a student compose one at all', async () => {
    await expect(
      asActor(student, () =>
        createAnnouncement(student, {
          title: `${TEST_TITLE}Nope`,
          body: 'Should be refused.',
          audience: { roles: ['STUDENT'] },
          pinned: false,
          allowReplies: false,
          expiresAt: null,
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('bulk fan-out', () => {
  it('writes one row per recipient per channel in a single pass', async () => {
    install();
    const result = await asActor(admin, () =>
      notifyMany(schoolId, 'result.published', [
        { userId: parent.userId, payload: { title: `${TEST_TITLE}Bulk`, body: 'Result out.' } },
        { userId: student.userId, payload: { title: `${TEST_TITLE}Bulk`, body: 'Result out.' } },
      ]),
    );
    expect(result.queued).toBeGreaterThan(0);

    const rows = await asActor(admin, () =>
      testPrisma.notification.findMany({
        where: { type: 'result.published', payloadJson: { path: ['title'], equals: `${TEST_TITLE}Bulk` } },
        select: { channel: true, deliveryStatus: true },
      }),
    );
    // In-app is complete on write; the paid rails wait for the worker.
    expect(rows.some((row) => row.channel === 'IN_APP' && row.deliveryStatus === 'SENT')).toBe(true);
    expect(rows.some((row) => row.channel !== 'IN_APP' && row.deliveryStatus === 'QUEUED')).toBe(true);
  });
});
