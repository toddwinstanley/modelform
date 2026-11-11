/**
 * Editing a dashboard's settings: its time options and its template variables, written the
 * way Grafana writes them so the JSON stays importable there.
 */
import type { Dashboard, Panel, TemplateVariable } from './schema';
import { ALL, selectValue, variableOptions } from './variables';

/** Auto-refresh intervals to offer; "" is off. */
export const REFRESH_CHOICES = ['', '30s', '1m', '5m', '15m', '30m', '1h'];

/** Variable types an editor can set up without a datasource to query. */
export const EDITABLE_VARIABLE_TYPES = ['custom', 'interval', 'textbox', 'constant'] as const;
export type EditableVariableType = (typeof EDITABLE_VARIABLE_TYPES)[number];

export const isEditableVariableType = (type: string): type is EditableVariableType => (EDITABLE_VARIABLE_TYPES as readonly string[]).includes(type);

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why `name` can't be a variable's name, or null if it can. `others` are the other variables' names. */
export function variableNameError(name: string, others: string[]): string | null {
  if (!name) return 'Give it a name';
  if (!NAME.test(name)) return 'Use letters, digits and _, not starting with a digit';
  if (name.startsWith('__')) return 'Names starting with __ are Grafana’s built-ins';
  if (others.includes(name)) return `There’s already a variable "${name}"`;
  return null;
}

const STARTERS: Record<EditableVariableType, { name: string; query: string }> = {
  custom: { name: 'choice', query: 'a, b, c' },
  interval: { name: 'interval', query: '1h,1d,1w' },
  textbox: { name: 'text', query: '' },
  constant: { name: 'constant', query: '' },
};

/** A new variable of `type`, named so it doesn't clash with `taken`. */
export function newVariable(type: EditableVariableType, taken: string[]): TemplateVariable {
  const base = STARTERS[type].name;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}${n}`;
  return variableWithType({ name, type }, type);
}

/** The variable as `type`, keeping its name, label and visibility and starting the rest afresh. */
export function variableWithType(v: TemplateVariable, type: EditableVariableType): TemplateVariable {
  const next: TemplateVariable = { name: v.name, type };
  if (v.label) next.label = v.label;
  // Constants are hidden in Grafana by default; anything else that was hidden that way is shown again.
  if (type === 'constant') next.hide = 2;
  else if (v.hide === 1) next.hide = 1;
  return variableWithQuery(next, STARTERS[type].query);
}

/** `{ text, value }` for a selection, as Grafana saves `current`. */
function currentFor(v: TemplateVariable, value: string | string[]): TemplateVariable['current'] {
  const options = variableOptions({ ...v, current: undefined });
  const text = (x: string) => (x === ALL ? 'All' : options.find((o) => o.value === x)?.text ?? x);
  return Array.isArray(value) ? { text: value.map(text), value } : { text: text(value), value };
}

/**
 * The variable with a new query: custom and interval options, a textbox's default or a
 * constant's value. The selection is kept where it's still an option, as Grafana does; saved
 * `options` are dropped, since they'd override the query.
 */
export function variableWithQuery(v: TemplateVariable, query: string): TemplateVariable {
  const { options: _, current, ...rest } = v;
  const next: TemplateVariable = { ...rest, query };
  if (v.type === 'textbox' || v.type === 'constant') return { ...next, current: { text: query, value: query } };
  const value = selectValue(next, current?.value as string | string[] | undefined, variableOptions(next));
  return { ...next, current: currentFor(next, value) };
}

/** The variable with `value` selected by default. */
export function variableWithCurrent(v: TemplateVariable, value: string | string[]): TemplateVariable {
  return { ...v, current: currentFor(v, value) };
}

/** The variable with multi-value or All turned on or off, its selection adjusted to suit. */
export function variableWithFlags(v: TemplateVariable, flags: { multi?: boolean; includeAll?: boolean }): TemplateVariable {
  const next = { ...v, ...flags };
  if (!next.multi) delete next.multi;
  if (!next.includeAll) delete next.includeAll;
  const raw = v.current?.value as string | string[] | undefined;
  const current = next.multi ? (raw == null ? [] : Array.isArray(raw) ? raw : [raw]) : Array.isArray(raw) ? raw[0] : raw;
  return variableWithCurrent(next, selectValue(next, current, variableOptions({ ...next, current: undefined })));
}

const refers = (name: string, flags?: string) =>
  new RegExp(`\\$${name}\\b|\\$\\{${name}(:\\w+)?\\}|\\[\\[${name}(:\\w+)?\\]\\]`, flags);

function allPanels(dashboard: Dashboard): Panel[] {
  return (dashboard.panels ?? []).flatMap((p) => (p?.type === 'row' ? [p, ...(p.panels ?? [])] : [p])).filter((p) => p && typeof p === 'object');
}

/** Titles of the panels that use variable `name`: in a query, a title, options, or repeating by it. */
export function variableUses(dashboard: Dashboard, name: string): string[] {
  const re = refers(name);
  return allPanels(dashboard)
    .filter((p) => p.repeat === name || re.test(JSON.stringify({ ...p, panels: undefined })))
    .map((p) => p.title || (p.type === 'row' ? 'A section' : `Panel ${p.id}`));
}

/** Panels with every use of variable `from` (references and repeats) changed to `to`. */
export function renameVariableInPanels(panels: Panel[], from: string, to: string): Panel[] {
  const re = refers(from, 'g');
  const swap = (s: string) => s.replace(re, (m) => m.replace(from, to));
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') return key === 'repeat' && value === from ? to : swap(value);
    if (Array.isArray(value)) return value.map((v) => walk(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    return value;
  };
  return walk(panels) as Panel[];
}
