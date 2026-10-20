import type { DataFrame } from './frame';
import type { Dashboard, TemplateVariable } from './schema';
import type { TimeRange } from './time';
import { formatDuration } from './time';

/**
 * Dashboard template variables. The current selection saved in the JSON is the starting
 * value. Options for custom/interval variables are read from the JSON; query variables are
 * re-run against their datasource by resolveVariables (see resolveVariables.ts), and until
 * then (or for datasources that can't run them) offer the options saved in the JSON.
 */

export type VariableValues = Record<string, string | string[]>;

export interface VarOption {
  text: string;
  value: string;
}

/** What interpolation needs to know about a variable beyond its value. */
export interface VariableInfo {
  multi?: boolean;
  includeAll?: boolean;
  allValue?: string | null;
  /** Never includes the synthetic All option. */
  options: VarOption[];
}

export const ALL = '$__all';

export function initialVariableValues(dashboard: Dashboard): VariableValues {
  const values: VariableValues = {};
  for (const v of dashboard.templating?.list ?? []) {
    const current = v.current?.value;
    if (current != null) values[v.name] = current;
    else if (v.type === 'constant' || v.type === 'textbox') values[v.name] = String(v.query ?? '');
    else {
      const first = variableOptions(v)[0];
      if (first) values[v.name] = first.value;
    }
  }
  return values;
}

export function variableOptions(v: TemplateVariable): VarOption[] {
  if (v.options?.length) {
    return v.options.map((o) => ({ text: String(o.text), value: String(o.value) }));
  }
  if ((v.type === 'custom' || v.type === 'interval') && typeof v.query === 'string') {
    // custom: "a, b, label : value"
    return v.query
      .split(/(?<!\\),/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [text, value] = s.split(/\s+:\s+/);
        return { text, value: value ?? text };
      });
  }
  const cur = v.current;
  return cur?.value != null ? [{ text: String(cur.text ?? cur.value), value: String(cur.value) }] : [];
}

/** Per-variable info for interpolation, preferring `resolved` options over the ones saved in the JSON. */
export function variableInfo(dashboard: Dashboard, resolved: Record<string, VarOption[]> = {}): Record<string, VariableInfo> {
  const info: Record<string, VariableInfo> = {};
  for (const v of dashboard.templating?.list ?? []) {
    const options = (resolved[v.name] ?? variableOptions(v)).filter((o) => o.value !== ALL);
    info[v.name] = { multi: v.multi, includeAll: v.includeAll, allValue: v.allValue, options };
  }
  return info;
}

export function visibleVariables(dashboard: Dashboard): TemplateVariable[] {
  // hide: 0 = show, 1 = hide label, 2 = hide variable
  return (dashboard.templating?.list ?? []).filter((v) => v.hide !== 2 && v.type !== 'constant' && v.type !== 'adhoc');
}

/** Datasources whose queries take multi-value variables as a quoted list, `'a','b'`, by default. */
export const isSqlDatasource = (type: string | undefined) => !!type && /postgres|mysql|mssql/.test(type);

/** Turn a variable query's result into options, using Grafana's SQL convention of `__text`/`__value` columns. */
export function framesToOptions(frames: DataFrame[]): VarOption[] {
  const out: VarOption[] = [];
  for (const frame of frames) {
    const text = frame.fields.find((f) => f.name === '__text');
    const value = frame.fields.find((f) => f.name === '__value');
    const first = frame.fields[0];
    const t = text ?? value ?? first;
    const v = value ?? text ?? first;
    if (!t || !v) continue;
    for (let i = 0; i < t.values.length; i++) {
      if (t.values[i] == null || v.values[i] == null) continue;
      out.push({ text: String(t.values[i]), value: String(v.values[i]) });
    }
  }
  return out;
}

/** Apply a query variable's `regex` and `sort`, and drop duplicate values, as Grafana does. */
export function refineOptions(v: TemplateVariable, options: VarOption[]): VarOption[] {
  let out = options;
  const regex = parseRegex(v.regex);
  if (regex) {
    out = out.flatMap((o) => {
      const m = o.text.match(regex);
      if (!m) return [];
      const g = m.groups;
      if (g?.text || g?.value) return [{ text: g.text ?? g.value, value: g.value ?? g.text }];
      return m[1] != null ? [{ text: m[1], value: m[1] }] : [o];
    });
  }
  const seen = new Set<string>();
  out = out.filter((o) => !seen.has(o.value) && seen.add(o.value));
  const sort = v.sort ?? 0;
  if (sort > 0) {
    const cmp = [
      (a: VarOption, b: VarOption) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
      (a: VarOption, b: VarOption) => leadingNumber(a.text) - leadingNumber(b.text) || 0,
      (a: VarOption, b: VarOption) => a.text.toLowerCase().localeCompare(b.text.toLowerCase()),
      (a: VarOption, b: VarOption) => a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' }),
    ][Math.floor((sort - 1) / 2)];
    if (cmp) {
      out = [...out].sort(cmp);
      if (sort % 2 === 0) out.reverse();
    }
  }
  return out;
}

/** The first number in an option's text, as Grafana's numeric sort uses; options without one sort first. */
function leadingNumber(text: string): number {
  const m = text.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : -Infinity;
}

function parseRegex(s: string | undefined): RegExp | undefined {
  if (!s) return undefined;
  const m = s.match(/^\/(.*)\/([a-z]*)$/s);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(s);
  } catch {
    return undefined;
  }
}

