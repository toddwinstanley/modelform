import type { Dashboard, Panel } from './schema';

/**
 * Input forms reuse the dashboard format: a form is a dashboard whose panels have
 * `input-*` types. Layout, rows and gridPos work exactly like visualization panels,
 * so one layout engine (and one hot-reloadable JSON file) drives both tabs.
 *
 *   { "type": "input-number", "title": "Weight", "gridPos": {"x":0,"y":0,"w":12,"h":3},
 *     "options": { "metric": "weight", "unit": "kg", "step": 0.1, "default": "last" } }
 */

export type InputType =
  | 'input-number'
  | 'input-slider'
  | 'input-select'
  | 'input-toggle'
  | 'input-rating'
  | 'input-text'
  | 'input-counter'
  | 'input-duration';

export interface InputChoice {
  label: string;
  value: number | string;
}

export interface InputOptions {
  /** The metric this input records to. Visualization queries select data by this name. */
  metric: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /**
   * input-slider only: text spaced evenly along the track, first at min and last at max,
   * e.g. ["Understeer", "Neutral", "Oversteer"]. Replaces the numeric min/max labels.
   */
  labels?: string[];
  /** Initial value: a literal, or "last" to start from the most recent entry. */
  default?: number | string | boolean | 'last';
  /**
   * "changed" (the default) records the value only when it was edited before Save;
   * "always" records it on every Save, so a default like "last" is kept with each save.
   */
  record?: 'changed' | 'always';
  /** input-select only. */
  choices?: InputChoice[];
  /**
   * input-select only: take the choices from the app at runtime instead of `choices`,
   * for lists that live in app data (e.g. wheel sets). Names a key of InputForm's `choices` prop.
   */
  choicesFrom?: string;
  /** input-select only: allow selecting several. Each selection is recorded as its own entry. */
  multi?: boolean;
  /** input-counter only: the amount each tap records (default 1). */
  increment?: number;
  /** input-text only: a single-line field that suggests values recorded earlier, matching what's typed. */
  suggest?: boolean;
  /**
   * input-text with `suggest` only: another input's metric whose current value narrows the
   * suggestions to values saved alongside it (e.g. configurations of the chosen track).
   * Falls back to every earlier value when none were.
   */
  suggestWith?: string;
}

/** The options each input type reads, for editors to offer. */
export const INPUT_OPTION_KEYS: Record<InputType, (keyof InputOptions)[]> = {
  'input-number': ['metric', 'unit', 'step', 'min', 'max', 'default', 'record'],
  'input-slider': ['metric', 'min', 'max', 'step', 'unit', 'labels', 'default', 'record'],
  'input-select': ['metric', 'choices', 'choicesFrom', 'multi', 'placeholder', 'default', 'record'],
  'input-toggle': ['metric', 'default', 'record'],
  'input-rating': ['metric', 'min', 'max', 'default', 'record'],
  'input-text': ['metric', 'placeholder', 'suggest', 'suggestWith', 'default', 'record'],
  'input-counter': ['metric', 'increment', 'unit'],
  'input-duration': ['metric', 'placeholder', 'default', 'record'],
};

export const INPUT_TYPES = Object.keys(INPUT_OPTION_KEYS) as InputType[];

export const isInputType = (type: string): type is InputType => type in INPUT_OPTION_KEYS;

export type InputPanel = Panel & { type: InputType; options: InputOptions };

export const isInputPanel = (p: Panel): p is InputPanel => p.type.startsWith('input-') && !!p.options?.metric;

export function inputPanels(dashboard: Dashboard): InputPanel[] {
  const all = dashboard.panels.flatMap((p) => (p.type === 'row' ? [p, ...(p.panels ?? [])] : [p]));
  return all.filter(isInputPanel);
}

/**
 * input-duration: lap-timer style MM:SS.hh. Digits fill from the right as they're typed,
 * so "13245" reads 01:32.45, which is recorded as 92.45 seconds.
 */
export function parseClockDigits(digits: string): number | null {
  const d = digits.replace(/\D/g, '').slice(-6);
  if (!d) return null;
  const p = d.padStart(6, '0');
  const m = Number(p.slice(0, 2));
  const s = Number(p.slice(2, 4));
  const h = Number(p.slice(4, 6));
  if (s > 59) return null;
  return Math.round((m * 60 + s + h / 100) * 100) / 100;
}

/** Seconds → MM:SS.hh (minutes widen past 99). */
export function formatClock(seconds: number): string {
  const total = Math.round(seconds * 100);
  const m = Math.floor(total / 6000);
  const s = Math.floor((total % 6000) / 100);
  const h = total % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(h).padStart(2, '0')}`;
}

/** A form value as held by the UI before saving. */
export type InputValue = number | string | boolean | (number | string)[] | null;

/** One recorded data point. `value` holds numbers (and booleans as 0/1); `text` holds free text and string choices. */
export interface Entry {
  id: string;
  metric: string;
  ts: number;
  value: number | null;
  text: string | null;
}

export type NewEntry = Omit<Entry, 'id'>;

export function toEntries(panel: InputPanel, value: InputValue, ts: number): NewEntry[] {
  if (value == null || value === '') return [];
  const metric = panel.options.metric;
  const one = (v: number | string | boolean): NewEntry =>
    typeof v === 'string'
      ? { metric, ts, value: null, text: v }
      : { metric, ts, value: typeof v === 'boolean' ? (v ? 1 : 0) : v, text: null };
  return Array.isArray(value) ? value.map(one) : [one(value)];
}

export function entryToInputValue(panel: InputPanel, entry: Entry | undefined): InputValue {
  if (!entry) return null;
  if (panel.type === 'input-toggle') return entry.value === 1;
  return entry.text ?? entry.value;
}

/**
 * Earlier text values worth offering for `query`, most recently used first, one per
 * spelling (ignoring case). Matches words starting with the query; an empty query
 * matches everything. Leaves out `query` itself once it's typed in full.
 */
export function textSuggestions(entries: Entry[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...entries].sort((a, b) => b.ts - a.ts)) {
    const text = e.text?.trim();
    const key = text?.toLowerCase();
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    if (key === q) continue;
    if (q && !key.startsWith(q) && !key.split(/[\s\-/(]+/).some((w) => w.startsWith(q))) continue;
    out.push(text);
    if (out.length === limit) break;
  }
  return out;
}

/**
 * Entries of `metric` saved together with (at the same time as) a `withMetric` entry
 * whose text is `withText`, ignoring case.
 */
export function entriesSavedWith(entries: Entry[], metric: string, withMetric: string, withText: string): Entry[] {
  const want = withText.trim().toLowerCase();
  const times = new Set(entries.filter((e) => e.metric === withMetric && e.text?.trim().toLowerCase() === want).map((e) => e.ts));
  return entries.filter((e) => e.metric === metric && times.has(e.ts));
}
