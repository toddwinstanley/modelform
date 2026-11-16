import type { Dashboard, DocumentKind, Panel } from './schema';

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
  /** Save waits until this has a value. */
  required?: boolean;
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
  'input-number': ['metric', 'unit', 'step', 'min', 'max', 'required', 'default', 'record'],
  'input-slider': ['metric', 'min', 'max', 'step', 'unit', 'labels', 'required', 'default', 'record'],
  'input-select': ['metric', 'choices', 'choicesFrom', 'multi', 'placeholder', 'required', 'default', 'record'],
  'input-toggle': ['metric', 'default', 'record'],
  'input-rating': ['metric', 'min', 'max', 'required', 'default', 'record'],
  'input-text': ['metric', 'placeholder', 'suggest', 'suggestWith', 'required', 'default', 'record'],
  'input-counter': ['metric', 'increment', 'unit'],
  'input-duration': ['metric', 'placeholder', 'required', 'default', 'record'],
};

export const INPUT_TYPES = Object.keys(INPUT_OPTION_KEYS) as InputType[];

export const isInputType = (type: string): type is InputType => type in INPUT_OPTION_KEYS;

export type InputPanel = Panel & { type: InputType; options: InputOptions };

export const isInputPanel = (p: Panel): p is InputPanel => p.type.startsWith('input-') && !!p.options?.metric;

/** One field of an input-group: an input panel without `id` or `gridPos`, `span` columns (of 24) wide in its item. */
export interface GroupField {
  type: InputType;
  title?: string;
  description?: string;
  /** Width inside an item, out of 24 (default 24). */
  span?: number;
  options: InputOptions;
}

/**
 * input-group: fields filled in once per item, for as many items as the user adds (the
 * entree and sides of a meal, the sets of a workout). Each field records to its own
 * metric; entries of one item share `save` and `item`.
 */
export interface InputGroupOptions {
  /** The inputs each item has. Any input type but input-counter. */
  fields: GroupField[];
  /** Items are titled "<itemTitle> 1", "<itemTitle> 2"… (default "Item"). */
  itemTitle?: string;
  /** A field's metric whose value titles its item once it has one. */
  titleFrom?: string;
  /** Fewest items Save accepts (default 0). Items left completely empty don't count. */
  min?: number;
  /** Most items the user can add. */
  max?: number;
  /** Empty items a new form starts with (default 1), or "last" for the items saved last time. */
  start?: number | 'last';
  /** Text of the add button (default "Add <itemTitle>"). */
  addLabel?: string;
}

export const INPUT_GROUP = 'input-group';

export type InputGroupPanel = Panel & { type: typeof INPUT_GROUP; options: InputGroupOptions };

/** Panel types that belong in forms: the inputs and input-group. */
export const isFormPanelType = (type: string) => isInputType(type) || type === INPUT_GROUP;

export const isInputGroup = (p: Panel): p is InputGroupPanel => p.type === INPUT_GROUP && Array.isArray(p.options?.fields);

/** Input types a group's fields can have. */
export const GROUP_FIELD_TYPES = INPUT_TYPES.filter((t) => t !== 'input-counter');

/** A group's fields as input panels, the shape the input components and helpers take. Fields without a metric are left out. */
export function groupFields(group: InputGroupPanel): InputPanel[] {
  return group.options.fields
    .filter((f) => f && isInputType(f.type) && f.type !== 'input-counter' && typeof f.options?.metric === 'string' && f.options.metric)
    .map(({ span, ...f }) => ({ ...f, gridPos: { x: 0, y: 0, w: span ?? 24, h: 3 } }) as InputPanel);
}

const panelsOf = (dashboard: Dashboard) => dashboard.panels.flatMap((p) => (p.type === 'row' ? [p, ...(p.panels ?? [])] : [p]));

/** Every input that records, groups' fields included. */
export function inputPanels(dashboard: Dashboard): InputPanel[] {
  return panelsOf(dashboard).flatMap((p) => (isInputGroup(p) ? groupFields(p) : isInputPanel(p) ? [p] : []));
}

/**
 * Whether a document is a form or a dashboard: its `kind` when it states one, otherwise a form
 * if it has inputs. Prefer stating `kind`: a guess changes when a form's last input is removed.
 */
export function documentKind(dashboard: Partial<Dashboard>): DocumentKind {
  if (dashboard.kind === 'form' || dashboard.kind === 'dashboard') return dashboard.kind;
  return Array.isArray(dashboard.panels) && inputPanels(dashboard as Dashboard).length ? 'form' : 'dashboard';
}

/** The form's input-group panels. */
export function inputGroups(dashboard: Dashboard): InputGroupPanel[] {
  return panelsOf(dashboard).filter(isInputGroup);
}

/** Inputs outside groups. */
export function plainInputPanels(dashboard: Dashboard): InputPanel[] {
  return panelsOf(dashboard).filter(isInputPanel);
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
  /** Id of the Save that recorded it, shared by every entry of that Save. Missing on entries recorded before saves had ids. */
  save?: string | null;
  /** Position (0, 1, 2…) of the input-group item it belongs to; null outside a group. */
  item?: number | null;
}

export type NewEntry = Omit<Entry, 'id'>;

/** Where an entry came from: the Save, and the group item within it. */
export interface EntryOrigin {
  save?: string | null;
  item?: number | null;
}

