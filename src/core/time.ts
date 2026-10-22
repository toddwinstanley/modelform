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
