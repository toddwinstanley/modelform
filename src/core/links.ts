import type { DataFrame, Field } from './frame';
import { toMillis } from './frame';
import type { Dashboard, DataLink, TemplateVariable } from './schema';
import type { TimeRange } from './time';
import { interpolate, queryParam, type ScopedVars, type VariableInfo, type VariableValues } from './variables';

/** A link with its URL filled in, ready to open. */
export interface ResolvedLink {
  title: string;
  href: string;
  targetBlank: boolean;
}

/** What a data link was opened from: a chart point, table cell or reduced stat value. */
export interface LinkData {
  frame?: DataFrame;
  /** Row of `frame` the point or cell is in; unset for reduced values. */
  row?: number;
  field?: Field;
  /** The field's display name. */
  fieldName?: string;
  value?: unknown;
  /** The value as displayed, for `${__value.text}`. */
  text?: string;
  /** Epoch ms of the point, for `${__value.time}`. */
  time?: number;
  /** The reducer that produced a stat value, for `${__value.calc}`. */
  calc?: string;
  /** For `${__series.name}`; defaults to the frame name. */
  seriesName?: string;
}

export interface LinkContext {
  dashboard?: Dashboard;
  values: VariableValues;
  info?: Record<string, VariableInfo>;
  scoped?: ScopedVars;
  range?: TimeRange;
  timezone?: string;
  data?: LinkData;
}

// ${__value.raw}, ${__data.fields["Speed"]}, ${__from:date:iso}, ...
const MACRO = /\$\{(__(?:value|field|series|data|url_time_range|all_variables|dashboard|from|to)\b(?:\.[\w-]+|\[[^\]]*\])*)(?::([^}]+))?\}/g;

/** Fill in each link's URL and title. Links whose URL ends up empty are dropped. */
export function resolveLinks(links: DataLink[] | undefined, ctx: LinkContext): ResolvedLink[] {
  return (links ?? []).flatMap((l) => {
    const href = fillLink(l.url ?? '', ctx, true).replace(/\n/g, '');
    if (!href.trim()) return [];
    return [{ title: fillLink(l.title || href, ctx, false), href, targetBlank: !!l.targetBlank }];
  });
}

function fillLink(text: string, ctx: LinkContext, url: boolean): string {
  const withMacros = text.replace(MACRO, (match, path: string, format: string | undefined) => {
    const v = macro(path, format, ctx);
    if (v == null) return match;
    // These build their own query strings, already encoded.
    if (!url || format === 'raw' || /^__(url_time_range|all_variables)$/.test(path)) return v;
    return encodeURIComponent(v);
  });
  return interpolate(withMacros, {
    values: ctx.values,
    info: ctx.info,
    scoped: ctx.scoped,
    range: ctx.range,
    timezone: ctx.timezone,
    urlEncode: url,
  });
}

function macro(path: string, format: string | undefined, ctx: LinkContext): string | undefined {
  const d = ctx.data ?? {};
  const [head, ...rest] = path.split(/\.(?![^[]*\])/);
  switch (head) {
    case '__from':
    case '__to': {
      const ms = head === '__from' ? ctx.range?.from : ctx.range?.to;
      if (ms == null) return undefined;
      if (format === 'date' || format === 'date:iso') return new Date(ms).toISOString();
      if (format === 'date:seconds') return String(Math.floor(ms / 1000));
      return String(ms);
    }
    case '__url_time_range':
      return ctx.range ? `from=${urlTime(ctx.range.raw.from, ctx.range.from)}&to=${urlTime(ctx.range.raw.to, ctx.range.to)}` : undefined;
    case '__all_variables':
      return allVariables(ctx);
    case '__dashboard':
      if (!ctx.dashboard) return undefined;
      return rest[0] === 'uid' ? ctx.dashboard.uid : ctx.dashboard.title;
    case '__value':
      switch (rest[0] ?? 'raw') {
        case 'raw':
          return d.value == null ? undefined : String(d.value);
        case 'numeric':
          return d.value == null ? undefined : String(Number(d.value));
        case 'text':
          return d.text ?? (d.value == null ? undefined : String(d.value));
        case 'time':
          return d.time == null ? undefined : String(d.time);
        case 'calc':
          return d.calc;
      }
      return undefined;
    case '__field':
      if (!d.field) return undefined;
      if (rest[0] === 'name') return d.field.name;
      if (rest[0] === 'displayName') return d.fieldName ?? d.field.name;
      if (rest[0] === 'labels') {
        const labels = d.field.labels ?? {};
        return rest[1] ? labels[rest[1]] : Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(', ');
      }
      return undefined;
    case '__series':
      return rest[0] === 'name' ? d.seriesName ?? d.frame?.name ?? d.fieldName : undefined;
    case '__data': {
      // __data.fields.Speed, __data.fields["Speed"] or __data.fields[0], optionally .text/.numeric
      const m = /^fields(?:\.([\w-]+)|\["([^"]*)"\]|\[(\d+)\])/.exec(rest.join('.'));
      if (!m || !d.frame || d.row == null) return undefined;
      const key = m[1] ?? m[2];
      const f = key != null ? d.frame.fields.find((x) => x.name === key || x.config?.displayName === key) : d.frame.fields[Number(m[3])];
      const v = f?.values[d.row];
      if (v == null) return undefined;
      return f!.type === 'time' ? String(toMillis(v)) : String(v);
    }
  }
  return undefined;
}

