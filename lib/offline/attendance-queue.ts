import type { AttendanceStatus } from '@prisma/client';
import {
  STORE_META,
  STORE_QUEUE,
  STORE_REGISTERS,
  count,
  get,
  getAll,
  isOfflineStorageAvailable,
  put,
  remove,
} from './db';

/**
 * The attendance write queue and the register cache.
 *
 * Every entry carries the timestamp of the period it belongs to, not of the moment it is
 * eventually sent — "with the original period timestamp preserved, not the sync time".
 */
export type QueuedMark = {
  studentId: string;
  status: AttendanceStatus;
  minutesLate?: number | null;
  note?: string | null;
};

export type QueuedRegister = {
  /** Client-generated, stable across retries. */
  id: string;
  sectionId: string;
  sectionName: string;
  date: string;
  periodIndex: number;
  /** When the teacher actually marked it. */
  markedAt: string;
  deviceId: string;
  marks: QueuedMark[];
  queuedAt: number;
  attempts: number;
  lastError?: string;
};

export type CachedRegister = {
  key: string;
  cachedAt: number;
  payload: unknown;
};

export function registerKey(sectionId: string, date: string, periodIndex: number): string {
  return `${sectionId}:${date}:${periodIndex}`;
}

/** A stable per-install id, so the server can tell two of a teacher's devices apart. */
export async function getDeviceId(): Promise<string> {
  if (!isOfflineStorageAvailable()) return 'unknown-device';

  const existing = await get<{ key: string; value: string }>(STORE_META, 'deviceId');
  if (existing?.value) return existing.value;

  const value = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}`;
  await put(STORE_META, { key: 'deviceId', value });
  return value;
}

export async function enqueueRegister(
  entry: Omit<QueuedRegister, 'queuedAt' | 'attempts'>,
): Promise<void> {
  await put<QueuedRegister>(STORE_QUEUE, { ...entry, queuedAt: Date.now(), attempts: 0 });
}

export async function pendingRegisters(): Promise<QueuedRegister[]> {
  if (!isOfflineStorageAvailable()) return [];
  const rows = await getAll<QueuedRegister>(STORE_QUEUE);
  return rows.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function pendingCount(): Promise<number> {
  if (!isOfflineStorageAvailable()) return 0;
  return count(STORE_QUEUE);
}

export async function dequeueRegister(id: string): Promise<void> {
  await remove(STORE_QUEUE, id);
}

export async function recordFailure(entry: QueuedRegister, message: string): Promise<void> {
  await put<QueuedRegister>(STORE_QUEUE, {
    ...entry,
    attempts: entry.attempts + 1,
    lastError: message,
  });
}

export async function cacheRegister(
  sectionId: string,
  date: string,
  periodIndex: number,
  payload: unknown,
): Promise<void> {
  if (!isOfflineStorageAvailable()) return;
  await put<CachedRegister>(STORE_REGISTERS, {
    key: registerKey(sectionId, date, periodIndex),
    cachedAt: Date.now(),
    payload,
  });
}

export async function readCachedRegister<T>(
  sectionId: string,
  date: string,
  periodIndex: number,
): Promise<T | null> {
  if (!isOfflineStorageAvailable()) return null;
  const row = await get<CachedRegister>(STORE_REGISTERS, registerKey(sectionId, date, periodIndex));
  return (row?.payload as T | undefined) ?? null;
}

/** Applies a queued register on top of a cached one, so the teacher sees their own marks. */
export function applyQueuedMarks<T extends { students: { studentId: string; status: AttendanceStatus }[] }>(
  register: T,
  queued: QueuedRegister | undefined,
): T {
  if (!queued) return register;
  const byStudent = new Map(queued.marks.map((mark) => [mark.studentId, mark.status]));

  return {
    ...register,
    students: register.students.map((student) => ({
      ...student,
      status: byStudent.get(student.studentId) ?? student.status,
    })),
  };
}