/**
 * Grafana's selection rules after a variable's options change: keep the current value if it's
 * still an option (for multi-value, keep whichever still are), keep All, otherwise take the first
 * option, which is All when the variable includes it.
 */
export function selectValue(v: TemplateVariable, current: string | string[] | undefined, options: VarOption[]): string | string[] {
  const cur = current == null ? [] : Array.isArray(current) ? current : [current];
  const wrap = (x: string) => (v.multi ? [x] : x);
  if (v.includeAll && cur.length === 1 && cur[0] === ALL) return wrap(ALL);
  const valid = cur.filter((c) => options.some((o) => o.value === c));
  if (valid.length) return v.multi ? valid : valid[0];
  if (v.includeAll) return wrap(ALL);
  return wrap(options[0]?.value ?? '');
}

/** Names of the other variables a variable's query refers to. */
export function variableReferences(v: TemplateVariable, names: Iterable<string>): string[] {
  const text = typeof v.query === 'string' ? v.query : JSON.stringify(v.query ?? '');
  return [...names].filter(
    (n) => n !== v.name && new RegExp(`\\$${n}\\b|\\$\\{${n}(:\\w+)?\\}|\\[\\[${n}(:\\w+)?\\]\\]`).test(text),
  );
}

interface InterpolateContext {
  values: VariableValues;
  /** Needed to expand All and for `:text`; without it All becomes `.*`. */
  info?: Record<string, VariableInfo>;
  /** Datasource type of the query being interpolated; picks the default multi-value format. */
  datasourceType?: string;
  range?: TimeRange;
  intervalMs?: number;
}

/**
 * Replace $var, ${var}, ${var:format} and [[var]] in a string. Built-ins that Grafana resolves
 * in the browser ($__interval, $__range, ...) are filled in too; anything unknown is left as-is.
 */
export function interpolate(text: string, ctx: InterpolateContext): string {
  const builtins = builtinValues(ctx);
  return text.replace(
    /\$(\w+)|\$\{(\w+)(?::(\w+))?\}|\[\[(\w+)(?::(\w+))?\]\]/g,
    (match, plain: string, braced: string, bracedFmt: string, old: string, oldFmt: string) => {
      const name = plain ?? braced ?? old;
      const format = bracedFmt ?? oldFmt;
      if (name in ctx.values) return formatVariable(ctx.values[name], format, ctx.info?.[name], ctx.datasourceType);
      return builtins[name] ?? match;
    },
  );
}

/** Deep-interpolate every string inside a query target. */
export function interpolateDeep<T>(value: T, ctx: InterpolateContext): T {
  if (typeof value === 'string') return interpolate(value, ctx) as T;
  if (Array.isArray(value)) return value.map((v) => interpolateDeep(v, ctx)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolateDeep(v, ctx)])) as T;
  }
  return value;
}

function builtinValues({ range, intervalMs }: InterpolateContext): Record<string, string> {
  const b: Record<string, string> = {};
  if (intervalMs) {
    b.__interval = formatDuration(intervalMs);
    b.__interval_ms = String(intervalMs);
    b.__rate_interval = formatDuration(Math.max(intervalMs * 4, 60_000));
  }
  if (range) {
    const ms = range.to - range.from;
    b.__range = `${Math.round(ms / 1000)}s`;
    b.__range_s = String(Math.round(ms / 1000));
    b.__range_ms = String(ms);
    b.__from = String(range.from);
    b.__to = String(range.to);
  }
  return b;
}

function formatVariable(value: string | string[], format: string | undefined, info: VariableInfo | undefined, dsType: string | undefined): string {
  let arr = Array.isArray(value) ? value : [value];
  const isAll = arr.length === 1 && arr[0] === ALL;
  const sql = isSqlDatasource(dsType);

  if (format === 'text') {
    if (isAll) return 'All';
    return arr.map((v) => info?.options.find((o) => o.value === v)?.text ?? v).join(' + ');
  }
  if (isAll) {
    if (info?.allValue) return info.allValue;
    if (info?.options.length) arr = info.options.map((o) => o.value);
    // Nothing to expand to: a regex wildcard for Prometheus-style queries, and a valid
    // match-nothing list for SQL rather than `in ()`.
    else return sql ? 'NULL' : '.*';
  }
  if (!format && sql && (info?.multi || info?.includeAll)) format = 'sqlstring';

  switch (format) {
    case 'csv':
    case 'raw':
      return arr.join(',');
    case 'pipe':
      return arr.join('|');
    case 'json':
      return JSON.stringify(arr.length === 1 ? arr[0] : arr);
    case 'singlequote':
      return arr.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(',');
    case 'sqlstring':
      return arr.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
    case 'doublequote':
      return arr.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',');
    default:
      // Grafana's default for multi-value in Prometheus-style queries is a regex alternation.
      return arr.length > 1 ? `(${arr.map(escapeRegex).join('|')})` : arr[0];
  }
}

/** The label to show for a variable's current value. */
export function valueText(value: string | string[] | undefined, info: VariableInfo | undefined): string {
  const arr = value == null ? [] : Array.isArray(value) ? value : [value];
  if (arr.length === 1 && arr[0] === ALL) return 'All';
  if (arr.length > 1) return `${arr.length} selected`;
  return arr[0] == null ? '' : (info?.options.find((o) => o.value === arr[0])?.text ?? arr[0]);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