/** How Grafana writes a time in a dashboard URL: relative times as-is, absolute ones as epoch ms. */
function urlTime(raw: string, ms: number): string {
  return raw.trim().startsWith('now') ? encodeURIComponent(raw.trim()) : String(ms);
}

function allVariables(ctx: LinkContext): string {
  const names = (ctx.dashboard?.templating?.list ?? []).filter((v) => v.type !== 'adhoc').map((v) => v.name);
  return (names.length ? names : Object.keys(ctx.values))
    .flatMap((n) => {
      const v = ctx.scoped?.[n]?.value ?? ctx.values[n];
      return v == null ? [] : [queryParam(n, v)];
    })
    .join('&');
}

/** What a link to a Grafana dashboard asks for: the dashboard, and optionally a time range and variable values. */
export interface DashboardLinkTarget {
  uid: string;
  from?: string;
  to?: string;
  vars: Record<string, string[]>;
}

/**
 * Recognise a link to a Grafana dashboard: `/d/<uid>[/<slug>]` with optional `from`, `to` and
 * `var-<name>` query parameters. Relative links count; absolute ones only on `grafanaUrl`'s host.
 */
export function parseDashboardLink(href: string, grafanaUrl?: string): DashboardLinkTarget | null {
  const m = /^(?:([a-z][a-z0-9+.-]*:)?\/\/([^/?#]+))?([^?#]*)(?:\?([^#]*))?/i.exec(href.trim());
  if (!m) return null;
  const [, scheme, host, rawPath = '', query = ''] = m;
  const base = grafanaUrl ? /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]+)([^?#]*)/i.exec(grafanaUrl.trim()) : null;
  if (host && (!base || base[1].toLowerCase() !== host.toLowerCase())) return null;
  if (scheme && !/^https?:$/i.test(scheme)) return null;
  // Grafana served from a sub-path (https://host/grafana/d/...).
  const prefix = (base?.[2] ?? '').replace(/\/+$/, '');
  const path = prefix && rawPath.startsWith(prefix + '/') ? rawPath.slice(prefix.length) : rawPath;
  const p = /^\/d\/([^/]+)(?:\/[^/]*)?\/?$/.exec(path);
  if (!p) return null;

  const target: DashboardLinkTarget = { uid: decodeURIComponent(p[1]), vars: {} };
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const key = decode(i < 0 ? pair : pair.slice(0, i));
    const value = i < 0 ? '' : decode(pair.slice(i + 1));
    if (key === 'from') target.from = value;
    else if (key === 'to') target.to = value;
    else if (key.startsWith('var-')) (target.vars[key.slice(4)] ??= []).push(value);
  }
  return target;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/**
 * The dashboard as a link asks to show it: its time range and the variables' current values
 * replaced by the link's. Epoch-ms times are kept as such; modelform parses them.
 */
export function applyDashboardLink(dashboard: Dashboard, target: Pick<DashboardLinkTarget, 'from' | 'to' | 'vars'>): Dashboard {
  const time = target.from || target.to ? { from: target.from || dashboard.time?.from || 'now-6h', to: target.to || dashboard.time?.to || 'now' } : dashboard.time;
  const list = dashboard.templating?.list.map((v): TemplateVariable => {
    const values = target.vars[v.name];
    if (!values?.length) return v;
    const value = v.multi ? values : values[0];
    const text = (Array.isArray(value) ? value : [value]).map((x) => (x === '$__all' ? 'All' : v.options?.find((o) => o.value === x)?.text ?? x));
    return { ...v, current: { text: v.multi ? (text as string[]) : (text[0] as string), value } };
  });
  return { ...dashboard, time, templating: list ? { ...dashboard.templating, list } : dashboard.templating };
}
