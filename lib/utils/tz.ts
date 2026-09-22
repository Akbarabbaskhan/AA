/**
 * Timezone helpers. "Pakistan Standard Time as the default timezone, stored as UTC,
 * displayed local."
 *
 * Attendance is the reason this has to be exact: a register's lock deadline and the date a
 * period belongs to are both wall-clock facts in the school's own timezone, and a naive
 * `new Date(...)` on a server running in UTC gets them wrong by five hours — which silently
 * moves an 08:00 period into the previous day.
 */
export const PAKISTAN_TIMEZONE = 'Asia/Karachi';

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
export function timezoneOffsetMs(instant: Date, timeZone: string = PAKISTAN_TIMEZONE): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    // Intl renders midnight as hour 24 in some environments.
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second']),
  );

  return asUtc - instant.getTime();
}

/**
 * Turns a wall-clock date and time in the school's timezone into a UTC instant.
 * `date` is `YYYY-MM-DD`, `time` is `HH:mm`.
 */
export function zonedToUtc(date: string, time: string, timeZone: string = PAKISTAN_TIMEZONE): Date {
  const naive = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  if (Number.isNaN(naive.getTime())) {
    throw new Error(`Not a valid date/time: ${date} ${time}`);
  }
  // Correct twice: the offset is looked up at the guessed instant, which is enough for a
  // fixed-offset zone like PKT and converges for zones with DST.
  const firstPass = new Date(naive.getTime() - timezoneOffsetMs(naive, timeZone));
  return new Date(naive.getTime() - timezoneOffsetMs(firstPass, timeZone));
}

/** The `YYYY-MM-DD` the instant falls on in the school's timezone. */
export function zonedDateString(instant: Date, timeZone: string = PAKISTAN_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(instant);
}

/** 1 = Monday … 7 = Sunday, in the school's timezone — matching TimetableSlot.dayOfWeek. */
export function zonedDayOfWeek(instant: Date, timeZone: string = PAKISTAN_TIMEZONE): number {
  const day = new Date(`${zonedDateString(instant, timeZone)}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** `HH:mm` in the school's timezone. */
export function zonedTimeString(instant: Date, timeZone: string = PAKISTAN_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/** A `@db.Date` column round-trips as midnight UTC; this reads it back as a plain date. */
export function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Builds the midnight-UTC Date that a `@db.Date` column stores for a plain date. */
export function toDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}
