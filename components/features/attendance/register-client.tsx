'use client';

import type { AttendanceStatus } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { OfflineIndicator, useOnlineStatus } from '@/components/features/offline-indicator';
import {
  applyQueuedMarks,
  cacheRegister,
  enqueueRegister,
  getDeviceId,
  pendingRegisters,
  readCachedRegister,
} from '@/lib/offline/attendance-queue';
import { drainQueue } from '@/lib/offline/sync-client';
import { cn } from '@/lib/utils/cn';
import type { Register, RegisterStudent } from '@/lib/services/attendance/register';

/**
 * The register.
 *
 * "Open app → today's classes are already on the dashboard → tap a class → the register
 * opens with every student pre-marked present → teacher taps only the absentees → submit.
 * Target: a 30-student register marked in under 15 seconds."
 *
 * Everything here serves that number. One tap marks a student absent, because that is the
 * only thing most teachers need to record. Press and hold cycles the rarer statuses. The
 * submit button is bottom-anchored so it is under a thumb, not in a corner.
 */

const CYCLE: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
const LONG_PRESS_MS = 450;

const STATUS_STYLES: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
  ABSENT: 'bg-[var(--danger)] text-[var(--brand-on-primary)] border-[var(--danger)]',
  LATE: 'bg-[var(--warning)] text-[var(--brand-on-primary)] border-[var(--warning)]',
  EXCUSED: 'bg-[var(--info)] text-[var(--brand-on-primary)] border-[var(--info)]',
  LEAVE: 'bg-[var(--info)] text-[var(--brand-on-primary)] border-[var(--info)]',
};