export function toEntries(panel: InputPanel, value: InputValue, ts: number, origin: EntryOrigin = {}): NewEntry[] {
  if (value == null || value === '') return [];
  const metric = panel.options.metric;
  const extra: EntryOrigin = {};
  if (origin.save != null) extra.save = origin.save;
  if (origin.item != null) extra.item = origin.item;
  const one = (v: number | string | boolean): NewEntry =>
    typeof v === 'string'
      ? { metric, ts, value: null, text: v, ...extra }
      : { metric, ts, value: typeof v === 'boolean' ? (v ? 1 : 0) : v, text: null, ...extra };
  return Array.isArray(value) ? value.map(one) : [one(value)];
}

/** An id for one Save. Unique enough to tell saves apart, without needing a crypto API. */
export function newSaveId(now = Date.now()): string {
  const rand = () => Math.floor(Math.random() * 0x100000000).toString(36).padStart(7, '0');
  return `${now.toString(36)}-${rand()}${rand()}`;
}

/** The values of one input-group item, keyed by field metric. */
export type GroupItem = Record<string, InputValue>;

const isEmptyValue = (v: InputValue | undefined) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** Whether an item has nothing filled in. Empty items aren't recorded, checked or counted. Toggles don't count as filled in. */
export function isEmptyItem(group: InputGroupPanel, item: GroupItem): boolean {
  return groupFields(group).every((f) => f.type === 'input-toggle' || isEmptyValue(item[f.options.metric]));
}

/** Entries for a group's items, numbered in order, skipping empty items. */
export function groupToEntries(group: InputGroupPanel, items: GroupItem[], ts: number, save?: string | null): NewEntry[] {
  const fields = groupFields(group);
  return items
    .filter((item) => !isEmptyItem(group, item))
    .flatMap((item, i) => fields.flatMap((f) => toEntries(f, item[f.options.metric] ?? null, ts, { save, item: i })));
}

/** Rebuilds a group's items from the entries of one Save, in item order. */
export function entriesToItems(group: InputGroupPanel, entries: Entry[]): GroupItem[] {
  const fields = groupFields(group);
  const byItem = new Map<number, Entry[]>();
  for (const e of entries) {
    if (e.item == null || !fields.some((f) => f.options.metric === e.metric)) continue;
    byItem.set(e.item, [...(byItem.get(e.item) ?? []), e]);
  }
  return [...byItem.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const mine = byItem.get(k)!;
      const item: GroupItem = {};
      for (const f of fields) {
        const es = mine.filter((e) => e.metric === f.options.metric);
        if (es.length) item[f.options.metric] = f.options.multi ? es.map((e) => (e.text ?? e.value)!) : entryToInputValue(f, es[0]);
      }
      return item;
    });
}

/** A group's problems before Save: too few items, or items with fields that need fixing ("Set 3: Reps is required"). */
export function groupProblems(group: InputGroupPanel, items: GroupItem[]): string[] {
  const fields = groupFields(group);
  const label = group.options.itemTitle || 'Item';
  const filled = items.map((item, i) => ({ item, n: i + 1 })).filter(({ item }) => !isEmptyItem(group, item));
  const out: string[] = [];
  const { min, max } = group.options;
  if (typeof min === 'number' && filled.length < min) out.push(`${group.title || label}: at least ${min} ${min === 1 ? label.toLowerCase() : `${label.toLowerCase()}s`}`);
  if (typeof max === 'number' && filled.length > max) out.push(`${group.title || label}: at most ${max}`);
  for (const { item, n } of filled)
    for (const f of fields) {
      const problem = inputProblem(f, item[f.options.metric] ?? null);
      if (problem) out.push(`${label} ${n}: ${f.title || f.options.metric} ${problem === 'Required' ? 'is required' : problem.toLowerCase()}`);
    }
  return out;
}

/** The Save `entries` came from, and the entries of it among `candidates` (by `save`, or by time for entries without one). */
export function sameSave(entry: Entry, candidates: Entry[]): Entry[] {
  return entry.save ? candidates.filter((e) => e.save === entry.save) : candidates.filter((e) => !e.save && e.ts === entry.ts);
}

/** Why a value can't be saved as it is: empty when required, or outside a number input's min and max. */
export function inputProblem(panel: InputPanel, value: InputValue): string | undefined {
  const o = panel.options;
  const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
  if (empty) return o.required && INPUT_OPTION_KEYS[panel.type]?.includes('required') ? 'Required' : undefined;
  if ((panel.type === 'input-number' || panel.type === 'input-slider') && typeof value === 'number') {
    const unit = o.unit ? ` ${o.unit}` : '';
    if (typeof o.min === 'number' && value < o.min) return `At least ${o.min}${unit}`;
    if (typeof o.max === 'number' && value > o.max) return `At most ${o.max}${unit}`;
  }
  return undefined;
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
  const matches = entries.filter((e) => e.metric === withMetric && e.text?.trim().toLowerCase() === want);
  const saves = new Set(matches.map((e) => e.save).filter(Boolean));
  const times = new Set(matches.filter((e) => !e.save).map((e) => e.ts));
  return entries.filter((e) => e.metric === metric && (e.save ? saves.has(e.save) : times.has(e.ts)));
}
