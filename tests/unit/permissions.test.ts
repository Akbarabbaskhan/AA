import { describe, expect, it } from 'vitest';
import type { RoleName } from '@prisma/client';
import {
  canReadSectionMarks,
  canReadSectionAttendance,
  CAPABILITIES,
  FINANCE_ONLY_FORBIDDEN,
  ROLE_CAPABILITIES,
  type Actor,
  type Capability,
  can,
  canAccessDepartment,
  canAccessStudent,
  canMarkSection,
  requireCapability,
  studentScopeFilter,
  ForbiddenError,
} from '@/lib/permissions';

function actor(overrides: Partial<Actor> & { roles: RoleName[] }): Actor {
  return {
    userId: 'u1',
    schoolId: 's1',
    sectionIds: [],
    enrolledSectionIds: [],
    headOfDepartmentIds: [],
    childStudentIds: [],
    ...overrides,
  };
}

describe('permissions: the capability matrix', () => {
  it('grants every role only capabilities that exist', () => {
    const known = new Set<string>(CAPABILITIES);
    for (const [role, capabilities] of Object.entries(ROLE_CAPABILITIES)) {
      for (const capability of capabilities) {
        expect(known.has(capability), `${role} grants unknown capability ${capability}`).toBe(true);
      }
    }
  });

  it('keeps the bursar out of academic data entirely', () => {
    // "Whole campus, finance only. No access to marks or remarks."
    const bursar = actor({ roles: ['BURSAR'] });
    for (const capability of FINANCE_ONLY_FORBIDDEN) {
      expect(can(bursar, capability), `bursar must not hold ${capability}`).toBe(false);
    }
    expect(can(bursar, 'fee.manage')).toBe(true);
    expect(can(bursar, 'payment.reconcile')).toBe(true);
  });

  it('gives a parent no academic write access at all', () => {
    const parent = actor({ roles: ['PARENT'] });
    const writes: Capability[] = [
      'marks.enter',
      'marks.moderate',
      'attendance.mark',
      'remark.write',
      'assignment.manage',
      'exam.publish',
    ];
    for (const capability of writes) {
      expect(can(parent, capability), `parent must not hold ${capability}`).toBe(false);
    }
    expect(can(parent, 'attendance.read.children')).toBe(true);
    expect(can(parent, 'leave.request')).toBe(true);
  });

  it('gives an HOD everything a teacher has, plus moderation', () => {
    const teacher = ROLE_CAPABILITIES.TEACHER;
    const hod = new Set(ROLE_CAPABILITIES.HOD);
    for (const capability of teacher) {
      expect(hod.has(capability), `HOD is missing teacher capability ${capability}`).toBe(true);
    }
    expect(hod.has('marks.moderate')).toBe(true);
    expect(hod.has('report.department')).toBe(true);
  });

  it('does not let a student read anything school-wide', () => {
    const student = actor({ roles: ['STUDENT'] });
    const schoolWide: Capability[] = [
      'marks.read.school',
      'marks.read.section',
      'attendance.read.school',
      'attendance.read.section',
      'fee.read.school',
      'user.read',
      'audit.read',
      'report.school',
    ];
    for (const capability of schoolWide) {
      expect(can(student, capability), `student must not hold ${capability}`).toBe(false);
    }
  });

  it('does not make Super Admin a superset of a school\'s academic access', () => {
    // Volt staff provision tenants and support them; they do not silently read marks.
    const superadmin = actor({ roles: ['SUPERADMIN'] });
    expect(can(superadmin, 'tenant.provision')).toBe(true);
    expect(can(superadmin, 'user.impersonate')).toBe(true);
    expect(can(superadmin, 'marks.enter')).toBe(false);
    expect(can(superadmin, 'marks.read.school')).toBe(false);
  });

  it('accumulates capabilities across multiple roles on one account', () => {
    // A teacher who is also an HOD and a parent at the same school.
    const multi = actor({ roles: ['TEACHER', 'HOD', 'PARENT'] });
    expect(can(multi, 'marks.enter')).toBe(true);
    expect(can(multi, 'marks.moderate')).toBe(true);
    expect(can(multi, 'attendance.read.children')).toBe(true);
    expect(can(multi, 'fee.manage')).toBe(false);
  });

  it('throws ForbiddenError rather than returning false where a handler expects a guard', () => {
    const student = actor({ roles: ['STUDENT'] });
    expect(() => requireCapability(student, 'marks.enter')).toThrow(ForbiddenError);
    expect(() => requireCapability(student, 'attempt.create')).not.toThrow();
  });
});

