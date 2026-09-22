import type { RoleName } from '@prisma/client';

/**
 * Capabilities are `resource.action`. They are the only thing a route handler checks —
 * never a role name directly, so adding a role is a change to this file and nothing else.
 */
export const CAPABILITIES = [
  // Identity and administration
  'user.read',
  'user.manage',
  'user.impersonate',
  'role.manage',
  'school.settings.read',
  'school.settings.manage',
  'tenant.provision',
  'audit.read',
  'import.run',

  // Academic structure
  'structure.read',
  'structure.manage',
  'enrolment.manage',
  'timetable.read',
  'timetable.manage',

  // Attendance
  'attendance.read.own',
  'attendance.read.children',
  'attendance.read.section',
  'attendance.read.department',
  'attendance.read.school',
  'attendance.mark',
  'attendance.amend',

  // Assessment
  'marks.read.own',
  'marks.read.children',
  'marks.read.section',
  'marks.read.department',
  'marks.read.school',
  'marks.enter',
  'marks.moderate',
  'exam.manage',
  'exam.publish',
  'gradingscale.manage',
  'resultcard.read.own',
  'resultcard.read.children',
  'resultcard.generate',
  'predictedgrade.set',

  // Behaviour and pastoral
  'remark.read.own',
  'remark.read.children',
  'remark.write',
  'leave.request',
  'leave.approve',

  // Learning
  'resource.read',
  'resource.upload',
  'resource.moderate',
  'pastpaper.read',
  'pastpaper.manage',
  'attempt.create',
  'attempt.read.own',
  'attempt.read.section',
  'assignment.read',
  'assignment.manage',
  'submission.create',
  'submission.grade',
  'quiz.take',
  'quiz.manage',
  'doubt.ask',
  'doubt.answer',
  'syllabus.track',

  // Finance
  'fee.read.own',
  'fee.read.children',
  'fee.read.school',
  'fee.manage',
  'payment.record',
  'payment.reconcile',
  'discount.approve',

  // Engagement
  'announcement.read',
  'announcement.manage',
  'society.read',
  'society.join',
  'society.manage',
  'event.rsvp',
  'event.manage',
  'career.read',
  'career.manage',

  // Reporting
  'report.section',
  'report.department',
  'report.school',
  'report.finance',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const STUDENT: readonly Capability[] = [
  'attendance.read.own',
  'marks.read.own',
  'resultcard.read.own',
  'remark.read.own',
  'timetable.read',
  'leave.request',
  'resource.read',
  'pastpaper.read',
  'attempt.create',
  'attempt.read.own',
  'assignment.read',
  'submission.create',
  'quiz.take',
  'doubt.ask',
  'fee.read.own',
  'announcement.read',
  'society.read',
  'society.join',
  'event.rsvp',
  'career.read',
];

/** Parents have no write access to anything academic. */
const PARENT: readonly Capability[] = [
  'attendance.read.children',
  'marks.read.children',
  'resultcard.read.children',
  'remark.read.children',
  'fee.read.children',
  'timetable.read',
  'leave.request',
  'announcement.read',
  'event.rsvp',
];

const TEACHER: readonly Capability[] = [
  'structure.read',
  'timetable.read',
  'attendance.read.section',
  'attendance.mark',
  'marks.read.section',
  'marks.enter',
  'remark.write',
  'resource.read',
  'resource.upload',
  'pastpaper.read',
  'pastpaper.manage',
  'attempt.read.section',
  'assignment.read',
  'assignment.manage',
  'submission.grade',
  'quiz.manage',
  'doubt.answer',
  'syllabus.track',
  'announcement.read',
  'announcement.manage',
  'society.read',
  'event.manage',
  'career.read',
  'report.section',
  'predictedgrade.set',
  'leave.approve',
];

/** Everything a teacher has, plus department-wide analytics and moderation. */
const HOD: readonly Capability[] = [
  ...TEACHER,
  'attendance.read.department',
  'marks.read.department',
  'marks.moderate',
  'exam.manage',
  'gradingscale.manage',
  'resource.moderate',
  'report.department',
];

const ADMIN: readonly Capability[] = [
  'user.read',
  'user.manage',
  'role.manage',
  'school.settings.read',
  'school.settings.manage',
  'audit.read',
  'import.run',
  'structure.read',
  'structure.manage',
  'enrolment.manage',
  'timetable.read',
  'timetable.manage',
  'attendance.read.school',
  'attendance.mark',
  'attendance.amend',
  'marks.read.school',
  'marks.moderate',
  'exam.manage',
  'exam.publish',
  'gradingscale.manage',
  'resultcard.generate',
  'remark.read.children',
  'remark.write',
  'leave.approve',
  'resource.read',
  'resource.upload',
  'resource.moderate',
  'pastpaper.read',
  'pastpaper.manage',
  'assignment.read',
  'assignment.manage',
  'quiz.manage',
  'syllabus.track',
  'announcement.read',
  'announcement.manage',
  'society.read',
  'society.manage',
  'event.manage',
  'career.read',
  'career.manage',
  'report.section',
  'report.department',
  'report.school',
];

/**
 * Whole campus, finance only. The absence of `marks.*` and `remark.*` here is the spec's
 * requirement, not an oversight — the bursar must not see academic records.
 */
const BURSAR: readonly Capability[] = [
  'user.read',
  'structure.read',
  'fee.read.school',
  'fee.manage',
  'payment.record',
  'payment.reconcile',
  'discount.approve',
  'report.finance',
  'announcement.read',
  'audit.read',
];

/** Volt staff. Tenant operations — not a superset of a school's academic access. */
const SUPERADMIN: readonly Capability[] = [
  'tenant.provision',
  'school.settings.read',
  'school.settings.manage',
  'user.read',
  'user.manage',
  'user.impersonate',
  'role.manage',
  'audit.read',
  'report.school',
];

export const ROLE_CAPABILITIES: Readonly<Record<RoleName, readonly Capability[]>> = Object.freeze({
  STUDENT,
  PARENT,
  TEACHER,
  HOD,
  ADMIN,
  BURSAR,
  SUPERADMIN,
});

/** Capabilities a bursar must never hold, asserted in tests as well as documented here. */
export const FINANCE_ONLY_FORBIDDEN: readonly Capability[] = [
  'marks.read.school',
  'marks.read.section',
  'marks.read.department',
  'marks.enter',
  'marks.moderate',
  'remark.write',
  'remark.read.own',
  'remark.read.children',
];
