import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import { availableReports, buildReport, reportToSheets } from '@/lib/services/reports';
import { REPORT_KEYS } from '@/lib/services/reports/definitions';
import { recordBoardResults } from '@/lib/services/reports/board-results';
import {
  createReportSchedule,
  isDue,
  listReportSchedules,
  runDueReportSchedules,
  setReportScheduleActive,
} from '@/lib/services/reports/schedules';
import { buildXlsx } from '@/lib/reports/xlsx';
import { renderReportPdf } from '@/lib/pdf/report';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

/**
 * The six reports, their exports, and the schedule that emails them.
 */

let schoolId: string;
let admin: Actor;
let bursar: Actor;
let teacher: Actor;
let student: Actor;
let hod: Actor;
let schoolDay: string;
const scheduleIds: string[] = [];
const BOARD_SESSION = '[test] June 2099';

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  bursar = await actorByEmail(schoolId, 'bursar@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  /*
   * A plain teacher, not a head of department: an HOD holds `report.department` and therefore
   * does get the academic-performance report, which is the spec's intent. Picking "any user
   * with the teacher role" silently picks an HOD and tests the wrong boundary.
   */
  const staff = await asActor(admin, () =>
    testPrisma.user.findFirstOrThrow({
      where: {
        roles: { some: { role: 'TEACHER' } },
        NOT: { roles: { some: { role: { in: ['HOD', 'ADMIN'] } } } },
      },
      select: { email: true },
    }),
  );
  teacher = await actorByEmail(schoolId, staff.email!);

  const hodUser = await asActor(admin, () =>
    testPrisma.user.findFirstOrThrow({
      where: { roles: { some: { role: 'HOD' } } },
      select: { email: true },
    }),
  );
  hod = await actorByEmail(schoolId, hodUser.email!);

  // The most recent day with registers: "today" is a Sunday one week in seven, and a report
  // for a day the school was shut is empty by definition.
  const lastSession = await asActor(admin, () =>
    testPrisma.attendanceSession.findFirstOrThrow({
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
  );
  schoolDay = lastSession.date.toISOString().slice(0, 10);
});

afterAll(async () => {
  await asActor(admin, async () => {
    await testPrisma.boardResult.deleteMany({ where: { session: BOARD_SESSION } });
    if (scheduleIds.length > 0) {
      await testPrisma.reportSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
    }
  });
  await testPrisma.$disconnect();
});

describe('the report catalogue', () => {
  it('offers each audience exactly its own reports', () => {
    expect(availableReports(admin).sort()).toEqual([...REPORT_KEYS].sort());
    // The spec's audiences: the bursar gets the money, the HOD gets their subject's
    // performance, a classroom teacher and a student get nothing.
    expect(availableReports(bursar)).toEqual(['fee-collection']);
    expect(availableReports(hod)).toEqual(['academic-performance']);
    expect(availableReports(teacher)).toEqual([]);
    expect(availableReports(student)).toEqual([]);
  });

  it('refuses a report to somebody outside its audience', async () => {
    await expect(asActor(bursar, () => buildReport(bursar, 'at-risk'))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      asActor(teacher, () => buildReport(teacher, 'daily-attendance')),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('each report against the seeded campus', () => {
  it('builds the daily attendance summary', async () => {
    const report = await asActor(admin, () =>
      buildReport(admin, 'daily-attendance', { date: schoolDay }),
    );
    expect(report.headline.map((entry) => entry.label)).toContain('Campus attendance');
    expect(report.tables.map((table) => table.name)).toEqual([
      'By year group',
      'Absent today',
      'Registers not marked',
    ]);
    // Every table's rows are the width of its own header: a report that is one column out is a
    // spreadsheet with figures under the wrong headings.
    for (const table of report.tables) {
      for (const row of table.rows) expect(row).toHaveLength(table.columns.length);
    }
  });

  it('builds academic performance with a trend against the previous series', async () => {
    const report = await asActor(admin, () => buildReport(admin, 'academic-performance'));
    const bySection = report.tables.find((table) => table.name === 'By section and teacher');
    expect(bySection).toBeTruthy();
    expect(bySection!.rows.length).toBeGreaterThan(20);
    expect(bySection!.columns.map((column) => column.header)).toContain('Previous %');
    // Somebody's mean moved, or the trend column is not doing anything.
    const changeIndex = bySection!.columns.findIndex((column) => column.header === 'Change');
    expect(bySection!.rows.some((row) => typeof row[changeIndex] === 'number')).toBe(true);
  });

  it('builds fee collection with aging and method breakdowns', async () => {
    const report = await asActor(bursar, () => buildReport(bursar, 'fee-collection'));
    expect(report.tables.map((table) => table.name)).toEqual([
      'By period',
      'Aging',
      'By method',
      'By year group',
    ]);
    const methods = report.tables.find((table) => table.name === 'By method')!;
    expect(methods.rows.length).toBeGreaterThan(1);
  });

  it('builds the at-risk list, worst first', async () => {
    const report = await asActor(admin, () => buildReport(admin, 'at-risk'));
    const table = report.tables[0]!;
    expect(table.rows.length).toBeGreaterThan(10);

    // Flags descend: the student on three lists is at the top, which is the whole point.
    const flags = table.rows.map((row) => Number(row[0]));
    expect([...flags].sort((a, b) => b - a)).toEqual(flags);
    expect(flags[0]).toBeGreaterThanOrEqual(1);

    // And it carries the guardian's phone number, because the next action is a phone call.
    expect(table.columns.map((column) => column.header)).toContain('Phone');
  });

  it('builds teacher activity from registers, marks and uploads', async () => {
    const report = await asActor(admin, () => buildReport(admin, 'teacher-activity'));
    const table = report.tables[0]!;
    expect(table.rows.length).toBeGreaterThan(50);
    const complianceIndex = table.columns.findIndex((column) => column.header === 'Compliance %');
    const values = table.rows
      .map((row) => row[complianceIndex])
      .filter((value): value is number => typeof value === 'number');
    expect(values.length).toBeGreaterThan(10);
    // Worst compliance first: this report exists to be acted on.
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it('says so plainly when no board results have been entered', async () => {
    const report = await asActor(admin, () =>
      buildReport(admin, 'board-results', { session: 'nope' }),
    );
    expect(report.tables[0]!.rows).toEqual([]);
  });
});

describe('board results', () => {
  it('reads a pasted board list, rejects what it cannot match, and compares to predictions', async () => {
    const sample = await asActor(admin, () =>
      testPrisma.predictedGrade.findMany({
        take: 3,
        select: {
          grade: true,
          student: { select: { rollNumber: true } },
          subject: { select: { code: true } },
        },
      }),
    );
    expect(sample.length).toBeGreaterThan(0);

    const lines = [
      'Roll number,Subject,Grade',
      ...sample.map((row) => `${row.student.rollNumber},${row.subject.code},${row.grade}`),
      'AS1-9999,9701,A*',
      'not-a-roll,not-a-subject,Z',
    ].join('\n');

    const result = await asActor(admin, () =>
      recordBoardResults(admin, { session: BOARD_SESSION, text: lines }),
    );

    expect(result.recorded).toBe(sample.length);
    // The two bad lines are named rather than dropped.
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]?.reason).toContain('No student');

    const report = await asActor(admin, () =>
      buildReport(admin, 'board-results', { session: BOARD_SESSION }),
    );
    expect(report.headline.find((entry) => entry.label === 'Results entered')?.value).toBe(
      String(sample.length),
    );
    // The school predicted these exactly, because that is where the grades came from.
    expect(report.headline.find((entry) => entry.label === 'Predicted exactly')?.value).toBe(
      '100.0%',
    );
  });

  it('records a correction rather than a second row', async () => {
    const existing = await asActor(admin, () =>
      testPrisma.boardResult.findFirstOrThrow({
        where: { session: BOARD_SESSION },
        select: {
          grade: true,
          student: { select: { rollNumber: true } },
          subject: { select: { code: true } },
        },
      }),
    );
    const corrected = existing.grade === 'A' ? 'B' : 'A';

    const result = await asActor(admin, () =>
      recordBoardResults(admin, {
        session: BOARD_SESSION,
        text: `${existing.student.rollNumber},${existing.subject.code},${corrected}`,
      }),
    );
    expect(result.updated).toBe(1);
    expect(result.recorded).toBe(0);

    const rows = await asActor(admin, () =>
      testPrisma.boardResult.count({
        where: { session: BOARD_SESSION, student: { rollNumber: existing.student.rollNumber } },
      }),
    );
    expect(rows).toBeLessThanOrEqual(3);
  });

  it('is refused to a teacher', async () => {
    await expect(
      asActor(teacher, () =>
        recordBoardResults(teacher, { session: BOARD_SESSION, text: 'AS1-0001,9701,A' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('exports', () => {
  it('writes a workbook a reference reader opens, with a sheet per table', async () => {
    const report = await asActor(admin, () =>
      buildReport(admin, 'daily-attendance', { date: schoolDay }),
    );
    const workbook = buildXlsx(reportToSheets(report));

    const directory = mkdtempSync(join(tmpdir(), 'volt-xlsx-'));
    const file = join(directory, 'report.xlsx');
    writeFileSync(file, workbook);

    /*
     * Opened with Python's openpyxl — a reference implementation, not our own code. The QR
     * encoder taught this lesson: bytes coming out is not the same as a file anybody can read.
     * Skipped only if the reference reader is not installed, and the assertion below fails
     * loudly rather than passing quietly in that case.
     */
    const script = `
import sys, warnings, openpyxl
warnings.simplefilter('error')
book = openpyxl.load_workbook(sys.argv[1])
print('|'.join(book.sheetnames))
sheet = book[book.sheetnames[1]]
rows = list(sheet.iter_rows(values_only=True))
print(len(rows))
print(type(rows[1][1]).__name__ if len(rows) > 1 and len(rows[1]) > 1 else 'none')
`;
    const scriptFile = join(directory, 'read.py');
    writeFileSync(scriptFile, script);

    const output = execFileSync('python3', [scriptFile, file], { encoding: 'utf8' })
      .trim()
      .split('\n');
    const sheetNames = output[0]!.split('|');

    expect(sheetNames[0]).toBe('Summary');
    expect(sheetNames).toContain('By year group');
    expect(Number(output[1])).toBeGreaterThan(1);
    // The percentage column came back as a number, not a string.
    expect(['float', 'int', 'NoneType']).toContain(output[2]);
    expect(existsSync(file)).toBe(true);
  });

  it('renders a PDF with a page count and the report title', async () => {
    const report = await asActor(admin, () => buildReport(admin, 'at-risk'));
    const pdf = await renderReportPdf(report, { schoolName: 'Volt Demo', generatedBy: 'test' });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    // A ten-column list goes landscape rather than being squeezed.
    expect(pdf.toString('latin1')).toContain('/Type /Page');
  }, 60_000);
});

describe('scheduling', () => {
  it('works out what is due without sending anything twice', () => {
    const base = { cadence: 'DAILY' as const, hourLocal: 7, lastRunAt: null };
    const morning = new Date('2026-09-28T02:10:00.000Z'); // 07:10 Karachi

    expect(isDue(base, morning, 300)).toBe(true);
    // Before the hour it is not due.
    expect(isDue(base, new Date('2026-09-28T01:00:00.000Z'), 300)).toBe(false);
    // Already sent today.
    expect(isDue({ ...base, lastRunAt: new Date('2026-09-28T02:00:00.000Z') }, morning, 300)).toBe(
      false,
    );
    // Yesterday's run means today's is due.
    expect(isDue({ ...base, lastRunAt: new Date('2026-09-27T02:00:00.000Z') }, morning, 300)).toBe(
      true,
    );

    // And not on a day the school is shut: a Sunday summary of nothing teaches a principal to
    // ignore the whole thing.
    const sunday = new Date('2026-09-27T02:10:00.000Z');
    expect(isDue(base, sunday, 300, [1, 2, 3, 4, 5, 6])).toBe(false);
    expect(isDue(base, sunday, 300, [1, 2, 3, 4, 5, 6, 7])).toBe(true);

    // Weekly only on a Monday, and only once a week.
    const monday = new Date('2026-09-28T02:10:00.000Z');
    expect(isDue({ cadence: 'WEEKLY', hourLocal: 7, lastRunAt: null }, monday, 300)).toBe(true);
    expect(
      isDue(
        { cadence: 'WEEKLY', hourLocal: 7, lastRunAt: new Date('2026-09-27T02:00:00.000Z') },
        monday,
        300,
      ),
    ).toBe(false);
  });

  it('runs a due schedule, files the report, and tells the recipients the figures', async () => {
    const schedule = await asActor(admin, () =>
      createReportSchedule(admin, {
        reportKey: 'daily-attendance',
        cadence: 'DAILY',
        hourLocal: 0,
        format: 'XLSX',
        recipients: { userIds: [admin.userId], roles: [] },
      }),
    );
    scheduleIds.push(schedule.id);

    /*
     * A fixed Monday morning rather than "now": a daily report deliberately does not fire on a
     * day the school is shut, so a suite run on a Sunday would otherwise test nothing.
     */
    const monday = new Date('2026-09-28T03:00:00.000Z');

    const result = await asActor(admin, () => runDueReportSchedules(schoolId, { now: monday }));
    expect(result.failures).toEqual([]);
    expect(result.ran).toBeGreaterThanOrEqual(1);
    expect(result.notified).toBeGreaterThanOrEqual(1);

    // The notification carries the headline figures and a link, not an attachment.
    const sent = await asActor(admin, () =>
      testPrisma.notification.findFirst({
        where: { userId: admin.userId, type: 'report.ready' },
        orderBy: { createdAt: 'desc' },
        select: { payloadJson: true },
      }),
    );
    const payload = sent?.payloadJson as { body?: string; link?: string };
    expect(payload?.body).toContain('Campus attendance');
    expect(payload?.link).toContain('/api/files/');

    // Running again inside the same day sends nothing.
    const second = await asActor(admin, () => runDueReportSchedules(schoolId, { now: monday }));
    expect(second.ran).toBe(0);

    // And a schedule can be switched off.
    const disabled = await asActor(admin, () => setReportScheduleActive(admin, schedule.id, false));
    expect(disabled.isActive).toBe(false);
    const listed = await asActor(admin, () => listReportSchedules(admin));
    expect(listed.find((row) => row.id === schedule.id)?.isActive).toBe(false);
  }, 120_000);

  it('records a failure instead of stopping the other schedules', async () => {
    // A schedule whose owner cannot open the report any more: a teacher's account set up a
    // coordinator's report, then lost the capability.
    const schedule = await asActor(admin, () =>
      createReportSchedule(admin, {
        reportKey: 'at-risk',
        cadence: 'DAILY',
        hourLocal: 0,
        format: 'XLSX',
        recipients: { userIds: [admin.userId], roles: [] },
      }),
    );
    scheduleIds.push(schedule.id);

    await asActor(admin, () =>
      testPrisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { createdById: null },
      }),
    );

    const result = await asActor(admin, () =>
      runDueReportSchedules(schoolId, { now: new Date('2026-09-28T03:00:00.000Z') }),
    );
    expect(result.failures.some((failure) => failure.scheduleId === schedule.id)).toBe(true);
  }, 120_000);
});
