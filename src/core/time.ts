/** Grafana-style relative time parsing: "now", "now-6h", "now-1d/d", "now/w", or absolute ISO/epoch-ms. */

export interface TimeRange {
  from: number;
  to: number;
  raw: { from: string; to: string };
}

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export type TimeUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

export function parseTime(expr: string, now = Date.now(), roundUp = false): number {
  const s = expr.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const local = parseLocalDateTime(s);
  if (local != null) return local;
  if (!s.startsWith('now')) {
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error(`Unparseable time: ${expr}`);
    return t;
  }

  let d = new Date(now);
  let rest = s.slice(3);
  const re = /^([+-])(\d+)([smhdwMy])|^\/([smhdwMy])/;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) throw new Error(`Unparseable time: ${expr}`);
    if (m[4]) {
      d = startOf(d, m[4] as TimeUnit, roundUp);
    } else {
      d = addTime(d, (m[1] === '-' ? -1 : 1) * Number(m[2]), m[3] as TimeUnit);
    }
    rest = rest.slice(m[0].length);
  }
  return d.getTime();
}

export function parseRange(raw: { from: string; to: string }, now = Date.now()): TimeRange {
  return { from: parseTime(raw.from, now), to: parseTime(raw.to, now, true), raw };
}

export function addTime(d: Date, n: number, unit: TimeUnit): Date {
  const r = new Date(d);
  if (unit === 'M') r.setMonth(r.getMonth() + n);
  else if (unit === 'y') r.setFullYear(r.getFullYear() + n);
  else r.setTime(r.getTime() + n * UNIT_MS[unit]);
  return r;
}

/** Round down to the start of the unit (local time), or to its last millisecond when roundUp. */
export function startOf(d: Date, unit: TimeUnit, roundUp = false): Date {
  const r = new Date(d);
  switch (unit) {
    case 'y':
      r.setMonth(0, 1);
      r.setHours(0, 0, 0, 0);
      break;
    case 'M':
      r.setDate(1);
      r.setHours(0, 0, 0, 0);
      break;
    case 'w':
      r.setDate(r.getDate() - r.getDay());
      r.setHours(0, 0, 0, 0);
      break;
    case 'd':
      r.setHours(0, 0, 0, 0);
      break;
    case 'h':
      r.setMinutes(0, 0, 0);
      break;
    case 'm':
      r.setSeconds(0, 0);
      break;
    case 's':
      r.setMilliseconds(0);
      break;
  }
  if (roundUp) return new Date(addTime(r, 1, unit).getTime() - 1);
  return r;
}

/** "5m" → 300000. Accepts Grafana interval strings including ms. */
export function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|M|y)$/.exec(s.trim());
  if (!m) throw new Error(`Unparseable duration: ${s}`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 'ms':
      return n;
    case 'M':
      return n * 30 * UNIT_MS.d;
    case 'y':
      return n * 365 * UNIT_MS.d;
    default:
      return n * UNIT_MS[m[2]];
  }
}

/** Pick a query interval the way Grafana does: range / maxDataPoints, snapped to a nice value. */
export function calculateInterval(range: TimeRange, maxDataPoints: number, minIntervalMs = 1000): number {
  const raw = Math.max((range.to - range.from) / Math.max(maxDataPoints, 1), minIntervalMs);
  const nice = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 604800].map(
    (s) => s * 1000,
  );
  return nice.find((n) => n >= raw) ?? raw;
}

export function formatDuration(ms: number): string {
  for (const [unit, size] of [['d', UNIT_MS.d], ['h', UNIT_MS.h], ['m', UNIT_MS.m], ['s', UNIT_MS.s]] as const) {
    if (ms >= size && ms % size === 0) return `${ms / size}${unit}`;
  }
  return `${ms}ms`;
}

export const TIME_PRESETS: { label: string; from: string; to: string }[] = [
  { label: '1h', from: 'now-1h', to: 'now' },
  { label: '6h', from: 'now-6h', to: 'now' },
  { label: '24h', from: 'now-24h', to: 'now' },
  { label: '7d', from: 'now-7d', to: 'now' },
  { label: '30d', from: 'now-30d', to: 'now' },
  { label: '90d', from: 'now-90d', to: 'now' },
  { label: '1y', from: 'now-1y', to: 'now' },
];

/** More relative ranges for the custom range picker, beyond the quick presets. */
export const RELATIVE_RANGES: { label: string; from: string; to: string }[] = [
  { label: 'Today', from: 'now/d', to: 'now/d' },
  { label: 'Yesterday', from: 'now-1d/d', to: 'now-1d/d' },
  { label: 'This week', from: 'now/w', to: 'now/w' },
  { label: 'This month', from: 'now/M', to: 'now/M' },
  { label: 'Last month', from: 'now-1M/M', to: 'now-1M/M' },
  { label: 'This year', from: 'now/y', to: 'now/y' },
  { label: 'Last year', from: 'now-1y/y', to: 'now-1y/y' },
  { label: 'Last 6 months', from: 'now-6M', to: 'now' },
  { label: 'Last 2 years', from: 'now-2y', to: 'now' },
  { label: 'Last 5 years', from: 'now-5y', to: 'now' },
];

/**
 * "2026-03-01", "2026-03-01 14:00" or "2026-03-01T14:00:05" as local time. Date.parse would read a
 * bare date as UTC midnight, which lands on the previous day west of Greenwich.
 */
export function parseLocalDateTime(s: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, sec = 0] = m.slice(1).map((v) => (v == null ? undefined : Number(v))) as number[];
  const date = new Date(y, mo - 1, d, h, mi, sec);
  // Reject overflow like 2026-02-30 rather than rolling into March.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || h > 23 || mi > 59 || sec > 59) return null;
  return date.getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "YYYY-MM-DD HH:mm:ss", the form the range picker shows and parseLocalDateTime reads back. */
export function formatLocalDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** An error message for a time expression the range picker can't use, or null if it parses. */
export function timeExprError(expr: string): string | null {
  if (!expr.trim()) return 'Required';
  try {
    parseTime(expr);
    return null;
  } catch {
    return 'Use a date like 2026-03-01 14:00 or a relative time like now-7d';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A short label for a range: the preset or relative range it matches, else "Mar 1 – Mar 5, 2026" style. */
export function describeRange(raw: { from: string; to: string }, now = Date.now()): string {
  const named = [...TIME_PRESETS, ...RELATIVE_RANGES].find((r) => r.from === raw.from && r.to === raw.to);
  if (named) return named.label;
  let r: TimeRange;
  try {
    r = parseRange(raw, now);
  } catch {
    return `${raw.from} to ${raw.to}`;
  }
  const from = new Date(r.from);
  const to = new Date(r.to);
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameDay = sameYear && from.getMonth() === to.getMonth() && from.getDate() === to.getDate();
  const wholeDays = from.getHours() + from.getMinutes() === 0 && to.getHours() === 23 && to.getMinutes() === 59;
  const day = (d: Date, year: boolean) => `${MONTHS[d.getMonth()]} ${d.getDate()}${year ? `, ${d.getFullYear()}` : ''}`;
  const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const showYear = !sameYear || from.getFullYear() !== new Date(now).getFullYear();
  if (wholeDays) return sameDay ? day(from, showYear) : `${day(from, !sameYear)} – ${day(to, showYear)}`;
  if (sameDay) return `${day(from, showYear)} ${time(from)}–${time(to)}`;
  return `${day(from, !sameYear)} ${time(from)} – ${day(to, showYear)} ${time(to)}`;
}
