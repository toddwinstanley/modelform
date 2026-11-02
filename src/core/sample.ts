/**
 * Made-up entries for previewing a config before anything has been recorded. Each metric gets
 * values shaped by the input that records it (choices for a select, whole stars for a rating,
 * the slider's range, and so on), the same every time for the same metric.
 */
import { inputPanels, type InputChoice, type NewEntry } from './inputs';
import type { Dashboard } from './schema';

const DAY = 86_400_000;

/** A small seedable generator (mulberry32), seeded from the metric's name. */
function random(seed: string) {
  let a = 0;
  for (const c of seed) a = (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Maker = (next: () => number, day: number) => { value: number | null; text: string | null }[];

/** A value that wanders between lo and hi rather than jumping about. */
function walk(lo: number, hi: number, step?: number): Maker {
  let v: number | undefined;
  return (next) => {
    v ??= lo + (hi - lo) * (0.3 + next() * 0.4);
    v = Math.min(hi, Math.max(lo, v + (next() - 0.5) * (hi - lo) * 0.15));
    const value = step ? Math.round(v / step) * step : Math.round(v * 10) / 10;
    return [{ value, text: null }];
  };
}

function maker(type: string, o: Record<string, unknown>): Maker {
  const num = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : undefined);
  const pick = <T,>(xs: T[], next: () => number) => xs[Math.floor(next() * xs.length)];
  switch (type) {
    case 'input-select': {
      const choices = (Array.isArray(o.choices) ? o.choices : []).filter((c: InputChoice) => c && (typeof c.value === 'string' || typeof c.value === 'number')) as InputChoice[];
      const values = choices.length ? choices.map((c) => c.value) : ['a', 'b', 'c'];
      return (next) => {
        const v = pick(values, next);
        return [typeof v === 'number' ? { value: v, text: null } : { value: null, text: v }];
      };
    }
    case 'input-toggle':
      return (next) => [{ value: next() < 0.6 ? 1 : 0, text: null }];
    case 'input-rating': {
      const min = Math.round(num('min') ?? 1);
      const max = Math.max(min, Math.round(num('max') ?? 5));
      return walk(min, max, 1);
    }
    case 'input-text':
      return (next) => [{ value: null, text: pick(['Felt good', 'Tired', 'Busy day', 'Rested'], next) }];
    case 'input-counter': {
      const increment = num('increment') ?? 1;
      return (next) => Array.from({ length: Math.floor(next() * 4) }, () => ({ value: increment, text: null }));
    }
    case 'input-duration':
      return walk(15 * 60, 90 * 60, 60);
    default: {
      const min = num('min');
      const max = num('max');
      const lo = min ?? (max !== undefined ? max - 100 : 40);
      const hi = max !== undefined && max > lo ? max : lo + (min !== undefined ? 100 : 40);
      return walk(lo, hi, num('step'));
    }
  }
}

/**
 * Entries for each metric over the last `days`, most days having one (counters may have
 * several). Metrics a form records take their shape from its input; any other is a number
 * wandering around 60.
 */
export function sampleEntries(forms: Dashboard[], metrics: Iterable<string>, now = Date.now(), days = 180): NewEntry[] {
  const makers = new Map<string, Maker>();
  for (const form of forms) for (const p of inputPanels(form)) if (!makers.has(p.options.metric)) makers.set(p.options.metric, maker(p.type, p.options as unknown as Record<string, unknown>));
  const out: NewEntry[] = [];
  for (const metric of new Set([...metrics, ...makers.keys()])) {
    const next = random(metric);
    const make = makers.get(metric) ?? walk(40, 80);
    for (let d = days - 1; d >= 0; d--) {
      if (next() < 0.2) continue;
      const day = Math.floor(now / DAY - d) * DAY;
      for (const e of make(next, d)) out.push({ metric, ts: Math.min(now, day + (7 + next() * 14) * 3_600_000), ...e });
    }
  }
  return out;
}
