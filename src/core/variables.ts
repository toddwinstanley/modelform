import type { Dashboard, TemplateVariable } from './schema';
import type { TimeRange } from './time';
import { formatDuration } from './time';

/**
 * Dashboard template variables. The current selection saved in the JSON is used as the
 * starting value. Options for custom/interval variables are read from the JSON; options
 * for query variables would require a datasource-specific lookup, so for those the saved
 * `options` (or just `current`) are what's offered.
 */

export type VariableValues = Record<string, string | string[]>;

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

export function variableOptions(v: TemplateVariable): Array<{ text: string; value: string }> {
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

export function visibleVariables(dashboard: Dashboard): TemplateVariable[] {
  // hide: 0 = show, 1 = hide label, 2 = hide variable
  return (dashboard.templating?.list ?? []).filter((v) => v.hide !== 2 && v.type !== 'constant' && v.type !== 'adhoc');
}

interface InterpolateContext {
  values: VariableValues;
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
      const value = name in ctx.values ? ctx.values[name] : builtins[name];
      if (value === undefined) return match;
      return formatValue(value, format);
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

function formatValue(value: string | string[], format?: string): string {
  const arr = Array.isArray(value) ? value : [value];
  if (arr.length === 1 && arr[0] === '$__all') return '.*';
  switch (format) {
    case 'csv':
      return arr.join(',');
    case 'pipe':
      return arr.join('|');
    case 'json':
      return JSON.stringify(arr.length === 1 ? arr[0] : arr);
    case 'singlequote':
      return arr.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(',');
    case 'doublequote':
      return arr.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',');
    case 'raw':
      return arr.join(',');
    default:
      // Grafana's default for multi-value in Prometheus-style queries is a regex alternation.
      return arr.length > 1 ? `(${arr.map(escapeRegex).join('|')})` : arr[0];
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
