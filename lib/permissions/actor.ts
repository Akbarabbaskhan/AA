import type { RoleName } from '@prisma/client';
import { ROLE_CAPABILITIES, type Capability } from './capabilities';

/**
 * Everything a permission decision needs, resolved once per request from the session.
 *
 * The scope arrays are what make this row-level rather than role-level: a teacher holds
 * `attendance.mark`, but only for the sections in `sectionIds`.
 */
export type Actor = {
  userId: string;
  schoolId: string;
  roles: readonly RoleName[];
  /** Set when a Super Admin is acting as this user. Every mutation records it. */
  impersonatedByUserId?: string;

  staffId?: string;
  studentId?: string;
  guardianId?: string;

  /** Sections the actor teaches. Empty for non-teaching roles. */
  sectionIds: readonly string[];
  /** Sections the actor is enrolled in. Empty for non-students. */
  enrolledSectionIds: readonly string[];
  /** Departments the actor heads. Empty unless HOD. */
  headOfDepartmentIds: readonly string[];
  /** Students linked to this guardian. Empty unless parent. */
  childStudentIds: readonly string[];
};

export class ForbiddenError extends Error {
  override readonly name = 'ForbiddenError';
  readonly status = 403;
  constructor(
    message: string,
    readonly capability?: Capability,
  ) {
    super(message);
  }
}

export function capabilitiesOf(roles: readonly RoleName[]): ReadonlySet<Capability> {
  const set = new Set<Capability>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role]) set.add(capability);
  }
  return set;
}

/** Role-level check. Necessary, never sufficient — row scope is checked separately. */
export function can(actor: Actor, capability: Capability): boolean {
  return capabilitiesOf(actor.roles).has(capability);
}

export function requireCapability(actor: Actor, capability: Capability): void {
  if (!can(actor, capability)) {
    throw new ForbiddenError(`Missing capability: ${capability}`, capability);
  }
}

export function hasRole(actor: Actor, role: RoleName): boolean {
  return actor.roles.includes(role);
}

/**
 * Whether the actor may read a whole section's marks — a register of everyone's results,
 * not their own.
 *
 * Deliberately excludes `marks.read.own` and `marks.read.children`. Those are permission to
 * see one person's results, and a student holds the first of them: counting it here would
 * let any student enrolled in a section open that section's marks grid and read every
 * classmate's marks, which is exactly what "students must never be able to read another
 * student's marks through any endpoint" forbids.
 */
export function canReadSectionMarks(actor: Actor): boolean {
  return (
    can(actor, 'marks.read.section') ||
    can(actor, 'marks.read.department') ||
    can(actor, 'marks.read.school')
  );
}

/** The same distinction for attendance: a whole register, not one student's record. */
export function canReadSectionAttendance(actor: Actor): boolean {
  return (
    can(actor, 'attendance.read.section') ||
    can(actor, 'attendance.read.department') ||
    can(actor, 'attendance.read.school')
  );
}

// ---------------------------------------------------------------------------
// Row-level scope
// ---------------------------------------------------------------------------

/**
 * Can this actor see this student's record?
 *
 * A student sees only themselves; a parent only their linked children; a teacher only
 * students enrolled in a section they teach; admins and coordinators the whole campus.
 * A bursar can see that a student exists (they invoice them) but is blocked from academic
 * data by capability, not by this function.
 */
export function canAccessStudent(
  actor: Actor,
  studentId: string,
  studentSectionIds: readonly string[] = [],
): boolean {
  if (actor.studentId === studentId) return true;
  if (actor.childStudentIds.includes(studentId)) return true;
  if (hasRole(actor, 'ADMIN') || hasRole(actor, 'BURSAR')) return true;
  if (actor.sectionIds.some((id) => studentSectionIds.includes(id))) return true;
  return false;
}

export function assertCanAccessStudent(
  actor: Actor,
  studentId: string,
  studentSectionIds: readonly string[] = [],
): void {
  if (!canAccessStudent(actor, studentId, studentSectionIds)) {
    // Deliberately vague: confirming a student exists is itself a disclosure.
    throw new ForbiddenError('Student not accessible to this user');
  }
}

/** A teacher marks only the sections they teach. Admins mark any section. */
export function canMarkSection(actor: Actor, sectionId: string): boolean {
  if (!can(actor, 'attendance.mark')) return false;
  if (hasRole(actor, 'ADMIN')) return true;
  return actor.sectionIds.includes(sectionId);
}

export function canAccessSection(actor: Actor, sectionId: string): boolean {
  if (hasRole(actor, 'ADMIN')) return true;
  if (actor.sectionIds.includes(sectionId)) return true;
  if (actor.enrolledSectionIds.includes(sectionId)) return true;
  return false;
}

export function assertCanAccessSection(actor: Actor, sectionId: string): void {
  if (!canAccessSection(actor, sectionId)) {
    throw new ForbiddenError('Section not accessible to this user');
  }
}

/** An HOD sees only their own department. */
export function canAccessDepartment(actor: Actor, departmentId: string): boolean {
  if (hasRole(actor, 'ADMIN')) return true;
  return actor.headOfDepartmentIds.includes(departmentId);
}

export function assertCanAccessDepartment(actor: Actor, departmentId: string): void {
  if (!canAccessDepartment(actor, departmentId)) {
    throw new ForbiddenError('Department not accessible to this user');
  }
}

/**
 * The "students must never read another student's marks, remarks, fee status or contact
 * details through any endpoint, including list endpoints and search" rule, as a query
 * predicate.
 *
 * Services compose this into their `where` clause so the restriction is applied by the
 * database rather than by filtering results after the fact — which is what makes it hold
 * on list endpoints, on search, and on every paginated page rather than only the first.
 *
 * The shape is deliberately Prisma-compatible without importing Prisma: this module is
 * pure, so the whole matrix stays unit-testable with no database.
 */
export type StudentScopeFilter =
  | Record<never, never>
  | { id: string }
  | { id: { in: string[] } }
  | { enrolments: { some: { sectionId: { in: string[] }; droppedAt: null } } };

export function studentScopeFilter(actor: Actor): StudentScopeFilter {
  // Campus-wide roles. A bursar sees that a student exists because they invoice them;
  // capability checks keep them out of the academic data.
  if (hasRole(actor, 'ADMIN') || hasRole(actor, 'BURSAR')) return {};

  if (actor.studentId) return { id: actor.studentId };
  if (actor.childStudentIds.length > 0) return { id: { in: [...actor.childStudentIds] } };

  // Teachers and HODs are scoped by the sections they teach, which is a join rather than
  // an id list.
  if (actor.sectionIds.length > 0) {
    return { enrolments: { some: { sectionId: { in: [...actor.sectionIds] }, droppedAt: null } } };
  }

  // No scope resolved: match nothing rather than everything. Getting this default wrong
  // is how a list endpoint leaks a whole school.
  return { id: { in: [] } };
}
