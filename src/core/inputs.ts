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
  | 'input-counter';

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
  /** Initial value: a literal, or "last" to start from the most recent entry. */
  default?: number | string | boolean | 'last';
  /** input-select only. */
  choices?: InputChoice[];
  /** input-select only: allow selecting several. Each selection is recorded as its own entry. */
  multi?: boolean;
  /** input-counter only: the amount each tap records (default 1). */
  increment?: number;
}

export type InputPanel = Panel & { type: InputType; options: InputOptions };

export const isInputPanel = (p: Panel): p is InputPanel => p.type.startsWith('input-') && !!p.options?.metric;

export function inputPanels(dashboard: Dashboard): InputPanel[] {
  const all = dashboard.panels.flatMap((p) => (p.type === 'row' ? [p, ...(p.panels ?? [])] : [p]));
  return all.filter(isInputPanel);
}

/** A form value as held by the UI before saving. */
export type InputValue = number | string | boolean | Array<number | string> | null;

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