export function RegisterClient({ initial }: { initial: Register }) {
  const t = useTranslations('attendance');
  const online = useOnlineStatus();

  const [register, setRegister] = useState<Register>(initial);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  // Cache the register so the same class opens instantly, and opens at all, with no signal.
  useEffect(() => {
    void cacheRegister(initial.sectionId, initial.date, initial.periodIndex, initial);
  }, [initial]);

  // If this register is sitting in the offline queue, show the teacher their own marks
  // rather than the stale server copy.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cached, queued] = await Promise.all([
        readCachedRegister<Register>(initial.sectionId, initial.date, initial.periodIndex),
        pendingRegisters(),
      ]);
      if (cancelled) return;

      const match = queued.find(
        (entry) =>
          entry.sectionId === initial.sectionId &&
          entry.date === initial.date &&
          entry.periodIndex === initial.periodIndex,
      );
      if (match) setRegister(applyQueuedMarks(cached ?? initial, match));
    })();
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const setStatus = useCallback((studentId: string, next: AttendanceStatus) => {
    setRegister((current) => ({
      ...current,
      students: current.students.map((student) =>
        student.studentId === studentId ? { ...student, status: next } : student,
      ),
    }));
  }, []);

  const toggle = useCallback(
    (student: RegisterStudent) => {
      // One tap is the whole interaction for the common case.
      setStatus(student.studentId, student.status === 'PRESENT' ? 'ABSENT' : 'PRESENT');
    },
    [setStatus],
  );

  const cycle = useCallback(
    (student: RegisterStudent) => {
      const index = CYCLE.indexOf(student.status);
      const next = CYCLE[(index + 1) % CYCLE.length]!;
      setStatus(student.studentId, next);
    },
    [setStatus],
  );

  const markAll = useCallback((status: AttendanceStatus) => {
    setRegister((current) => ({
      ...current,
      students: current.students.map((student) => ({ ...student, status })),
    }));
  }, []);

  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    for (const student of register.students) {
      if (student.status === 'PRESENT' || student.status === 'LATE') present += 1;
      if (student.status === 'ABSENT') absent += 1;
    }
    return { present, absent };
  }, [register.students]);

  async function submit() {
    if (saving || register.isLocked) return;
    setSaving(true);
    setSavedMessage(null);

    const marks = register.students.map((student) => ({
      studentId: student.studentId,
      status: student.status,
      minutesLate: student.minutesLate ?? null,
    }));
    // The moment the teacher pressed submit, which is the period's timestamp — not
    // whenever this eventually reaches the server.
    const markedAt = new Date().toISOString();
    /*
     * Sent on the online path too, not only when queueing. The server uses it to tell a
     * correction from this phone apart from a second teacher's device: without it, a
     * register marked online and then corrected offline from the same phone loses to its
     * own earlier timestamp and the fix is silently dropped.
     */
    const deviceId = await getDeviceId();

    try {
      if (!online) throw new Error('offline');

      const response = await fetch('/api/attendance/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sectionId: register.sectionId,
          date: register.date,
          periodIndex: register.periodIndex,
          markedAt,
          deviceId,
          marks,
        }),
      });

      if (!response.ok) throw new Error(`status ${response.status}`);

      setRegister((current) => ({ ...current, isMarked: true, markedAt }));
      setSavedMessage(t('savedOnline'));
    } catch {
      /*
       * No signal, or the request failed. Queue it and tell the teacher plainly that their
       * work is safe — this is the moment the product either earns trust or loses it.
       */
      await enqueueRegister({
        id: globalThis.crypto?.randomUUID?.() ?? `${register.sectionId}-${Date.now()}`,
        sectionId: register.sectionId,
        sectionName: register.sectionName,
        date: register.date,
        periodIndex: register.periodIndex,
        markedAt,
        deviceId,
        marks,
      });
      setRegister((current) => ({ ...current, isMarked: true, markedAt }));
      setSavedMessage(t('savedOffline'));
      // If we were merely unlucky rather than offline, this clears it straight away.
      if (online) void drainQueue();
    } finally {
      setSaving(false);
    }
  }

  function startLongPress(student: RegisterStudent) {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      cycle(student);
    }, LONG_PRESS_MS);
  }

  function endLongPress(student: RegisterStudent) {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (!longPressFired.current) toggle(student);
    longPressFired.current = false;
  }

  return (
    <div className="flex flex-col gap-2 pb-[calc(var(--bottom-nav-height)+8rem)] desktop:pb-4">
      <OfflineIndicator />

      <header className="flex flex-col gap-1">
        <p className="text-small text-[var(--text-tertiary)]">
          {register.periodLabel} · {register.startTime}–{register.endTime}
          {register.roomName ? ` · ${register.roomName}` : ''}
        </p>
        <h1 className="text-h1">{register.subjectName}</h1>
        <p className="text-body text-[var(--text-secondary)]">
          {register.sectionName} · {t('students', { count: register.students.length })}
        </p>
      </header>

      {register.isLocked ? (
        <div role="alert" className="rounded-card border border-[var(--border-subtle)] p-3">
          <p className="text-h3 text-[var(--danger)]">{t('locked')}</p>
          <p className="text-body text-[var(--text-secondary)]">{t('lockedBody')}</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1">
            <Button type="button" variant="secondary" onClick={() => markAll('PRESENT')}>
              {t('markAllPresent')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => markAll('ABSENT')}>
              {t('markAllAbsent')}
            </Button>
          </div>
          <p className="text-small text-[var(--text-tertiary)]">{t('tapHint')}</p>
        </>
      )}

      <ul className="flex flex-col gap-1">
        {register.students.map((student) => (
          <li key={student.studentId}>
            <button
              type="button"
              disabled={register.isLocked}
              onPointerDown={() => startLongPress(student)}
              onPointerUp={() => endLongPress(student)}
              onPointerLeave={() => {
                if (longPressTimer.current) clearTimeout(longPressTimer.current);
              }}
              onContextMenu={(event) => event.preventDefault()}
              aria-label={`${student.name}, ${t(`status.${student.status}`)}`}
              className={cn(
                'flex min-h-tap w-full items-center gap-2 rounded-card border p-1 text-start',
                'transition-colors duration-fast ease-out disabled:opacity-60',
                'border-[var(--border-subtle)] bg-[var(--surface-raised)]',
                'touch-manipulation select-none',
              )}
            >
              {/* Teachers identify faces faster than names. */}
              {student.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- student photos come from tenant storage
                <img
                  src={student.photoUrl}
                  alt=""
                  width={40}
                  height={40}
                  loading="lazy"
                  className="h-10 w-10 shrink-0 rounded-pill object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-[var(--surface)] text-small font-medium text-[var(--text-secondary)]"
                >
                  {student.name.slice(0, 1)}
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body text-[var(--text-primary)]">{student.name}</span>
                <span data-numeric className="font-mono text-small text-[var(--text-tertiary)]">
                  {student.rollNumber}
                </span>
              </span>

              <span
                className={cn(
                  'shrink-0 rounded-pill border px-2 py-1 text-small font-medium',
                  STATUS_STYLES[student.status],
                )}
              >
                {t(`status.${student.status}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {register.isLocked ? null : (
        <div
          className={cn(
            // Anchored directly above the tab bar, not on top of it: z-index alone would
            // leave the button overlapping navigation a thumb is also aiming for.
            'fixed inset-x-0 z-40 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] p-2',
            'bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))]',
            'desktop:static desktop:border-0 desktop:bg-transparent desktop:p-0',
          )}
        >
          <div className="mx-auto flex max-w-container flex-col gap-1">
            <p aria-live="polite" className="text-small text-[var(--text-secondary)]">
              {savedMessage ??
                `${t('presentCount', { count: counts.present })} · ${t('absentCount', { count: counts.absent })}`}
            </p>
            {/* Bottom-anchored so the primary action is under a thumb, never top-right. */}
            <Button type="button" size="lg" full onClick={() => void submit()} disabled={saving}>
              {saving ? t('submitting') : t('submit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
