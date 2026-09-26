import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { StatCard, TodaysClasses } from '@/components/features/attendance/todays-classes';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getTodaysClasses } from '@/lib/services/attendance/register';
import { getDailyReport, getStudentAttendance } from '@/lib/services/attendance/reports';
import { getFoundationSummary } from '@/lib/services/foundation';
import { getSchoolSettings } from '@/lib/services/school-settings';
import { getTimetable } from '@/lib/services/timetable';
import { getChildren, getParentHome } from '@/lib/services/parents';
import { getCalendar } from '@/lib/services/calendar';
import { getPracticeGoal } from '@/lib/services/papers/practice';
import { getLeaderboard } from '@/lib/services/recognition';
import { ParentHomeScreen } from '@/components/features/parents/parent-home';
import { can, hasRole, primaryRoleOf } from '@/lib/permissions';
import { zonedDateString } from '@/lib/utils/tz';

export const dynamic = 'force-dynamic';

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/**
 * The first screen after login, ordered by what each role actually wants to know at 7am.
 *
 * Nothing here is a placeholder: every figure is a live query through the tenant-scoped
 * client, and every card links to the screen that acts on it.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { studentId?: string };
}) {
  const actor = await requireSessionActor();
  const [t, tNav, tAttendance, tRoles, tParents, tCalendar, tPractice, tRecognition] =
    await Promise.all([
      getTranslations('dashboard'),
      getTranslations('nav'),
      getTranslations('attendance'),
      getTranslations('roles'),
      getTranslations('parents'),
      getTranslations('calendar'),
      getTranslations('practice'),
      getTranslations('recognition'),
    ]);

  return withActor(actor, async () => {
    const settings = await getSchoolSettings();
    const today = zonedDateString(new Date(), settings.timezone);
    const role = primaryRoleOf(actor.roles);

    const header = (title: string) => (
      <header className="flex flex-col gap-1">
        <p className="text-small text-[var(--text-tertiary)]">{tRoles(role)}</p>
        <h1 className="text-h1">{title}</h1>
      </header>
    );

    // Coordinator: the campus, and what is outstanding.
    if (hasRole(actor, 'ADMIN')) {
      const [report, summary] = await Promise.all([
        getDailyReport(actor, today),
        getFoundationSummary(),
      ]);

      return (
        <div className="flex flex-col gap-3">
          {header(t('greetingAdmin'))}
          <section className="grid gap-2 tablet:grid-cols-2 desktop:grid-cols-4">
            <StatCard label={t('attendanceToday')} value={formatPercent(report.campus.percent)} />
            <StatCard
              label={t('unmarkedRegisters')}
              value={String(report.unmarked.length)}
              tone={report.unmarked.length > 0 ? 'danger' : 'success'}
            />
            <StatCard label={t('students')} value={summary.students.toLocaleString('en-PK')} />
            <StatCard label={t('staff')} value={summary.staff.toLocaleString('en-PK')} />
          </section>
          <Button asChild variant="secondary">
            <Link href="/attendance">{tAttendance('title')}</Link>
          </Button>
        </div>
      );
    }

    // Teacher: today's classes, one tap from a marked register.
    if (actor.staffId && can(actor, 'attendance.mark')) {
      const classes = await getTodaysClasses(actor, { date: today });
      const unmarked = classes.filter((entry) => !entry.isMarked).length;

      return (
        <div className="flex flex-col gap-3">
          {header(t('greetingTeacher'))}
          <section className="grid gap-2 tablet:grid-cols-2">
            <StatCard
              label={t('unmarkedRegisters')}
              value={String(unmarked)}
              tone={unmarked > 0 ? 'warning' : 'success'}
            />
            <StatCard label={tAttendance('todaysClasses')} value={String(classes.length)} />
          </section>
          <Card>
            <CardHeader>
              <CardTitle>{tAttendance('todaysClasses')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TodaysClasses classes={classes} date={today} />
            </CardContent>
          </Card>
        </div>
      );
    }

    /*
     * Parent: the four facts the spec names, and nothing else.
     *
     * Deliberately a different screen from the student's, not the student's with pieces
     * hidden. A parent wants "is my child in school, do I owe anything, is there a result,
     * is there news" — which is a different question from "what is my next class".
     */
    if (hasRole(actor, 'PARENT') && !actor.studentId) {
      const children = await getChildren(actor);
      if (children.length === 0) {
        return (
          <div className="flex flex-col gap-3">
            {header(t('title'))}
            <EmptyState title={tParents('noChildren')} body={tParents('noChildrenBody')} />
          </div>
        );
      }

      const home = await getParentHome(actor, searchParams?.studentId);
      return <ParentHomeScreen home={home} students={children} />;
    }

    // Student: the numbers, what is next, and what is happening around campus.
    const studentId = actor.studentId ?? actor.childStudentIds[0];
    if (studentId) {
      const [attendance, timetable, upcoming, goal, board] = await Promise.all([
        getStudentAttendance(actor, studentId),
        getTimetable(actor, { studentId, date: today }),
        /*
         * "Around campus" and "Upcoming" — the two sections of the spec's student dashboard
         * that make the acceptance criterion reachable: "a student with no test due this
         * week still has a reason to open the app."
         */
        getCalendar(actor, { mineOnly: true, from: today }),
        actor.studentId ? getPracticeGoal(actor) : Promise.resolve(null),
        actor.studentId
          ? getLeaderboard(actor, { metric: 'PAPERS', windowDays: 30, limit: 3 })
          : Promise.resolve(null),
      ]);

      const nowMinutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
      const todayEntries = timetable.entries
        .filter((entry) => entry.dayOfWeek === timetable.currentDayOfWeek)
        .sort((a, b) => a.periodIndex - b.periodIndex);
      const next =
        todayEntries.find((entry) => entry.isCurrent) ??
        todayEntries.find((entry) => {
          const [hour, minute] = entry.startTime.split(':').map(Number);
          return (hour ?? 0) * 60 + (minute ?? 0) > nowMinutes - 300;
        });

      return (
        <div className="flex flex-col gap-3">
          {header(t('greetingStudent'))}
          <section className="grid gap-2 tablet:grid-cols-3">
            <StatCard label={t('myAttendance')} value={formatPercent(attendance.overall.percent)} />
            <StatCard
              label={t('last30')}
              value={formatPercent(attendance.rolling.percent)}
              tone={attendance.rolling.belowThreshold ? 'danger' : 'success'}
            />
            <StatCard label={t('subjectsTaken')} value={String(attendance.bySubject.length)} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>{t('nextClass')}</CardTitle>
            </CardHeader>
            <CardContent>
              {next ? (
                <div className="flex items-center gap-2">
                  <span data-numeric className="text-h2 text-[var(--text-primary)]">
                    {next.startTime}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-medium">{next.subjectName}</span>
                    <span className="truncate text-small text-[var(--text-secondary)]">
                      {next.roomName ?? '—'}
                      {next.teacherName ? ` · ${next.teacherName}` : ''}
                    </span>
                  </span>
                </div>
              ) : (
                <EmptyState title={t('nothingNext')} />
              )}
            </CardContent>
          </Card>

          {/*
            Upcoming, inside the next fortnight. The spec's order: tests and deadlines
            before anything social, with the social right behind it rather than absent.
          */}
          {upcoming.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{tCalendar('title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2" data-testid="dashboard-upcoming">
                  {upcoming.slice(0, 6).map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 text-small text-[var(--text-tertiary)]">
                          {tCalendar(`kind${entry.kind}`)}
                        </span>
                        <span className="truncate text-body text-[var(--text-primary)]">
                          {entry.title}
                        </span>
                      </span>
                      <span className="shrink-0 text-small text-[var(--text-tertiary)]">
                        {entry.date}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* Your numbers: effort against the goal the student set themselves. */}
          {goal ? (
            <Card>
              <CardHeader>
                <CardTitle>{tPractice('goal')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-h2 text-[var(--text-primary)]" data-testid="dashboard-goal">
                  {tPractice('goalSet', { done: goal.thisWeek, goal: goal.goalPerWeek })}
                </span>
                <span className="text-small text-[var(--text-tertiary)]">
                  {goal.streakWeeks > 0
                    ? tPractice('streak', { weeks: goal.streakWeeks })
                    : tPractice('streakNone')}
                </span>
                {board?.myRank ? (
                  <span className="text-small text-[var(--text-secondary)]">
                    {tRecognition('yourPosition', { rank: board.myRank, count: board.myCount })}
                  </span>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/timetable">{tNav('timetable')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/events">{tNav('events')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/papers">{tNav('papers')}</Link>
            </Button>
          </div>
        </div>
      );
    }

    // Bursar and Volt staff: fees and tenant tooling land in M4 and M6.
    const summary = await getFoundationSummary();
    return (
      <div className="flex flex-col gap-3">
        {header(tNav('dashboard'))}
        <section className="grid gap-2 tablet:grid-cols-2 desktop:grid-cols-4">
          <StatCard label={t('students')} value={summary.students.toLocaleString('en-PK')} />
          <StatCard label={t('staff')} value={summary.staff.toLocaleString('en-PK')} />
          <StatCard label={t('sections')} value={summary.sections.toLocaleString('en-PK')} />
          <StatCard
            label={t('timetabledPeriods')}
            value={summary.timetableSlots.toLocaleString('en-PK')}
          />
        </section>
      </div>
    );
  });
}
