import { getTranslations } from 'next-intl/server';
import { DailyReportView } from '@/components/features/attendance/daily-report-view';
import { StudentAttendanceView } from '@/components/features/attendance/student-attendance-view';
import { TodaysClasses } from '@/components/features/attendance/todays-classes';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getTodaysClasses } from '@/lib/services/attendance/register';
import { getDailyReport, getStudentAttendance } from '@/lib/services/attendance/reports';
import { getSchoolSettings } from '@/lib/services/school-settings';
import { can, hasRole } from '@/lib/permissions';
import { zonedDateString } from '@/lib/utils/tz';

export const dynamic = 'force-dynamic';

/**
 * One route, four audiences. A coordinator, a teacher, a student and a parent each open
 * /attendance and get the thing they came for, rather than a landing page that asks them
 * which kind of person they are.
 */
export default async function AttendancePage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('attendance');

  return withActor(actor, async () => {
    const settings = await getSchoolSettings();
    const today = zonedDateString(new Date(), settings.timezone);

    if (can(actor, 'attendance.read.school') && hasRole(actor, 'ADMIN')) {
      const report = await getDailyReport(actor, today);
      return (
        <div className="flex flex-col gap-3">
          <h1 className="text-h1">{t('title')}</h1>
          <DailyReportView report={report} />
        </div>
      );
    }

    if (actor.staffId && can(actor, 'attendance.mark')) {
      const classes = await getTodaysClasses(actor, { date: today });
      return (
        <div className="flex flex-col gap-3">
          <h1 className="text-h1">{t('todaysClasses')}</h1>
          <TodaysClasses classes={classes} date={today} />
        </div>
      );
    }

    // A student sees their own record; a parent sees their first child's, with the child
    // switcher landing in M4 alongside the rest of the parent portal.
    const studentId = actor.studentId ?? actor.childStudentIds[0];
    if (studentId) {
      const data = await getStudentAttendance(actor, studentId);
      return (
        <div className="flex flex-col gap-3">
          <h1 className="text-h1">{t('myAttendance')}</h1>
          <StudentAttendanceView
            data={data}
            thresholdPercent={settings.attendance.minimumPercent}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('noRecords')} body={t('noRecordsBody')} />
      </div>
    );
  });
}
