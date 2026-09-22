import { Prisma } from '@prisma/client';
import { prisma, getTenantContext } from '@/lib/db';
import type { Actor } from '@/lib/permissions';

/**
 * "Every mutation to marks, attendance, fees, user roles and student records writes an
 * audit_log row: actor, action, entity, before, after, IP, timestamp. This is what protects
 * you when a parent claims a grade was changed."
 *
 * The audit log is a user-facing feature, not just a table — see the admin audit view.
 */
export type AuditableEntity =
  | 'Student'
  | 'Staff'
  | 'AttendanceRecord'
  | 'AttendanceSession'
  | 'Mark'
  | 'Invoice'
  | 'Payment'
  | 'UserRole'
  | 'Enrolment'
  | 'TimetableSlot'
  | 'ImportJob'
  | 'School';

export type AuditEntry = {
  action: string;
  entityType: AuditableEntity;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** Mandatory on amendments — an attendance change after the lock window needs one. */
  reason?: string;
};

/**
 * Prisma distinguishes "SQL NULL" from "JSON null", so a nullable Json column cannot take
 * a plain `null`. Anything undefined becomes a real SQL NULL.
 */
function auditJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function writeAudit(actor: Actor, entry: AuditEntry): Promise<void> {
  const context = getTenantContext();

  await prisma.auditLog.create({
    data: {
      schoolId: actor.schoolId,
      actorUserId: actor.userId,
      // An action taken while impersonating records both people, not just the target.
      impersonatedByUserId: actor.impersonatedByUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJson: auditJson(entry.before),
      afterJson: auditJson(entry.after),
      reason: entry.reason ?? null,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    },
  });
}

/** Batched form for bulk operations — one row per changed entity, one insert. */
export async function writeAuditMany(actor: Actor, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const context = getTenantContext();

  await prisma.auditLog.createMany({
    data: entries.map((entry) => ({
      schoolId: actor.schoolId,
      actorUserId: actor.userId,
      impersonatedByUserId: actor.impersonatedByUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJson: auditJson(entry.before),
      afterJson: auditJson(entry.after),
      reason: entry.reason ?? null,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    })),
  });
}