describe('permissions: reading a whole section', () => {
  it('does not let a student read a section\'s marks or register', () => {
    /*
     * A student is legitimately enrolled in the section, so the row-level check alone
     * would let them through. "Own" is permission to see one person's results, never a
     * register of everyone's — this is the distinction that keeps a student out of the
     * marks grid for their own class.
     */
    const student = actor({ roles: ['STUDENT'], studentId: 'stu-1', enrolledSectionIds: ['sec-a'] });
    expect(can(student, 'marks.read.own')).toBe(true);
    expect(canReadSectionMarks(student)).toBe(false);
    expect(canReadSectionAttendance(student)).toBe(false);
  });

  it('does not let a parent read a section\'s marks or register', () => {
    const parent = actor({ roles: ['PARENT'], childStudentIds: ['stu-1'] });
    expect(can(parent, 'marks.read.children')).toBe(true);
    expect(canReadSectionMarks(parent)).toBe(false);
    expect(canReadSectionAttendance(parent)).toBe(false);
  });

  it('lets staff read a section', () => {
    for (const role of ['TEACHER', 'HOD', 'ADMIN'] as const) {
      const staff = actor({ roles: [role] });
      expect(canReadSectionMarks(staff), `${role} should read section marks`).toBe(true);
      expect(canReadSectionAttendance(staff), `${role} should read a register`).toBe(true);
    }
  });

  it('keeps the bursar out of both', () => {
    const bursar = actor({ roles: ['BURSAR'] });
    expect(canReadSectionMarks(bursar)).toBe(false);
    expect(canReadSectionAttendance(bursar)).toBe(false);
  });
});

describe('permissions: row-level scope', () => {
  it('lets a student see only their own record', () => {
    const student = actor({ roles: ['STUDENT'], studentId: 'stu-1' });
    expect(canAccessStudent(student, 'stu-1')).toBe(true);
    expect(canAccessStudent(student, 'stu-2')).toBe(false);
  });

  it('lets a parent see only their linked children', () => {
    const parent = actor({ roles: ['PARENT'], childStudentIds: ['stu-1', 'stu-9'] });
    expect(canAccessStudent(parent, 'stu-1')).toBe(true);
    expect(canAccessStudent(parent, 'stu-9')).toBe(true);
    expect(canAccessStudent(parent, 'stu-2')).toBe(false);
  });

  it('lets a teacher see only students in a section they teach', () => {
    const teacher = actor({ roles: ['TEACHER'], staffId: 'st-1', sectionIds: ['sec-a'] });
    expect(canAccessStudent(teacher, 'stu-1', ['sec-a'])).toBe(true);
    expect(canAccessStudent(teacher, 'stu-2', ['sec-b'])).toBe(false);
  });

  it('lets a teacher mark only their own sections', () => {
    const teacher = actor({ roles: ['TEACHER'], sectionIds: ['sec-a'] });
    expect(canMarkSection(teacher, 'sec-a')).toBe(true);
    expect(canMarkSection(teacher, 'sec-b')).toBe(false);

    const admin = actor({ roles: ['ADMIN'] });
    expect(canMarkSection(admin, 'sec-b')).toBe(true);

    // Holding the section is not enough without the capability.
    const student = actor({ roles: ['STUDENT'], enrolledSectionIds: ['sec-a'] });
    expect(canMarkSection(student, 'sec-a')).toBe(false);
  });

  it('confines an HOD to their own department', () => {
    const hod = actor({ roles: ['HOD'], headOfDepartmentIds: ['dep-sci'] });
    expect(canAccessDepartment(hod, 'dep-sci')).toBe(true);
    expect(canAccessDepartment(hod, 'dep-hum')).toBe(false);
  });

  it('reduces a list query to the caller\'s own row for a student', () => {
    // The isolation rule has to hold on list and search endpoints too, so it is expressed
    // as a query predicate rather than a post-filter.
    const student = actor({ roles: ['STUDENT'], studentId: 'stu-1' });
    expect(studentScopeFilter(student)).toEqual({ id: 'stu-1' });
  });

  it('reduces a list query to the linked children for a parent', () => {
    const parent = actor({ roles: ['PARENT'], childStudentIds: ['stu-3', 'stu-4'] });
    expect(studentScopeFilter(parent)).toEqual({ id: { in: ['stu-3', 'stu-4'] } });
  });

  it('scopes a teacher to the sections they teach', () => {
    const teacher = actor({ roles: ['TEACHER'], sectionIds: ['sec-a', 'sec-b'] });
    expect(studentScopeFilter(teacher)).toEqual({
      enrolments: { some: { sectionId: { in: ['sec-a', 'sec-b'] }, droppedAt: null } },
    });
  });

  it('leaves campus-wide roles unfiltered', () => {
    expect(studentScopeFilter(actor({ roles: ['ADMIN'] }))).toEqual({});
    expect(studentScopeFilter(actor({ roles: ['BURSAR'] }))).toEqual({});
  });

  it('matches nothing when no scope resolves, rather than everything', () => {
    // Getting this default wrong is how a list endpoint leaks a whole school.
    const teacher = actor({ roles: ['TEACHER'] });
    expect(studentScopeFilter(teacher)).toEqual({ id: { in: [] } });
  });
});
