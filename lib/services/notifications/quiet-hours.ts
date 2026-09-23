/**
 * Quiet hours.
 *
 * "Quiet hours 21:00–07:00 for anything non-urgent." Pure arithmetic, no database and no
 * Date parsing of the school's timezone at the call site, so the rule that decides whether
 * a parent's phone buzzes at midnight is exhaustively testable.
 *
 * The window wraps midnight, which is the case a naive `from <= now && now <= to` gets
 * wrong — and gets wrong silently, in the direction of sending.
 */

export type QuietHours = { from: string; to: string };

export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function isWithinQuietHours(nowMinutes: number, window: QuietHours): boolean {
  const from = minutesOfDay(window.from);
  const to = minutesOfDay(window.to);
  // A window that does not wrap (say 13:00–14:00) is the simple case.
  if (from < to) return nowMinutes >= from && nowMinutes < to;
  // 21:00–07:00 wraps: quiet if we are after the start OR before the end.
  if (from > to) return nowMinutes >= from || nowMinutes < to;
  // from === to means no quiet hours at all rather than a 24-hour blackout. A school that
  // sets 00:00–00:00 means "never hold anything", and the other reading silences the
  // system permanently with no error.
  return false;
}

/**
 * When a held message should go out.
 *
 * Returns null when nothing is held. Otherwise the next boundary, so a batch queued at
 * 23:10 is delivered at 07:00 rather than being dropped or sent at once in the morning
 * rush as a backlog.
 */
export function releaseAt(now: Date, window: QuietHours, timezoneOffsetMinutes: number): Date | null {
  const local = new Date(now.getTime() + timezoneOffsetMinutes * 60_000);
  const nowMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (!isWithinQuietHours(nowMinutes, window)) return null;

  const to = minutesOfDay(window.to);
  const release = new Date(local);
  release.setUTCHours(Math.floor(to / 60), to % 60, 0, 0);
  // Still before the end of the window today means the release is later today; otherwise
  // we are in the evening part of a wrapping window and it releases tomorrow morning.
  if (release.getTime() <= local.getTime()) release.setUTCDate(release.getUTCDate() + 1);

  return new Date(release.getTime() - timezoneOffsetMinutes * 60_000);
}
